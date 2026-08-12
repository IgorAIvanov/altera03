/**
 * Проби розкладки гарячих клавіш.
 *
 * Головне, що вони стережуть, — незалежність від розкладки клавіатури: помилка
 * тут не падає, а тихо вимикає Ctrl+S у кирилиці, тобто саме там, де ним і
 * користуються.
 */
import { assertEquals } from "@std/assert";
import { type KeyStroke, matchShortcut, modalDialogInPath } from "./shortcuts.ts";

function stroke(code: string, mods: Partial<KeyStroke> = {}): KeyStroke {
  return { code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods };
}

Deno.test("Ctrl+S зберігає; сама S — ні", () => {
  assertEquals(matchShortcut(stroke("KeyS", { ctrlKey: true })), "save");
  // Cmd на macOS — те саме.
  assertEquals(matchShortcut(stroke("KeyS", { metaKey: true })), "save");
  assertEquals(matchShortcut(stroke("KeyS")), null);
});

Deno.test("розкладка не впливає: дивимось на фізичну клавішу", () => {
  // У кирилиці на цій клавіші «ы»/«і», але code лишається KeyS. Якби
  // розпізнавання йшло по `key`, тут було б null — і Ctrl+S не працював би.
  assertEquals(matchShortcut(stroke("KeyS", { ctrlKey: true })), "save");
});

Deno.test("Insert створює, Escape закриває — без модифікаторів", () => {
  assertEquals(matchShortcut(stroke("Insert")), "create");
  assertEquals(matchShortcut(stroke("Escape")), "close");
  assertEquals(matchShortcut(stroke("Insert", { ctrlKey: true })), null);
  assertEquals(matchShortcut(stroke("Escape", { ctrlKey: true })), null);
});

Deno.test("Ctrl+Enter — кнопка за замовчуванням; сам Enter — ні", () => {
  assertEquals(matchShortcut(stroke("Enter", { ctrlKey: true })), "default");
  assertEquals(matchShortcut(stroke("NumpadEnter", { ctrlKey: true })), "default");
  assertEquals(matchShortcut(stroke("Enter", { metaKey: true })), "default");
  // Звичайний Enter належить екрану: комірці таблиці, списку пікера, рядку.
  assertEquals(matchShortcut(stroke("Enter")), null);
  assertEquals(matchShortcut(stroke("NumpadEnter")), null);
});

Deno.test("Alt і Shift не наші: комбінації з ними належать браузеру", () => {
  assertEquals(matchShortcut(stroke("KeyS", { ctrlKey: true, altKey: true })), null);
  assertEquals(matchShortcut(stroke("KeyS", { ctrlKey: true, shiftKey: true })), null);
  assertEquals(matchShortcut(stroke("Escape", { shiftKey: true })), null);
});

Deno.test("чужа клавіша — null", () => {
  assertEquals(matchShortcut(stroke("KeyA", { ctrlKey: true })), null);
  assertEquals(matchShortcut(stroke("F7")), null);
  assertEquals(matchShortcut(stroke("Tab")), null);
});

// Вузли шляху описані качиною типізацією навмисно: справжній DOM тут не
// потрібен, а проба лишається без браузера.
const node = (localName: string, open?: boolean) => ({ localName, open } as unknown as EventTarget);

Deno.test("відкрите <dialog> у шляху події зупиняє оболонку", () => {
  // Esc усередині діалогу: браузер закриє вікно сам, і вкладка під ним
  // закриватися НЕ мусить — це і є дефект, заради якого перевірка з'явилася.
  assertEquals(
    modalDialogInPath([node("input"), node("form"), node("dialog", true), node("body")]),
    true,
  );
});

Deno.test("закрите <dialog> у шляху не заважає", () => {
  // Розмітка діалогу лишається в DOM після закриття; поки він не відкритий,
  // клавіша належить вкладці, як і до появи вікна.
  assertEquals(modalDialogInPath([node("button"), node("dialog", false), node("body")]), false);
  assertEquals(modalDialogInPath([node("button"), node("dialog"), node("body")]), false);
});

Deno.test("без діалогу — звичайний шлях", () => {
  assertEquals(modalDialogInPath([node("input"), node("div"), node("body")]), false);
  assertEquals(modalDialogInPath([]), false);
});
