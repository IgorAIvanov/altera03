import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib";
import fontkit from "npm:@pdf-lib/fontkit";
import { getModelConfig } from "../model-registry.ts";
import type { ModelCommandContext } from "../model-runtime.types.ts";
//import { normalizePrintTemplateSchema } from "../../../../../app/_shared/printTemplateSchema.ts";
//import type { PrintTemplateColumnAlign, PrintTemplateSchema, PrintTemplateTableColumnItem } from "../../../../../app/_shared/printTemplateSchema.ts";
//import { buildPrintTemplateRenderPlan } from "../../../../../app/_shared/printTemplateRenderPlan.ts";

const STANDARD_COMMANDS = new Set(["list", "get", "save", "delete", "lookup"]);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
} as const;

const FONT_REGULAR_URL = new URL(
  "../../../../../frontend/node_modules/@fontsource/roboto/files/roboto-cyrillic-400-normal.woff",
  import.meta.url,
);
const FONT_BOLD_URL = new URL(
  "../../../../../frontend/node_modules/@fontsource/roboto/files/roboto-cyrillic-700-normal.woff",
  import.meta.url,
);

export interface PrintTemplateItem {
  code: string;
  name: string;
  targetModel: string;
  dataCommand: string;
  orientation: "portrait" | "landscape";
  //schema: PrintTemplateSchema;
}

export interface GenericPrintDocument {
  id?: string | null;
  code?: string | null;
  number?: string | null;
  displayName?: string | null;
  document?: {
    id?: string | null;
    code?: string | null;
    number?: string | null;
    inventoryNumber?: string | null;
    displayName?: string | null;
  } & Record<string, unknown>;
}

interface ModelEnvelope<TItem> {
  ok: boolean;
  data?: {
    item?: TItem | null;
  };
  messages?: string[];
}

function createEnvelope(extra: Record<string, unknown>) {
  return {
    ok: true,
    data: {
      item: null,
      rows: [],
      options: {},
      totals: {},
      extra,
    },
    messages: [],
    meta: {},
  };
}

