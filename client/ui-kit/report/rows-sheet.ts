/**
 * Модель аркуша з даних і опису колонок — шлях для списків.
 *
 * У звіті аркуш читається з намальованої таблиці, бо опису колонок там немає
 * взагалі. У списку все навпаки: колонки оголошені (`ListColumn[]`), а от у DOM
 * лежить лише поточна сторінка — вивантажувати її означало б віддати 20 рядків
 * з п'яти тисяч. Тому список бере дані, а не розмітку: повторює запит без
 * пагінації й будує аркуш звідси.
 */

import type { SheetCell, SheetModel } from "./xlsx.ts";

const MIN_WIDTH = 8;
const MAX_WIDTH = 55;

/** Колонка вивантаження: заголовок уже перекладений, значення дає геттер. */
export interface ExportColumn<Row> {
  title: string;
  align?: SheetCell["align"];
  value: (row: Row) => string | number | null | undefined;
}

/**
 * Рядок, який виглядає як число, стає числом — але лише у правій колонці.
 * Праве вирівнювання в цих списках і означає «це число»; без цієї умови
 * номером став би код рахунку чи номер документа, а з ним поїхали б і нулі
 * на початку.
 */
function asNumber(value: string, align: SheetCell["align"]): number | undefined {
  if (align !== "right") return undefined;
  if (!/^-?\d+(\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildRowsSheet<Row>(columns: ExportColumn<Row>[], rows: Row[]): SheetModel {
  const widths = columns.map((col) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, col.title.length + 2)));

  const header: SheetCell[] = columns.map((col) => ({
    text: col.title,
    bold: true,
    align: col.align ?? "left",
  }));

  const body = rows.map((row) =>
    columns.map((col, i): SheetCell => {
      const raw = col.value(row);
      const text = raw == null ? "" : String(raw);
      const value = typeof raw === "number" ? raw : asNumber(text, col.align);

      widths[i] = Math.min(MAX_WIDTH, Math.max(widths[i], text.length + 2));

      return value === undefined
        ? { text, align: col.align ?? "left" }
        : { text: "", value, numeric: true, align: "right" };
    })
  );

  return { rows: [header, ...body], colWidths: widths, headerRows: 1 };
}
