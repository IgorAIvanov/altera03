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
  PrintTemplateSchema,
  PrintTemplateTableColumnItem,
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

export interface PrintTemplateRenderTableBlock {
  key: string;
  type: "table";
  title: string;
  columns: PrintTemplateRenderTableColumn[];
  rows: Array<Record<string, string>>;
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

function buildTableRows(source: unknown, columns: PrintTemplateTableColumnItem[]) {
  const rows = Array.isArray(source) ? source as Array<Record<string, unknown>> : [];
  return rows.map((row) => Object.fromEntries(
    columns.map((column) => [column.key, stringifyPrintTemplateValue(resolvePrintTemplatePath(row, column.path))]),
  ));
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
      const columns = getRenderablePrintTemplateTableColumns(block.columns);
      return [{
        key: block.key,
        type: "table",
        title: block.title,
        columns,
        rows: buildTableRows(resolvePrintTemplatePath(source, block.source), columns),
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
