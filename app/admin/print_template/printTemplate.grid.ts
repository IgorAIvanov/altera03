// Операції над сіткою секції таблиці: об'єднання, розбиття, додавання й
// видалення рядків та колонок.
//
// Секція зберігається як список рядків із комірками, де комірка може займати
// кілька клітинок (`colSpan`/`rowSpan`) — як у HTML. Редагувати такий список
// «на місці» незручно, тож кожна операція: розгортаємо секцію в матрицю
// ПОСИЛАНЬ на комірки → міняємо матрицю → згортаємо назад у рядки.
//
// Ключове: спани не переносяться з матриці, а ВИВОДЯТЬСЯ з того, скільки
// клітинок реально зайняло посилання. Тому будь-яка структурна правка (зсув
// рядків, видалення колонки) не лишає за собою неузгоджених координат.

import type {
  PrintTemplateTableCell,
  PrintTemplateTableRow,
} from "@altera/server/print";

/** Матриця клітинок: у кожній — посилання на комірку або порожньо. */
export type CellGrid = Array<Array<PrintTemplateTableCell | null>>;

/** Прямокутний діапазон у координатах сітки. */
export interface GridRange {
  fromRow: number;
  toRow: number;
  fromColumn: number;
  toColumn: number;
}

/** Межі комірки в матриці. */
export interface CellBounds extends GridRange {
  cell: PrintTemplateTableCell;
}

export function createCell(patch: Partial<PrintTemplateTableCell> = {}): PrintTemplateTableCell {
  return {
    key: crypto.randomUUID(),
    text: "",
    path: "",
    format: "",
    colSpan: 1,
    rowSpan: 1,
    align: "left",
    fontWeight: "normal",
    fontSize: "",
    color: "",
    textOrientation: "0",
    ...patch,
  };
}

export function createRow(columnCount: number): PrintTemplateTableRow {
  return {
    key: crypto.randomUUID(),
    cells: Array.from({ length: Math.max(columnCount, 1) }, () => createCell()),
    visibleWhen: "",
  };
}

/** Рядки секції → матриця клітинок. */
export function buildGrid(rows: PrintTemplateTableRow[], columnCount: number): CellGrid {
  const width = Math.max(columnCount, 1);
  const grid: CellGrid = rows.map(() => Array.from({ length: width }, () => null));

  rows.forEach((row, rowIndex) => {
    let columnIndex = 0;

    for (const cell of row.cells) {
      while (columnIndex < width && grid[rowIndex]![columnIndex]) columnIndex += 1;
      if (columnIndex >= width) break;

      const colSpan = Math.min(Math.max(cell.colSpan, 1), width - columnIndex);
      const rowSpan = Math.min(Math.max(cell.rowSpan, 1), rows.length - rowIndex);

      for (let r = 0; r < rowSpan; r += 1) {
        for (let c = 0; c < colSpan; c += 1) {
          grid[rowIndex + r]![columnIndex + c] = cell;
        }
      }

      columnIndex += colSpan;
    }
  });

  return grid;
}

/** Межі кожної комірки — виводяться з фактичного покриття матриці. */
export function describeGrid(grid: CellGrid): Map<PrintTemplateTableCell, CellBounds> {
  const bounds = new Map<PrintTemplateTableCell, CellBounds>();

  grid.forEach((gridRow, rowIndex) => {
    gridRow.forEach((cell, columnIndex) => {
      if (!cell) return;

      const known = bounds.get(cell);
      if (!known) {
        bounds.set(cell, { cell, fromRow: rowIndex, toRow: rowIndex, fromColumn: columnIndex, toColumn: columnIndex });
        return;
      }

      known.fromRow = Math.min(known.fromRow, rowIndex);
      known.toRow = Math.max(known.toRow, rowIndex);
      known.fromColumn = Math.min(known.fromColumn, columnIndex);
      known.toColumn = Math.max(known.toColumn, columnIndex);
    });
  });

  return bounds;
}

/**
 * Матриця → рядки секції. Спани перераховуються з меж покриття, порожні
 * клітинки стають звичайними комірками — щоб у шаблоні не було «дірок».
 *
 * Комірки КОПІЮЮТЬСЯ, а не правляться на місці: операція не має псувати той
 * стан, з якого її викликали (інакше попередній масив рядків «поїде» слідом).
 */
