/**
 * Проби числової колонки списку.
 *
 * `columnAlign` і `cellStyle` — чисті функції, тож перевіряються прямо. Сам
 * `formatNumber` живе приватно в `query-table-base.ts` (його не можна винести
 * в table-contract.ts: там навмисно немає нічого, що тягне поведінку —
 * див. шапку того файлу), тому тут стережеться те, що від нього залежить і що
 * ламається тихо: вирівнювання, за яким аркуш упізнає число, і табличні цифри.
 */
import { assertEquals } from "@std/assert";
import { cellStyle, columnAlign, type ListColumn } from "./table-contract.ts";

interface Row {
  id: string;
  code: string;
  total: number;
}

const col = (over: Partial<ListColumn<Row>> = {}): ListColumn<Row> => ({
  key: "total",
  title: "common.amount",
  ...over,
});

Deno.test("числова колонка стає правою сама", () => {
  assertEquals(columnAlign(col({ precision: 2 })), "right");
});

Deno.test("оголошене вирівнювання сильніше за виведене", () => {
  // Буває колонка, де число доречно тримати ліворуч (рік, номер) — оголошення
  // форми має лишатися сильнішим за умовчання.
  assertEquals(columnAlign(col({ precision: 0, align: "left" })), "left");
});

Deno.test("колонка без precision вирівнювання не набуває", () => {
  assertEquals(columnAlign(col({ key: "code" })), undefined);
  assertEquals(columnAlign(col({ key: "code", align: "center" })), "center");
});

Deno.test("числова колонка отримує табличні цифри", () => {
  // Без них стовпчик сум стоїть вразнобій навіть коли всі значення
  // відформатовані однаково: «1» у пропорційному шрифті вужча за «8».
  assertEquals(cellStyle(col({ precision: 2 })), "font-variant-numeric:tabular-nums");
});

Deno.test("нечислова колонка табличних цифр не отримує", () => {
  assertEquals(cellStyle(col({ key: "code" })), "");
});

Deno.test("табличні цифри не витісняють обрізку тексту", () => {
  const style = cellStyle(col({ precision: 3, overflow: "ellipsis", width: "8rem" }));
  assertEquals(
    style,
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:8rem;" +
      "font-variant-numeric:tabular-nums",
  );
});

Deno.test("precision 0 — теж число, а не «не задано»", () => {
  // Перевірка на `!= null`, а не на істинність: нуль знаків це законна
  // точність (кількість штук, місяців), і вона не має вимикати форматування.
  assertEquals(columnAlign(col({ precision: 0 })), "right");
  assertEquals(cellStyle(col({ precision: 0 })), "font-variant-numeric:tabular-nums");
});
