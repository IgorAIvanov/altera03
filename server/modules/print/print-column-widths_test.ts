/**
 * Ширини колонок, пораховані ядром.
 *
 * Перевіряється не арифметика, а те, заради чого це взагалі перенесено з
 * застосунку: що намір колонки («не переносься», «забери лишок», «три
 * відсотки») перетворюється на числа, які на папері дають ЧИТАБЕЛЬНУ таблицю.
 * Випадки взяті з запису прикладників — регламентована форма на альбомному
 * аркуші, де сума «потрібного» більша за аркуш і місця вистачає лише після
 * перерозподілу, і її ж крайній варіант, де не влазять навіть окремі слова.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { createPrintTextMeasurer, PRINT_CELL_PADDING, printContentWidth } from "./print-text-metrics.ts";
import {
  type PrintColumnSizingInput,
  type PrintSizedCell,
  resolvePrintColumnWidths,
} from "./print-column-widths.ts";
import { normalizePrintTemplateSchema } from "./print-template.ts";
import { renderPrintPdfWithLayout } from "./print-pdf.renderer.ts";

const options = async () => ({
  measure: await createPrintTextMeasurer(),
  cellPadding: PRINT_CELL_PADDING,
  lineStep: (fontSize: number) => fontSize + 2,
});

const cell = (
  columnIndex: number,
  value: string,
  extra: Partial<PrintSizedCell> = {},
): PrintSizedCell => ({
  columnIndex,
  colSpan: 1,
  value,
  fontSize: 9,
  bold: false,
  rotated: false,
  ...extra,
});

const fit: PrintColumnSizingInput = { sizing: { kind: "fit" }, minPt: 0 };
const auto: PrintColumnSizingInput = { sizing: { kind: "auto" }, minPt: 0 };
const percent = (value: number): PrintColumnSizingInput => ({
  sizing: { kind: "percent", percent: value },
  minPt: 0,
});

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

Deno.test("сума ширин дорівнює ширині блока — завжди", async () => {
  const o = await options();
  const widths = resolvePrintColumnWidths(
    [fit, auto, percent(10)],
    [cell(0, "1 234 567.89"), cell(1, "Найменування товару"), cell(2, "%")],
    500,
    o,
  );

  assertEquals(widths.length, 3);
  assertAlmostEquals(sum(widths), 500, 0.001);
});

/**
 * `fit` — це «не переносься». Коли місця вистачає, колонка мусить дістати рівно
 * ширину свого найдовшого значення, а не частку від чогось.
 */
Deno.test("місця вистачає: fit бере рівно своє, auto забирає лишок", async () => {
  const o = await options();
  const number = "1 234 567.89";
  const needed = o.measure(number, 9) + PRINT_CELL_PADDING * 2;

  const widths = resolvePrintColumnWidths(
    [fit, auto],
    [cell(0, number), cell(1, "Опис")],
    500,
    o,
  );

  assertAlmostEquals(widths[0]!, needed, 0.5);
  // Решта — колонці `auto`, а не порівну: у неї на те й намір.
  assertAlmostEquals(widths[1]!, 500 - needed, 0.5);
});

Deno.test("відсоток забирає свою частку від ширини блока", async () => {
  const o = await options();
  const widths = resolvePrintColumnWidths(
    [percent(20), auto],
    [cell(0, "20"), cell(1, "Опис товару")],
    600,
    o,
  );

  assertAlmostEquals(widths[0]!, 120, 0.5);
  assertAlmostEquals(widths[1]!, 480, 0.5);
});

/**
 * Випадок із запису: колонок багато, сума «потрібного» більша за аркуш.
 *
 * Головне тут не конкретні числа, а властивість: таблиця лишається в межах
 * аркуша, кожна колонка вміщає своє найдовше СЛОВО (інакше на папері розрив
 * посеред слова), а висота шапки менша, ніж при рівному поділі. Саме останнє й
 * було ціною відсутності цієї функції: 11 рядків шапки замість 6, при тому що
 * місця вистачало з самого початку.
 */
