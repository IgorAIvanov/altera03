import type { ModelCommandContext } from "../../../../server/modules/model-runtime/model-runtime.types.ts";
// Довжина береться з фреймворку, а не оголошується тут: інакше екран
// адміністратора і перший запуск міряли б пароль різними лінійками.
import { hashPassword, MIN_PASSWORD_LENGTH } from "../../../../server/modules/auth/password-hash.ts";

function fail(message: string) {
  return {
    ok: false,
    data: { item: null, rows: [], options: {}, totals: {} },
    messages: [{ type: "error", text: message }],
  };
}

/**
 * Встановлення пароля користувача.
 *
 * Чому TS, а не SQL: хеш рахує PBKDF2-SHA256 у Deno, і схема хешування живе в
 * одному місці — `server/modules/auth/password-hash.ts`. `app.user_save` пароля
 * не приймає взагалі, тому без цієї команди заведений в UI користувач увійти
 * не може, доки хтось не виконає `deno task passwd`.
 *
 * Імпорт іде прямо з модуля, а не з барелю `@altera/server`: барель тягне за
 * собою весь граф Danet заради однієї функції.
 */
export default async function setPassword(
  payload: Record<string, unknown>,
  ctx: ModelCommandContext,
): Promise<unknown> {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!id) return fail("id обов'язковий");

  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`Пароль має містити щонайменше ${MIN_PASSWORD_LENGTH} символів`);
  }

  const hash = await hashPassword(password);

  const updated = await ctx.db.sql<{ id: string }[]>`
    update app.users
       set password_hash = ${hash},
           updated_at = now()
     where id = ${id}::bigint
    returning id::text as id
  `;

  if (updated.length === 0) return fail("Користувача не знайдено");

  return {
    ok: true,
    data: { item: null, rows: [], options: {}, totals: {} },
    messages: [{ type: "info", text: "Пароль встановлено" }],
  };
}
