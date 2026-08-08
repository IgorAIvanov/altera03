import { assertEquals } from "@std/assert";
import { computePlacement, type PlacementInput } from "./popover.ts";

/** Поле 200×24 у точці (left, top) при вікні 1280×800. */
function input(over: Partial<PlacementInput> & { left?: number; top?: number } = {}): PlacementInput {
  const left = over.left ?? 100;
  const top = over.top ?? 100;
  return {
    anchor: { top, left, bottom: top + 24, width: 200 },
    popover: { width: 304, height: 260 }, // 19rem — вікно періоду
    viewport: { width: 1280, height: 800 },
    gap: 2,
    margin: 4,
    ...over,
  };
}

Deno.test("звичайний випадок: під полем, за його лівим краєм", () => {
  const p = computePlacement(input());
  assertEquals(p.top, 126); // 100 + 24 + gap
  assertEquals(p.left, 100);
  assertEquals(p.maxHeight, undefined);
});

Deno.test("біля правого краю вікно зсувається вліво, а не вилазить", () => {
  // Поле починається за 1100px: 1100 + 304 = 1404 > 1280.
  const p = computePlacement(input({ left: 1100 }));
  assertEquals(p.left, 1280 - 304 - 4); // притиснуте з відступом margin
  assertEquals(p.left + 304 <= 1280, true);
});

Deno.test("вікно, ширше за екран, притискається до ЛІВОГО краю", () => {
  // Побачити початок важливіше, ніж кінець: інакше left став би від'ємним.
  const p = computePlacement(input({
    left: 10,
    popover: { width: 1400, height: 260 },
  }));
  assertEquals(p.left, 4);
});

Deno.test("унизу немає місця — розкривається вгору", () => {
  // Поле в самому низу: під ним 800-724-2 = 74 < 260, над ним 698.
  const p = computePlacement(input({ top: 700 }));
  assertEquals(p.top, 700 - 2 - 260); // над полем, на власну висоту
});

Deno.test("угорі теж тісно — лишається внизу, бо там місця більше", () => {
  const p = computePlacement(input({ top: 30 }));
  assertEquals(p.top, 56); // 30 + 24 + gap, тобто вниз
});

Deno.test("desiredHeight обрізає список за вільним місцем", () => {
  // Під полем 800 - 124 - 2 = 674; просимо 900 — дістанемо 674.
  const p = computePlacement(input({ desiredHeight: 900 }));
  assertEquals(p.maxHeight, 674);
  assertEquals(p.top, 126);
});

Deno.test("без desiredHeight висоту не чіпаємо — календар не прокручується", () => {
  const p = computePlacement(input({ top: 700 }));
  assertEquals(p.maxHeight, undefined);
});

Deno.test("розкриття вгору з обрізанням рахує верх за обрізаною висотою", () => {
  // Поле низько, просимо більше, ніж є над ним.
  const p = computePlacement(input({ top: 700, desiredHeight: 900 }));
  assertEquals(p.maxHeight, 698); // усе вільне місце над полем
  assertEquals(p.top, 4); // margin, а не від'ємне значення
});

Deno.test("вікно не заходить за верхній край навіть у тісноті", () => {
  const p = computePlacement(input({ top: 200, popover: { width: 304, height: 5000 } }));
  assertEquals(p.top >= 4, true);
});
