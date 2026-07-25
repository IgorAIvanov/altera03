/**
 * Мінімальний письменник .xlsx — рівно стільки OOXML, скільки треба звіту.
 *
 * Чому руками, а не бібліотекою: справжній .xlsx — це zip з кількох XML-частин,
 * і для аркуша «шапка + рядки + підсумки» їх набір фіксований. Пакування —
 * `store` (без стиснення), тому zip зводиться до CRC32 і трьох заголовків, а
 * бібліотека стиснення не потрібна взагалі. Ціна такого файлу — трохи більший
 * розмір; вигода — жодної залежності ні в клієнті, ні на сервері, і експорт
 * лишається чисто клієнтським (дані вже в `$root`, другий запит не потрібен).
 *
 * Що вміє: текст і числа (числа — числами, тож Excel їх додає), формат
 * `#,##0.00` для сум, жирна шапка з фоном, об'єднані комірки, закріплення
 * шапки, ширини колонок. Чого немає: кілька аркушів, формули, картинки —
 * звітам вони не потрібні, а кожна така фіча коштує ще однієї частини пакета.
 */

/** Комірка аркуша. `value` заданий → у файл іде число, інакше текст. */
export interface SheetCell {
  text: string;
  /** Числове значення (сума, кількість). Порожній рядок ≠ 0: тоді комірка пуста. */
  value?: number;
  bold?: boolean;
  align?: "left" | "right" | "center";
  /** Формат числа Excel; за замовчуванням `#,##0.00` для чисел з дробом. */
  numeric?: boolean;
  colSpan?: number;
  rowSpan?: number;
  /**
   * Оформлення поза сіткою таблиці: `title` — назва звіту (жирний, без рамок і
   * фону), `plain` — просто текст. Без цього назва звіту приїжджала б із
   * блакитним фоном шапки, бо фон і жирність в аркуші йдуть одним стилем.
   */
  style?: "title" | "plain";
}

export interface SheetModel {
  rows: SheetCell[][];
  /** Ширини колонок у символах. */
  colWidths: number[];
  /** Скільки перших рядків — шапка (закріплюються при прокрутці). */
  headerRows: number;
}

// ── XML ─────────────────────────────────────────────────────────────────────

