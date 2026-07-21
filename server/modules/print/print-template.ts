// Нейтральний блочний формат шаблону друку (`schemaVersion: 2`).
//
// Один формат живить обидва рендерери: прев'ю в редакторі (HTML) і фінальний PDF
// на сервері. Тут — тільки типи, нормалізація «сирого» JSON із БД/файлу та
// резолвінг значень (числа з рядків, шляхи в даних). Жодного рендеру.
//
// Файл лежить в `app/shared/`, бо ним користуються і фронтенд-редактор, і
// TS-команда `printPdf` — напрямок залежностей `app → client/server` збережено.

export type PrintTemplateTargetModel = string;
export type PrintTemplatePaperSize = "A4";
export type PrintTemplateOrientation = "portrait" | "landscape";
export type PrintTemplateColumnAlign = "left" | "center" | "right";
export type PrintTemplateFontWeight = "normal" | "bold";
export type PrintTemplateBlockPlacementMode = "absolute";
export type PrintTemplateBlockType = "text" | "field-list" | "table" | "image" | "horizontal-line" | "vertical-line";
export type PrintTemplateTextStyle = "title" | "section" | "body";
export type PrintTemplateLineStyle = "solid" | "dashed" | "dotted" | "double";

export interface PrintTemplateBlockPlacement {
  mode: PrintTemplateBlockPlacementMode;
  xPercent: string;
  yPercent: string;
  widthPercent: string;
  heightPercent: string;
}

export interface PrintTemplateBlockTextOptions {
  fontSize: string;
  align: PrintTemplateColumnAlign;
  fontWeight: PrintTemplateFontWeight;
  color: string;
}

interface PrintTemplateBlockBase {
  key: string;
  placement: PrintTemplateBlockPlacement;
  text: PrintTemplateBlockTextOptions;
}

export interface PrintTemplateFieldListItem {
  key: string;
  label: string;
  path: string;
}

export interface PrintTemplateTableColumnItem {
  key: string;
  title: string;
  path: string;
  widthPercent: string;
  headerAlign: PrintTemplateColumnAlign;
  headerFontWeight: PrintTemplateFontWeight;
  headerFontSize: string;
  headerColor: string;
  valueAlign: PrintTemplateColumnAlign;
  valueFontWeight: PrintTemplateFontWeight;
  valueFontSize: string;
  valueColor: string;
}

export interface PrintTemplateTextBlock extends PrintTemplateBlockBase {
  type: "text";
  style: PrintTemplateTextStyle;
  value: string;
}

export interface PrintTemplateFieldListBlock extends PrintTemplateBlockBase {
  type: "field-list";
  items: PrintTemplateFieldListItem[];
}

export interface PrintTemplateTableBlock extends PrintTemplateBlockBase {
  type: "table";
  title: string;
  source: string;
  columns: PrintTemplateTableColumnItem[];
}

export interface PrintTemplateImageBlock extends PrintTemplateBlockBase {
  type: "image";
  src: string;
  alt: string;
}

export interface PrintTemplateHorizontalLineBlock extends PrintTemplateBlockBase {
  type: "horizontal-line";
  color: string;
  lineStyle: PrintTemplateLineStyle;
  lineWidth: string;
}

export interface PrintTemplateVerticalLineBlock extends PrintTemplateBlockBase {
  type: "vertical-line";
  color: string;
  lineStyle: PrintTemplateLineStyle;
  lineWidth: string;
}

export type PrintTemplateBlock =
  | PrintTemplateTextBlock
  | PrintTemplateFieldListBlock
  | PrintTemplateTableBlock
  | PrintTemplateImageBlock
  | PrintTemplateHorizontalLineBlock
  | PrintTemplateVerticalLineBlock;

export interface PrintTemplateSchema {
  schemaVersion: 2;
  blocks: PrintTemplateBlock[];
}

export interface ResolvedPrintTemplateBlockPlacement {
  mode: PrintTemplateBlockPlacementMode;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}

export interface ResolvedPrintTemplateBlockTextOptions {
  fontSize: number;
  align: PrintTemplateColumnAlign;
  fontWeight: PrintTemplateFontWeight;
  color: string;
}

export interface ResolvedPrintTemplateLineOptions {
  color: string;
  lineStyle: PrintTemplateLineStyle;
  lineWidth: number;
}

