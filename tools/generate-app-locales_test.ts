/**
 * Склейка локалей застосунку — на синтетичних джерелах, без диска.
 *
 * Проба конкретного дерева живе в `scripts/app-locales_test.ts`; тут
 * перевіряється сама механіка, включно з тим, чого в здоровому дереві не
 * буває: двома власниками на один ключ і неповним перекладом.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  type LocaleSource,
  mergeLocales,
  renderLocaleFile,
  renderLocaleIndex,
} from "./generate-app-locales.ts";

const source = (owner: string, byLocale: Record<string, Record<string, string>>): LocaleSource => ({
  owner,
  byLocale: new Map(Object.entries(byLocale)),
});

Deno.test("склейка: власники йдуть за алфавітом, ключі — у порядку файлу", () => {
  const { locales } = mergeLocales([
    source("catalog/bank", { uk: { "bank.titleMany": "Банки", "bank.mfo": "МФО" } }),
    source("admin/user", { uk: { "user.login": "Логін" } }),
  ]);

  assertEquals(Object.keys(locales.get("uk")!), ["user.login", "bank.titleMany", "bank.mfo"]);
});

Deno.test("склейка: два власники на один ключ — зіткнення", () => {
  const { collisions } = mergeLocales([
    source("catalog/bank", { uk: { "common.code": "Код" } }),
    source("shared", { uk: { "common.code": "Код" } }),
  ]);

  assertEquals(collisions, [{ key: "common.code", owners: ["catalog/bank", "shared"] }]);
});

Deno.test("склейка: зіткнення видно, навіть якщо ключі в різних мовах", () => {
  // Найгірший випадок: англійською ключ оголосив один власник, українською —
  // інший. Ані злиття, ані око тут нічого не помітять — обидва файли валідні.
  const { collisions } = mergeLocales([
    source("catalog/bank", { en: { "bank.name": "Name" } }),
    source("catalog/currency", { uk: { "bank.name": "Назва" } }),
  ]);

  assertEquals(collisions.length, 1);
  assertEquals(collisions[0].owners, ["catalog/bank", "catalog/currency"]);
});

Deno.test("склейка: неповний переклад названий поіменно", () => {
  const { gaps } = mergeLocales([
    source("catalog/bank", { uk: { "bank.mfo": "МФО", "bank.name": "Назва" }, en: { "bank.name": "Name" } }),
  ]);

  assertEquals(gaps, [{ owner: "catalog/bank", locale: "en", keys: ["bank.mfo"] }]);
});

Deno.test("склейка: мови немає у власника зовсім — теж пропуск", () => {
  const { gaps } = mergeLocales([
    source("shared", { uk: { "common.save": "Зберегти" } }),
    source("header", { uk: { "header.org": "Організація" }, en: { "header.org": "Organisation" } }),
  ]);

  assertEquals(gaps, [{ owner: "shared", locale: "en", keys: ["common.save"] }]);
});

Deno.test("перелік мов відсортований — порядок джерел на нього не впливає", () => {
  // Порядок у меню мов не має залежати від того, у якій моделі яку мову
  // завели першою: меню читає людина, а не збирач.
  const index = JSON.parse(renderLocaleIndex(["uk", "pl", "en"])) as { locales: string[] };
  assertEquals(index.locales, ["en", "pl", "uk"]);
});

Deno.test("вихід несе попередження про генерацію першим ключем", () => {
  const text = renderLocaleFile({ "bank.mfo": "МФО" });

  assertEquals(Object.keys(JSON.parse(text))[0], "//");
  assertStringIncludes(text, "locales:build");
  assertEquals(text.endsWith("\n"), true);
});
