const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const FALLBACK_USER_ID = "00000000-0000-0000-0000-000000000000";

function getHeaders(request: unknown): Headers | null {
  if (!request || typeof request !== "object") {
    return null;
  }

  const requestRecord = request as Record<string, unknown>;
  const directHeaders = requestRecord.headers;
  if (directHeaders instanceof Headers) {
    return directHeaders;
  }

  const nestedCandidates = [
    requestRecord.raw,
    requestRecord.req,
    requestRecord.request,
  ];

  for (const candidate of nestedCandidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const candidateHeaders = (candidate as Record<string, unknown>).headers;
    if (candidateHeaders instanceof Headers) {
      return candidateHeaders;
    }
  }

  return null;
}

function getHeaderUserId(request: unknown): string | null {
  const headers = getHeaders(request);
  if (!headers) {
    return null;
  }

  const headerValue = headers.get("x-user-id")
    ?? headers.get("x-altera-user-id")
    ?? headers.get("x-userid");

  if (!headerValue) {
    return null;
  }

  const normalizedHeader = headerValue.trim();
  return UUID_PATTERN.test(normalizedHeader) ? normalizedHeader : null;
}

function getPayloadUserId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>).userId;
  return typeof value === "string" && UUID_PATTERN.test(value.trim()) ? value.trim() : null;
}

export function resolveRequestUserId(request: Request, payload?: unknown): string {
  const envUserId = Deno.env.get("DEFAULT_USER_ID")?.trim();

  return getHeaderUserId(request)
    ?? getPayloadUserId(payload)
    ?? (envUserId && UUID_PATTERN.test(envUserId) ? envUserId : null)
    ?? FALLBACK_USER_ID;
}
