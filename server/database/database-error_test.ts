/**
 * Проби перекладу помилок PostgreSQL для клієнта (database-error.ts).
 *
 * Стережуть межу: сирі тексти з іменами таблиць і констрейнтів не мають
 * доходити до клієнта, а навмисні `raise exception` — мають, як є.
 */
import { assertEquals } from "@std/assert";
import {
  isPostgresError,
  postgresErrorClientMessage,
  postgresErrorField,
} from "./database-error.ts";

/** Форма помилки postgres.js: поля протоколу PostgreSQL. */
function pgError(code: string, message: string) {
  return { code, message, severity: "ERROR" };
}

Deno.test("isPostgresError: SQLSTATE із severity — так", () => {
  assertEquals(isPostgresError(pgError("23505", "duplicate key")), true);
  assertEquals(isPostgresError(pgError("P0001", "code обов'язковий")), true);
});

Deno.test("isPostgresError: транспорт, драйвер і TS-помилки — ні", () => {
  // Транспортний код не п'ятизначний і не має severity.
  assertEquals(isPostgresError({ code: "ETIMEDOUT", message: "timeout" }), false);
  // Драйверний код довший за SQLSTATE.
  assertEquals(isPostgresError({ code: "CONNECTION_CLOSED", message: "closed" }), false);
  assertEquals(isPostgresError(new Error("item обов'язковий для save")), false);
  assertEquals(isPostgresError(null), false);
});

Deno.test("переклад: навмисний raise віддається як є", () => {
  const message = postgresErrorClientMessage(pgError("P0001", "code обов'язковий"));
  assertEquals(message, "code обов'язковий");
});

Deno.test("переклад: відомий SQLSTATE не тягне сирий текст", () => {
  const message = postgresErrorClientMessage(
    pgError("23505", 'duplicate key value violates unique constraint "bank_code_key"'),
  );
  assertEquals(typeof message, "string");
  assertEquals(message?.includes("bank_code_key"), false);
  assertEquals(message?.includes("duplicate key"), false);
});

Deno.test("переклад: невідомий SQLSTATE — null, рішення за викликачем", () => {
  assertEquals(postgresErrorClientMessage(pgError("42601", "syntax error at or near")), null);
});

// ── Поле форми в помилці ──────────────────────────────────────────────────────

Deno.test("поле: column_name від raise ... using column", () => {
  assertEquals(
    postgresErrorField({ ...pgError("P0001", "code обов'язковий"), column_name: "code" }),
    "code",
  );
});

Deno.test("поле: snake_case колонки стає camelCase полем схеми", () => {
  assertEquals(
    postgresErrorField({ ...pgError("23502", "null value"), column_name: "full_name" }),
    "fullName",
  );
});

Deno.test("поле: унікальність — обидві конвенції імені обмеження", () => {
  // Конвенція проєкту (перевірено на живій базі: саме таке ім'я віддає драйвер).
  assertEquals(
    postgresErrorField({
      ...pgError("23505", "duplicate key"),
      table_name: "bank",
      constraint_name: "uq_bank_code",
    }),
    "code",
  );
  // Дефолт PostgreSQL для unique на колонці.
  assertEquals(
    postgresErrorField({
      ...pgError("23505", "duplicate key"),
      table_name: "bank",
      constraint_name: "bank_code_key",
    }),
    "code",
  );
  // Таблиця з підкресленням в імені — префікс знімається цілком.
  assertEquals(
    postgresErrorField({
      ...pgError("23505", "duplicate key"),
      table_name: "menu_item",
      constraint_name: "uq_menu_item_code",
    }),
    "code",
  );
});

Deno.test("поле: чужий шаблон констрейнта — null, а не здогадка", () => {
  // Складене обмеження: колонки в імені немає, вгадувати нічого.
  assertEquals(
    postgresErrorField({
      ...pgError("23505", "duplicate key"),
      table_name: "user_group_member",
      constraint_name: "uq_user_group_member",
    }),
    null,
  );
  // Констрейнт не від цієї таблиці — префікс не збігається.
  assertEquals(
    postgresErrorField({
      ...pgError("23505", "duplicate key"),
      table_name: "bank",
      constraint_name: "organization_code_key",
    }),
    null,
  );
  assertEquals(postgresErrorField(pgError("23505", "duplicate key")), null);
  assertEquals(postgresErrorField(null), null);
});