export interface RenderablePrintTemplateTableColumn extends PrintTemplateTableColumnItem {
  widthWeight: number;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTextStyle(value: unknown): PrintTemplateTextStyle {
  return value === "title" || value === "section" || value === "body" ? value : "body";
}

function normalizeColumnAlign(value: unknown): PrintTemplateColumnAlign {
  return value === "right" || value === "center" || value === "left" ? value : "left";
}

function normalizeFontWeight(value: unknown): PrintTemplateFontWeight {
  return value === "bold" ? "bold" : "normal";
}

function normalizeLineStyle(value: unknown): PrintTemplateLineStyle {
  return value === "solid" || value === "dashed" || value === "dotted" || value === "double"
    ? value
    : "solid";
}

function normalizeColor(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function createDefaultBlockPlacement(): PrintTemplateBlockPlacement {
  return {
    mode: "absolute",
    xPercent: "0",
    yPercent: "0",
    widthPercent: "100",
    heightPercent: "0",
  };
}

function createDefaultBlockTextOptions(options?: Partial<PrintTemplateBlockTextOptions>): PrintTemplateBlockTextOptions {
  return {
    fontSize: options?.fontSize ?? "10",
    align: options?.align ?? "left",
    fontWeight: options?.fontWeight ?? "normal",
    color: options?.color ?? "#262626",
  };
}

function getDefaultBlockTextOptions(type: PrintTemplateBlockType, textStyle?: PrintTemplateTextStyle): PrintTemplateBlockTextOptions {
  if (type === "text") {
    if (textStyle === "title") {
      return createDefaultBlockTextOptions({ fontSize: "16", align: "center", fontWeight: "bold" });
    }

    if (textStyle === "section") {
      return createDefaultBlockTextOptions({ fontSize: "12", align: "left", fontWeight: "bold" });
    }

    return createDefaultBlockTextOptions({ fontSize: "10", align: "left", fontWeight: "normal" });
  }

  return createDefaultBlockTextOptions({ fontSize: "10", align: "left", fontWeight: type === "table" ? "normal" : "normal" });
}

function normalizeBlockPlacement(value: unknown): PrintTemplateBlockPlacement {
  if (!isRecord(value)) {
    return createDefaultBlockPlacement();
  }

  return {
    mode: "absolute",
    xPercent: normalizeString(value.xPercent) || "0",
    yPercent: normalizeString(value.yPercent) || "0",
    widthPercent: normalizeString(value.widthPercent) || "100",
    heightPercent: normalizeString(value.heightPercent) || "0",
  };
}

function normalizeBlockTextOptions(value: unknown, defaults: PrintTemplateBlockTextOptions): PrintTemplateBlockTextOptions {
  if (!isRecord(value)) {
    return defaults;
  }

  return {
    fontSize: normalizeString(value.fontSize) || defaults.fontSize,
    align: normalizeColumnAlign(value.align ?? defaults.align),
    fontWeight: normalizeFontWeight(value.fontWeight ?? defaults.fontWeight),
    color: normalizeColor(value.color, defaults.color),
  };
}

function normalizeLineWidth(value: unknown, fallback = "2") {
  const normalized = normalizeString(value);
  if (!normalized) {
    return fallback;
  }

  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? normalized : fallback;
}

function normalizeFieldListItem(value: unknown): PrintTemplateFieldListItem | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    key: normalizeString(value.key),
    label: normalizeString(value.label),
    path: normalizeString(value.path),
  };
}

function normalizeTableColumn(value: unknown): PrintTemplateTableColumnItem | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    key: normalizeString(value.key),
    title: normalizeString(value.title),
    path: normalizeString(value.path),
    widthPercent: normalizeString(value.widthPercent),
    headerAlign: normalizeColumnAlign(value.headerAlign ?? value.align),
    headerFontWeight: normalizeFontWeight(value.headerFontWeight ?? value.fontWeight),
    headerFontSize: normalizeString(value.headerFontSize ?? value.fontSize),
    headerColor: normalizeColor(value.headerColor, ""),
    valueAlign: normalizeColumnAlign(value.valueAlign ?? value.align),
    valueFontWeight: normalizeFontWeight(value.valueFontWeight ?? value.fontWeight),
    valueFontSize: normalizeString(value.valueFontSize ?? value.fontSize),
    valueColor: normalizeColor(value.valueColor, ""),
  };
}

