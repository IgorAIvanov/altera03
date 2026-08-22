/**
 * Поточна розкладка: блок стає під попереднім, а не на вгадану координату.
 *
 * Перевіряється саме те, заради чого вона є: що місце блока НЕ залежить від
 * того, чи вгадали висоту таблиці над ним. Тому в пробах таблиця щоразу
 * розрахована на різну кількість рядків, а очікування — відносні: підпис під
 * таблицею, хай де та скінчилася.
 *
 * Міряється звітом про розкладку, а не потоком PDF: звіт для того й доданий,
 * щоб про своє місце можна було спитати, а не з'ясовувати його розбиранням
 * готового файлу.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { normalizePrintTemplateSchema } from "./print-template.ts";
import { type PrintPdfLayoutEntry, renderPrintPdfWithLayout } from "./print-pdf.renderer.ts";

const MARGIN = 40;
const CONTENT_TOP = 841.89 - MARGIN;

function textOptions(fontSize = "10") {
  return { fontSize, align: "left", fontWeight: "normal", color: "#000000" };
}

function place(patch: Record<string, string>) {
  return { mode: "absolute", xPercent: "0", yPercent: "0", widthPercent: "100", heightPercent: "0", ...patch };
}

/** Текстовий блок: одне значення, відома висота. */
function text(key: string, placement: Record<string, string>, patch: Record<string, unknown> = {}) {
  return { key, type: "text", value: key, placement: place(placement), text: textOptions(), ...patch };
}

/** Таблиця на задану кількість рядків — щоб її висота була різною в пробах. */
function table(key: string, placement: Record<string, string>, rows: number) {
  return {
    key,
    type: "table",
    source: "lines",
    columns: [{ key: "c1", widthPercent: "100" }],
    sections: {
      header: [{ key: "h", cells: [{ key: "hc", columnKey: "c1", text: "Назва" }] }],
      row: [{ key: "r", cells: [{ key: "rc", columnKey: "c1", path: "name" }] }],
      footer: [],
    },
    placement: place(placement),
    text: textOptions(),
    __rows: rows,
  };
}

async function layoutOf(blocks: unknown[], rows: number): Promise<PrintPdfLayoutEntry[]> {
  const schema = normalizePrintTemplateSchema({ schemaVersion: 2, blocks });
  assert(schema, "шаблон не пройшов нормалізацію");

  const data = { lines: Array.from({ length: rows }, (_, index) => ({ name: `Рядок ${index + 1}` })) };
  const { layout } = await renderPrintPdfWithLayout({
    code: "probe",
    name: "проба",
    targetModel: "probe",
    dataCommand: "print",
    orientation: "portrait",
    schema,
  }, data);

  return layout;
}

function entry(layout: PrintPdfLayoutEntry[], key: string): PrintPdfLayoutEntry {
  const found = layout.find((item) => item.key === key);
  assert(found, `у звіті немає блока ${key}`);
  return found;
}

Deno.test("потік: блок стає під попереднім, хай де той скінчився", async () => {
  const blocks = [
    table("lines", { yPercent: "10" }, 3),
    text("caption", { mode: "flow", gapPt: "6" }),
  ];

  // Та сама розкладка на трьох і на тридцяти рядках: підпис іде за таблицею, а
  // не стоїть на числі, яке хтось порахував наперед.
  const short = await layoutOf(blocks, 3);
  const long = await layoutOf(blocks, 30);

  assertAlmostEquals(entry(short, "caption").topPt, entry(short, "lines").bottomPt - 6, 0.01);
  assertAlmostEquals(entry(long, "caption").topPt, entry(long, "lines").bottomPt - 6, 0.01);
  assert(entry(long, "caption").topPt < entry(short, "caption").topPt, "довша таблиця мусить відсунути підпис нижче");
});

Deno.test("потік: підпис МІЖ двома таблицями лишається між ними", async () => {
  // Випадок із «Розрахунку коригування»: на абсолютній розкладці цей підпис
  // зараховувався до підвалу (усе нижче ПЕРШОЇ таблиці) і їхав на другий аркуш
  // разом із ним, хоча місця на першому вистачало.
  const layout = await layoutOf([
    table("section_a", { yPercent: "10" }, 4),
    text("section_b_caption", { mode: "flow", gapPt: "10" }),
    table("section_b", { mode: "flow", gapPt: "4" }, 4),
    text("signature", { mode: "flow", gapPt: "20" }),
  ], 4);

  const a = entry(layout, "section_a");
  const caption = entry(layout, "section_b_caption");
  const b = entry(layout, "section_b");
  const signature = entry(layout, "signature");

  assertEquals([a.page, caption.page, b.page, signature.page], [1, 1, 1, 1]);
  assert(caption.topPt < a.bottomPt, "підпис мусить стояти нижче першої таблиці");
  assert(b.topPt < caption.bottomPt, "друга таблиця — нижче підпису");
  assert(signature.topPt < b.bottomPt, "підпис бланка — нижче другої таблиці");
});

Deno.test("потік: блок, який не влазить, іде на наступну сторінку цілим", async () => {
  // Вертикальна лінія — блок із ЗАДАНОЮ висотою, тож «не влазить» тут не
  // випадковість набору: 30 % висоти області друку під блоком, у якого до
  // нижнього поля лишилося менше.
  const layout = await layoutOf([
    text("head", { yPercent: "80" }),
    {
      key: "tall",
      type: "vertical-line",
      placement: place({ mode: "flow", gapPt: "6", heightPercent: "30", widthPercent: "10" }),
      text: textOptions(),
    },
  ], 0);

  const tall = entry(layout, "tall");
  assertEquals(tall.page, 2);
  assertAlmostEquals(tall.topPt, CONTENT_TOP, 0.01);
  assertEquals(tall.overflow, false);
});

