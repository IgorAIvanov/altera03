import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";
import { AuthTokenService } from "./auth-token.service.ts";
import type { AuthSessionInfo, AuthSessionRow, AuthUserDto, AuthUserRow } from "./auth.types.ts";
import { toAuthUserDto } from "./auth.types.ts";

interface SessionLookupRow extends AuthUserRow {
  session_id: string;
  auth_method: string;
  expires_at: string;
}

interface SessionStateRow {
  session_id: string;
  user_id: string;
  auth_method: string;
  expires_at: string;
}

function getSessionLifetimeMs(): number {
  const defaultHours = 24 * 30;
  const rawHours = Number.parseInt(Deno.env.get("AUTH_SESSION_TTL_HOURS") ?? String(defaultHours), 10);
  const hours = Number.isFinite(rawHours) && rawHours > 0 ? rawHours : defaultHours;
  return hours * 60 * 60 * 1000;
}

@Injectable()
export class AuthSessionService {
  constructor(private db: DatabaseService, private tokenService: AuthTokenService) {}

  async createSession(user: AuthUserDto, authMethod: string): Promise<AuthSessionInfo> {
    const token = this.tokenService.generateOpaqueToken();
    const tokenHash = await this.tokenService.hashToken(token);
    const expiresAt = new Date(Date.now() + getSessionLifetimeMs()).toISOString();

    const rows = await this.db.sql<AuthSessionRow[]>`
      INSERT INTO app.auth_session (user_id, auth_method, token_hash, expires_at, last_seen_at)
      VALUES (${user.id}::bigint, ${authMethod}, ${tokenHash}, ${expiresAt}::timestamptz, NOW())
      RETURNING id, user_id, auth_method, expires_at
    `;

    const session = rows[0];
    return {
      id: session.id,
      authMethod: session.auth_method,
      token,
      expiresAt: session.expires_at,
    };
  }

  async resolveSessionUser(request: Request): Promise<{ user: AuthUserDto; session: AuthSessionInfo } | null> {
    const token = this.tokenService.extractBearerToken(request);
    if (!token) {
      return null;
    }

    const rows = await this.db.sql<SessionLookupRow[]>`
      SELECT
        s.id as session_id,
        s.auth_method,
        s.expires_at,
        u.id,
        u.login,
        u.full_name,
        u.password_hash,
        u.is_active
      FROM app.auth_session s
      JOIN app.users u ON u.id = s.user_id
      WHERE s.token_hash = ${await this.tokenService.hashToken(token)}
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.is_active = true
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      return null;
    }

    await this.db.sql`
      UPDATE app.auth_session
      SET last_seen_at = NOW(), updated_at = NOW()
      WHERE id = ${row.session_id}::uuid
    `;

    return {
      user: toAuthUserDto(row),
      session: {
        id: row.session_id,
        authMethod: row.auth_method,
        token,
        expiresAt: row.expires_at,
      },
    };
  }

  async refreshSession(request: Request): Promise<AuthSessionInfo | null> {
    const token = this.tokenService.extractBearerToken(request);
    if (!token) {
      return null;
    }

    const currentSession = await this.findActiveSession(token);
    if (!currentSession) {
      return null;
    }

    const nextToken = this.tokenService.generateOpaqueToken();
    const nextTokenHash = await this.tokenService.hashToken(nextToken);
    const nextExpiresAt = new Date(Date.now() + getSessionLifetimeMs()).toISOString();

    const rows = await this.db.sql<AuthSessionRow[]>`
      UPDATE app.auth_session
      SET token_hash = ${nextTokenHash},
          expires_at = ${nextExpiresAt}::timestamptz,
          last_seen_at = NOW(),
          updated_at = NOW()
      WHERE id = ${currentSession.session_id}::uuid
        AND revoked_at IS NULL
      RETURNING id, user_id, auth_method, expires_at
    `;

    const session = rows[0];
    if (!session) {
      return null;
    }

    return {
      id: session.id,
      authMethod: session.auth_method,
      token: nextToken,
      expiresAt: session.expires_at,
    };
  }

  async revokeSession(request: Request): Promise<boolean> {
    const token = this.tokenService.extractBearerToken(request);
    if (!token) {
      return false;
    }

    const tokenHash = await this.tokenService.hashToken(token);
    const rows = await this.db.sql<{ id: string }[]>`
      UPDATE app.auth_session
      SET revoked_at = NOW(), updated_at = NOW()
      WHERE token_hash = ${tokenHash}
        AND revoked_at IS NULL
      RETURNING id
    `;

    return rows.length > 0;
  }

  private async findActiveSession(token: string): Promise<SessionStateRow | null> {
    const tokenHash = await this.tokenService.hashToken(token);
    const rows = await this.db.sql<SessionStateRow[]>`
      SELECT
        s.id as session_id,
        s.user_id,
        s.auth_method,
        s.expires_at
      FROM app.auth_session s
      JOIN app.users u ON u.id = s.user_id
      WHERE s.token_hash = ${tokenHash}
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.is_active = true
      LIMIT 1
    `;

    return rows[0] ?? null;
  }
}