function wrapText(text: string, maxWidth: number, measureTextWidth: (value: string) => number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [""];
  }

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (!currentLine || measureTextWidth(candidate) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function assertIdentifier(value: string, label: string) {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} має містити лише lowercase, digits та underscore`);
  }
}

function toPlainJson(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => toPlainJson(item));
  }

  if (value && typeof value === "object") {
    const plain: Record<string, JsonValue> = {};
    const record = value as Record<string, unknown>;

    for (const key of Object.getOwnPropertyNames(value)) {
      plain[key] = toPlainJson(record[key]);
    }

    return plain;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return null;
}

function toSqlJsonPayload(payload: unknown): JsonValue {
  return toPlainJson(payload ?? {});
}

function decodeBase64(base64: string) {
  const normalized = base64.replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace(/^#/, "");
  const r = parseInt(cleaned.substring(0, 2), 16) / 255;
  const g = parseInt(cleaned.substring(2, 4), 16) / 255;
  const b = parseInt(cleaned.substring(4, 6), 16) / 255;
  return rgb(
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0,
  );
}

function parseTemplateImageDataUrl(source: string) {
  const match = source.trim().match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/i);
  if (!match) {
    return null;
  }

  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  if (mimeType !== "image/png" && mimeType !== "image/jpeg") {
    return null;
  }

  return {
    mimeType,
    bytes: decodeBase64(match[3]),
  };
}

function resolvePrintDataSqlCommand(targetModel: string, dataCommand: string) {
  const modelConfig = getModelConfig(targetModel);

  if (modelConfig?.tsCommands?.[dataCommand]) {
    throw new Error(`Команда друку ${targetModel}.${dataCommand} має TS handler і не підтримується для PDF renderer`);
  }

  const sqlCommand = STANDARD_COMMANDS.has(dataCommand)
    ? { schema: modelConfig?.schema ?? "app", functionName: `${targetModel}_${dataCommand}` }
    : typeof modelConfig?.sqlCommands?.[dataCommand] === "string"
    ? { schema: modelConfig?.schema ?? "app", functionName: modelConfig.sqlCommands[dataCommand] }
    : modelConfig?.sqlCommands?.[dataCommand];

  if (!sqlCommand) {
    throw new Error(`Команда друку ${targetModel}.${dataCommand} не налаштована`);
  }

  const schema = sqlCommand.schema ?? modelConfig?.schema ?? "app";
  const functionName = sqlCommand.functionName ?? `${targetModel}_${dataCommand}`;

  assertIdentifier(schema, "schema");
  assertIdentifier(functionName, "functionName");

  return { schema, functionName };
}

export function getRequiredPrintPdfId(payload: Record<string, unknown>) {
  const id = typeof payload.id === "string" && payload.id.trim() ? payload.id.trim() : null;
  if (!id) {
    throw new Error("id обов'язковий для printPdf");
  }

  return id;
}

export async function loadPrintDocument<TItem>(
  targetModel: string,
  dataCommand: string,
  payload: Record<string, unknown>,
  context: ModelCommandContext,
) {
  const { schema, functionName } = resolvePrintDataSqlCommand(targetModel, dataCommand);
  const rows = await context.db.sql<{ result: ModelEnvelope<TItem> }[]>`
    select ${context.db.sql(schema)}.${context.db.sql(functionName)}(
      ${context.userId}::bigint,
      ${context.db.sql.json(toSqlJsonPayload(payload))}::jsonb
    ) as result
  `;
  const result = rows[0]?.result;
  if (!result?.ok || !result.data?.item) {
    throw new Error(result?.messages?.[0] ?? `Не вдалося завантажити документ для друку через ${targetModel}.${dataCommand}`);
  }

  return result.data.item;
}

export async function loadPrintTemplate(targetModel: string, context: ModelCommandContext) {
  const rows = await context.db.sql<{ result: ModelEnvelope<PrintTemplateItem> }[]>`
    select app.print_template_resolve(${context.userId}::bigint, ${context.db.sql.json(toSqlJsonPayload({ targetModel }))}::jsonb) as result
  `;
  const result = rows[0]?.result;
  if (!result?.ok || !result.data?.item) {
    throw new Error(result?.messages?.[0] ?? `Не знайдено активний шаблон друку для ${targetModel}`);
  }

  const schema = normalizePrintTemplateSchema(result.data.item.schema);
  if (!schema) {
    throw new Error("Шаблон друку не містить block-based schemaVersion 2");
  }

  return {
    ...result.data.item,
    schema,
  };
}

function getGenericPrintFileIdentifier(printDocument: GenericPrintDocument, fallbackId: string) {
  const nestedDocument = printDocument.document ?? {};
  const candidates = [
    printDocument.number,
    nestedDocument.number,
    nestedDocument.inventoryNumber,
    printDocument.code,
    nestedDocument.code,
    printDocument.displayName,
    nestedDocument.displayName,
    printDocument.id,
    nestedDocument.id,
    fallbackId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return fallbackId;
}

function getGenericPrintFileName(model: string, printDocument: GenericPrintDocument, fallbackId: string) {
  const modelSlug = model.replaceAll("_", "-");
  const fileIdentifier = getGenericPrintFileIdentifier(printDocument, fallbackId);
  return `${modelSlug}-${fileIdentifier}.pdf`;
}

export async function genericPrintPdfHandler(
  payload: Record<string, unknown>,
  context: ModelCommandContext,
) {
  const id = getRequiredPrintPdfId(payload);
  const template = await loadPrintTemplate(context.model, context);
  const printDocument = await loadPrintDocument<GenericPrintDocument>(
    template.targetModel,
    template.dataCommand,
    payload,
    context,
  );

  return renderBlockPrintPdf(template, printDocument, getGenericPrintFileName(context.model, printDocument, id));
}

export async function renderBlockPrintPdf(template: PrintTemplateItem, printDocument: unknown, fileName: string) {
  const renderPlan = buildPrintTemplateRenderPlan(template.schema, printDocument);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const regularFont = await pdf.embedFont(await Deno.readFile(FONT_REGULAR_URL));
  const boldFont = await pdf.embedFont(await Deno.readFile(FONT_BOLD_URL));
  const regularAsciiFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldAsciiFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize = PAGE_SIZES.A4;
  const landscape = template.orientation === "landscape";
  let page = pdf.addPage(landscape ? [pageSize.height, pageSize.width] : [pageSize.width, pageSize.height]);
  const marginLeft = 40;
  const marginTop = 40;
  const marginBottom = 40;
  const marginRight = 40;
  const contentWidth = page.getWidth() - marginLeft - marginRight;
  const contentHeight = page.getHeight() - marginTop - marginBottom;
  const baseFontSize = 10;
  const smallFontSize = 9;
  let currentY = page.getHeight() - marginTop;

  const isAsciiFallbackChar = (char: string) => /[\u0000-\u007f]/.test(char);

  const getTextRuns = (text: string, bold = false) => {
    const runs: Array<{ text: string; font: typeof regularFont }> = [];
    const defaultFont = bold ? boldFont : regularFont;
    const asciiFont = bold ? boldAsciiFont : regularAsciiFont;

    for (const char of text) {
      const font = isAsciiFallbackChar(char) ? asciiFont : defaultFont;
      const previousRun = runs[runs.length - 1];
      if (previousRun?.font === font) {
        previousRun.text += char;
        continue;
      }

      runs.push({ text: char, font });
    }

    return runs;
  };

  const measureTextWidth = (text: string, fontSize: number, bold = false) => {
    return getTextRuns(text, bold).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, fontSize), 0);
  };

  const drawTextLine = (text: string, x: number, y: number, fontSize: number, bold = false, color?: ReturnType<typeof rgb>) => {
    let offsetX = x;
    for (const run of getTextRuns(text, bold)) {
      page.drawText(run.text, {
        x: offsetX,
        y,
        size: fontSize,
        font: run.font,
        color,
      });
      offsetX += run.font.widthOfTextAtSize(run.text, fontSize);
    }
  };

  const ensureSpace = (requiredHeight: number) => {
    if (currentY - requiredHeight >= marginBottom) {
      return;
    }

    page = pdf.addPage(landscape ? [pageSize.height, pageSize.width] : [pageSize.width, pageSize.height]);
    currentY = page.getHeight() - marginTop;
  };

  const drawParagraph = (text: string, options?: {
    bold?: boolean;
    fontSize?: number;
    color?: ReturnType<typeof rgb>;
    align?: PrintTemplateColumnAlign;
    x?: number;
    y?: number;
    width?: number;
    skipFlow?: boolean;
  }) => {
    const isBold = options?.bold ?? false;
    const fontSize = options?.fontSize ?? baseFontSize;
    const paragraphWidth = options?.width ?? contentWidth;
    const paragraphX = options?.x ?? marginLeft;
    const lines = wrapText(text, paragraphWidth, (value) => measureTextWidth(value, fontSize, isBold));
    const paragraphHeight = lines.length * (fontSize + 3) + 6;

    if (!options?.skipFlow) {
      ensureSpace(paragraphHeight);
    }

    let paragraphY = options?.y ?? currentY;

    for (const line of lines) {
      const lineWidth = measureTextWidth(line, fontSize, isBold);
      let textX = paragraphX;
      if (options?.align === "right") {
        textX = paragraphX + paragraphWidth - lineWidth;
      } else if (options?.align === "center") {
        textX = paragraphX + (paragraphWidth - lineWidth) / 2;
      }

      drawTextLine(line, textX, paragraphY, fontSize, isBold, options?.color);
      paragraphY -= fontSize + 3;
    }

    if (!options?.skipFlow) {
      currentY = paragraphY - 4;
    }

    return paragraphHeight;
  };

  const drawTableRow = (
    columns: Array<{
      key: string;
      title: string;
      width: number;
      headerAlign: PrintTemplateTableColumnItem["headerAlign"];
      headerFontWeight: PrintTemplateTableColumnItem["headerFontWeight"];
      headerFontSize: PrintTemplateTableColumnItem["headerFontSize"];
      headerColor: PrintTemplateTableColumnItem["headerColor"];
      valueAlign: PrintTemplateTableColumnItem["valueAlign"];
      valueFontWeight: PrintTemplateTableColumnItem["valueFontWeight"];
      valueFontSize: PrintTemplateTableColumnItem["valueFontSize"];
      valueColor: PrintTemplateTableColumnItem["valueColor"];
    }>,
    values: Record<string, string>,
    isHeader = false,
    options?: { x?: number; y?: number; skipFlow?: boolean; fontSize?: number; color?: ReturnType<typeof rgb> },
  ) => {
    const padding = 4;
    const resolveTableFontSize = (column: typeof columns[number]) => {
      const parsed = Number.parseFloat(isHeader ? column.headerFontSize : column.valueFontSize);
      if (!Number.isFinite(parsed)) {
        return options?.fontSize ?? (isHeader ? smallFontSize : baseFontSize);
      }

      return Math.min(72, Math.max(6, parsed));
    };
    const cellLines = columns.map((column) => wrapText(
      String(values[column.key] ?? ""),
      Math.max(column.width - padding * 2, 12),
      (value) => measureTextWidth(value, resolveTableFontSize(column), isHeader ? column.headerFontWeight === "bold" : column.valueFontWeight === "bold"),
    ));
    const rowHeight = columns.reduce((maxHeight, column, columnIndex) => {
      const lineHeight = resolveTableFontSize(column) + 2;
      const columnHeight = Math.max(cellLines[columnIndex]?.length ?? 1, 1) * lineHeight + padding * 2;
      return Math.max(maxHeight, columnHeight);
    }, 0);
    if (!options?.skipFlow) {
      ensureSpace(rowHeight + 6);
    }

    const rowX = options?.x ?? marginLeft;
    const rowY = options?.y ?? currentY;
    const rowWidth = columns.reduce((sum, column) => sum + column.width, 0);

    page.drawRectangle({
      x: rowX,
      y: rowY - rowHeight + padding,
      width: rowWidth,
      height: rowHeight,
      borderColor: rgb(0.82, 0.82, 0.82),
      borderWidth: 0.7,
      color: isHeader ? rgb(0.98, 0.98, 0.98) : undefined,
    });

    let x = rowX;
    columns.forEach((column, columnIndex) => {
      if (columnIndex > 0) {
        page.drawLine({
          start: { x, y: rowY - rowHeight + padding },
          end: { x, y: rowY + padding },
          thickness: 0.5,
          color: rgb(0.82, 0.82, 0.82),
        });
      }

      cellLines[columnIndex].forEach((line, lineIndex) => {
        const align = isHeader ? column.headerAlign : column.valueAlign;
        const isBold = isHeader ? column.headerFontWeight === "bold" : column.valueFontWeight === "bold";
        const fontSize = resolveTableFontSize(column);
        const lineHeight = fontSize + 2;
        const textColor = isHeader ? hexToRgb(column.headerColor || "") ?? options?.color : hexToRgb(column.valueColor || "") ?? options?.color;
        const lineWidth = measureTextWidth(line, fontSize, isBold);
        let textX = x + padding;
        if (align === "right") {
          textX = x + column.width - padding - lineWidth;
        } else if (align === "center") {
          textX = x + (column.width - lineWidth) / 2;
        }

        drawTextLine(line, textX, rowY - padding - fontSize - lineIndex * lineHeight + 2, fontSize, isBold, textColor);
      });

      x += column.width;
    });

    if (!options?.skipFlow) {
      currentY -= rowHeight;
    }

    return rowHeight;
  };

  for (const block of renderPlan) {
    const isAbsolute = block.placement.mode === "absolute";
    const blockX = isAbsolute ? marginLeft + contentWidth * (block.placement.xPercent / 100) : marginLeft;
    const blockWidth = isAbsolute ? contentWidth * (block.placement.widthPercent / 100) : contentWidth;
    const blockTopY = page.getHeight() - marginTop - (contentHeight * (block.placement.yPercent / 100));

    if (block.type === "text") {
      drawParagraph(block.text || "-", {
        bold: block.textOptions.fontWeight === "bold",
        fontSize: block.textOptions.fontSize,
        color: hexToRgb(block.textOptions.color),
        align: block.textOptions.align,
        x: blockX,
        y: isAbsolute ? blockTopY : undefined,
        width: blockWidth,
        skipFlow: isAbsolute,
      });
      continue;
    }

    if (block.type === "field-list") {
      let fieldOffsetY = blockTopY;
      for (const fieldItem of block.items) {
        const consumedHeight = drawParagraph(`${fieldItem.label}: ${fieldItem.value}`, {
          bold: block.textOptions.fontWeight === "bold",
          fontSize: block.textOptions.fontSize,
          color: hexToRgb(block.textOptions.color),
          align: block.textOptions.align,
          x: blockX,
          y: isAbsolute ? fieldOffsetY : undefined,
          width: blockWidth,
          skipFlow: isAbsolute,
        });
        if (isAbsolute) {
          fieldOffsetY -= consumedHeight;
        }
      }
      continue;
    }

    if (block.type === "table") {
      let tableTopY = blockTopY;

      if (block.title.trim()) {
        const consumedHeight = drawParagraph(block.title, {
          bold: true,
          fontSize: block.textOptions.fontSize + 2,
          color: hexToRgb(block.textOptions.color),
          align: block.textOptions.align,
          x: blockX,
          y: isAbsolute ? tableTopY : undefined,
          width: blockWidth,
          skipFlow: isAbsolute,
        });
        if (isAbsolute) {
          tableTopY -= consumedHeight;
        }
      }

      const normalizedColumns = block.columns.map((column) => ({
        ...column,
        width: blockWidth * (column.widthWeight / 100),
      }));
      const totalWidth = normalizedColumns.reduce((sum, column) => sum + column.width, 0) || blockWidth;
      const widthScale = blockWidth / totalWidth;
      const columns = normalizedColumns.map((column) => ({
        ...column,
        width: column.width * widthScale,
      }));

      const headerHeight = drawTableRow(columns, Object.fromEntries(columns.map((column) => [column.key, column.title])), true, {
        x: blockX,
        y: isAbsolute ? tableTopY : undefined,
        skipFlow: isAbsolute,
        fontSize: Math.max(block.textOptions.fontSize - 1, 6),
        color: hexToRgb(block.textOptions.color),
      });
      if (isAbsolute) {
        tableTopY -= headerHeight;
      }

      for (const row of block.rows) {
        const rowHeight = drawTableRow(columns, row, false, {
          x: blockX,
          y: isAbsolute ? tableTopY : undefined,
          skipFlow: isAbsolute,
          fontSize: block.textOptions.fontSize,
          color: hexToRgb(block.textOptions.color),
        });
        if (isAbsolute) {
          tableTopY -= rowHeight;
        }
      }
      continue;
    }

    if (block.type === "total") {
      drawParagraph(`${block.label}: ${block.value}`, {
        bold: block.textOptions.fontWeight === "bold",
        fontSize: block.textOptions.fontSize,
        color: hexToRgb(block.textOptions.color),
        align: block.textOptions.align,
        x: blockX,
        y: isAbsolute ? blockTopY : undefined,
        width: blockWidth,
        skipFlow: isAbsolute,
      });
      continue;
    }

    if (block.type === "image") {
      const parsedImage = parseTemplateImageDataUrl(block.src);
      if (!parsedImage) {
        continue;
      }

      const embeddedImage = parsedImage.mimeType === "image/png"
        ? await pdf.embedPng(parsedImage.bytes)
        : await pdf.embedJpg(parsedImage.bytes);
      const targetWidth = Math.max(blockWidth, 1);
      const targetHeight = block.placement.heightPercent > 0
        ? contentHeight * (block.placement.heightPercent / 100)
        : embeddedImage.height * (targetWidth / Math.max(embeddedImage.width, 1));
      const drawY = (isAbsolute ? blockTopY : currentY) - targetHeight;

      page.drawImage(embeddedImage, {
        x: blockX,
        y: drawY,
        width: targetWidth,
        height: targetHeight,
      });

      if (!isAbsolute) {
        currentY -= targetHeight + 4;
      }
      continue;
    }

    if (block.type === "horizontal-line") {
      const lineColor = hexToRgb(block.lineOptions.color);
      const lineThickness = block.lineOptions.lineWidth;
      const drawY = isAbsolute ? blockTopY : currentY;
      const dashArray = block.lineOptions.lineStyle === "dashed" ? [6, 4]
        : block.lineOptions.lineStyle === "dotted" ? [2, 3]
        : undefined;
      if (block.lineOptions.lineStyle === "double") {
        const gap = Math.max(lineThickness, 2);
        page.drawLine({ start: { x: blockX, y: drawY + gap }, end: { x: blockX + blockWidth, y: drawY + gap }, thickness: lineThickness, color: lineColor });
        page.drawLine({ start: { x: blockX, y: drawY - gap }, end: { x: blockX + blockWidth, y: drawY - gap }, thickness: lineThickness, color: lineColor });
      } else {
        page.drawLine({ start: { x: blockX, y: drawY }, end: { x: blockX + blockWidth, y: drawY }, thickness: lineThickness, color: lineColor, dashArray });
      }
      if (!isAbsolute) {
        currentY -= lineThickness + 6;
      }
      continue;
    }

    if (block.type === "vertical-line") {
      const lineColor = hexToRgb(block.lineOptions.color);
      const lineThickness = block.lineOptions.lineWidth;
      const blockHeight = block.placement.heightPercent > 0
        ? contentHeight * (block.placement.heightPercent / 100)
        : contentHeight * 0.1;
      const lineX = blockX + blockWidth / 2;
      const startY = isAbsolute ? blockTopY : currentY;
      const endY = startY - blockHeight;
      const dashArray = block.lineOptions.lineStyle === "dashed" ? [6, 4]
        : block.lineOptions.lineStyle === "dotted" ? [2, 3]
        : undefined;
      if (block.lineOptions.lineStyle === "double") {
        const gap = Math.max(lineThickness, 2);
        page.drawLine({ start: { x: lineX - gap, y: startY }, end: { x: lineX - gap, y: endY }, thickness: lineThickness, color: lineColor });
        page.drawLine({ start: { x: lineX + gap, y: startY }, end: { x: lineX + gap, y: endY }, thickness: lineThickness, color: lineColor });
      } else {
        page.drawLine({ start: { x: lineX, y: startY }, end: { x: lineX, y: endY }, thickness: lineThickness, color: lineColor, dashArray });
      }
      if (!isAbsolute) {
        currentY -= blockHeight + 4;
      }
      continue;
    }

    if (block.type === "note" && block.value.trim()) {
      drawParagraph(block.value, {
        bold: block.textOptions.fontWeight === "bold",
        fontSize: block.textOptions.fontSize || smallFontSize,
        color: rgb(0.35, 0.35, 0.35),
        align: block.textOptions.align,
        x: blockX,
        y: isAbsolute ? blockTopY : undefined,
        width: blockWidth,
        skipFlow: isAbsolute,
      });
    }
  }

  const bytes = await pdf.save();
  const pdfBase64 = encodeBase64(bytes);

  return createEnvelope({
    fileName,
    mimeType: "application/pdf",
    pdfBase64,
    templateCode: template.code,
    templateName: template.name,
  });
}