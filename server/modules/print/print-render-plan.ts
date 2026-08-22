// План рендеру: шаблон + дані документа → плаский список блоків із уже
// підставленими значеннями (шляхи резолвнуті, числа з рядків розібрані).
//
// Це єдина точка, де шаблон зустрічається з даними. Прев'ю в редакторі і
// PDF-рендерер малюють ОДИН і той самий план — тому вони не розходяться
// у трактуванні шляхів, ширин колонок і текстових налаштувань.

import { buildBarcode } from "./barcode/barcode.ts";
import type { BarcodeShape } from "./barcode/barcode.ts";
import {
  distributePrintTemplateCharCells,
  getRenderablePrintTemplateBlocks,
  getRenderablePrintTemplateTableColumns,
  isPrintTemplateElementVisible,
  layoutPrintTemplateGrid,
  resolvePrintTemplateBlockPlacement,
  resolvePrintTemplateBlockTextOptions,
  resolvePrintTemplateCharCellsOptions,
  resolvePrintTemplateLineOptions,
  resolvePrintTemplatePath,
  stringifyPrintTemplateValue,
} from "./print-template.ts";
import type {
  PrintTemplateColumnAlign,
  PrintTemplateFontWeight,
  PrintTemplateSchema,
  PrintTemplateTableRow,
  PrintTemplateTextOrientation,
  PrintTemplateValueContext,
  ResolvedPrintTemplateBlockPlacement,
  ResolvedPrintTemplateBlockTextOptions,
  ResolvedPrintTemplateCharCellsOptions,
  ResolvedPrintTemplateLineOptions,
  RenderablePrintTemplateTableColumn,
} from "./print-template.ts";

export interface PrintTemplateRenderTextBlock {
  key: string;
  type: "text";
  text: string;
  textOrientation: PrintTemplateTextOrientation;
  placement: ResolvedPrintTemplateBlockPlacement;
  /** «Не відривати від наступного» — читає розкладка потоком. */
  keepTogether: boolean;
  /** «Звідси — новий аркуш» — її ж. */
  pageBreakBefore: boolean;
  textOptions: ResolvedPrintTemplateBlockTextOptions;
}

export interface PrintTemplateRenderFieldItem {
  key: string;
  label: string;
  value: string;
}

export interface PrintTemplateRenderFieldListBlock {
  key: string;
  type: "field-list";
  items: PrintTemplateRenderFieldItem[];
  placement: ResolvedPrintTemplateBlockPlacement;
  /** «Не відривати від наступного» — читає розкладка потоком. */
  keepTogether: boolean;
  /** «Звідси — новий аркуш» — її ж. */
  pageBreakBefore: boolean;
  textOptions: ResolvedPrintTemplateBlockTextOptions;
}

export interface PrintTemplateRenderTableColumn extends RenderablePrintTemplateTableColumn {}

/** Комірка з уже підставленим значенням. */
export interface PrintTemplateRenderTableCell {
  key: string;
  value: string;
  colSpan: number;
  rowSpan: number;
  align: PrintTemplateColumnAlign;
  fontWeight: PrintTemplateFontWeight;
  /** `null` — успадкувати від блока. */
  fontSize: number | null;
  color: string;
  textOrientation: PrintTemplateTextOrientation;
}

export interface PrintTemplateRenderTableRow {
  key: string;
  cells: PrintTemplateRenderTableCell[];
}

export interface PrintTemplateRenderTableBlock {
  key: string;
  type: "table";
  title: string;
  columns: PrintTemplateRenderTableColumn[];
  /** Шапка: друкується на кожній сторінці. */
  header: PrintTemplateRenderTableRow[];
  /**
   * Тіло: по групі рядків на КОЖЕН запис джерела. Групування важливе для
   * розривів — запис із кількох рядків не має розриватися між сторінками.
   */
  body: PrintTemplateRenderTableRow[][];
  /** Підвал: друкується один раз, після останнього запису. */
  footer: PrintTemplateRenderTableRow[];
  placement: ResolvedPrintTemplateBlockPlacement;
  /** «Не відривати від наступного» — читає розкладка потоком. */
  keepTogether: boolean;
  /** «Звідси — новий аркуш» — її ж. */
  pageBreakBefore: boolean;
  textOptions: ResolvedPrintTemplateBlockTextOptions;
}

