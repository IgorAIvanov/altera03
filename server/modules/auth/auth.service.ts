import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";
import { AuthUserRow } from "./auth.types.ts";

@Injectable()
export class AuthService {
  constructor(private db: DatabaseService) {}

  /**
   * Ефективні права користувача — плоский список (model, action).
   *
   * Свідомо не команда моделі: `access_effective` не входить у стандартну
   * п'ятірку, і рантайм її не змаршрутизує. Та й за змістом це частина
   * авторизації, а не довідник.
   */
  async getEffectivePermissions(userId: string): Promise<{ model: string; action: string }[]> {
    const rows = await this.db.sql<{ result: { data?: { rows?: { model: string; action: string }[] } } }[]>`
      SELECT app.access_effective(${userId}::bigint, '{}'::jsonb) as result
    `;

    return rows[0]?.result?.data?.rows ?? [];
  }

  async hasAnyUsers(): Promise<boolean> {
    const rows = await this.db.sql<{ has_users: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM app.users) as has_users
    `;

    return rows[0]?.has_users ?? false;
  }

  async findUserByLogin(login: string): Promise<AuthUserRow | null> {
    const rows = await this.db.sql<AuthUserRow[]>`
      SELECT id, login, password_hash, full_name, is_active, must_change_password
      FROM app.users
      WHERE login = ${login} AND is_active = true
    `;
    return rows[0] ?? null;
  }

  async findUserById(id: string): Promise<AuthUserRow | null> {
    const rows = await this.db.sql<AuthUserRow[]>`
      SELECT id, login, full_name, is_active, must_change_password
      FROM app.users
      WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }

  async findFirstActiveUser(): Promise<AuthUserRow | null> {
    const rows = await this.db.sql<AuthUserRow[]>`
      SELECT id, login, full_name, is_active, must_change_password
      FROM app.users
      WHERE is_active = true
      ORDER BY created_at, login
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async createUser(
    login: string,
    passwordHash: string,
    fullName: string,
    mustChangePassword = false,
  ) {
    const rows = await this.db.sql<AuthUserRow[]>`
      INSERT INTO app.users (login, password_hash, full_name, must_change_password)
      VALUES (${login}, ${passwordHash}, ${fullName}, ${mustChangePassword})
      RETURNING id, login, full_name, must_change_password
    `;
    return rows[0];
  }

  /**
   * Зміна власного пароля. Тут, а не командою моделі, свідомо: доки стоїть
   * `must_change_password`, рантайм команд моделей не виконує взагалі — інакше
   * єдиний спосіб зняти прапорець був би заблокований разом з усім іншим.
   */
  async changeOwnPassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.sql`
      UPDATE app.users
         SET password_hash = ${passwordHash},
             must_change_password = false,
             updated_at = now()
       WHERE id = ${userId}::bigint
    `;
  }

  /**
   * Первинний доступ для користувача, створеного bootstrap-ом: група повного
   * доступу. Інакше після першого запуску нема кому налаштувати решту.
   *
   * Прив'язки до «інтерфейсів» (наборів екранів) більше немає — право тепер
   * описується дією над моделлю, див. server/sql/access.
   */
  async ensureDefaultAccess(userId: string) {
    await this.db.sql`
      INSERT INTO app.user_group_member (user_group_id, user_id, is_active)
      SELECT ug.id, ${userId}::bigint, true
      FROM app.user_group ug
      WHERE ug.code = 'admin'
      ON CONFLICT (user_group_id, user_id) DO UPDATE
      SET
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    `;
  }
}
