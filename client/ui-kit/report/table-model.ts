/**
 * Таблиця звіту на екрані → модель аркуша для експорту.
 *
 * Джерело — сам відрендерений `<table>`, а не окремий опис колонок. Це свідомо:
 * інакше кожен звіт описував би свої колонки двічі (для екрана й для Excel), і
 * будь-яка зміна розкладки розходилася б з вивантаженням — а розходження видно
 * лише тоді, коли бухгалтер уже відкрив файл. Тут експортується рівно те, що
 * людина бачить, включно з колонками, які звіт показує за наявністю даних
 * (валюта, кількість), і з підсумковим підвалом.
 *
 * Три сигнали розмітки, на які спирається читач:
 *  - `th` — шапка або підсумок: жирний шрифт і фон;
 *  - `tabular-nums` — комірка числова: текст розбирається назад у число, тож
 *    у файлі буде число, яке Excel уміє додавати, а не рядок;
 *  - `text-right` / `text-center` — вирівнювання.
 *
 * Усі три вже стоять у звітах для екрана — окремої розмітки «для експорту» не
 * з'являється.
 */

import type { SheetCell, SheetModel } from "./xlsx.ts";

/** Мінімальна й максимальна ширина колонки в символах. */
const MIN_WIDTH = 8;
const MAX_WIDTH = 55;

/**
 * Текст комірки. `innerText` (а не `textContent`), бо він бачить розкладку:
 * список субконто, намальований стовпчиком, приїде з переносами рядків, а не
 * склеєним в одне слово.
 */
function cellText(cell: HTMLTableCellElement): string {
  const raw = cell.innerText ?? cell.textContent ?? "";
  return raw.replace(/[ \t\u00A0]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/**
 * Число з відформатованого тексту: «1 234,56» → 1234.56. Розділювачі розрядів
 * бувають звичайним пробілом, нерозривним і вузьким нерозривним — саме такі
 * ставить `Intl.NumberFormat("uk-UA")`.
 */
function cellNumber(text: string): number | undefined {
  // \s у JS уже покриває нерозривний і вузький нерозривний пробіл — саме їх ставить Intl.
  const normalized = text.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function cellAlign(cell: HTMLTableCellElement): SheetCell["align"] {
  if (cell.classList.contains("text-right")) return "right";
  if (cell.classList.contains("text-center")) return "center";
  return "left";
}

/** Найдовший рядок у комірці — колонка міряється по ньому, а не по всьому тексту. */
function longestLine(text: string): number {
  return text.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
}

/**
 * Читає таблицю в модель аркуша: сітка з урахуванням `colspan`/`rowspan`,
 * числа числами, ширини колонок за вмістом.
 */
export function readReportTable(table: HTMLTableElement): SheetModel {
  const rows: SheetCell[][] = [];
  const widths: number[] = [];
  // Клітинки, зайняті об'єднанням зверху: ключ "рядок:колонка".
  const occupied = new Set<string>();

  for (let r = 0; r < table.rows.length; r++) {
    const rowCells: SheetCell[] = [];
    let col = 0;

    for (const cell of Array.from(table.rows[r].cells)) {
      while (occupied.has(`${r}:${col}`)) col++;

      const colSpan = Math.max(1, cell.colSpan || 1);
      const rowSpan = Math.max(1, cell.rowSpan || 1);
      const text = cellText(cell);
      const numeric = cell.classList.contains("tabular-nums");
      const value = numeric ? cellNumber(text) : undefined;

      rowCells.push({
        text: value === undefined ? text : "",
        value,
        numeric: value !== undefined,
        bold: cell.tagName === "TH",
        align: cellAlign(cell),
        colSpan,
        rowSpan,
      });

      // Ширину набирає лише колонка, яку комірка займає одна: об'єднана шапка
      // інакше роздула б першу колонку групи на всю свою довжину.
      if (colSpan === 1) {
        widths[col] = Math.max(widths[col] ?? MIN_WIDTH, Math.min(MAX_WIDTH, longestLine(text) + 2));
      }

      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          if (dr > 0 || dc > 0) occupied.add(`${r + dr}:${col + dc}`);
        }
      }
      col += colSpan;
    }

    rows.push(rowCells);
    for (let c = 0; c < col; c++) if (widths[c] === undefined) widths[c] = MIN_WIDTH;
  }

  return {
    rows,
    colWidths: widths.map((w) => w ?? MIN_WIDTH),
    headerRows: table.tHead?.rows.length ?? 0,
  };
}

/**
 * Рядки над таблицею (назва звіту, організація, період) — тим самим аркушем,
 * перед шапкою. Заголовок звіту в Excel потрібен рівно з тієї ж причини, що й
 * на папері: файл живе окремо від екрана, з якого його вивантажили.
 */
export function withTitleRows(model: SheetModel, titleLines: string[]): SheetModel {
  const lines = titleLines.filter((line) => line.trim().length > 0);
  if (lines.length === 0) return model;

  const width = Math.max(1, model.colWidths.length);
  const head: SheetCell[][] = lines.map((line, i) => [
    { text: line, style: i === 0 ? "title" : "plain", align: "left", colSpan: width },
  ]);

  return {
    rows: [...head, ...model.rows],
    colWidths: model.colWidths,
    headerRows: model.headerRows + head.length,
  };
}
