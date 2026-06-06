import { Injectable } from "@danet/core";
import { AuthenticationRequiredError } from "./http.ts";
import { DatabaseService } from "../database/database.service.ts";

const BIGINT_ID_PATTERN = /^\d+$/;

interface SessionUserRow {
  user_id: string;
}

interface ActiveUserRow {
  id: string;
}

function getHeaders(request: unknown): Headers | null {
  if (!request || typeof request !== "object") {
    return null;
  }

  const requestRecord = request as Record<string, unknown>;
  const directHeaders = requestRecord.headers;
  if (directHeaders instanceof Headers) {
    return directHeaders;
  }

  const nestedCandidates = [requestRecord.raw, requestRecord.req, requestRecord.request];
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

function getBearerToken(request: unknown): string | null {
  const header = getHeaders(request)?.get("authorization");
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim() || null;
}

function normalizeUserId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && BIGINT_ID_PATTERN.test(normalized) ? normalized : null;
}

function isProductionEnvironment() {
  const values = [
    Deno.env.get("NODE_ENV"),
    Deno.env.get("APP_ENV"),
    Deno.env.get("DENO_ENV"),
  ];

  return values.some((value) => {
    const normalized = value?.trim().toLowerCase();
    return normalized === "production" || normalized === "prod";
  });
}

function isDevAuthBypassEnabled() {
  const raw = Deno.env.get("DEV_AUTH_BYPASS")?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function getDevBypassUserIdCandidate(request: unknown) {
  const headers = getHeaders(request);
  return normalizeUserId(
    headers?.get("x-dev-user-id")
      ?? Deno.env.get("DEV_AUTH_USER_ID")
      ?? Deno.env.get("DEFAULT_USER_ID"),
  );
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

@Injectable()
export class RequestUserService {
  constructor(private db: DatabaseService) {}

  async resolveUserId(request: Request, payload?: unknown): Promise<string> {
    const sessionUserId = await this.resolveSessionUserId(request);
    if (sessionUserId) {
      return sessionUserId;
    }

    const devBypassUserId = await this.resolveDevBypassUserId(request);
    if (devBypassUserId) {
      return devBypassUserId;
    }

    throw new AuthenticationRequiredError();
  }

  private async resolveDevBypassUserId(request: Request): Promise<string | null> {
    if (!isDevAuthBypassEnabled()) {
      return null;
    }

    if (isProductionEnvironment()) {
      throw new Error("DEV_AUTH_BYPASS must not be enabled in production");
    }

    const candidateUserId = getDevBypassUserIdCandidate(request);
    if (candidateUserId) {
      const rows = await this.db.sql<ActiveUserRow[]>`
        select u.id::text as id
        from app.users u
        where u.id = ${candidateUserId}::bigint
          and u.is_active = true
        limit 1
      `;

      if (!rows[0]?.id) {
        throw new AuthenticationRequiredError("DEV_AUTH_USER_ID points to a missing or inactive user");
      }

      return rows[0].id;
    }

    const rows = await this.db.sql<ActiveUserRow[]>`
      select u.id::text as id
      from app.users u
      where u.is_active = true
      order by u.id
      limit 1
    `;

    if (!rows[0]?.id) {
      throw new AuthenticationRequiredError("DEV_AUTH_BYPASS is enabled but no active user exists");
    }

    return rows[0].id;
  }

  private async resolveSessionUserId(request: Request): Promise<string | null> {
    const token = getBearerToken(request);
    if (!token) {
      return null;
    }

    const tokenHash = await hashToken(token);
    const rows = await this.db.sql<SessionUserRow[]>`
      SELECT s.user_id
      FROM app.auth_session s
      JOIN app.users u ON u.id = s.user_id
      WHERE s.token_hash = ${tokenHash}
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.is_active = true
      LIMIT 1
    `;

    return rows[0]?.user_id ?? null;
  }
}