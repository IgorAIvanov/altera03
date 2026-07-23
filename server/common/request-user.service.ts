import { Injectable } from "@danet/core";
import { AuthenticationRequiredError, type HttpRequest, resolveSessionToken } from "./http.ts";
import { getServerConfig } from "../config/server-config.ts";
import { DatabaseService } from "../database/database.service.ts";

const BIGINT_ID_PATTERN = /^\d+$/;

interface SessionUserRow {
  user_id: string;
  session_id: string;
}

/**
 * Хто виконує запит. `sessionId` порожній, коли сесії немає (dev-bypass або
 * агент) — токени вкладень тоді не прив'язані до сесії й живуть до
 * протермінування.
 */
export interface RequestAuthContext {
  userId: string;
  sessionId: string;
}

interface ActiveUserRow {
  id: string;
}

function normalizeUserId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && BIGINT_ID_PATTERN.test(normalized) ? normalized : null;
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

  async resolveUserId(request: HttpRequest, payload?: unknown): Promise<string> {
    return (await this.resolveAuthContext(request, payload)).userId;
  }

  /**
   * Користувач + сесія. Сесія потрібна там, де право доступу переїжджає в
   * URL (токени вкладень): такий токен має вмирати разом із сесією.
   */
  async resolveAuthContext(request: HttpRequest, _payload?: unknown): Promise<RequestAuthContext> {
    const session = await this.resolveSession(request);
    if (session) {
      return session;
    }

    const devBypassUserId = await this.resolveDevBypassUserId(request);
    if (devBypassUserId) {
      return { userId: devBypassUserId, sessionId: "" };
    }

    throw new AuthenticationRequiredError();
  }

  /**
   * Обхід авторизації для розробки. Несумісність із продуктивом перевіряється
   * при збиранні конфігурації (`configFromEnv`), тому сюди ми потрапляємо, лише
   * якщо застосунок дозволив обхід свідомо.
   */
  private async resolveDevBypassUserId(request: HttpRequest): Promise<string | null> {
    const devBypass = getServerConfig().auth.devBypass;
    if (!devBypass) {
      return null;
    }

    const candidateUserId = normalizeUserId(request.header("x-dev-user-id") ?? devBypass.userId);
    if (candidateUserId) {
      const rows = await this.db.sql<ActiveUserRow[]>`
        select u.id::text as id
        from app.users u
        where u.id = ${candidateUserId}::bigint
          and u.is_active = true
        limit 1
      `;

      if (!rows[0]?.id) {
        throw new AuthenticationRequiredError("dev-bypass user id points to a missing or inactive user");
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
      throw new AuthenticationRequiredError("dev-bypass is enabled but no active user exists");
    }

    return rows[0].id;
  }

  private async resolveSession(request: HttpRequest): Promise<RequestAuthContext | null> {
    const token = resolveSessionToken(request)?.token ?? null;
    if (!token) {
      return null;
    }

    const tokenHash = await hashToken(token);
    const rows = await this.db.sql<SessionUserRow[]>`
      SELECT s.user_id, s.id::text as session_id
      FROM app.auth_session s
      JOIN app.users u ON u.id = s.user_id
      WHERE s.token_hash = ${tokenHash}
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.is_active = true
      LIMIT 1
    `;

    const row = rows[0];
    return row ? { userId: row.user_id, sessionId: row.session_id } : null;
  }
}