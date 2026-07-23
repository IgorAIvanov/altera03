export class AuthenticationRequiredError extends Error {
  readonly status = 401;

  constructor(message = "Необхідна авторизація") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

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

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
