/**
 * Сканер маркерів — на синтетичних джерелах.
 *
 * Проба конкретного дерева живе в `scripts/translation-markers_test.ts`; тут
 * перевіряється розбір, і насамперед те, через що сканер уже одного разу впав
 * на власній документації: маркер у коментарі — це цитата формату, а не ужиток.
 */
import { assertEquals } from "@std/assert";
import { findMarkers, missingKeys, stripComments } from "./scan-translation-markers.ts";

Deno.test("маркер у рядковому літералі знайдено", () => {
  const sql = "  raise exception '@" + "[core.documentNotFound]%', v_json;";
  assertEquals(findMarkers(sql, "core.sql"), [
    { key: "core.documentNotFound", file: "core.sql", line: 1 },
  ]);
});

Deno.test("маркер у коментарі SQL — цитата формату, не ужиток", () => {
  const sql = "-- У name лежить маркер @" + "[ключ], а не текст.\nselect 1;";
  assertEquals(findMarkers(sql, "data.sql"), []);
});

Deno.test("маркер у коментарі TS теж не рахується", () => {
  const ts = "// формат — @" + "[ключ]{\"a\":1}\nconst x = 1;";
  assertEquals(findMarkers(ts, "menu.ts"), []);
});

Deno.test("блоковий коментар на кілька рядків", () => {
  const ts = [
    "/**",
    " * Приклад: @" + "[core.sample]",
    " */",
    'const message = "@' + '[user.notFound]";',
  ].join("\n");

  assertEquals(findMarkers(ts, "commands.ts"), [
    { key: "user.notFound", file: "commands.ts", line: 4 },
  ]);
});

Deno.test("номер рядка вказує на справжнє місце", () => {
  // Заради цього коментарі й заміняються порожнім рядком, а не викидаються.
  const sql = ["-- коментар", "-- ще один", "  raise exception '@" + "[core.x]';"].join("\n");
  assertEquals(findMarkers(sql, "a.sql")[0].line, 3);
});

Deno.test("stripComments не чіпає код перед коментарем", () => {
  assertEquals(stripComments("select 1; -- пояснення", true).trim(), "select 1;");
  assertEquals(stripComments("const a = 1; // тут", false).trim(), "const a = 1;");
});

Deno.test("missingKeys називає лише невідоме", () => {
  const uses = [
    { key: "core.a", file: "a.sql", line: 1 },
    { key: "core.b", file: "b.sql", line: 2 },
  ];
  assertEquals(missingKeys(uses, new Set(["core.a"])), [
    { key: "core.b", file: "b.sql", line: 2 },
  ]);
});
