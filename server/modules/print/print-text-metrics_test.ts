/**
 * Метрика тексту бланка.
 *
 * Перевіряється не арифметика pdf-lib, а те, заради чого метрику взагалі
 * винесли назовні: що нею МОЖНА відповісти на питання «чи влізе значення в
 * колонку». Тому проба міряє те саме, що міряв би застосунок, і на тих самих
 * величинах, що в записі прикладників (1 234 567.89 у вузькій колонці, «Ставка
 * ПДВ» у шапці на 9pt).
 */
import { assert, assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
  createPrintTextMeasurer,
  PRINT_CELL_PADDING,
  printContentHeight,
  printContentWidth,
  printFontIndexFor,
} from "./print-text-metrics.ts";

/** Індекс шрифту для символу; -1 — Helvetica. */
const fontFor = (char: string, bold = false) => printFontIndexFor(char.codePointAt(0)!, bold);

/**
 * Вибір шрифту за символом.
 *
 * Проба існує через живий дефект: шрифт вибирався за межею `код <= 0x7F`, усе
 * вище йшло в кирилічний субсет Roboto, а лапки-ялинки (U+00AB) у ньому немає —
 * тож `ТОВ «Демо»` друкувалося сміттям у КОЖНОМУ бланку. Помітив це замовник,
 * бо перевірити було нічим: команда даних віддає правильний рядок, шаблон
 * правильний, прив'язки на місці, PDF будується.
 */
Deno.test("шрифт: кирилиця з Roboto, лапки-ялинки з Helvetica", () => {
  assertEquals(fontFor("А"), 0, "кирилиця — основний субсет");
  assertEquals(fontFor("я"), 0);
  assertEquals(fontFor("№"), 0);

  // Ось воно: у Roboto-субсеті цих гліфів немає, а у Helvetica (WinAnsi) є.
  assertEquals(fontFor("«"), -1);
  assertEquals(fontFor("»"), -1);
  for (const char of "“”„—–’…") assertEquals(fontFor(char), -1, `${char} мусить іти в Helvetica`);

  // ASCII лишається за Helvetica — на цьому тримаються метрики pdf-lib.
  assertEquals(fontFor("A"), -1);
  assertEquals(fontFor("1"), -1);
});

Deno.test("шрифт: гривня береться з другої гарнітури", () => {
  // ₴ (U+20B4) немає ні у WinAnsi, ні в жодному з 162 файлів @fontsource/roboto
  // — саме заради неї до бланка доданий субсет PT Sans. Без нього сума зі
  // знаком гривні (звичайний спосіб писати гроші) друкувалася б рамкою.
  assertEquals(fontFor("₴"), 1);
  assertEquals(fontFor("₴", true), 1);

  // А кирилиця при цьому лишається за Roboto — друга гарнітура вживається
  // рівно там, де перша безсила, і не «перетягує» на себе текст.
  assertEquals(fontFor("А"), 0);
  assertEquals(fontFor("ї"), 0);
  assertEquals(fontFor("Ґ"), 0);
});

Deno.test("шрифт: невідомий символ не валить документ", () => {
  // Гліфа немає ніде — але друк не має падати: pdf-lib кидає, коли просиш
  // стандартний шрифт намалювати символ поза його кодуванням, тож такий символ
  // свідомо віддається вбудованому шрифту (порожня рамка на папері).
  assertEquals(fontFor("漢"), 0);
  assertEquals(fontFor("🙂"), 0);
});

Deno.test("область друку рахується з аркуша й полів, а не константою", () => {
  assertAlmostEquals(printContentWidth(), 515.28, 0.001);
  assertAlmostEquals(printContentHeight(), 761.89, 0.001);
  // Альбомна орієнтація — та сама арифметика, сторони міняються місцями.
  assertAlmostEquals(printContentWidth("landscape"), 761.89, 0.001);
  assertAlmostEquals(printContentHeight("landscape"), 515.28, 0.001);

  // Невідома орієнтація — відмова, а не мовчазна книжкова: зайвий аргумент
  // (`printContentWidth("A4", "landscape")`) інакше віддавав би 515.28, і всі
  // ширини, пораховані від нього, були б тихо неправильні.
  assertThrows(() => printContentWidth("A4" as unknown as "portrait"), TypeError);
  assertThrows(() => printContentHeight("" as unknown as "portrait"), TypeError);
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