Deno.test("місця не вистачає: висота шапки менша, ніж при рівному поділі", async () => {
  const o = await options();
  const sheet = printContentWidth("landscape");

  const headers = [
    "№ з/п",
    "Номенклатура товарів продавця",
    "Код УКТ ЗЕД",
    "Одиниця виміру",
    "Умовне позначення",
    "Кількість",
    "Ціна постачання одиниці без урахування податку",
    "Код ставки",
    "Обсяг постачання без урахування податку",
    "Сума податку",
  ];

  const columns = headers.map(() => fit);
  const cells = headers.map((title, index) => cell(index, title, { bold: true }));
  for (const [index] of headers.entries()) cells.push(cell(index, "1 234.56"));

  const widths = resolvePrintColumnWidths(columns, cells, sheet, o);

  assertAlmostEquals(sum(widths), sheet, 0.001);

  // Кожна колонка вміщає своє найдовше слово — тобто розриву посеред слова не
  // буде ніде.
  for (const [index, title] of headers.entries()) {
    const longest = Math.max(
      ...title.split(" ").map((word) => o.measure(word, 9, true)),
      o.measure("1", 9),
    );
    assert(
      widths[index]! >= longest + PRINT_CELL_PADDING * 2 - 0.5,
      `колонка ${index} («${title}») вужча за своє найдовше слово`,
    );
  }

  const linesAt = (title: string, width: number) => {
    const usable = width - PRINT_CELL_PADDING * 2;
    const spaceWidth = o.measure(" ", 9, true);
    let lines = 1;
    let current = 0;
    for (const word of title.split(" ")) {
      const wordWidth = o.measure(word, 9, true);
      const candidate = current === 0 ? wordWidth : current + spaceWidth + wordWidth;
      if (candidate <= usable) {
        current = candidate;
        continue;
      }
      lines += 1;
      current = wordWidth;
    }
    return lines;
  };

  const tallestSized = Math.max(...headers.map((title, index) => linesAt(title, widths[index]!)));
  const even = sheet / headers.length;
  const tallestEven = Math.max(...headers.map((title) => linesAt(title, even)));

  assert(
    tallestSized < tallestEven,
    `шапка мусить бути нижчою за рівний поділ: ${tallestSized} проти ${tallestEven}`,
  );
});

/**
 * Межа, названа явно: буває, що не влазять навіть найдовші слова.
 *
 * Дев'ятнадцять колонок із підписами затвердженої форми дають суму мінімумів,
 * більшу за альбомний аркуш, — і жодна розкладка цього не виправить. Ядро тоді
 * стискає пропорційно, а слово ріже сам перенос: розрив некрасивий, але він у
 * МЕЖАХ комірки, а вихід за межі не має жодного правильного прочитання. Те, що
 * тут перевіряється, — що це не падіння й не нульова колонка.
 */
Deno.test("не влазять навіть слова: стискаємо пропорційно, а не ламаємось", async () => {
  const o = await options();
  const sheet = printContentWidth("landscape");

  const headers = [
    "№ з/п",
    "Номенклатура товарів/послуг продавця",
    "Код УКТ ЗЕД",
    "Ознака імпортованого товару",
    "Код послуги згідно з ДКПП",
    "Одиниця виміру товару/послуги",
    "Умовне позначення",
    "Код",
    "Кількість (об'єм, обсяг)",
    "Ціна постачання одиниці товару/послуги без урахування податку",
    "Код ставки",
    "Код пільги",
    "Обсяги постачання (база оподаткування) без урахування податку",
    "Сума податку на додану вартість",
    "Код виду діяльності сільськогосподарського товаровиробника",
    "Дата",
    "Номер",
    "Сума з урахуванням податку",
    "Примітка",
  ];

  const widths = resolvePrintColumnWidths(
    headers.map(() => fit),
    headers.map((title, index) => cell(index, title, { bold: true })),
    sheet,
    o,
  );

  assertEquals(widths.length, headers.length);
  assertAlmostEquals(sum(widths), sheet, 0.001);
  for (const [index, width] of widths.entries()) {
    assert(width > 0, `колонка ${index} лишилася без ширини`);
  }
});

/**
 * Об'єднана комірка каже про СУМУ своїх колонок, а не про кожну окремо.
 *
 * Позиційна прикидка на боці застосунку саме тут і брехала: на тризначній шапці
 * з `rowSpan` вона мапила комірки по порядку й показувала чужі числа.
 */
Deno.test("об'єднана комірка розсовує свої колонки, а не одну", async () => {
  const o = await options();
  const wide = "Дуже довгий заголовок над двома колонками";

  const widths = resolvePrintColumnWidths(
    [fit, fit, fit],
    [
      cell(0, wide, { colSpan: 2, bold: true }),
      cell(0, "1"),
      cell(1, "2"),
      cell(2, "3"),
    ],
    400,
    o,
  );

  // Перші дві разом мусять покривати підпис, і жодна з них не з'їдає все.
  assert(
    widths[0]! + widths[1]! >= o.measure(wide, 9, true) + PRINT_CELL_PADDING * 2 - 0.5,
    "дві колонки разом мусять уміщати спільний підпис",
  );
  assert(widths[0]! > 0 && widths[1]! > 0);
  // Третій колонці дісталося небагато: її вимога — одна цифра.
  assert(widths[2]! < widths[0]!);
});

/**
 * Повернутий текст росте ВГОРУ: ширини йому треба на один рядок, і давати
 * більше — марно витрачене місце сусідів. Саме на вертикальних підписах
 * регламентованої форми це й видно.
 */