export function gridToRows(grid: CellGrid, sourceRows: PrintTemplateTableRow[]): PrintTemplateTableRow[] {
  const bounds = describeGrid(grid);

  return grid.map((gridRow, rowIndex) => ({
    key: sourceRows[rowIndex]?.key ?? crypto.randomUUID(),
    // Умова показу належить РЯДКУ, а не комірці: перебудова сітки (об'єднання,
    // вставка) не має її губити.
    visibleWhen: sourceRows[rowIndex]?.visibleWhen ?? "",
    cells: gridRow.flatMap((cell, columnIndex) => {
      if (!cell) return [createCell()];

      const box = bounds.get(cell)!;
      if (box.fromRow !== rowIndex || box.fromColumn !== columnIndex) return [];

      return [{
        ...cell,
        colSpan: box.toColumn - box.fromColumn + 1,
        rowSpan: box.toRow - box.fromRow + 1,
      }];
    }),
  }));
}

export function normalizeRange(
  anchor: { row: number; column: number },
  focus: { row: number; column: number },
): GridRange {
  return {
    fromRow: Math.min(anchor.row, focus.row),
    toRow: Math.max(anchor.row, focus.row),
    fromColumn: Math.min(anchor.column, focus.column),
    toColumn: Math.max(anchor.column, focus.column),
  };
}

/**
 * Розширює діапазон так, щоб він не різав комірки навпіл: якщо в нього
 * потрапила частина об'єднаної комірки, діапазон вбирає її цілком.
 */
export function expandRange(grid: CellGrid, range: GridRange): GridRange {
  const bounds = describeGrid(grid);
  const result = { ...range };
  let changed = true;

  while (changed) {
    changed = false;

    for (let r = result.fromRow; r <= result.toRow; r += 1) {
      for (let c = result.fromColumn; c <= result.toColumn; c += 1) {
        const cell = grid[r]?.[c];
        const box = cell ? bounds.get(cell) : null;
        if (!box) continue;

        if (box.fromRow < result.fromRow) { result.fromRow = box.fromRow; changed = true; }
        if (box.fromColumn < result.fromColumn) { result.fromColumn = box.fromColumn; changed = true; }
        if (box.toRow > result.toRow) { result.toRow = box.toRow; changed = true; }
        if (box.toColumn > result.toColumn) { result.toColumn = box.toColumn; changed = true; }
      }
    }
  }

  return result;
}

/**
 * Об'єднання діапазону: виживає ліва верхня комірка, решта зникає разом зі
 * своїм вмістом. Діапазон спершу розширюється до цілих комірок.
 */
export function mergeRange(
  rows: PrintTemplateTableRow[],
  columnCount: number,
  range: GridRange,
): PrintTemplateTableRow[] {
  const grid = buildGrid(rows, columnCount);
  const full = expandRange(grid, range);
  const survivor = grid[full.fromRow]?.[full.fromColumn] ?? createCell();

  for (let r = full.fromRow; r <= full.toRow; r += 1) {
    for (let c = full.fromColumn; c <= full.toColumn; c += 1) {
      grid[r]![c] = survivor;
    }
  }

  return gridToRows(grid, rows);
}

/** Розбиття об'єднаної комірки: звільнені клітинки стають порожніми. */
export function splitCell(
  rows: PrintTemplateTableRow[],
  columnCount: number,
  position: { row: number; column: number },
): PrintTemplateTableRow[] {
  const grid = buildGrid(rows, columnCount);
  const cell = grid[position.row]?.[position.column];
  if (!cell) return rows;

  const box = describeGrid(grid).get(cell)!;

  for (let r = box.fromRow; r <= box.toRow; r += 1) {
    for (let c = box.fromColumn; c <= box.toColumn; c += 1) {
      grid[r]![c] = r === box.fromRow && c === box.fromColumn ? cell : createCell();
    }
  }

  return gridToRows(grid, rows);
}

/** Додає колонку праворуч. */
export function addColumn(rows: PrintTemplateTableRow[], columnCount: number): PrintTemplateTableRow[] {
  const grid = buildGrid(rows, columnCount).map((gridRow) => [...gridRow, null]);
  return gridToRows(grid, rows);
}

/**
 * Прибирає колонку. Комірка, що перекривала кілька колонок, просто звужується —
 * спан перерахується сам із покриття, що лишилось.
 */
export function removeColumn(
  rows: PrintTemplateTableRow[],
  columnCount: number,
  columnIndex: number,
): PrintTemplateTableRow[] {
  const grid = buildGrid(rows, columnCount).map((gridRow) => gridRow.filter((_, index) => index !== columnIndex));
  return gridToRows(grid, rows);
}

/** Прибирає рядок секції; вертикальні об'єднання через нього звужуються. */
export function removeRow(
  rows: PrintTemplateTableRow[],
  columnCount: number,
  rowIndex: number,
): PrintTemplateTableRow[] {
  const grid = buildGrid(rows, columnCount).filter((_, index) => index !== rowIndex);
  return gridToRows(grid, rows.filter((_, index) => index !== rowIndex));
}