function xml(value: string): string {
  return value
    // Керуючі символи в XML 1.0 недопустимі навіть екранованими — Excel на них
    // скаржиться «unreadable content», тому вирізаємо, а не escape-имо.
    // deno-lint-ignore no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Номер колонки → літерна адреса Excel: 1 → A, 27 → AA. */
export function colName(index: number): string {
  let n = index;
  let name = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * Стиль назви звіту йде останнім у `cellXfs`: 0 — «нормальний», 1…12 — сітка
 * (жирність × число × вирівнювання), 13 — назва.
 */
const TITLE_XF = 13;

/**
 * Індекс стилю в `cellXfs`. Порядок згенерованих xf-ів фіксований (див.
 * `stylesXml`), тому індекс рахується, а не шукається.
 */
function styleIndex(cell: SheetCell): number {
  // xf 0 лишаємо «нормальним» (без рамки) — на нього посилається cellStyles.
  if (cell.style === "plain") return 0;
  if (cell.style === "title") return TITLE_XF;
  const align = cell.align === "right" ? 1 : cell.align === "center" ? 2 : 0;
  const bold = cell.bold ? 1 : 0;
  const num = cell.numeric ? 1 : 0;
  return 1 + bold * 6 + num * 3 + align;
}

function sheetXml(model: SheetModel): string {
  const lastCol = colName(Math.max(1, model.colWidths.length));
  const lastRow = Math.max(1, model.rows.length);

  const cols = model.colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  const merges: string[] = [];
  // Клітинки, перекриті об'єднанням із рядка вище: ключ "рядок:колонка". Без
  // цього другий рядок шапки з'їжджає ліворуч, під вертикально об'єднані
  // колонки, і файл відкривається з переплутаними колонками.
  const taken = new Set<string>();

  const rows = model.rows.map((cells, rowIdx) => {
    const r = rowIdx + 1;
    let col = 1;
    const body = cells.map((cell) => {
      while (taken.has(`${r}:${col}`)) col++;

      const ref = `${colName(col)}${r}`;
      const cs = cell.colSpan ?? 1;
      const rs = cell.rowSpan ?? 1;
      if (cs > 1 || rs > 1) {
        merges.push(`<mergeCell ref="${ref}:${colName(col + cs - 1)}${r + rs - 1}"/>`);
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (dr > 0 || dc > 0) taken.add(`${r + dr}:${col + dc}`);
          }
        }
      }
      col += cs;
      const s = styleIndex(cell);
      if (cell.value !== undefined) return `<c r="${ref}" s="${s}"><v>${cell.value}</v></c>`;
      if (!cell.text) return `<c r="${ref}" s="${s}"/>`;
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`;
    }).join("");
    return `<row r="${r}">${body}</row>`;
  }).join("");

  // Закріплення шапки: pane йде лише коли є що закріпляти — Excel не любить
  // frozen-пейн з ySplit="0".
  const pane = model.headerRows > 0
    ? `<pane ySplit="${model.headerRows}" topLeftCell="A${model.headerRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : "";

  // Порядок елементів у worksheet визначений схемою: dimension → sheetViews →
  // sheetFormatPr → cols → sheetData → mergeCells. Переставиш — файл не
  // відкриється.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0" tabSelected="1">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="14"/>${
    cols ? `<cols>${cols}</cols>` : ""
  }<sheetData>${rows}</sheetData>${
    merges.length ? `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>` : ""
  }</worksheet>`;
}

function stylesXml(): string {
  const aligns = [
    `<alignment vertical="center" wrapText="1"/>`,
    `<alignment horizontal="right" vertical="center"/>`,
    `<alignment horizontal="center" vertical="center" wrapText="1"/>`,
  ];
  const xfs: string[] = [`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`];
  for (const bold of [0, 1]) {
    for (const num of [0, 1]) {
      for (const align of aligns) {
        xfs.push(
          `<xf numFmtId="${num ? 164 : 0}" fontId="${bold}" fillId="${bold ? 2 : 0}" borderId="1" xfId="0"` +
            ` applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"${num ? ' applyNumberFormat="1"' : ""}>` +
            `${align}</xf>`,
        );
      }
    }
  }
  // Назва звіту: жирна, але без рамки й фону — має бути видно, що це підпис до
  // таблиці, а не її перший рядок.
  xfs.push(`<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>`);

  const thin = (side: string) => `<${side} style="thin"><color rgb="FFB8C3CC"/></${side}>`;
  const border = `<border>${thin("left")}${thin("right")}${thin("top")}${thin("bottom")}</border>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3EAF0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/>${border}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${
    xfs.join("")
  }</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

/** Ім'я аркуша: Excel забороняє `\ / * ? : [ ]` і довжину понад 31 символ. */
function sheetName(raw: string): string {
  const clean = raw.replace(/[\\/*?:[\]]/g, " ").trim();
  return clean.slice(0, 31) || "Report";
}

// ── ZIP (метод store) ───────────────────────────────────────────────────────

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Дата у zip-заголовках — константа (2020-01-01), а не «зараз»: файл, зібраний
 * з тих самих даних, лишається побайтово тим самим, тож його можна порівнювати
 * в тестах. Excel цю мітку не показує ніде, де вона мала б значення.
 */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

interface ZipEntry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
}

function zipStore(files: { name: string; text: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };

  for (const file of files) {
    const name = enc.encode(file.name);
    const data = enc.encode(file.text);
    const crc = crc32(data);
    entries.push({ name, data, crc, offset });

    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);       // версія
    head.setUint16(6, 0x0800, true);   // прапорець: імена в UTF-8
    head.setUint16(8, 0, true);        // метод: store
    head.setUint16(10, DOS_TIME, true);
    head.setUint16(12, DOS_DATE, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    push(new Uint8Array(head.buffer));
    push(name);
    push(data);
  }

  const cdOffset = offset;
  for (const entry of entries) {
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, 0x0800, true);
    head.setUint16(10, 0, true);
    head.setUint16(12, DOS_TIME, true);
    head.setUint16(14, DOS_DATE, true);
    head.setUint32(16, entry.crc, true);
    head.setUint32(20, entry.data.length, true);
    head.setUint32(24, entry.data.length, true);
    head.setUint16(28, entry.name.length, true);
    head.setUint16(30, 0, true);
    head.setUint16(32, 0, true);
    head.setUint16(34, 0, true);
    head.setUint16(36, 0, true);
    head.setUint32(38, 0, true);
    head.setUint32(42, entry.offset, true);
    push(new Uint8Array(head.buffer));
    push(entry.name);
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, offset - cdOffset, true);
  end.setUint32(16, cdOffset, true);
  push(new Uint8Array(end.buffer));

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// ── Публічне API ────────────────────────────────────────────────────────────

/** Модель аркуша → байти .xlsx. */
export function buildXlsx(name: string, model: SheetModel): Uint8Array {
  const title = sheetName(name);
  return zipStore([
    {
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${
        xml(title)
      }" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", text: stylesXml() },
    { name: "xl/worksheets/sheet1.xml", text: sheetXml(model) },
  ]);
}

/** Ім'я файлу без символів, недопустимих у файловій системі. */
export function safeFileName(raw: string): string {
  return raw.replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, "_").slice(0, 80) || "report";
}

/**
 * Віддати байти користувачеві як файл. У браузері іншого способу немає:
 * посилання з `download`, клік по ньому і звільнення URL.
 */
export function downloadFile(bytes: Uint8Array, fileName: string, mimeType: string): void {
  // Копія в окремий ArrayBuffer: Blob не приймає Uint8Array поверх SharedArrayBuffer,
  // а типи в TS 5.7+ це розрізняють.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Синхронний revoke ламає завантаження у Firefox — віддаємо один тік.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