Deno.test("повернута колонка бере ширину одного рядка, а не довжини напису", async () => {
  const o = await options();
  const long = "Код виду діяльності сільськогосподарського товаровиробника";

  const widths = resolvePrintColumnWidths(
    [fit, auto],
    [cell(0, long, { rotated: true }), cell(1, "Опис")],
    400,
    o,
  );

  // Один рядок 9pt плюс відступи — і ані пункта більше.
  assertAlmostEquals(widths[0]!, 9 + PRINT_CELL_PADDING * 2, 0.5);
});

Deno.test("minPt тримає нижню межу навіть для порожньої колонки", async () => {
  const o = await options();
  const widths = resolvePrintColumnWidths(
    [{ sizing: { kind: "fit" }, minPt: 60 }, auto],
    [cell(0, ""), cell(1, "Опис товару")],
    400,
    o,
  );

  assert(widths[0]! >= 60 - 0.5, `нижня межа не втрималася: ${widths[0]}`);
});

/**
 * Явний розрив у підписі мусить впливати й на ШИРИНУ, а не лише на малювання:
 * інакше рахівник вимагав би місця під увесь рядок, якого ніколи не буде.
 */
Deno.test("явний розрив зменшує потрібну ширину", async () => {
  const o = await options();
  const one = resolvePrintColumnWidths([fit, auto], [cell(0, "Ставка ПДВ"), cell(1, "Опис")], 400, o);
  const two = resolvePrintColumnWidths([fit, auto], [cell(0, "Ставка\nПДВ"), cell(1, "Опис")], 400, o);

  assert(two[0]! < one[0]!, "розрив мусить зробити колонку вужчою");
  assertAlmostEquals(two[0]!, o.measure("Ставка", 9) + PRINT_CELL_PADDING * 2, 0.5);
});

// ── Кінець у кінець: те саме, але через справжній рендер ─────────────────────

/** Бланк із однією таблицею: заголовки в шапці, один рядок даних. */
async function tableHeightPt(headers: string[], width: (index: number) => Record<string, string>) {
  const columns = headers.map((_, index) => ({ key: `c${index}`, ...width(index) }));
  const schema = normalizePrintTemplateSchema({
    schemaVersion: 2,
    blocks: [{
      key: "grid",
      type: "table",
      source: "lines",
      columns,
      sections: {
        header: [{
          key: "h",
          cells: headers.map((title, index) => ({ key: `hc${index}`, columnKey: `c${index}`, text: title })),
        }],
        row: [{
          key: "r",
          cells: headers.map((_, index) => ({ key: `rc${index}`, columnKey: `c${index}`, path: "value" })),
        }],
        footer: [],
      },
      placement: { mode: "absolute", xPercent: "0", yPercent: "5", widthPercent: "100", heightPercent: "0" },
      text: { fontSize: "9", align: "left", fontWeight: "normal", color: "#000000" },
    }],
  });
  assert(schema, "шаблон не пройшов нормалізацію");

  const { layout } = await renderPrintPdfWithLayout({
    code: "probe",
    name: "проба",
    targetModel: "probe",
    dataCommand: "print",
    orientation: "landscape",
    schema,
  }, { lines: [{ value: "1 234.56" }] });

  const grid = layout.find((item) => item.key === "grid");
  assert(grid, "у звіті немає таблиці");
  return grid.topPt - grid.bottomPt;
}

/**
 * Кінець у кінець: та сама таблиця, порахована ядром, нижча за поділ порівну.
 *
 * Це і є вимірна ціна відсутності функції — на бланку прикладників 11 рядків
 * шапки замість 6. Проба міряє висоту звітом про розкладку, а не розбиранням
 * PDF: звіт для того й доданий.
 */
Deno.test("рендер: fit дає нижчу шапку, ніж рівні відсотки", async () => {
  const headers = [
    "№ з/п",
    "Номенклатура товарів продавця",
    "Код УКТ ЗЕД",
    "Одиниця виміру",
    "Умовне позначення",
    "Кількість",
    "Ціна постачання одиниці без урахування податку",
    "Код ставки",
    "Обсяг постачання без урахування податку",
    "Сума податку",
  ];

  const even = await tableHeightPt(headers, () => ({ widthPercent: "10" }));
  const sized = await tableHeightPt(headers, () => ({ width: "fit" }));

  assert(sized < even, `шапка з fit мусить бути нижчою: ${sized} проти ${even}`);
});

/**
 * Стара форма не змінилася ані на пункт.
 *
 * Заради цього в рендері й стоїть розвилка «чи оголосив хоч хтось намір»:
 * рахунок по даних дає інші числа за визначенням, і вмикати його всім означало
 * б переверстати всі наявні бланки мовчки.
 */
Deno.test("рендер: шаблон на відсотках лишається таким, яким був", async () => {
  const headers = ["Назва", "Кількість", "Ціна", "Сума"];
  const percents = ["55", "15", "15", "15"];

  const before = await tableHeightPt(headers, (index) => ({ widthPercent: percents[index]! }));
  const after = await tableHeightPt(headers, (index) => ({ widthPercent: percents[index]!, width: "" }));

  assertAlmostEquals(after, before, 0.001);
});
