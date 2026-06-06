import { Injectable } from "@danet/core";

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

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

@Injectable()
export class AuthTokenService {
  generateOpaqueToken(): string {
    return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  }

  async hashToken(token: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return bytesToHex(new Uint8Array(digest));
  }

  extractBearerToken(request: unknown): string | null {
    const headers = getHeaders(request);
    const header = headers?.get("authorization");
    if (!header) {
      return null;
    }

    const [scheme, token] = header.split(/\s+/, 2);
    if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
      return null;
    }

    return token.trim() || null;
  }
}