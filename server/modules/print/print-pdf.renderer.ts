// Малювання блочного шаблону в PDF (pdf-lib). Чистий рендер: жодної БД,
// жодного знання про моделі — на вхід шаблон і дані, на вихід байти PDF.
//
// Викликається з `print.handlers.ts`, який і дістає шаблон та дані.

import { PDFDocument, rgb } from "pdf-lib";
import { embedPrintFonts } from "./print-text-metrics.ts";
import { layoutPrintTemplateGrid } from "./print-template.ts";
import type { PrintTemplateColumnAlign, PrintTemplateSchema } from "./print-template.ts";
import { buildPrintTemplateRenderPlan } from "./print-render-plan.ts";
import type {
  PrintTemplateRenderBarcodeBlock,
  PrintTemplateRenderBlock,
  PrintTemplateRenderTableBlock,
  PrintTemplateRenderTableColumn,
  PrintTemplateRenderTableRow,
} from "./print-render-plan.ts";

const PAGE_SIZE_A4 = { width: 595.28, height: 841.89 } as const;
const MARGIN = 40;

/** Відступ між таблицею та блоком, який довелося зсунути під неї. */
const BLOCK_GAP = 12;

/** Менше цього місця під підвал — краще винести його на нову сторінку. */
const FOOTER_MIN_SPACE = 24;

/**
 * Висота штрих-коду, коли її не задали в розкладці.
 *
 * 40pt ≈ 14 мм — стандартна висота для лінійного коду на документі: нижче
 * ручні сканери починають вимагати точного прицілювання.
 */
const BARCODE_DEFAULT_HEIGHT = 40;

/** Проміжок між кодом і підписом під ним. */
const BARCODE_CAPTION_GAP = 3;

// Кирилиці у StandardFonts немає — Roboto їде вбудованим у модуль
// (`deno task print:fonts`). З диска його читати не можна: у встановленому
// пакеті node_modules поряд немає, а якщо модуль приїхав із кеша JSR, то
// `import.meta.url` це взагалі `https://` — Deno.readFile тоді каже
// «Must be a file URL», і друк падає лише в застосунку, ніколи в репозиторії.

/** Шаблон у формі, придатній для рендеру: реквізити + нормалізовані блоки. */
export interface PrintTemplateRuntimeItem {
  code: string;
  name: string;
  targetModel: string;
  dataCommand: string;
  orientation: "portrait" | "landscape";
  schema: PrintTemplateSchema;
}


