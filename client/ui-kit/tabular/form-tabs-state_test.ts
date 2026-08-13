/**
 * Проби вибору активної вкладки.
 *
 * Стережуть те, що видно лише в рідкісний момент: вкладку з помилкою в
 * СХОВАНІЙ таблиці й вибір першої, коли поточної в переліку вже немає. Помилка
 * тут не падає — вона показує не ту вкладку, а банер при цьому каже про рядок,
 * якого на екрані немає.
 */
import { assertEquals } from "@std/assert";
import { activeTabKey, type TabFocusState } from "./form-tabs-state.ts";

const tabs = (...keys: string[]): TabFocusState[] =>
  keys.map((key) => ({ key, focusRequested: false }));

Deno.test("вибір користувача лишається", () => {
  assertEquals(activeTabKey(tabs("goods", "services"), "services"), "services");
});

Deno.test("порожній і невідомий ключ → перша вкладка", () => {
  assertEquals(activeTabKey(tabs("goods", "services"), ""), "goods");
  assertEquals(activeTabKey(tabs("goods", "services"), "payments"), "goods");
});

Deno.test("прохання фокуса вмикає СВОЮ вкладку", () => {
  const list: TabFocusState[] = [
    { key: "goods", focusRequested: false },
    { key: "services", focusRequested: true },
  ];
  assertEquals(activeTabKey(list, "goods"), "services");
});

Deno.test("прохання фокуса на вже відкритій вкладці нічого не міняє", () => {
  const list: TabFocusState[] = [
    { key: "goods", focusRequested: true },
    { key: "services", focusRequested: false },
  ];
  assertEquals(activeTabKey(list, "goods"), "goods");
});

Deno.test("порожній перелік вкладок", () => {
  assertEquals(activeTabKey([], "goods"), "");
});
