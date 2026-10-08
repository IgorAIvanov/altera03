import { Injectable } from "@danet/core";
import { DatabaseService } from "../../database/database.service.ts";
import { getServerConfig } from "../../config/server-config.ts";

/** Результат початку спроби: дозвіл з номером рядка або відмова з паузою. */
export type LoginAttempt =
  | { allowed: true; id: string | null }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Обмеження спроб входу. Лічильники й межі — у `app.auth_attempt_begin`
 * (пакет `@core/access`), тут лише виклик і конфігурація.
 *
 * Спроба відкривається ДО перевірки облікових даних і записується невдачею;
 * успіх треба підтвердити `succeeded(id)`. Чому саме так — коментар до
 * `app.auth_login_attempt`.
 */
@Injectable()
export class AuthLoginThrottleService {
  constructor(private db: DatabaseService) {}

  async begin(login: string, address: string | null): Promise<LoginAttempt> {
    const limits = getServerConfig().auth.loginThrottle;
    if (!limits) return { allowed: true, id: null };

    const rows = await this.db.sql<{ result: { allowed: boolean; id: string | null; retryAfter: number } }[]>`
      SELECT app.auth_attempt_begin(${login}, ${address}, ${this.db.sql.json({ ...limits })}::jsonb) as result
    `;
    const result = rows[0]?.result;
    if (!result?.allowed) {
      const retryAfterSeconds = Math.max(1, Number(result?.retryAfter) || limits.windowMinutes * 60);
      // Видно в журналі платформи: саме тут атака стає помітною людині.
      console.warn(
        `[auth] вхід заблоковано на ${retryAfterSeconds} с: логін ${JSON.stringify(login)}, ` +
          `адреса ${address ?? "невідома"}`,
      );
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true, id: result.id };
  }

  async succeeded(id: string | null): Promise<void> {
    if (!id) return;
    await this.db.sql`SELECT app.auth_attempt_succeeded(${id}::bigint)`;
  }
}

/** Текст відмови: людині потрібні хвилини, а не секунди. */
export function tooManyAttemptsMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Забагато невдалих спроб входу. Спробуйте через ${minutes} хв.`;
}