function normalizeBlock(value: unknown): PrintTemplateBlock | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = value.type;
  const key = normalizeString(value.key);

  if (type === "text") {
    const textStyle = normalizeTextStyle(value.style);
    return {
      key,
      type,
      style: textStyle,
      value: normalizeString(value.value),
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type, textStyle)),
    };
  }

  if (type === "field-list") {
    return {
      key,
      type,
      items: Array.isArray(value.items)
        ? value.items.map((item) => normalizeFieldListItem(item)).filter((item): item is PrintTemplateFieldListItem => Boolean(item))
        : [],
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type)),
    };
  }

  if (type === "table") {
    return {
      key,
      type,
      title: normalizeString(value.title),
      source: normalizeString(value.source),
      columns: Array.isArray(value.columns)
        ? value.columns.map((column) => normalizeTableColumn(column)).filter((column): column is PrintTemplateTableColumnItem => Boolean(column))
        : [],
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type)),
    };
  }

  if (type === "image") {
    return {
      key,
      type,
      src: normalizeString(value.src),
      alt: normalizeString(value.alt),
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type)),
    };
  }

  if (type === "horizontal-line" || type === "vertical-line") {
    return {
      key,
      type,
      placement: normalizeBlockPlacement(value.placement),
      text: normalizeBlockTextOptions(value.text, getDefaultBlockTextOptions(type)),
      color: normalizeColor(value.color, "#595959"),
      lineStyle: normalizeLineStyle(value.lineStyle),
      lineWidth: normalizeLineWidth(value.lineWidth),
    };
  }

  return null;
}

export function normalizePrintTemplateSchema(schema: unknown): PrintTemplateSchema | null {
  if (!isRecord(schema) || schema.schemaVersion !== 2 || !Array.isArray(schema.blocks)) {
    return null;
  }

  const blocks = schema.blocks
    .map((block) => normalizeBlock(block))
    .filter((block): block is PrintTemplateBlock => Boolean(block));

  if (!blocks.length) {
    return null;
  }

  return {
    schemaVersion: 2,
    blocks,
  };
}

export function getRenderablePrintTemplateBlocks(schema: PrintTemplateSchema): PrintTemplateBlock[] {
  return schema.blocks.filter((block) => block.key);
}

export function sanitizePrintTemplateBlocks(blocks: PrintTemplateBlock[]): PrintTemplateBlock[] {
  return normalizePrintTemplateSchema({ schemaVersion: 2, blocks })?.blocks ?? [];
}

export function resolvePrintTemplatePath(source: unknown, path: string): unknown {
  const normalizedPath = normalizeString(path);
  if (!normalizedPath) {
    return null;
  }

  return normalizedPath.split(".").reduce<unknown>((current, segment) => {
    if (!segment) {
      return current;
    }

    if (current && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }

    return null;
  }, source);
}

export function stringifyPrintTemplateValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "-";
}

export function getRenderablePrintTemplateTableColumns(columns: PrintTemplateTableColumnItem[]): RenderablePrintTemplateTableColumn[] {
  return columns
    .map((column) => ({
      ...column,
      widthWeight: Number(column.widthPercent) > 0 ? Number(column.widthPercent) : 1,
    }))
    .filter((column) => column.key && column.title);
}

function parseTemplateNumber(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolvePrintTemplateBlockPlacement(placement: PrintTemplateBlockPlacement): ResolvedPrintTemplateBlockPlacement {
  return {
    mode: placement.mode,
    xPercent: clampNumber(parseTemplateNumber(placement.xPercent, 0), 0, 100),
    yPercent: clampNumber(parseTemplateNumber(placement.yPercent, 0), 0, 100),
    widthPercent: clampNumber(parseTemplateNumber(placement.widthPercent, 100), 1, 100),
    heightPercent: clampNumber(parseTemplateNumber(placement.heightPercent, 0), 0, 100),
  };
}

export function resolvePrintTemplateBlockTextOptions(text: PrintTemplateBlockTextOptions): ResolvedPrintTemplateBlockTextOptions {
  return {
    fontSize: clampNumber(parseTemplateNumber(text.fontSize, 10), 6, 72),
    align: text.align,
    fontWeight: text.fontWeight,
    color: normalizeColor(text.color, "#262626"),
  };
}

export function resolvePrintTemplateLineOptions(block: PrintTemplateHorizontalLineBlock | PrintTemplateVerticalLineBlock): ResolvedPrintTemplateLineOptions {
  return {
    color: normalizeColor(block.color, "#595959"),
    lineStyle: normalizeLineStyle(block.lineStyle),
    lineWidth: clampNumber(parseTemplateNumber(block.lineWidth, 2), 1, 12),
  };
}
