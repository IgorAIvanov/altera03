export class AuthenticationRequiredError extends Error {
  readonly status = 401;

  constructor(message = "Необхідна авторизація") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}