export interface PrintTemplateRenderImageBlock {
  key: string;
  type: "image";
  src: string;
  alt: string;
  placement: ResolvedPrintTemplateBlockPlacement;
  /** «Не відривати від наступного» — читає розкладка потоком. */
  keepTogether: boolean;
  /** «Звідси — новий аркуш» — її ж. */
  pageBreakBefore: boolean;
}

/**
 * Штрих-код із уже побудованою фігурою.
 *
 * Фігура рахується саме тут, а не в рендерері: план — єдине місце, де шаблон
 * зустрічається з даними, і побудова коду залежить від даних так само, як
 * підстановка значення в комірку. Помилка значення теж потрапляє сюди
 * (`error`) — рендерер надрукує її замість коду й не завалить весь документ.
 */
export interface PrintTemplateRenderBarcodeBlock {
  key: string;
  type: "barcode";
  shape: BarcodeShape | null;
  error: string;
  showText: boolean;
  placement: ResolvedPrintTemplateBlockPlacement;
  /** «Не відривати від наступного» — читає розкладка потоком. */
  keepTogether: boolean;
  /** «Звідси — новий аркуш» — її ж. */
  pageBreakBefore: boolean;
  textOptions: ResolvedPrintTemplateBlockTextOptions;
}

/**
 * Поле по клітинках із уже розрізаним значенням.
 *
 * Різання лежить тут, а не в рендерері, з тієї ж причини, що й побудова
 * штрих-кода: план — єдине місце, де шаблон зустрічається з даними. Рендереру
 * лишається намалювати рамки й покласти в кожну по символу.
 */
export interface PrintTemplateRenderCharCellsBlock {
  key: string;
  type: "char-cells";
  /** Рівно `count` елементів; порожня клітинка — порожній рядок. */
  cells: string[];
  placement: ResolvedPrintTemplateBlockPlacement;
  /** «Не відривати від наступного» — читає розкладка потоком. */
  keepTogether: boolean;
  /** «Звідси — новий аркуш» — її ж. */
  pageBreakBefore: boolean;
  textOptions: ResolvedPrintTemplateBlockTextOptions;
  cellOptions: ResolvedPrintTemplateCharCellsOptions;
}

export interface PrintTemplateRenderHorizontalLineBlock {
  key: string;
  type: "horizontal-line";
  placement: ResolvedPrintTemplateBlockPlacement;
  /** «Не відривати від наступного» — читає розкладка потоком. */
  keepTogether: boolean;
  /** «Звідси — новий аркуш» — її ж. */
  pageBreakBefore: boolean;
  lineOptions: ResolvedPrintTemplateLineOptions;
}

export interface PrintTemplateRenderVerticalLineBlock {
  key: string;
  type: "vertical-line";
  placement: ResolvedPrintTemplateBlockPlacement;
  /** «Не відривати від наступного» — читає розкладка потоком. */
  keepTogether: boolean;
  /** «Звідси — новий аркуш» — її ж. */
  pageBreakBefore: boolean;
  lineOptions: ResolvedPrintTemplateLineOptions;
}

export type PrintTemplateRenderBlock =
  | PrintTemplateRenderTextBlock
  | PrintTemplateRenderFieldListBlock
  | PrintTemplateRenderTableBlock
  | PrintTemplateRenderImageBlock
  | PrintTemplateRenderBarcodeBlock
  | PrintTemplateRenderCharCellsBlock
  | PrintTemplateRenderHorizontalLineBlock
  | PrintTemplateRenderVerticalLineBlock;

/**
 * Секція → рядки з підставленими значеннями.
 * `scope` — корінь, від якого рахуються шляхи комірок: для шапки й підвалу це
 * всі дані друку, для рядка тіла — конкретний запис.
 */
