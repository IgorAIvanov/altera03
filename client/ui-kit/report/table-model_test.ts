/// <reference lib="deno.ns" />
/**
 * Проби читача таблиці: `deno task test:unit`.
 *
 * Директива вгорі — не забаганка: `client/` це браузерна бібліотека, і в її
 * `lib` немає `deno.ns` навмисно. Додати його в конфіг пакета означало б
 * дозволити `Deno.*` у самому ui-kit; тут він потрібен лише файлу з пробами.
 *
 * DOM тут підроблений навмисно — потрібні рівно ті властивості, які читає
 * `readReportTable` (`rows`, `cells`, спани, класи, текст). Тягнути заради
 * цього реалізацію DOM у залежності ні до чого, а логіка сітки — саме те, що
 * ламається тихо: з'їхала колонка, і видно це лише коли бухгалтер уже відкрив
 * файл.
 */
import { assertEquals } from "@std/assert";
import { NO_EXPORT_CLASS, readReportTable } from "./table-model.ts";

interface FakeCellInit {
  text?: string;
  classes?: string[];
  colSpan?: number;
  rowSpan?: number;
  header?: boolean;
}

function cell(init: FakeCellInit = {}) {
  const classes = new Set(init.classes ?? []);
  return {
    innerText: init.text ?? "",
    textContent: init.text ?? "",
    tagName: init.header ? "TH" : "TD",
    colSpan: init.colSpan ?? 1,
    rowSpan: init.rowSpan ?? 1,
    classList: { contains: (name: string) => classes.has(name) },
  };
}

function row(cells: ReturnType<typeof cell>[], classes: string[] = []) {
  const set = new Set(classes);
  return { cells, classList: { contains: (name: string) => set.has(name) } };
}

function table(rows: ReturnType<typeof row>[], headRowCount = 0) {
  return {
    rows,
    tHead: headRowCount ? { rows: rows.slice(0, headRowCount) } : null,
  } as unknown as HTMLTableElement;
}

Deno.test("readReportTable: базова сітка", () => {
  const model = readReportTable(table([
    row([cell({ text: "Рахунок", header: true }), cell({ text: "Сума", header: true })]),
    row([cell({ text: "0631" }), cell({ text: "1 234,56", classes: ["tabular-nums", "text-right"] })]),
  ], 1));

  assertEquals(model.rows.length, 2);
  assertEquals(model.headerRows, 1);
  assertEquals(model.rows[0][0].bold, true);

  // Код рахунку лишається текстом — на нього не поставили `tabular-nums`.
  assertEquals(model.rows[1][0].numeric, false);
  assertEquals(model.rows[1][0].text, "0631");

  // Сума розбирається назад у число разом із нерозривними пробілами Intl.
  assertEquals(model.rows[1][1].numeric, true);
  assertEquals(model.rows[1][1].value, 1234.56);
  assertEquals(model.rows[1][1].align, "right");
});

Deno.test("readReportTable: no-export", async (t) => {
  await t.step("рядок викидається цілком", () => {
    const model = readReportTable(table([
      row([cell({ text: "Рахунок", header: true })]),
      row([cell({ text: "графік" })], [NO_EXPORT_CLASS]),
      row([cell({ text: "0631" })]),
    ], 1));

    assertEquals(model.rows.length, 2);
    assertEquals(model.rows[1][0].text, "0631");
  });

  await t.step("комірка лишається на місці, але порожня", () => {
    const model = readReportTable(table([
      row([cell({ text: "0631" }), cell({ text: "спарклайн", classes: [NO_EXPORT_CLASS] }), cell({ text: "12" })]),
    ]));

    // Три комірки, а не дві: викинути середню означало б зсунути третю під
    // чужий заголовок.
    assertEquals(model.rows[0].length, 3);
    assertEquals(model.rows[0][1].text, "");
    assertEquals(model.rows[0][2].text, "12");
  });

  await t.step("викинутий рядок шапки не зсуває закріплення", () => {
    const model = readReportTable(table([
      row([cell({ text: "Рахунок", header: true })]),
      row([cell({ text: "перемикач" })], [NO_EXPORT_CLASS]),
      row([cell({ text: "0631" })]),
    ], 2));

    assertEquals(model.headerRows, 1);
  });

  // Найтонше місце правки: індекси для rowspan рахуються по вихідній таблиці.
  // Якби вони рахувалися по відібраних рядках, об'єднання «перестрибнуло» б
  // викинутий рядок і зайняло чужу клітинку.
  await t.step("rowspan через викинутий рядок лишається узгодженим", () => {
    const model = readReportTable(table([
      row([cell({ text: "Група", rowSpan: 3 }), cell({ text: "A" })]),
      row([cell({ text: "службовий" })], [NO_EXPORT_CLASS]),
      row([cell({ text: "B" })]),
    ]));

    assertEquals(model.rows.length, 2);
    // У другому вивантаженому рядку одна комірка: першу колонку тримає
    // об'єднання зверху.
    assertEquals(model.rows[1].length, 1);
    assertEquals(model.rows[1][0].text, "B");
  });
});

Deno.test("readReportTable: об'єднання зберігаються", () => {
  const model = readReportTable(table([
    row([cell({ text: "Обороти", header: true, colSpan: 2 })]),
    row([cell({ text: "Дебет", header: true }), cell({ text: "Кредит", header: true })]),
  ], 2));

  assertEquals(model.rows[0][0].colSpan, 2);
  assertEquals(model.rows[1].length, 2);
  assertEquals(model.rows[1][1].text, "Кредит");
});
