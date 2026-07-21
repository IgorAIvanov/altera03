// Малювання блочного шаблону в PDF (pdf-lib). Чистий рендер: жодної БД,
// жодного знання про моделі — на вхід шаблон і дані, на вихід байти PDF.
//
// Викликається з `print.handlers.ts`, який і дістає шаблон та дані.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { PrintTemplateColumnAlign, PrintTemplateSchema } from "./print-template.ts";
import { buildPrintTemplateRenderPlan } from "./print-render-plan.ts";
import type {
  PrintTemplateRenderBlock,
  PrintTemplateRenderTableBlock,
  PrintTemplateRenderTableColumn,
} from "./print-render-plan.ts";

const PAGE_SIZE_A4 = { width: 595.28, height: 841.89 } as const;
const MARGIN = 40;

/** Відступ між таблицею та блоком, який довелося зсунути під неї. */
const BLOCK_GAP = 12;

/** Менше цього місця під підвал — краще винести його на нову сторінку. */
const FOOTER_MIN_SPACE = 24;

// Кирилиці у StandardFonts немає — вантажимо Roboto з node_modules.
const FONT_REGULAR_URL = new URL(
  "../../../node_modules/@fontsource/roboto/files/roboto-cyrillic-400-normal.woff",
  import.meta.url,
);
const FONT_BOLD_URL = new URL(
  "../../../node_modules/@fontsource/roboto/files/roboto-cyrillic-700-normal.woff",
  import.meta.url,
);

/** Шаблон у формі, придатній для рендеру: реквізити + нормалізовані блоки. */
export interface PrintTemplateRuntimeItem {
  code: string;
  name: string;
  targetModel: string;
  dataCommand: string;
  orientation: "portrait" | "landscape";
  schema: PrintTemplateSchema;
}