function buildSectionRows(
  rows: PrintTemplateTableRow[],
  scope: unknown,
  context: PrintTemplateValueContext,
  columnCount: number,
  isColumnVisible: (index: number) => boolean,
): PrintTemplateRenderTableRow[] {
  const kept = rows.filter((row) => isPrintTemplateElementVisible(scope, row.visibleWhen));

  // Комірки лежать у рядку списком, а до колонок їх прив'язує обхід сітки —
  // той самий, яким потім розставляє їх рендерер. Без нього неможливо
  // сказати, ЯКІЙ колонці належить комірка, а отже й чи вона зникає разом
  // із нею: `colSpan`/`rowSpan` зсувають усе, що правіше й нижче.
  const placed = layoutPrintTemplateGrid(kept, columnCount);
  const cellsByRow: PrintTemplateRenderTableCell[][] = kept.map(() => []);

  for (const item of placed) {
    let colSpan = 0;
    for (let column = item.columnIndex; column < item.columnIndex + item.colSpan; column += 1) {
      if (isColumnVisible(column)) colSpan += 1;
    }

    // Від комірки не лишилося жодної видимої колонки — вона зникає разом із ними.
    if (colSpan === 0) continue;

    const cell = item.cell;
    cellsByRow[item.rowIndex]!.push({
      key: cell.key,
      // Статичний текст має пріоритет: підпис у шапці не має залежати від даних.
      value: cell.text ||
        (cell.path
          ? stringifyPrintTemplateValue(resolvePrintTemplatePath(scope, cell.path), cell.format, context)
          : ""),
      colSpan,
      rowSpan: cell.rowSpan,
      align: cell.align,
      fontWeight: cell.fontWeight,
      fontSize: cell.fontSize ? Number.parseFloat(cell.fontSize) || null : null,
      color: cell.color,
      textOrientation: cell.textOrientation,
    });
  }

  // Рядок, від якого не лишилося комірок, теж не друкуємо: інакше в таблиці
  // з'явилася б порожня смуга висотою в рядок тексту — слід від колонки, якої
  // на бланку немає.
  return kept
    .map((row, index) => ({ key: row.key, cells: cellsByRow[index]! }))
    .filter((row) => row.cells.length > 0);
}

