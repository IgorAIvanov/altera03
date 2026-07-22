export class AuthenticationRequiredError extends Error {
  readonly status = 401;

  constructor(message = "Необхідна авторизація") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

/**
 * Заголовки запиту. Danet передає в `@Req()` не завжди справжній `Request`:
 * буває обгортка, у якої сам запит лежить у `raw`/`req`/`request`, а `headers`
 * на верхньому рівні немає. Звертатися до `req.headers.get()` напряму тому не
 * можна — впаде на undefined.
 */
export function getRequestHeaders(request: unknown): Headers | null {
  if (!request || typeof request !== "object") {
    return null;
  }

  const record = request as Record<string, unknown>;
  if (record.headers instanceof Headers) {
    return record.headers;
  }

  for (const candidate of [record.raw, record.req, record.request]) {
    if (!candidate || typeof candidate !== "object") continue;
    const headers = (candidate as Record<string, unknown>).headers;
    if (headers instanceof Headers) return headers;
  }

  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}