Deno.test("потік: «не відривати» тримає групу на одній сторінці", async () => {
  // Твердження ще влазить, а підпис під ним — уже ні: саме той випадок, заради
  // якого ознака й потрібна. Без неї вони роз'їжджаються по двох аркушах —
  // і це проба перевіряє окремо, інакше вона нічого не доводила б.
  const blocks = (keepTogether: boolean) => [
    text("head", { yPercent: "60" }),
    text("statement", { mode: "flow", gapPt: "6" }, { keepTogether }),
    // Підпис заввишки 35 % області друку: на місці, що лишилося під
    // твердженням, він не поміщається.
    {
      key: "signature",
      type: "vertical-line",
      placement: place({ mode: "flow", gapPt: "6", heightPercent: "35", widthPercent: "10" }),
      text: textOptions(),
    },
  ];

  const apart = await layoutOf(blocks(false), 0);
  assertEquals(entry(apart, "statement").page, 1);
  assertEquals(entry(apart, "signature").page, 2);

  const together = await layoutOf(blocks(true), 0);
  assertEquals(entry(together, "statement").page, 2);
  assertEquals(entry(together, "signature").page, 2);
});

Deno.test("потік: абсолютні блоки лишаються там, де стояли", async () => {
  // Змішана розкладка — шапка на координатах, стос нижче. Координата не має
  // залежати ні від сусідів, ні від того, що потік уже почався.
  const layout = await layoutOf([
    text("head", { yPercent: "10" }),
    text("flowing", { mode: "flow", gapPt: "6" }),
    text("stamp", { yPercent: "60" }),
  ], 0);

  assertAlmostEquals(entry(layout, "head").topPt, CONTENT_TOP - 761.89 * 0.10, 0.01);
  assertAlmostEquals(entry(layout, "stamp").topPt, CONTENT_TOP - 761.89 * 0.60, 0.01);
  assert(entry(layout, "flowing").topPt < entry(layout, "head").bottomPt);
});

Deno.test("звіт: наявні бланки без потоку теж отримують свої координати", async () => {
  const layout = await layoutOf([
    text("head", { yPercent: "0" }),
    table("lines", { yPercent: "20" }, 2),
  ], 2);

  assertEquals(layout.length, 2);
  assertEquals(entry(layout, "head").page, 1);
  assertEquals(entry(layout, "head").overflow, false);
  assert(entry(layout, "lines").bottomPt < entry(layout, "lines").topPt);
});


/**
 * Розрив сторінки — намір, а не наслідок заповненості.
 *
 * Затверджена двобічна форма (НА-1, НА-3, М-2, інвентаризаційний опис із
 * розпискою) вимагає, щоб зворотний бік починався з нового аркуша ЗАВЖДИ. Акт
 * на один об'єкт лицьовим боком займає півсторінки, тож будь-яка розкладка «за
 * залишком місця» кладе зворотний бік під лицьовий — і бланк із написом
 * «Зворотний бік акта» виявляється на тому самому аркуші.
 */
Deno.test("потік: оголошений розрив починає новий аркуш, хоч би місце й лишалося", async () => {
  const blocks = (pageBreakBefore: boolean) => [
    text("front", { mode: "flow" }),
    text("back", { mode: "flow", gapPt: "6" }, { pageBreakBefore }),
  ];

  // Без ознаки обидва блоки на першому аркуші — місця вдосталь.
  const together = await layoutOf(blocks(false), 0);
  assertEquals(entry(together, "front").page, 1);
  assertEquals(entry(together, "back").page, 1);

  const split = await layoutOf(blocks(true), 0);
  assertEquals(entry(split, "front").page, 1);
  assertEquals(entry(split, "back").page, 2);
  // Зворотний бік починається з ВЕРХУ області друку, а не з координати
  // попереднього аркуша.
  assertAlmostEquals(entry(split, "back").topPt, CONTENT_TOP, 0.01);
});

Deno.test("потік: розрив на першому блоці не дає порожнього аркуша", async () => {
  // Порожній перший аркуш виглядав би не як розрив, а як зламаний друк.
  const layout = await layoutOf([
    text("first", { mode: "flow" }, { pageBreakBefore: true }),
    text("second", { mode: "flow", gapPt: "6" }),
  ], 0);

  assertEquals(entry(layout, "first").page, 1);
  assertEquals(entry(layout, "second").page, 1);
});

Deno.test("потік: розрив діє й після таблиці, хай де та скінчилася", async () => {
  // Найчастіший бланк: лицьовий бік із таблицею, далі зворотний. Висота
  // таблиці до рендера невідома, тож «підперти» зворотний бік нічим — це і є
  // випадок, у якому обхід не пишеться взагалі.
  for (const rows of [2, 40]) {
    const layout = await layoutOf([
      table("lines", { mode: "flow" }, rows),
      text("back", { mode: "flow", gapPt: "6" }, { pageBreakBefore: true }),
    ], rows);

    const back = entry(layout, "back");
    assertEquals(back.page, entry(layout, "lines").endPage + 1);
    assertAlmostEquals(back.topPt, CONTENT_TOP, 0.01);
  }
});
