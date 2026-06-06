import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";
import { AuthUserRow } from "./auth.types.ts";

@Injectable()
export class AuthService {
  constructor(private db: DatabaseService) {}

  async hasAnyUsers(): Promise<boolean> {
    const rows = await this.db.sql<{ has_users: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM app.users) as has_users
    `;

    return rows[0]?.has_users ?? false;
  }

  async findUserByLogin(login: string): Promise<AuthUserRow | null> {
    const rows = await this.db.sql<AuthUserRow[]>`
      SELECT id, login, password_hash, full_name, is_active
      FROM app.users
      WHERE login = ${login} AND is_active = true
    `;
    return rows[0] ?? null;
  }

  async findUserById(id: string): Promise<AuthUserRow | null> {
    const rows = await this.db.sql<AuthUserRow[]>`
      SELECT id, login, full_name, is_active
      FROM app.users
      WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }

  async findFirstActiveUser(): Promise<AuthUserRow | null> {
    const rows = await this.db.sql<AuthUserRow[]>`
      SELECT id, login, full_name, is_active
      FROM app.users
      WHERE is_active = true
      ORDER BY created_at, login
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async createUser(login: string, passwordHash: string, fullName: string) {
    const rows = await this.db.sql<AuthUserRow[]>`
      INSERT INTO app.users (login, password_hash, full_name)
      VALUES (${login}, ${passwordHash}, ${fullName})
      RETURNING id, login, full_name
    `;
    return rows[0];
  }

  async ensureDefaultAccess(userId: string) {
    await this.db.sql`
      INSERT INTO app.user_group_member (user_group_id, user_id, is_active)
      SELECT ug.id, ${userId}::bigint, true
      FROM app.user_group ug
      WHERE ug.code = 'default'
      ON CONFLICT (user_group_id, user_id) DO UPDATE
      SET
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    `;

    await this.db.sql`
      INSERT INTO app.user_interface (user_id, interface_id, sort_order, is_active)
      SELECT ${userId}::bigint, i.id, 10, true
      FROM app.interface i
      WHERE i.code = 'default'
      ON CONFLICT (user_id, interface_id) DO UPDATE
      SET
        sort_order = EXCLUDED.sort_order,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    `;
  }
}