/**
 * Байти з base64. Лишається тут, хоч такий самий є в модулі метрики: це
 * рядкова арифметика, у якій нема чому розійтися, а спільний «утиль» заради
 * шести рядків зробив би модуль метрики звалищем.
 */
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
  // Шрифти й метрика — зі спільного модуля: тим самим кодом застосунок міряє
  // верстку в пробі. Дві копії розійшлися б мовчки, а розходження виявилося б
  // рівно там, де перевірка й потрібна, — на надрукованому бланку.
  const fonts = await embedPrintFonts(pdf);
  const getTextRuns = fonts.runs;
  const measure = fonts.measure;

  const landscape = template.orientation === "landscape";
  const pageSize: [number, number] = landscape
    ? [PAGE_SIZE_A4.height, PAGE_SIZE_A4.width]
    : [PAGE_SIZE_A4.width, PAGE_SIZE_A4.height];

  // `page` — поточна сторінка: довга таблиця додає нові, і всі функції
  // малювання нижче бачать саме її (замикання на змінну, а не на значення).
  let page = pdf.addPage(pageSize);
  const contentWidth = page.getWidth() - MARGIN * 2;
  const contentHeight = page.getHeight() - MARGIN * 2;

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

  /**
   * Малює штрих-код і повертає використану висоту.
   *
   * Штрихи завжди чорні на прозорому (тобто на білому папері): будь-який інший
   * колір або інверсія — це код, який сканер не візьме. Тихі зони вже входять у
   * фігуру, тож масштабування рамкою їх не з'їдає.
   *
   * Ширина модуля — просте ділення ширини блока на кількість модулів, без
   * округлення до цілих пунктів: PDF векторний, а сусідні штрихи малюються
   * єдиними прямокутниками, тому щілин між ними не виникає.
   */
  const drawBarcode = (block: PrintTemplateRenderBarcodeBlock, blockX: number, topY: number, blockWidth: number) => {
    const height = block.placement.heightPercent > 0
      ? contentHeight * (block.placement.heightPercent / 100)
      : BARCODE_DEFAULT_HEIGHT;

    if (!block.shape) {
      // Помилкове значення друкуємо текстом на місці коду. Мовчки нічого не
      // малювати не можна: порожнє місце в накладній ніхто не помітить, а
      // партія товару поїде без коду.
      return drawParagraph(block.error || "Штрих-код не побудовано", {
        x: blockX,
        y: topY,
        width: blockWidth,
        fontSize: block.textOptions.fontSize,
        bold: false,
        align: block.textOptions.align,
        color: rgb(0.7, 0.1, 0.1),
      });
    }

    const captionHeight = block.showText && block.shape.text
      ? block.textOptions.fontSize + BARCODE_CAPTION_GAP
      : 0;
    const codeHeight = Math.max(height - captionHeight, 1);

    if (block.shape.kind === "linear") {
      const moduleWidth = blockWidth / block.shape.modules.length;
      let runStart: number | null = null;

      // Суміжні штрихи зливаються в один прямокутник — інакше на межі двох
      // сусідніх модулів переглядач може лишити волосяну щілину.
      for (let index = 0; index <= block.shape.modules.length; index += 1) {
        const isBar = block.shape.modules[index] === true;
        if (isBar && runStart === null) {
          runStart = index;
          continue;
        }

        if (!isBar && runStart !== null) {
          page.drawRectangle({
            x: blockX + runStart * moduleWidth,
            y: topY - codeHeight,
            width: (index - runStart) * moduleWidth,
            height: codeHeight,
            color: rgb(0, 0, 0),
          });
          runStart = null;
        }
      }
    } else {
      // Матриця квадратна: сторона — менше з ширини рамки й доступної висоти,
      // інакше QR розтягнувся б у прямокутник і перестав читатися.
      const side = Math.min(blockWidth, codeHeight);
      const moduleSize = side / block.shape.size;
      const offsetX = blockX + (blockWidth - side) / 2;

      for (let row = 0; row < block.shape.size; row += 1) {
        let runStart: number | null = null;

        for (let column = 0; column <= block.shape.size; column += 1) {
          const isDark = column < block.shape.size &&
            block.shape.modules[row * block.shape.size + column] === true;

          if (isDark && runStart === null) {
            runStart = column;
            continue;
          }

          if (!isDark && runStart !== null) {
            page.drawRectangle({
              x: offsetX + runStart * moduleSize,
              y: topY - (row + 1) * moduleSize,
              width: (column - runStart) * moduleSize,
              height: moduleSize,
              color: rgb(0, 0, 0),
            });
            runStart = null;
          }
        }
      }
    }

    if (captionHeight) {
      const caption = block.shape.text;
      const captionWidth = measure(caption, block.textOptions.fontSize, false);
      drawTextLine(
        caption,
        blockX + (blockWidth - captionWidth) / 2,
        topY - codeHeight - block.textOptions.fontSize,
        block.textOptions.fontSize,
        false,
        hexToRgb(block.textOptions.color),
      );
    }

    return height;
  };

  type TableColumn = PrintTemplateRenderTableColumn & { width: number; x: number };

  const CELL_PADDING = 4;
  const GRID_COLOR = rgb(0.82, 0.82, 0.82);
  const HEADER_FILL = rgb(0.98, 0.98, 0.98);

  /** Комірка, розставлена по сітці: відомі колонка, рядок і розкладений текст. */
  interface PlacedCell {
    columnIndex: number;
    rowIndex: number;
    colSpan: number;
    rowSpan: number;
    width: number;
    lines: string[];
    fontSize: number;
    bold: boolean;
    align: PrintTemplateColumnAlign;
    color: string;
  }

  interface SectionLayout {
    placed: PlacedCell[];
    heights: number[];
    total: number;
  }

  const cellContentHeight = (cell: PlacedCell) =>
    Math.max(cell.lines.length, 1) * (cell.fontSize + 2) + CELL_PADDING * 2;

  /**
   * Розкладка секції по сітці колонок.
   *
   * Сам обхід (зліва направо, з пропуском клітинок, зайнятих `rowSpan` з
   * попередніх рядків) живе в `print-template.ts`: ним же користується план
   * рендеру, коли викидає комірки схованої колонки. Тут лишається те, що знає
   * тільки рендерер, — ширини, шрифти й перенесення рядків.
   *
   * Висота рядка = найвища з комірок, що в ньому закінчуються; якщо об'єднана
   * по вертикалі комірка вища за суму своїх рядків, різницю добираємо останньому.
   */
  const layoutSection = (
    rows: PrintTemplateRenderTableRow[],
    columns: TableColumn[],
    fallbackFontSize: number,
  ): SectionLayout => {
    const placed: PlacedCell[] = layoutPrintTemplateGrid(rows, columns.length).map((item) => {
      const cell = item.cell;
      const width = columns
        .slice(item.columnIndex, item.columnIndex + item.colSpan)
        .reduce((sum, column) => sum + column.width, 0);
      const fontSize = cell.fontSize ?? fallbackFontSize;
      const bold = cell.fontWeight === "bold";

      return {
        columnIndex: item.columnIndex,
        rowIndex: item.rowIndex,
        colSpan: item.colSpan,
        rowSpan: item.rowSpan,
        width,
        fontSize,
        bold,
        align: cell.align,
        color: cell.color,
        lines: wrapText(
          cell.value,
          Math.max(width - CELL_PADDING * 2, 12),
          (value) => measure(value, fontSize, bold),
        ),
      };
    });

    const heights = rows.map(() => 0);

    for (const cell of placed) {
      if (cell.rowSpan === 1) {
        heights[cell.rowIndex] = Math.max(heights[cell.rowIndex]!, cellContentHeight(cell));
      }
    }

    // Рядок лише з вертикально об'єднаних комірок теж має власну висоту.
    const emptyRowHeight = fallbackFontSize + 2 + CELL_PADDING * 2;
    for (let index = 0; index < heights.length; index += 1) {
      if (heights[index] === 0) heights[index] = emptyRowHeight;
    }

    for (const cell of placed) {
      if (cell.rowSpan <= 1) continue;

      const spanned = heights.slice(cell.rowIndex, cell.rowIndex + cell.rowSpan).reduce((sum, value) => sum + value, 0);
      const needed = cellContentHeight(cell);
      if (needed > spanned) {
        const last = cell.rowIndex + cell.rowSpan - 1;
        heights[last] = heights[last]! + (needed - spanned);
      }
    }

    return { placed, heights, total: heights.reduce((sum, value) => sum + value, 0) };
  };

  /** Малює розкладену секцію від верхньої межі `topY`. */
  const drawSection = (
    layout: SectionLayout,
    columns: TableColumn[],
    topY: number,
    fill: boolean,
    fallbackColor: ReturnType<typeof rgb>,
  ) => {
    for (const cell of layout.placed) {
      const cellTop = topY - layout.heights.slice(0, cell.rowIndex).reduce((sum, value) => sum + value, 0);
      const cellHeight = layout.heights
        .slice(cell.rowIndex, cell.rowIndex + cell.rowSpan)
        .reduce((sum, value) => sum + value, 0);
      const cellX = columns[cell.columnIndex]!.x;

      page.drawRectangle({
        x: cellX,
        y: cellTop - cellHeight,
        width: cell.width,
        height: cellHeight,
        borderColor: GRID_COLOR,
        borderWidth: 0.7,
        color: fill ? HEADER_FILL : undefined,
      });

      const color = cell.color ? hexToRgb(cell.color) : fallbackColor;

      cell.lines.forEach((line, lineIndex) => {
        const lineWidth = measure(line, cell.fontSize, cell.bold);
        const textX = cell.align === "right"
          ? cellX + cell.width - CELL_PADDING - lineWidth
          : cell.align === "center"
          ? cellX + (cell.width - lineWidth) / 2
          : cellX + CELL_PADDING;

        drawTextLine(
          line,
          textX,
          cellTop - CELL_PADDING - cell.fontSize - lineIndex * (cell.fontSize + 2) + 2,
          cell.fontSize,
          cell.bold,
          color,
        );
      });
    }
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
      return drawParagraph(block.text, {
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
        // Підпис необов'язковий: без нього друкується САМЕ значення. Доти рядок
        // склеювався беззастережно, і поле без підпису починалося з двокрапки
        // («: ТОВ «Демо»»), тобто списком полів не можна було надрукувати
        // рядок значень — а саме так виглядають реквізити сторони на бланку.
        fieldY -= drawParagraph(item.label ? `${item.label}: ${item.value}` : item.value, {
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

    if (block.type === "barcode") {
      return drawBarcode(block, blockX, topY, blockWidth);
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
   * Малює таблицю з секціями та перенесенням на наступні сторінки.
   *
   * Шапка повторюється на кожній сторінці; запис (група рядків секції `row`)
   * не розривається між сторінками; підвал друкується один раз наприкінці.
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

    // Ваги колонок нормалізуємо до ширини блока: сума може не дорівнювати 100,
    // але таблиця однаково має заповнити відведене місце.
    const totalWeight = block.columns.reduce((sum, column) => sum + column.widthWeight, 0) || 1;
    let columnX = blockX;
    const columns: TableColumn[] = block.columns.map((column) => {
      const width = blockWidth * (column.widthWeight / totalWeight);
      const placed = { ...column, width, x: columnX };
      columnX += width;
      return placed;
    });

    if (!columns.length) return tableY;

    const header = layoutSection(block.header, columns, headerFontSize);
    const groups = block.body.map((rows) => layoutSection(rows, columns, block.textOptions.fontSize));
    const footer = layoutSection(block.footer, columns, block.textOptions.fontSize);

    const drawHeader = () => {
      if (!header.total) return;
      drawSection(header, columns, tableY, true, color);
      tableY -= header.total;
    };

    drawHeader();

    for (const group of groups) {
      // Група — це один запис. Якщо він не влазить, переносимо його цілком;
      // запис, вищий за цілу сторінку, малюємо як є — інакше зациклимось.
      if (tableY - group.total < MARGIN && tableY < page.getHeight() - MARGIN) {
        page = pdf.addPage(pageSize);
        tableY = page.getHeight() - MARGIN;
        drawHeader();
      }

      drawSection(group, columns, tableY, false, color);
      tableY -= group.total;
    }

    if (footer.total) {
      if (tableY - footer.total < MARGIN) {
        page = pdf.addPage(pageSize);
        tableY = page.getHeight() - MARGIN;
      }

      drawSection(footer, columns, tableY, false, color);
      tableY -= footer.total;
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