function decodeBase64(base64: string) {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace(/^#/, "");
  const channel = (offset: number) => {
    const parsed = parseInt(cleaned.substring(offset, offset + 2), 16) / 255;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return rgb(channel(0), channel(2), channel(4));
}

function parseImageDataUrl(source: string) {
  const match = source.trim().match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/i);
  if (!match) return null;

  const rawType = match[1]!.toLowerCase();
  const mimeType = rawType === "image/jpg" ? "image/jpeg" : rawType;
  return { mimeType, bytes: decodeBase64(match[3]!) };
}

function wrapText(text: string, maxWidth: number, measure: (value: string) => number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (!currentLine || measure(candidate) <= maxWidth) {
      currentLine = candidate;
      continue;
    }
    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

/** Малює блочний шаблон у PDF і повертає байти. */
export async function renderPrintPdf(
  template: PrintTemplateRuntimeItem,
  printData: unknown,
): Promise<Uint8Array> {
  const renderPlan = buildPrintTemplateRenderPlan(template.schema, printData);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const regularFont = await pdf.embedFont(await Deno.readFile(FONT_REGULAR_URL));
  const boldFont = await pdf.embedFont(await Deno.readFile(FONT_BOLD_URL));
  const regularAsciiFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldAsciiFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  const landscape = template.orientation === "landscape";
  const pageSize: [number, number] = landscape
    ? [PAGE_SIZE_A4.height, PAGE_SIZE_A4.width]
    : [PAGE_SIZE_A4.width, PAGE_SIZE_A4.height];

  // `page` — поточна сторінка: довга таблиця додає нові, і всі функції
  // малювання нижче бачать саме її (замикання на змінну, а не на значення).
  let page = pdf.addPage(pageSize);
  const contentWidth = page.getWidth() - MARGIN * 2;
  const contentHeight = page.getHeight() - MARGIN * 2;

  // Кирилиця йде Roboto, латиниця — Helvetica: так метрики ASCII збігаються
  // з очікуваннями pdf-lib, а кирилиця не перетворюється на «крякозябри».
  const getTextRuns = (text: string, bold: boolean) => {
    const runs: Array<{ text: string; font: typeof regularFont }> = [];
    const unicodeFont = bold ? boldFont : regularFont;
    const asciiFont = bold ? boldAsciiFont : regularAsciiFont;

    for (const char of text) {
      const font = char.codePointAt(0)! <= 0x7f ? asciiFont : unicodeFont;
      const previous = runs[runs.length - 1];
      if (previous?.font === font) {
        previous.text += char;
        continue;
      }
      runs.push({ text: char, font });
    }

    return runs;
  };

  const measure = (text: string, fontSize: number, bold = false) =>
    getTextRuns(text, bold).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, fontSize), 0);

  const drawTextLine = (
    text: string,
    x: number,
    y: number,
    fontSize: number,
    bold: boolean,
    color?: ReturnType<typeof rgb>,
  ) => {
    let offsetX = x;
    for (const run of getTextRuns(text, bold)) {
      page.drawText(run.text, { x: offsetX, y, size: fontSize, font: run.font, color });
      offsetX += run.font.widthOfTextAtSize(run.text, fontSize);
    }
  };

  /** Малює абзац із перенесенням і повертає використану висоту. */
  const drawParagraph = (text: string, options: {
    x: number;
    y: number;
    width: number;
    fontSize: number;
    bold: boolean;
    align: PrintTemplateColumnAlign;
    color?: ReturnType<typeof rgb>;
  }) => {
    const lines = wrapText(text, options.width, (value) => measure(value, options.fontSize, options.bold));
    let lineY = options.y;

    for (const line of lines) {
      const lineWidth = measure(line, options.fontSize, options.bold);
      const x = options.align === "right"
        ? options.x + options.width - lineWidth
        : options.align === "center"
        ? options.x + (options.width - lineWidth) / 2
        : options.x;

      drawTextLine(line, x, lineY, options.fontSize, options.bold, options.color);
      lineY -= options.fontSize + 3;
    }

    return lines.length * (options.fontSize + 3) + 3;
  };

  type TableColumn = PrintTemplateRenderTableColumn & { width: number };

  const CELL_PADDING = 4;

  const columnFontSize = (column: TableColumn, isHeader: boolean, fallback: number) => {
    const parsed = Number.parseFloat(isHeader ? column.headerFontSize : column.valueFontSize);
    return Number.isFinite(parsed) ? Math.min(72, Math.max(6, parsed)) : fallback;
  };

  const columnBold = (column: TableColumn, isHeader: boolean) =>
    (isHeader ? column.headerFontWeight : column.valueFontWeight) === "bold";

  /** Текст комірок, розкладений по рядках у межах ширини колонки. */
  const layoutRow = (columns: TableColumn[], values: Record<string, string>, isHeader: boolean, fallbackFontSize: number) =>
    columns.map((column) => wrapText(
      String(values[column.key] ?? ""),
      Math.max(column.width - CELL_PADDING * 2, 12),
      (value) => measure(value, columnFontSize(column, isHeader, fallbackFontSize), columnBold(column, isHeader)),
    ));

  const rowHeightOf = (columns: TableColumn[], cellLines: string[][], isHeader: boolean, fallbackFontSize: number) =>
    columns.reduce((maxHeight, column, index) => {
      const lineHeight = columnFontSize(column, isHeader, fallbackFontSize) + 2;
      return Math.max(maxHeight, Math.max(cellLines[index]?.length ?? 1, 1) * lineHeight + CELL_PADDING * 2);
    }, 0);

  /**
   * Висота рядка БЕЗ малювання — потрібна, щоб вирішити про перенос сторінки
   * ще до того, як рядок ліг на аркуш.
   */
  const measureTableRow = (columns: TableColumn[], values: Record<string, string>, fallbackFontSize: number) =>
    rowHeightOf(columns, layoutRow(columns, values, false, fallbackFontSize), false, fallbackFontSize);

  /** Малює рядок таблиці (заголовок або дані) і повертає його висоту. */
  const drawTableRow = (
    columns: TableColumn[],
    values: Record<string, string>,
    isHeader: boolean,
    x: number,
    y: number,
    fallbackFontSize: number,
    fallbackColor: ReturnType<typeof rgb>,
  ) => {
    const padding = CELL_PADDING;
    const cellLines = layoutRow(columns, values, isHeader, fallbackFontSize);
    const rowHeight = rowHeightOf(columns, cellLines, isHeader, fallbackFontSize);

    page.drawRectangle({
      x,
      y: y - rowHeight + padding,
      width: columns.reduce((sum, column) => sum + column.width, 0),
      height: rowHeight,
      borderColor: rgb(0.82, 0.82, 0.82),
      borderWidth: 0.7,
      color: isHeader ? rgb(0.98, 0.98, 0.98) : undefined,
    });

    let cellX = x;
    columns.forEach((column, columnIndex) => {
      if (columnIndex > 0) {
        page.drawLine({
          start: { x: cellX, y: y - rowHeight + padding },
          end: { x: cellX, y: y + padding },
          thickness: 0.5,
          color: rgb(0.82, 0.82, 0.82),
        });
      }

      const fontSize = columnFontSize(column, isHeader, fallbackFontSize);
      const bold = columnBold(column, isHeader);
      const align: PrintTemplateColumnAlign = isHeader ? column.headerAlign : column.valueAlign;
      const rawColor = isHeader ? column.headerColor : column.valueColor;
      const color = rawColor ? hexToRgb(rawColor) : fallbackColor;

      cellLines[columnIndex]!.forEach((line, lineIndex) => {
        const lineWidth = measure(line, fontSize, bold);
        const textX = align === "right"
          ? cellX + column.width - padding - lineWidth
          : align === "center"
          ? cellX + (column.width - lineWidth) / 2
          : cellX + padding;

        drawTextLine(line, textX, y - padding - fontSize - lineIndex * (fontSize + 2) + 2, fontSize, bold, color);
      });

      cellX += column.width;
    });

    return rowHeight;
  };

  /**
   * Малює один блок, крім таблиці, від заданої верхньої межі.
   * Повертає використану висоту — щоб підвал можна було зсунути під таблицю.
   */
  const drawBlock = async (block: PrintTemplateRenderBlock, topY: number) => {
    // Розкладка блоків абсолютна у відсотках від області друку — так само,
    // як її показує полотно редактора.
    const blockX = MARGIN + contentWidth * (block.placement.xPercent / 100);
    const blockWidth = contentWidth * (block.placement.widthPercent / 100);

    if (block.type === "text") {
      return drawParagraph(block.text || "-", {
        x: blockX,
        y: topY,
        width: blockWidth,
        fontSize: block.textOptions.fontSize,
        bold: block.textOptions.fontWeight === "bold",
        align: block.textOptions.align,
        color: hexToRgb(block.textOptions.color),
      });
    }

    if (block.type === "field-list") {
      let fieldY = topY;
      for (const item of block.items) {
        fieldY -= drawParagraph(`${item.label}: ${item.value}`, {
          x: blockX,
          y: fieldY,
          width: blockWidth,
          fontSize: block.textOptions.fontSize,
          bold: block.textOptions.fontWeight === "bold",
          align: block.textOptions.align,
          color: hexToRgb(block.textOptions.color),
        });
      }
      return topY - fieldY;
    }

    if (block.type === "image") {
      const parsed = parseImageDataUrl(block.src);
      if (!parsed) return 0;

      const image = parsed.mimeType === "image/png"
        ? await pdf.embedPng(parsed.bytes)
        : await pdf.embedJpg(parsed.bytes);
      const width = Math.max(blockWidth, 1);
      const height = block.placement.heightPercent > 0
        ? contentHeight * (block.placement.heightPercent / 100)
        : image.height * (width / Math.max(image.width, 1));

      page.drawImage(image, { x: blockX, y: topY - height, width, height });
      return height;
    }

    if (block.type === "horizontal-line" || block.type === "vertical-line") {
      const color = hexToRgb(block.lineOptions.color);
      const thickness = block.lineOptions.lineWidth;
      const dashArray = block.lineOptions.lineStyle === "dashed"
        ? [6, 4]
        : block.lineOptions.lineStyle === "dotted"
        ? [2, 3]
        : undefined;
      const height = block.type === "vertical-line"
        ? (block.placement.heightPercent > 0
          ? contentHeight * (block.placement.heightPercent / 100)
          : contentHeight * 0.1)
        : thickness;

      const segment = block.type === "horizontal-line"
        ? { start: { x: blockX, y: topY }, end: { x: blockX + blockWidth, y: topY } }
        : (() => {
          const lineX = blockX + blockWidth / 2;
          return { start: { x: lineX, y: topY }, end: { x: lineX, y: topY - height } };
        })();

      if (block.lineOptions.lineStyle === "double") {
        // Подвійна лінія — дві паралельні з розбіжністю перпендикулярно осі.
        const gap = Math.max(thickness, 2);
        const shift = block.type === "horizontal-line" ? { x: 0, y: gap } : { x: gap, y: 0 };
        for (const sign of [1, -1]) {
          page.drawLine({
            start: { x: segment.start.x + shift.x * sign, y: segment.start.y + shift.y * sign },
            end: { x: segment.end.x + shift.x * sign, y: segment.end.y + shift.y * sign },
            thickness,
            color,
          });
        }
      } else {
        page.drawLine({ ...segment, thickness, color, dashArray });
      }

      return height;
    }

    return 0;
  };

  /**
   * Малює таблицю з перенесенням на наступні сторінки.
   *
   * Рядок, що не влазить до нижнього поля, починає нову сторінку, і шапка
   * колонок повторюється — інакше «хвіст» документа лишався б без заголовків.
   * Повертає y, на якому таблиця закінчилась (уже на останній сторінці).
   */
  const drawTable = (block: PrintTemplateRenderTableBlock, startY: number) => {
    const blockX = MARGIN + contentWidth * (block.placement.xPercent / 100);
    const blockWidth = contentWidth * (block.placement.widthPercent / 100);
    const color = hexToRgb(block.textOptions.color);
    const headerFontSize = Math.max(block.textOptions.fontSize - 1, 6);
    let tableY = startY;

    if (block.title.trim()) {
      tableY -= drawParagraph(block.title, {
        x: blockX,
        y: tableY,
        width: blockWidth,
        fontSize: block.textOptions.fontSize + 2,
        bold: true,
        align: block.textOptions.align,
        color,
      });
    }

    // widthPercent колонок нормалізуємо до ширини блока: сума ваг може не
    // дорівнювати 100, але таблиця однаково має заповнити відведене місце.
    const rawColumns = block.columns.map((column) => ({
      ...column,
      width: blockWidth * (column.widthWeight / 100),
    }));
    const totalWidth = rawColumns.reduce((sum, column) => sum + column.width, 0) || blockWidth;
    const columns: TableColumn[] = rawColumns.map((column) => ({
      ...column,
      width: column.width * (blockWidth / totalWidth),
    }));
    const headerValues = Object.fromEntries(columns.map((column) => [column.key, column.title]));

    const drawHeader = () => {
      tableY -= drawTableRow(columns, headerValues, true, blockX, tableY, headerFontSize, color);
    };

    drawHeader();

    for (const row of block.rows) {
      // Висота рядка залежить від перенесення тексту в комірках, тож рахуємо її
      // окремо ДО малювання — інакше рядок наполовину виїхав би за поле.
      const rowHeight = measureTableRow(columns, row, block.textOptions.fontSize);

      if (tableY - rowHeight < MARGIN) {
        page = pdf.addPage(pageSize);
        tableY = page.getHeight() - MARGIN;
        drawHeader();
      }

      tableY -= drawTableRow(columns, row, false, blockX, tableY, block.textOptions.fontSize, color);
    }

    return tableY;
  };

  // Блоки вище першої таблиці — «шапка» форми, вони лишаються на першій
  // сторінці. Блоки нижче — підвал (разом, підписи): їх треба малювати після
  // таблиці й на останній сторінці, інакше довга таблиця налізе на них.
  const tables = renderPlan.filter((block): block is PrintTemplateRenderTableBlock => block.type === "table");
  const firstTableTop = tables.length
    ? Math.min(...tables.map((table) => table.placement.yPercent))
    : Number.POSITIVE_INFINITY;
  const headerBlocks = renderPlan.filter((block) => block.type !== "table" && block.placement.yPercent < firstTableTop);
  const footerBlocks = renderPlan.filter((block) => block.type !== "table" && block.placement.yPercent >= firstTableTop);

  const topYOf = (block: PrintTemplateRenderBlock) =>
    page.getHeight() - MARGIN - contentHeight * (block.placement.yPercent / 100);

  for (const block of headerBlocks) {
    await drawBlock(block, topYOf(block));
  }

  let tableEndY: number | null = null;
  for (const table of tables) {
    // Перша таблиця стоїть на своєму місці; наступна — під попередньою, якщо
    // та вже зайняла це місце (або перенеслася на іншу сторінку).
    const naturalTop = topYOf(table);
    const startY = tableEndY === null ? naturalTop : Math.min(naturalTop, tableEndY - BLOCK_GAP);
    tableEndY = drawTable(table, startY);
  }

  if (footerBlocks.length) {
    // Підвал іде під таблицю, якщо вона до нього дотягнулась; інакше лишається
    // на своєму місці. Зсув однаковий для всіх блоків підвалу — щоб не
    // розсипалась їхня взаємна розкладка.
    const naturalTops = footerBlocks.map((block) => topYOf(block));
    const highestFooterTop = Math.max(...naturalTops);
    const shift = tableEndY !== null && tableEndY - BLOCK_GAP < highestFooterTop
      ? (tableEndY - BLOCK_GAP) - highestFooterTop
      : 0;

    // Якщо після зсуву підвал не влазить у сторінку — переносимо його цілком.
    const lowestFooterTop = Math.min(...naturalTops) + shift;
    if (lowestFooterTop < MARGIN + FOOTER_MIN_SPACE) {
      page = pdf.addPage(pageSize);
      const offset = page.getHeight() - MARGIN - highestFooterTop;
      for (const block of footerBlocks) {
        await drawBlock(block, topYOf(block) + offset);
      }
    } else {
      for (const block of footerBlocks) {
        await drawBlock(block, topYOf(block) + shift);
      }
    }
  }

  return await pdf.save();
}
