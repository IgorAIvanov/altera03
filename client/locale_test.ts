/// <reference lib="deno.ns" />
// Директива — з тієї ж причини, що в assets_test.ts: `lib` пакета браузерний.
//
// Перевіряється те, що не падає, а тихо дає не ту мову: порядок накладання
// ланцюжка й відсів зіпсованої мовної мітки. Саме злиття (мережа + вбудований
// модуль) сюди не дістає — воно потребує `fetch`, тож лишається на очах.
import { assertEquals } from "@std/assert";
import { FALLBACK_LOCALE, isValidLocale, localeChain, resolveText, t } from "./locale.ts";

Deno.test("localeChain: запасна мова стоїть перед обраною", () => {
  assertEquals(localeChain("uk"), ["en", "uk"]);
  assertEquals(localeChain("pl", "uk"), ["uk", "pl"]);
});

Deno.test("localeChain: обрана мова = запасна — один шар, не два", () => {
  assertEquals(localeChain("en"), ["en"]);
  assertEquals(localeChain(FALLBACK_LOCALE), [FALLBACK_LOCALE]);
});

Deno.test("localeChain: відкот можна вимкнути", () => {
  assertEquals(localeChain("uk", null), ["uk"]);
});

Deno.test("isValidLocale: мітки, які приймає Intl", () => {
  for (const code of ["uk", "en", "pl", "en-US", "pt-BR", "zh-Hans-CN"]) {
    assertEquals(isValidLocale(code), true, `${code} мала пройти`);
  }
});

// Словника в пробі немає (він вантажиться мережею), тож `t` віддає сам ключ —
// саме на цьому й перевіряється підстановка й розбір маркера.

Deno.test("t: підстановка іменована, невідоме ім'я лишається як є", () => {
  assertEquals(t("{count} з {total}", { count: 3, total: 10 }), "3 з 10");
  assertEquals(t("{a} і {b}", { a: "x" }), "x і {b}");
  assertEquals(t("без підстановок", { a: "x" }), "без підстановок");
});

Deno.test("resolveText: рядок без маркера недоторканий", () => {
  // Найважливіший випадок: назва контрагента, введена людиною, і діагностика
  // для розробника мають дійти до екрана незміненими.
  assertEquals(resolveText("Наші контрагенти"), "Наші контрагенти");
  assertEquals(resolveText("attachment_save: id обов'язковий"), "attachment_save: id обов'язковий");
  assertEquals(resolveText(""), "");
});

Deno.test("resolveText: голий ключ", () => {
  assertEquals(resolveText("@[bank.titleMany]"), "bank.titleMany");
});

Deno.test("resolveText: ключ із параметрами", () => {
  assertEquals(
    resolveText('@[core.accountNotFound]{"account":"311"}'),
    "core.accountNotFound",
    "без словника лишається ключ, але розбір не падає",
  );
});

Deno.test("resolveText: у значенні параметра — довільний текст", () => {
  // Заради цього хвіст і JSON: у підстановку їде назва рахунку чи субконто,
  // тобто текст користувача, де трапиться і «]», і «|».
  const text = JSON.stringify({ name: "Рахунок [31] | основний" });
  assertEquals(resolveText(`@[core.subcontoMissing]${text}`), "core.subcontoMissing");
});

Deno.test("resolveText: зіпсований маркер не показує сирий рядок користувачеві", () => {
  assertEquals(resolveText("@[core.broken]{не json}"), "core.broken");
  // Незакрита дужка — це вже не маркер, а просто текст.
  assertEquals(resolveText("@[core.broken"), "@[core.broken");
});

Deno.test("isValidLocale: сміття зі сховища", () => {
  // Порожній рядок і «uk_UA» (підкреслення замість дефіса) — рівно те, що
  // трапляється в localStorage від чужих версій і від правки руками.
  for (const code of ["", "uk_UA", "не мова", "a", "@@"]) {
    assertEquals(isValidLocale(code), false, `${code} мала відсіятися`);
  }
});
