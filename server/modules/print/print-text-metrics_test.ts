/**
 * Метрика тексту бланка.
 *
 * Перевіряється не арифметика pdf-lib, а те, заради чого метрику взагалі
 * винесли назовні: що нею МОЖНА відповісти на питання «чи влізе значення в
 * колонку». Тому проба міряє те саме, що міряв би застосунок, і на тих самих
 * величинах, що в записі прикладників (1 234 567.89 у вузькій колонці, «Ставка
 * ПДВ» у шапці на 9pt).
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  createPrintTextMeasurer,
  PRINT_CELL_PADDING,
  printContentWidth,
} from "./print-text-metrics.ts";

Deno.test("область друку рахується з аркуша й полів, а не константою", () => {
  assertAlmostEquals(printContentWidth(), 515.28, 0.001);
  // Альбомна орієнтація — та сама арифметика на довшій стороні.
  assertAlmostEquals(printContentWidth("landscape"), 761.89, 0.001);
});

Deno.test("порожній рядок нічого не займає, довший — ширший", async () => {
  const measure = await createPrintTextMeasurer();

  assertEquals(measure("", 10), 0);
  assert(measure("1234567", 10) > measure("123", 10));
  // Кегль масштабує ширину лінійно — на цьому тримається перевірка «а якщо
  // зменшити шрифт».
  assertAlmostEquals(measure("Разом", 20) / measure("Разом", 10), 2, 0.001);
});

Deno.test("жирний ширший за звичайний, кирилиця міряється як кирилиця", async () => {
  const measure = await createPrintTextMeasurer();

  assert(measure("Ставка", 9, true) > measure("Ставка", 9));
  // Рядок може розпастися на відрізки різними шрифтами (кирилиця Roboto,
  // латиниця Helvetica) — сума їхніх ширин і є відповідь. Якби кирилицю міряли
  // латинським шрифтом, «на кількість символів» вийшло б те саме число.
  assert(measure("ПДВ", 9) !== measure("PDV", 9));
});

Deno.test("те, заради чого це назовні: значення не влазить у вузьку колонку", async () => {
  const measure = await createPrintTextMeasurer();

  // Колонка «Сума ПДВ» — 10 % ширини бланка.
  const usable = printContentWidth() * 0.10 - PRINT_CELL_PADDING * 2;

  assert(measure("12 000.00", 9) <= usable, "демо-сума влазить — на ній бланк і робили");
  assert(measure("1 234 567.89", 9) > usable, "а справжня вже ні, і саме це видно лише з паперу");
});

Deno.test("заголовок міряють по найдовшому СЛОВУ, а не по рядку", async () => {
  const measure = await createPrintTextMeasurer();
  const usable = printContentWidth() * 0.08 - PRINT_CELL_PADDING * 2;

  const caption = "Ставка ПДВ";
  const longestWord = caption.split(/\s+/).reduce((a, b) => (a.length >= b.length ? a : b));

  // Рядок цілком не влазить — але це не біда: перенос по словах його розкладе.
  assert(measure(caption, 9, true) > usable);
  // А от слово, ширше за комірку, не переноситься ВЗАГАЛІ й лізе на сусідню
  // колонку. Саме тому перевіряти треба слово.
  assert(measure(longestWord, 9, true) <= usable);
  assert(measure(longestWord, 14, true) > usable, "а на 14pt уже не влізе й слово");
});
