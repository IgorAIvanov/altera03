import type { ModelCommandContext } from "@altera/server";
// Довжина береться з фреймворку, а не оголошується тут: інакше екран
// адміністратора і перший запуск міряли б пароль різними лінійками.
import { hashPassword, MIN_PASSWORD_LENGTH } from "@altera/server/password";

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
 * `hashPassword` береться з `@altera/server/password`, а НЕ з барелю
 * `@altera/server` — і це не косметика. Цей файл потрапляє у збірку фронтенду:
 * його статично імпортує `app/_generated/model-registry.generated.ts`, а реєстр
 * тягне екран `admin/user_group`. Барель же тягне `bootstrap`, а з ним
 * контролери Danet із декораторами — і Rolldown валить збірку двадцятьма трьома
 * «Decorators are not valid here».
 *
 * Раніше тут стояв відносний шлях у модуль сервера. Він рятував від того самого,
 * але працював лише в цьому репозиторії: у встановленому застосунку фреймворк
 * лежить у vendor/ і видний тільки через експорт-мапу пакета. Окремий вхід
 * закриває обидві біди відразу.
 *
 * `ModelCommandContext` можна брати з барелю: `import type` стирається при
 * збірці, тож у граф ніщо не потрапляє.
 */
export default async function setPassword(
  payload: Record<string, unknown>,
  ctx: ModelCommandContext,
): Promise<unknown> {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!id) return fail("id обов'язковий");

  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(`@[user.passwordTooShort]${JSON.stringify({ min: MIN_PASSWORD_LENGTH })}`);
  }

  const hash = await hashPassword(password);

  const updated = await ctx.db.sql<{ id: string }[]>`
    update app.users
       set password_hash = ${hash},
           updated_at = now()
     where id = ${id}::bigint
    returning id::text as id
  `;

  if (updated.length === 0) return fail("@[user.notFound]");

  return {
    ok: true,
    data: { item: null, rows: [], options: {}, totals: {} },
    messages: [{ type: "info", text: "@[user.passwordSet]" }],
  };
}