export function buildPrintTemplateRenderPlan(schema: PrintTemplateSchema, source: unknown): PrintTemplateRenderBlock[] {
  // Мова й валюта бланка — з самого шаблону: регламентована форма заводиться
  // окремим шаблоном на кожну мову, тож питати їх у даних нема потреби.
  const context: PrintTemplateValueContext = { locale: schema.locale, currency: schema.currency };

  return getRenderablePrintTemplateBlocks(schema).flatMap<PrintTemplateRenderBlock>((block: PrintTemplateSchema["blocks"][number]) => {
    // Умова показу — на блоці БУДЬ-ЯКОГО типу, включно з лініями: підвал із
    // факсиміле це рамка плюс картинка плюс риска, і сховати з них частину
    // означало б лишити на бланку висячу лінію.
    if (!isPrintTemplateElementVisible(source, block.visibleWhen)) {
      return [];
    }

    if (block.type === "text") {
      // Статичний текст перекриває прив'язку — те саме правило, що в комірці
      // таблиці й у штрих-коді.
      const bound = block.path
        ? stringifyPrintTemplateValue(resolvePrintTemplatePath(source, block.path), block.format, context)
        : "";

      return [{
        key: block.key,
        type: "text",
        text: block.value || bound,
        textOrientation: block.textOrientation,
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        keepTogether: block.keepTogether,
        pageBreakBefore: block.pageBreakBefore,
        textOptions: resolvePrintTemplateBlockTextOptions(block.text),
      }];
    }

    if (block.type === "field-list") {
      return [{
        key: block.key,
        type: "field-list",
        items: block.items
          .filter((item: typeof block.items[number]) => isPrintTemplateElementVisible(source, item.visibleWhen))
          .map((item: typeof block.items[number]) => ({
            key: item.key,
            label: item.label,
            value: stringifyPrintTemplateValue(
              resolvePrintTemplatePath(source, item.path),
              item.format,
              context,
            ),
          })),
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        keepTogether: block.keepTogether,
        pageBreakBefore: block.pageBreakBefore,
        textOptions: resolvePrintTemplateBlockTextOptions(block.text),
      }];
    }

    if (block.type === "table") {
      const records = resolvePrintTemplatePath(source, block.source);
      const items = Array.isArray(records) ? records : [];

      // Колонка є або її немає на весь бланк, тож умова рахується один раз — від
      // кореня даних, а не від запису. Ширину схована колонка віддає сусідам
      // САМА, без арифметики: рендерер ділить таблицю за вагами тих колонок, що
      // прийшли, тож менша сума ваг розтягує решту пропорційно.
      const columnVisible = block.columns.map((column) => isPrintTemplateElementVisible(source, column.visibleWhen));
      const columns = block.columns.filter((_, index) => columnVisible[index]);

      // Таблиця без жодної видимої колонки — це не порожня таблиця, а таблиця,
      // якої на цьому бланку немає.
      if (!columns.length) {
        return [];
      }

      const isColumnVisible = (index: number) => columnVisible[index] === true;
      const columnCount = block.columns.length;

      return [{
        key: block.key,
        type: "table",
        title: block.title,
        columns: getRenderablePrintTemplateTableColumns(columns),
        header: buildSectionRows(block.sections.header, source, context, columnCount, isColumnVisible),
        body: items.map((record) => buildSectionRows(block.sections.row, record, context, columnCount, isColumnVisible)),
        footer: buildSectionRows(block.sections.footer, source, context, columnCount, isColumnVisible),
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        keepTogether: block.keepTogether,
        pageBreakBefore: block.pageBreakBefore,
        textOptions: resolvePrintTemplateBlockTextOptions(block.text),
      }];
    }

    if (block.type === "image") {
      // Те саме правило, що всюди в форматі: статичне значення сильніше. Але
      // через `stringifyPrintTemplateValue` це не пропускаємо — його «-» для
      // порожнього значення став би `src="-"`, тобто зламаною картинкою замість
      // відсутньої (та сама причина, що в штрих-коді нижче).
      const bound = block.path ? resolvePrintTemplatePath(source, block.path) : null;

      return [{
        key: block.key,
        type: "image",
        src: block.src || (typeof bound === "string" ? bound : ""),
        alt: block.alt,
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        keepTogether: block.keepTogether,
        pageBreakBefore: block.pageBreakBefore,
      }];
    }

    if (block.type === "barcode") {
      // Те саме правило, що й у комірці таблиці: статичне значення перекриває
      // прив'язку. `stringifyPrintTemplateValue` тут не годиться — його «-» для
      // порожнього значення став би цілком валідним штрих-кодом із дефіса.
      const bound = block.path ? resolvePrintTemplatePath(source, block.path) : null;
      const raw = block.value ||
        (typeof bound === "string" || typeof bound === "number" ? String(bound) : "");
      const built = buildBarcode(block.symbology, raw);

      return [{
        key: block.key,
        type: "barcode",
        shape: built.ok ? built.shape : null,
        error: built.ok ? "" : built.message,
        showText: block.showText,
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        keepTogether: block.keepTogether,
        pageBreakBefore: block.pageBreakBefore,
        textOptions: resolvePrintTemplateBlockTextOptions(block.text),
      }];
    }

    if (block.type === "char-cells") {
      // Те саме правило, що всюди: статичне значення перекриває прив'язку.
      // Через `stringifyPrintTemplateValue` тут іти можна — форматів це поле не
      // приймає, а число (номер, ІПН) саме числом і приходить.
      const bound = block.path ? resolvePrintTemplatePath(source, block.path) : null;
      const cellOptions = resolvePrintTemplateCharCellsOptions(block);
      const textOptions = resolvePrintTemplateBlockTextOptions(block.text);

      return [{
        key: block.key,
        type: "char-cells",
        cells: distributePrintTemplateCharCells(
          block.value || stringifyPrintTemplateValue(bound),
          cellOptions.count,
          textOptions.align,
        ),
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        keepTogether: block.keepTogether,
        pageBreakBefore: block.pageBreakBefore,
        textOptions,
        cellOptions,
      }];
    }

    if (block.type === "horizontal-line") {
      return [{
        key: block.key,
        type: "horizontal-line",
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        keepTogether: block.keepTogether,
        pageBreakBefore: block.pageBreakBefore,
        lineOptions: resolvePrintTemplateLineOptions(block),
      }];
    }

    if (block.type === "vertical-line") {
      return [{
        key: block.key,
        type: "vertical-line",
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        keepTogether: block.keepTogether,
        pageBreakBefore: block.pageBreakBefore,
        lineOptions: resolvePrintTemplateLineOptions(block),
      }];
    }

    return [];
  });
}
