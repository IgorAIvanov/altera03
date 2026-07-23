/**
 * Cookie сесії.
 *
 * Токен віддається браузеру тільки так — httpOnly, тобто недосяжний для JS.
 * У тілі відповіді його немає навмисно: інакше сторінка могла б покласти його
 * в localStorage, і весь сенс httpOnly зник би.
 *
 * Скрипти й сторонні клієнти не постраждали: `Authorization: Bearer` працює
 * як працював, просто токен вони беруть із заголовка `set-cookie` самі.
 */
import { getServerConfig } from "../../config/server-config.ts";

function serialize(value: string, maxAgeSeconds: number): string {
  const { name, secure, sameSite, path } = getServerConfig().auth.cookie;

  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `Max-Age=${maxAgeSeconds}`,
    `SameSite=${sameSite}`,
    "HttpOnly",
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

/** Заголовки, що встановлюють cookie сесії на весь її строк життя. */
export function sessionCookieHeaders(token: string): Record<string, string> {
  return { "set-cookie": serialize(token, getServerConfig().auth.sessionTtlHours * 60 * 60) };
}

/** Заголовки, що гасять cookie: порожнє значення й нульовий строк. */
export function clearSessionCookieHeaders(): Record<string, string> {
  return { "set-cookie": serialize("", 0) };
}
