// Нейтральний блочний формат шаблону друку (`schemaVersion: 2`).
//
// Один формат живить обидва рендерери: прев'ю в редакторі (HTML) і фінальний PDF
// на сервері. Тут — тільки типи, нормалізація «сирого» JSON із БД/файлу та
// резолвінг значень (числа з рядків, шляхи в даних). Жодного рендеру.
//
// Файл лежить в `app/shared/`, бо ним користуються і фронтенд-редактор, і
// TS-команда `printPdf` — напрямок залежностей `app → client/server` збережено.

import { normalizeBarcodeSymbology } from "./barcode/symbology.ts";
import type { BarcodeSymbology } from "./barcode/symbology.ts";

export type { BarcodeSymbology } from "./barcode/symbology.ts";

export type PrintTemplateTargetModel = string;
export type PrintTemplatePaperSize = "A4";
export type PrintTemplateOrientation = "portrait" | "landscape";
export type PrintTemplateColumnAlign = "left" | "center" | "right";
export type PrintTemplateFontWeight = "normal" | "bold";
export type PrintTemplateBlockPlacementMode = "absolute";
export type PrintTemplateBlockType =
  | "text"
  | "field-list"
  | "table"
  | "image"
  | "barcode"
  | "horizontal-line"
  | "vertical-line";
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

/**
 * Колонка таблиці — це лише вертикаль сітки: ключ і ширина.
 *
 * Заголовки й прив'язки живуть у комірках секцій, бо одна колонка може мати над
 * собою кілька рівнів заголовків, а один запис — друкуватися кількома рядками.
 */
export interface PrintTemplateTableColumn {
  key: string;
  widthPercent: string;
}

/**
 * Комірка секції. Або статичний `text`, або значення за `path`
 * (у секції `row` — від запису, у `header`/`footer` — від кореня даних).
 * Порожні `fontSize`/`color` означають «успадкувати від блока».
 */
export interface PrintTemplateTableCell {
  key: string;
  text: string;
  path: string;
  colSpan: number;
  rowSpan: number;
  align: PrintTemplateColumnAlign;
  fontWeight: PrintTemplateFontWeight;
  fontSize: string;
  color: string;
}

export interface PrintTemplateTableRow {
  key: string;
  cells: PrintTemplateTableCell[];
}

/** Секції необов'язкові: таблиця може бути без шапки або без підвалу. */
export interface PrintTemplateTableSections {
  header: PrintTemplateTableRow[];
  row: PrintTemplateTableRow[];
  footer: PrintTemplateTableRow[];
}

export type PrintTemplateTableSectionName = keyof PrintTemplateTableSections;

export const PRINT_TEMPLATE_TABLE_SECTIONS: PrintTemplateTableSectionName[] = ["header", "row", "footer"];

/**
 * Стара форма колонки: заголовок і прив'язка прямо в колонці, без секцій.
 * Лишається лише для підняття давніх шаблонів — див. `sectionsFromLegacyColumns`.
 */
interface LegacyPrintTemplateTableColumn {
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
  columns: PrintTemplateTableColumn[];
  sections: PrintTemplateTableSections;
}

export interface PrintTemplateImageBlock extends PrintTemplateBlockBase {
  type: "image";
  src: string;
  alt: string;
}

/**
 * Штрих-код.
 *
 * Значення береться так само, як у комірці таблиці: статичний `value` перекриває
 * прив'язку `path`. Одне правило на весь формат — щоб не доводилось пам'ятати,
 * де саме пріоритет інший.
 *
 * Кольору тут немає навмисно: штрих-код мусить бути чорним на білому, інакше
 * сканер його не візьме. Дати таке поле означало б дати спосіб зіпсувати
 * документ, який виглядатиме цілком нормально на екрані.
 */
export interface PrintTemplateBarcodeBlock extends PrintTemplateBlockBase {
  type: "barcode";
  symbology: BarcodeSymbology;
  /** Статичне значення. Порожнє — беремо за `path`. */
  value: string;
  /** Шлях у даних друку (від того самого кореня, що й у списку полів). */
  path: string;
  /** Чи друкувати значення текстом під кодом. */
  showText: boolean;
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
  | PrintTemplateBarcodeBlock
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

export interface RenderablePrintTemplateTableColumn extends PrintTemplateTableColumn {
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

