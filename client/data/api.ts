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
 */

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
 * її не вдалося — решту статусів віддає викликові як є.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, withDefaults(init));
  if (response.status !== 401 || isAuthRequest(path)) {
    return response;
  }

  if (await refreshSession()) {
    const retried = await fetch(path, withDefaults(init));
    if (retried.status !== 401) {
      return retried;
    }
  }

  onSessionLost();
  throw new UnauthorizedError();
}

/** Запит із розбором JSON-конверта. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  return await response.json() as T;
}

/** POST з JSON-тілом — найчастіший випадок. */
export function apiPost<T>(path: string, payload: unknown): Promise<T> {
  return apiJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
}
