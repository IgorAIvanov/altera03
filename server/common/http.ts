import { getServerConfig } from "../config/server-config.ts";

export class AuthenticationRequiredError extends Error {
  readonly status = 401;

  constructor(message = "Необхідна авторизація") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

/**
 * Клієнт діяв від імені одного користувача, а cookie належить іншому.
 *
 * Так виглядає вхід під другим користувачем у сусідній вкладці: cookie одна на
 * все походження, тож вона міняється відразу всюди, а сторінка, відкрита раніше,
 * про це не знає — вона й далі показує попереднє ім'я і його права. Без цієї
 * перевірки запит просто виконався б, і документ отримав би автором того, чия
 * cookie зараз лежить у браузері. Для бухгалтерської системи це найгірший
 * різновид помилки: слід аудиту бреше, а ознак немає жодних.
 *
 * 409, а не 401: сесія жива й цілком дійсна — не збігається намір із фактом.
 * Перевірка стоїть ДО виконання команди, тому запис не встигає піти під чужим
 * іменем; виявляти таке постфактум було б запізно.
 */
export class SessionChangedError extends Error {
  readonly status = 409;

  constructor(message = "Сесію змінено в іншій вкладці. Сторінку буде перезавантажено.") {
    super(message);
    this.name = "SessionChangedError";
  }
}

/** Кого клієнт вважає поточним користувачем. Порожній — не перевіряємо. */
export const SESSION_USER_HEADER = "x-session-user";

/**
 * Позначка відповіді про розбіжність. Окремий заголовок, а не «будь-який 409»:
 * 409 колись знадобиться і для звичайного конфлікту даних, і плутати їх не можна.
 */
export const SESSION_CHANGED_HEADER = "x-session-changed";

/**
 * Запит у тому вигляді, в якому його віддає `@Req()`.
 *
 * Це **не** WHATWG `Request`: Danet резолвить параметр як `context.req`, тобто
 * обгортку Hono. Заголовки читаються через `header()`, а справжній запит лежить
 * у `raw` — саме тому пряме `req.headers.get()` падало на undefined.
 *
 * Оголошено структурно, щоб Hono не протікав у типи застосунку: якщо колись
 * міняємо HTTP-шар, правити треба тільки цей інтерфейс.
 */
export interface HttpRequest {
  readonly raw: Request;
  readonly url: string;
  readonly method: string;
  header(name: string): string | undefined;
  json(): Promise<unknown>;
  formData(): Promise<FormData>;
}

/** Методи, що не змінюють стан: для них CSRF-перевірка не потрібна. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Заголовок, який браузер не може підставити крос-доменно без preflight.
 * CORS ми не вмикаємо, тож preflight нікуди не приходить — наявність цього
 * заголовка означає, що запит зробив наш власний код.
 */
export const CSRF_HEADER = "x-requested-with";

/** Звідки взявся токен: від цього залежить, чи потрібна CSRF-перевірка. */
export type TokenSource = "cookie" | "bearer";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

/** Токен зі схеми `Authorization: Bearer …`, або null, якщо його немає. */
export function bearerToken(request: HttpRequest): string | null {
  const header = request.header("authorization");
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim() || null;
}

/** Значення cookie за іменем. */
export function cookieValue(request: HttpRequest, name: string): string | null {
  const header = request.header("cookie");
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim()) || null;
  }

  return null;
}

/**
 * Токен сесії поточного запиту.
 *
 * Два джерела й різне ставлення до них:
 *
 *  · **cookie** — браузер шле її сам, тому запит міг ініціювати чужий сайт.
 *    Для методів, що змінюють стан, вимагаємо {@link CSRF_HEADER}: крос-доменно
 *    його не поставити, бо для цього потрібен preflight, а CORS ми не вмикаємо.
 *    Разом із `SameSite=Strict` це два незалежні бар'єри.
 *
 *  · **Authorization: Bearer** — заголовок, який чужа сторінка підставити не
 *    може з тієї ж причини. Ambient-credentials тут немає, CSRF не загрожує:
 *    цей шлях лишається для скриптів і сторонніх клієнтів.
 */
export function resolveSessionToken(request: HttpRequest): ResolvedToken | null {
  const fromCookie = cookieValue(request, getServerConfig().auth.cookie.name);
  if (fromCookie) {
    if (!SAFE_METHODS.has(request.method.toUpperCase()) && !request.header(CSRF_HEADER)) {
      return null;
    }

    return { token: fromCookie, source: "cookie" };
  }

  const fromHeader = bearerToken(request);
  return fromHeader ? { token: fromHeader, source: "bearer" } : null;
}

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}
