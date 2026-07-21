// План рендеру: шаблон + дані документа → плаский список блоків із уже
// підставленими значеннями (шляхи резолвнуті, числа з рядків розібрані).
//
// Це єдина точка, де шаблон зустрічається з даними. Прев'ю в редакторі і
// PDF-рендерер малюють ОДИН і той самий план — тому вони не розходяться
// у трактуванні шляхів, ширин колонок і текстових налаштувань.

import {
  getRenderablePrintTemplateBlocks,
  getRenderablePrintTemplateTableColumns,
  resolvePrintTemplateBlockPlacement,
  resolvePrintTemplateBlockTextOptions,
  resolvePrintTemplateLineOptions,
  resolvePrintTemplatePath,
  stringifyPrintTemplateValue,
} from "./print-template.ts";
import type {
  PrintTemplateColumnAlign,
  PrintTemplateFontWeight,
  PrintTemplateSchema,
  PrintTemplateTableRow,
  ResolvedPrintTemplateBlockPlacement,
  ResolvedPrintTemplateBlockTextOptions,
  ResolvedPrintTemplateLineOptions,
  RenderablePrintTemplateTableColumn,
} from "./print-template.ts";

export interface PrintTemplateRenderTextBlock {
  key: string;
  type: "text";
  text: string;
  placement: ResolvedPrintTemplateBlockPlacement;
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
  textOptions: ResolvedPrintTemplateBlockTextOptions;
}

export interface PrintTemplateRenderImageBlock {
  key: string;
  type: "image";
  src: string;
  alt: string;
  placement: ResolvedPrintTemplateBlockPlacement;
}

export interface PrintTemplateRenderHorizontalLineBlock {
  key: string;
  type: "horizontal-line";
  placement: ResolvedPrintTemplateBlockPlacement;
  lineOptions: ResolvedPrintTemplateLineOptions;
}

export interface PrintTemplateRenderVerticalLineBlock {
  key: string;
  type: "vertical-line";
  placement: ResolvedPrintTemplateBlockPlacement;
  lineOptions: ResolvedPrintTemplateLineOptions;
}

export type PrintTemplateRenderBlock =
  | PrintTemplateRenderTextBlock
  | PrintTemplateRenderFieldListBlock
  | PrintTemplateRenderTableBlock
  | PrintTemplateRenderImageBlock
  | PrintTemplateRenderHorizontalLineBlock
  | PrintTemplateRenderVerticalLineBlock;

/**
 * Секція → рядки з підставленими значеннями.
 * `scope` — корінь, від якого рахуються шляхи комірок: для шапки й підвалу це
 * всі дані друку, для рядка тіла — конкретний запис.
 */
function buildSectionRows(rows: PrintTemplateTableRow[], scope: unknown): PrintTemplateRenderTableRow[] {
  return rows.map((row) => ({
    key: row.key,
    cells: row.cells.map((cell) => ({
      key: cell.key,
      // Статичний текст має пріоритет: підпис у шапці не має залежати від даних.
      value: cell.text || (cell.path ? stringifyPrintTemplateValue(resolvePrintTemplatePath(scope, cell.path)) : ""),
      colSpan: cell.colSpan,
      rowSpan: cell.rowSpan,
      align: cell.align,
      fontWeight: cell.fontWeight,
      fontSize: cell.fontSize ? Number.parseFloat(cell.fontSize) || null : null,
      color: cell.color,
    })),
  }));
}

export function buildPrintTemplateRenderPlan(schema: PrintTemplateSchema, source: unknown): PrintTemplateRenderBlock[] {
  return getRenderablePrintTemplateBlocks(schema).flatMap<PrintTemplateRenderBlock>((block: PrintTemplateSchema["blocks"][number]) => {
    if (block.type === "text") {
      return [{
        key: block.key,
        type: "text",
        text: block.value || "-",
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        textOptions: resolvePrintTemplateBlockTextOptions(block.text),
      }];
    }

    if (block.type === "field-list") {
      return [{
        key: block.key,
        type: "field-list",
        items: block.items.map((item: typeof block.items[number]) => ({
          key: item.key,
          label: item.label,
          value: stringifyPrintTemplateValue(resolvePrintTemplatePath(source, item.path)),
        })),
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        textOptions: resolvePrintTemplateBlockTextOptions(block.text),
      }];
    }

    if (block.type === "table") {
      const records = resolvePrintTemplatePath(source, block.source);
      const items = Array.isArray(records) ? records : [];

      return [{
        key: block.key,
        type: "table",
        title: block.title,
        columns: getRenderablePrintTemplateTableColumns(block.columns),
        header: buildSectionRows(block.sections.header, source),
        body: items.map((record) => buildSectionRows(block.sections.row, record)),
        footer: buildSectionRows(block.sections.footer, source),
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        textOptions: resolvePrintTemplateBlockTextOptions(block.text),
      }];
    }

    if (block.type === "image") {
      return [{
        key: block.key,
        type: "image",
        src: block.src,
        alt: block.alt,
        placement: resolvePrintTemplateBlockPlacement(block.placement),
      }];
    }

    if (block.type === "horizontal-line") {
      return [{
        key: block.key,
        type: "horizontal-line",
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        lineOptions: resolvePrintTemplateLineOptions(block),
      }];
    }

    if (block.type === "vertical-line") {
      return [{
        key: block.key,
        type: "vertical-line",
        placement: resolvePrintTemplateBlockPlacement(block.placement),
        lineOptions: resolvePrintTemplateLineOptions(block),
      }];
    }

    return [];
  });
}