  // Підпис під штрих-кодом — дрібний і по центру: він допоміжний, а вирівнювати
  // його інакше, ніж по коду, сенсу немає.
  if (type === "barcode") {
    return createDefaultBlockTextOptions({ fontSize: "8", align: "center", fontWeight: "normal" });
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

function normalizeLegacyTableColumn(value: unknown): LegacyPrintTemplateTableColumn | null {
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

function normalizeSpan(value: unknown) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeTableCell(value: unknown): PrintTemplateTableCell | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    key: normalizeString(value.key) || crypto.randomUUID(),
    text: normalizeString(value.text),
    path: normalizeString(value.path),
    colSpan: normalizeSpan(value.colSpan),
    rowSpan: normalizeSpan(value.rowSpan),
    align: normalizeColumnAlign(value.align),
    fontWeight: normalizeFontWeight(value.fontWeight),
    fontSize: normalizeString(value.fontSize),
    color: normalizeColor(value.color, ""),
  };
}

function normalizeTableRows(value: unknown): PrintTemplateTableRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((row) => {
    if (!isRecord(row)) return [];

    const cells = Array.isArray(row.cells)
      ? row.cells.map(normalizeTableCell).filter((cell): cell is PrintTemplateTableCell => Boolean(cell))
      : [];

    return cells.length ? [{ key: normalizeString(row.key) || crypto.randomUUID(), cells }] : [];
  });
}

function createTableCell(patch: Partial<PrintTemplateTableCell>): PrintTemplateTableCell {
  return {
    key: crypto.randomUUID(),
    text: "",
    path: "",
    colSpan: 1,
    rowSpan: 1,
    align: "left",
    fontWeight: "normal",
    fontSize: "",
    color: "",
    ...patch,
  };
}

/**
 * Підйом давнього шаблону: колонки з `title`/`path` перетворюються на секції —
 * один рядок шапки із заголовків і один рядок даних із прив'язок.
 *
 * Так шаблони, збережені до появи секцій, і далі друкуються без міграції даних.
 */
function sectionsFromLegacyColumns(columns: LegacyPrintTemplateTableColumn[]): PrintTemplateTableSections {
  return {
    header: [{
      key: crypto.randomUUID(),
      cells: columns.map((column) => createTableCell({
        text: column.title,
        align: column.headerAlign,
        fontWeight: column.headerFontWeight,
        fontSize: column.headerFontSize,
        color: column.headerColor,
      })),
    }],
    row: [{
      key: crypto.randomUUID(),
      cells: columns.map((column) => createTableCell({
        path: column.path,
        align: column.valueAlign,
        fontWeight: column.valueFontWeight,
        fontSize: column.valueFontSize,
        color: column.valueColor,
      })),
    }],
    footer: [],
  };
}

function normalizeTableSections(value: unknown, legacyColumns: LegacyPrintTemplateTableColumn[]): PrintTemplateTableSections {
  if (!isRecord(value)) {
    return sectionsFromLegacyColumns(legacyColumns);
  }

  const sections: PrintTemplateTableSections = {
    header: normalizeTableRows(isRecord(value.header) ? value.header.rows : value.header),
    row: normalizeTableRows(isRecord(value.row) ? value.row.rows : value.row),
    footer: normalizeTableRows(isRecord(value.footer) ? value.footer.rows : value.footer),
  };

  // Секції є, але всі порожні — вважаємо, що їх не описали, і беремо колонки.
  const hasAnyRow = PRINT_TEMPLATE_TABLE_SECTIONS.some((name) => sections[name].length > 0);
  return hasAnyRow ? sections : sectionsFromLegacyColumns(legacyColumns);
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
    const legacyColumns = Array.isArray(value.columns)
      ? value.columns
        .map((column) => normalizeLegacyTableColumn(column))
        .filter((column): column is LegacyPrintTemplateTableColumn => Boolean(column))
      : [];

    return {
      key,
      type,
      title: normalizeString(value.title),
      source: normalizeString(value.source),
      columns: legacyColumns.map((column) => ({ key: column.key, widthPercent: column.widthPercent })),
      sections: normalizeTableSections(value.sections, legacyColumns),
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

  if (type === "barcode") {
    return {
      key,
      type,
      symbology: normalizeBarcodeSymbology(value.symbology),
      value: normalizeString(value.value),
      path: normalizeString(value.path),
      // Підпис під кодом за замовчуванням увімкнений: він потрібен людині, коли
      // сканера немає під рукою, і саме його очікують у EAN-13.
      showText: value.showText !== false,
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

export function stringifyPrintTemplateValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "-";
}

/**
 * Сітка колонок для рендеру. Колонка без ширини важить 1 — тоді таблиця без
 * заданих ширин ділиться нарівно, а не зникає.
 */
export function getRenderablePrintTemplateTableColumns(columns: PrintTemplateTableColumn[]): RenderablePrintTemplateTableColumn[] {
  return columns.map((column) => ({
    ...column,
    widthWeight: Number(column.widthPercent) > 0 ? Number(column.widthPercent) : 1,
  }));
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
