/**
 * Єдина двері назовні: усі запити до /api ходять через `apiFetch`.
 *
 * Раніше `fetch` викликався у восьми місцях, і кожне довелося б навчати
 * авторизації окремо. Тепер авторизація — властивість транспорту:
 *
 *  · Токен сесії лежить у httpOnly-cookie, тож JS його не бачить і не носить —
 *    браузер підставляє сам. Нам лишається `credentials: "same-origin"`.
 *
 *  · Заголовок `X-Requested-With` — друга половина захисту від CSRF. Чужа
 *    сторінка не може його поставити (для цього потрібен preflight, а CORS
 *    сервер не вмикає), тому сервер відкидає зміни стану без нього.
 *
 *  · 401 — не помилка, а сигнал «сесія протермінувалася»: пробуємо один раз
 *    продовжити її і повторюємо запит. Не вийшло — повідомляємо застосунок,
 *    щоб той показав вхід.
 *
 *  · Недоступний сервер — теж властивість транспорту, а не турбота кожного
 *    виклику. Тут його видно раніше за всіх, тож звідси й показується екран
 *    {@link showServerUnavailable}.
 */
import { showServerUnavailable } from "../shell/server-unavailable.ts";

/** Той самий заголовок, що перевіряє сервер (server/common/http.ts). */
const CSRF_HEADER = "x-requested-with";
const CSRF_VALUE = "altera";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class UnauthorizedError extends Error {
  constructor(message = "Необхідна авторизація") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Сервер не відповів — або відповів не своєю мовою.
 *
 * Це НЕ те саме, що помилка на сервері. Наш API відповідає конвертом завжди,
 * включно з відмовами й недоступною базою, — і така відповідь має адресатом
 * екран, який її показує. Ця ж помилка означає, що відповідати нема кому:
 * процес не піднятий, dev-проксі не має куди проксювати, мережа зникла.
 * Розрізняти обов'язково: «база недоступна» лікується адміністратором,
 * «сервера немає» — запуском сервера.
 */
export class ServerUnavailableError extends Error {
  constructor(message = "Сервер недоступний") {
    super(message);
    this.name = "ServerUnavailableError";
  }
}

/** Конверт API — один на всі відповіді (server/common/response.ts). */
export interface ApiEnvelope<TItem = unknown, TRow = unknown> {
  ok: boolean;
  data: {
    item: TItem | null;
    rows: TRow[];
    options: Record<string, unknown>;
    totals: Record<string, unknown>;
  };
  messages: string[];
}

type SessionLostHandler = () => void;

let onSessionLost: SessionLostHandler = () => {};

/** Кого сповістити, коли сесію продовжити не вдалося. */
export function setSessionLostHandler(handler: SessionLostHandler): void {
  onSessionLost = handler;
}

/** Чи це запит самої авторизації — їх повторювати не можна, буде рекурсія. */
function isAuthRequest(path: string): boolean {
  return path.startsWith("/api/auth/");
}

function withDefaults(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();

  if (!SAFE_METHODS.has(method)) {
    headers.set(CSRF_HEADER, CSRF_VALUE);
  }

  return { ...init, headers, credentials: "same-origin" };
}

/**
 * `fetch`, який відхиляється лише з однієї причини — сервера немає.
 *
 * `fetch` кидає `TypeError` і на обрив з'єднання, і на DNS, і на відмову в
 * підключенні; розрізнити їх із браузера не можна, та й не треба — для
 * користувача це одне й те саме. Розрізняти важливо інше: ця помилка ніколи не
 * означає, що з запитом щось не так.
 */
async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch (error) {
    // AbortError — це наше власне скасування, а не збій сервера.
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    reportServerUnavailable(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    throw new ServerUnavailableError();
  }
}

function reportServerUnavailable(detail: string): void {
  console.error("[api] сервер недоступний —", detail);
  showServerUnavailable(detail);
}

let refreshing: Promise<boolean> | null = null;

/** Продовження сесії. Паралельні 401 чекають на один запит, а не шлють свій. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", withDefaults({ method: "POST" }))
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });

  return refreshing;
}

/**
 * Запит до API. Кидає {@link UnauthorizedError}, якщо сесії немає і продовжити
 * її не вдалося, та {@link ServerUnavailableError}, якщо сервер не відповів —
 * решту статусів віддає викликові як є.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await send(path, withDefaults(init));
  if (response.status !== 401 || isAuthRequest(path)) {
    return response;
  }

  if (await refreshSession()) {
    const retried = await send(path, withDefaults(init));
    if (retried.status !== 401) {
      return retried;
    }
  }

  onSessionLost();
  throw new UnauthorizedError();
}

/**
 * Розбір конверта, який може виявитися не конвертом.
 *
 * `response.json()` тут — найкоротший шлях до незрозумілої помилки: коли бекенд
 * лежить, до браузера доходить сторінка помилки dev-проксі, і замість причини
 * користувач бачив «Unexpected token '<'». Наш сервер відповідає конвертом
 * завжди — навіть на 500 і 503, — тож тіло не-JSON означає, що відповідав не він.
 */
export async function readEnvelope<TItem = unknown, TRow = unknown>(
  response: Response,
): Promise<ApiEnvelope<TItem, TRow>> {
  const text = await response.text();

  try {
    return JSON.parse(text) as ApiEnvelope<TItem, TRow>;
  } catch {
    reportServerUnavailable(`${response.url || "запит"}: HTTP ${response.status}, відповідь не JSON`);
    throw new ServerUnavailableError(`Сервер відповів не так, як мав (HTTP ${response.status}).`);
  }
}

/** Запит із розбором JSON-конверта. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  return await readEnvelope(response) as T;
}

/** POST з JSON-тілом — найчастіший випадок. */
export function apiPost<T>(path: string, payload: unknown): Promise<T> {
  return apiJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
}
