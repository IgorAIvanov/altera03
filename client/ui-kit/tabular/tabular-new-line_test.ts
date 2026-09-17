/**
 * Проби «Esc прибирає щойно доданий порожній рядок».
 *
 * Стережуть головну межу: заповнений рядок Esc не видаляє НІКОЛИ — помилка
 * тут коштувала б введених даних, а не зручності.
 */
import { assertEquals } from "@std/assert";
import { TabularSection } from "./tabular-section.ts";

interface Line {
  id: string | null;
  lineNo: number;
  qty: string;
  itemId: string;
}

const host = () => ({
  requestUpdate: () => {},
  addController: () => {},
  removeController: () => {},
  updateComplete: Promise.resolve(true),
});

function section(initial: Line[] = [{ id: "1", lineNo: 1, qty: "2.000", itemId: "7" }]) {
  let rows = initial;
  const mode = { readonly: false };
  const s = new TabularSection<Line>(host(), {
    rows: () => rows,
    setRows: (next) => { rows = next; },
    createLine: () => ({ id: null, lineNo: 0, qty: "0.000", itemId: "" }),
    readonly: () => mode.readonly,
    columns: [
      { kind: "picker", key: "itemId", title: "t.item" },
      { kind: "decimal", key: "qty", title: "t.qty", precision: 3 },
    ],
  });
  return { s, rows: () => rows, mode };
}

Deno.test("щойно доданий рядок без правок Esc прибирає", () => {
  const t = section();
  t.s.addLine();
  assertEquals(t.rows().length, 2);
  assertEquals(t.s.discardNewLine(1), true);
  assertEquals(t.rows().length, 1);
  assertEquals(t.rows()[0].id, "1");
});

Deno.test("рядок, у який щось внесли, Esc не чіпає", () => {
  const t = section();
  t.s.addLine();
  t.s.patch(1, { qty: "5.000" });
  assertEquals(t.s.discardNewLine(1), false);
  assertEquals(t.rows().length, 2);
});

Deno.test("правка, що повернула значення назад, рядок заповненим не робить", () => {
  // Вибрали товар у пікері й стерли — рядок знову порожній, і Esc має його прибрати.
  const t = section();
  t.s.addLine();
  t.s.patch(1, { itemId: "9" });
  t.s.patch(1, { itemId: "" });
  assertEquals(t.s.discardNewLine(1), true);
});

Deno.test("давній рядок, хай і порожній, Esc не видаляє", () => {
  const t = section([{ id: "1", lineNo: 1, qty: "0.000", itemId: "" }]);
  assertEquals(t.s.discardNewLine(0), false);
  assertEquals(t.rows().length, 1);
});

Deno.test("не останній рядок — не той, що додали", () => {
  const t = section();
  t.s.addLine();
  assertEquals(t.s.discardNewLine(0), false);
});

Deno.test("після вставки чи видалення знімок знецінюється", () => {
  const t = section();
  t.s.addLine();
  t.s.removeLine(0); // тепер новий рядок єдиний і останній, але кількість інша
  assertEquals(t.s.discardNewLine(0), false);
});

Deno.test("секція лише для перегляду нічого не прибирає", () => {
  const t = section();
  t.s.addLine();
  t.mode.readonly = true; // форму перевели в перегляд (зберегли, провели)
  assertEquals(t.s.discardNewLine(1), false);
  assertEquals(t.rows().length, 2);
});
