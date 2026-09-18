import type postgres from "postgres";
import type { DatabaseService } from "../database/database.service.ts";

/**
 * Журнал викликів персональним токеном — нижня межа, а не рівень.
 *
 * Рівні `app.audit_setting` — політика для людей: людина сама відповідає за
 * свою роботу, і скільки її журналювати, вирішує адміністратор. Токен — це
 * делегування: відповідає людина, яка кроків НЕ бачила, і журнал для неї —
 * єдиний спосіб дізнатися, що зроблено від її імені. Тому виклик токеном
 * пишеться завжди: читання, запис і відмови.
 *
 * І пишеться В ТІЙ САМІЙ ТРАНЗАКЦІЇ, що й дія. Для людей журнал fail-open
 * (збій запису лишає слід у консолі, команда живе); для токена так обіцянка
 * «все журналюється» не тримається. Не записався рядок — відкочується й дія.
 *
 * Правило стосується ТОКЕНА, а не одного споживача — та сама пастка, що
 * спіймала `assertTokenMayWrite` (`http.ts`): байти вкладень ходять власним
 * каналом, повз рантайм моделей. Тому кожен вхід, який приймає токен, мусить
 * виконувати дію через `withTokenAudit`. Сьогодні таких два: рантайм моделей і
 * `POST /api/blob/upload`. Деталі — docs/agent-audit-plan.md.
 */

/** Рядок `app.audit_log`. Payload не зберігається навмисно — див. struc.sql. */
export interface AuditEntry {
  userId: string;
  model: string;
  command: string;
  recordId: string | null;
  isSuccess: boolean;
  /** Порожньо — виклик людини. */
  accessTokenId: string | null;
}

type AnySql = postgres.Sql<Record<string, never>> | postgres.TransactionSql<Record<string, never>>;

export async function insertAuditEntry(sql: AnySql, entry: AuditEntry): Promise<void> {
  // Приведення — лише щоб покликати тегований шаблон на об'єднанні типів;
  // обидва члени його мають.
  await (sql as postgres.Sql<Record<string, never>>)`
    insert into app.audit_log (user_id, model, command, record_id, is_success, access_token_id)
    values (
      ${entry.userId}::bigint,
      ${entry.model},
      ${entry.command},
      ${entry.recordId}::bigint,
      ${entry.isSuccess},
      ${entry.accessTokenId}::bigint
    )
  `;
}

/** Fail-open запис: збій журналу лишає слід у консолі й не міняє результату. */
export async function writeAuditEntry(db: DatabaseService, entry: AuditEntry): Promise<void> {
  try {
    await insertAuditEntry(db.sql, entry);
  } catch (error) {
    console.error(`❌ audit ${entry.model}/${entry.command}: не вдалося записати подію:`, error);
  }
}

/**
 * Виконати дію токеном у транзакції разом із рядком журналу.
 *
 * - `run` отримує сервіс, прив'язаний до транзакції: усе, що він пише,
 *   фіксується лише разом із рядком журналу;
 * - `outcome` рахує успіх і запис з результату — `ok: false` у конверті теж
 *   фіксується (це відповідь, а не збій), лише з `isSuccess = false`;
 * - дія впала — транзакція відкочена, змін немає, і відмова пишеться окремим
 *   запитом (`failureRecordId`). Якщо не записалася й вона, лишається слід у
 *   консолі, а назовні йде первинна помилка: нічого не сталося, тож і
 *   приховувати нема чого.
 */
export async function withTokenAudit<T>(
  db: DatabaseService,
  entry: { userId: string; model: string; command: string; accessTokenId: string },
  run: (db: DatabaseService) => Promise<T>,
  outcome: (result: T) => { isSuccess: boolean; recordId: string | null },
  failureRecordId: string | null = null,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      const result = await run(db.bound(tx));
      await insertAuditEntry(tx, { ...entry, ...outcome(result) });
      return result;
    });
  } catch (error) {
    await writeAuditEntry(db, { ...entry, recordId: failureRecordId, isSuccess: false });
    throw error;
  }
}
