/**
 * Проби канонізації десяткових при читанні.
 *
 * Стережуть те, що інакше видно лише очима й лише в одному кадрі: SQL віддає
 * `numeric` числом, `JSON.parse` лишає від `15.000` просто `15`, і комірка
 * показує «15» доти, доки в неї не тицьнуть. Тут же й обидві межі, які легко
 * зламати непомітно, — не чіпати `normalizeLine` і не писати, коли нема чого.
 */
import { assertEquals, assertStrictEquals } from "@std/assert";
import { TabularSection } from "./tabular-section.ts";

interface Line {
  id: string | null;
  lineNo: number;
  qty: string;
  price: string;
  discount?: string | null;
  note?: string;
}

/** Хост секції: секції від нього потрібен лише `requestUpdate`. */
const host = () => {
  let updates = 0;
  return {
    requestUpdate: () => { updates++; },
    addController: () => {},
    removeController: () => {},
    updateComplete: Promise.resolve(true),
    get updates() { return updates; },
  };
};

/** Секція над масивом, що лежить «у формі»: писати — значить замінити масив. */
function section(initial: unknown[], extra: Record<string, unknown> = {}) {
  let rows = initial as Line[];
  let writes = 0;
  const s = new TabularSection<Line>(host(), {
    rows: () => rows,
    setRows: (next) => { rows = next; writes++; },
    createLine: () => ({ id: null, lineNo: 0, qty: "0.000", price: "0.00" }),
    columns: [
      { kind: "picker", key: "id", title: "t.ref" },
      { kind: "decimal", key: "qty", title: "t.qty", precision: 3 },
      { kind: "decimal", key: "price", title: "t.price", precision: 2 },
      { kind: "text", key: "note", title: "t.note" },
    ],
    ...extra,
  });
  return { s, rows: () => rows, writes: () => writes };
}

Deno.test("число з SQL стає рядком із потрібною кількістю знаків", () => {
  // Саме те, що приходить після JSON.parse: 15.000 → 15, 20.05 → 20.05.
  const t = section([{ id: "1", lineNo: 1, qty: 15, price: 20.05 }]);
  t.s.canonicalize();
  assertEquals(t.rows()[0].qty, "15.000");
  assertEquals(t.rows()[0].price, "20.05");
});

Deno.test("точність береться з колонки, а не з вигляду значення", () => {
  const t = section([{ id: "1", lineNo: 1, qty: "2.5", price: "3" }]);
  t.s.canonicalize();
  assertEquals(t.rows()[0].qty, "2.500");
  assertEquals(t.rows()[0].price, "3.00");
});

Deno.test("канонічні рядки не переписуються — масив той самий об'єкт", () => {
  // Не косметика: заміна масиву скинула б кеш записів і кеш підсумків на
  // кожному читанні, а читань у документа багато.
  const before = [{ id: "1", lineNo: 1, qty: "15.000", price: "20.05" }];
  const t = section(before);
  t.s.canonicalize();
  assertEquals(t.writes(), 0);
  assertStrictEquals(t.rows(), before);
});

Deno.test("незмінений рядок лишається тим самим об'єктом", () => {
  // Кеш подання відрізняє змінений рядок за identity — сусідній рядок, якого
  // канонізація не торкнулася, перемальовуватися не повинен.
  const keep = { id: "2", lineNo: 2, qty: "1.000", price: "2.00" };
  const t = section([{ id: "1", lineNo: 1, qty: 15, price: "20.05" }, keep]);
  t.s.canonicalize();
  assertEquals(t.writes(), 1);
  assertStrictEquals(t.rows()[1], keep);
});

Deno.test("порожнє лишається порожнім, а не стає нулем", () => {
  // На шляху ЗАПИСУ null стає «0.00» (число зобов'язане бути числом), на шляху
  // читання — ні: незаповнена необов'язкова колонка не має показувати нуль.
  const t = section([{ id: "1", lineNo: 1, qty: 1, price: "2.00", discount: null }], {
    columns: [
      { kind: "decimal", key: "qty", title: "t.qty", precision: 3 },
      { kind: "decimal", key: "price", title: "t.price", precision: 2 },
      { kind: "decimal", key: "discount", title: "t.discount", precision: 2 },
    ],
  });
  t.s.canonicalize();
  assertEquals(t.rows()[0].discount, null);
  assertEquals(t.rows()[0].qty, "1.000");
});

Deno.test("недесяткові колонки не чіпаються", () => {
  const t = section([{ id: "1", lineNo: 1, qty: 1, price: "2.00", note: "5" }]);
  t.s.canonicalize();
  assertEquals(t.rows()[0].note, "5");
  assertEquals(t.rows()[0].id, "1");
});

Deno.test("normalizeLine на читанні НЕ виконується", () => {
  // Хук буває не про формат, а про перерахунок похідних полів. Виконати його
  // тут означало б замінити пораховане сервером порахованим клієнтом.
  let called = 0;
  const t = section([{ id: "1", lineNo: 1, qty: 1, price: "2.00" }], {
    normalizeLine: (l: Line) => { called++; return { ...l, note: "перераховано" }; },
  });
  t.s.canonicalize();
  assertEquals(called, 0);
  assertEquals(t.rows()[0].note, undefined);

  // …а на шляху запису — виконується, як і доти.
  assertEquals(t.s.normalizedRows()[0].note, "перераховано");
  assertEquals(called, 1);
});

Deno.test("порожня секція нічого не пише", () => {
  const t = section([]);
  t.s.canonicalize();
  assertEquals(t.writes(), 0);
});
