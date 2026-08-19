/**
 * Метрика тексту бланка — та сама, якою рендерер розкладає рядки.
 *
 * ЧОМУ ЦЕ ЗОВНІ. Значення, ширше за комірку, псує бланк мовчки: число ламається
 * на два рядки, а заголовок, чиє СЛОВО ширше за колонку, не переноситься
 * взагалі й лізе на сусідню. Побачити це можна лише з готового PDF — SQL
 * зелений, шаблон валідний, дані правильні. Рендерер при цьому все потрібне вже
 * рахує, тільки назовні йшли самі байти, тож застосунок не міг ані перевірити
 * верстку пробою, ані попередити адміністратора в редакторі шаблонів.
 *
 * Обійти це без ядра не виходило: щоб порахувати ширину, потрібен ШРИФТ (Roboto
 * пропорційний, «на кількість символів» не рахується), а він лежав у модулі,
 * якого публічний експорт не віддавав. Обхід зводився до імпорту з `vendor/` —
 * тобто до коду, який мовчки ламається на першому перейменуванні модуля в ядрі.
 *
 * ```ts
 * const measure = await createPrintTextMeasurer();
 * const usable = columnWidth - PRINT_CELL_PADDING * 2;
 *
 * measure("1 234 567.89", 9) <= usable;                       // значення влізе
 * headers.every((word) => measure(word, 9, true) <= usable);  // і кожне СЛОВО заголовка
 * ```
 *
 * Заголовок міряють саме по найдовшому слову, а не по всьому рядку: перенос іде
 * по словах, тож рядок із двох коротких слів розкладеться на два, а одне довге
 * не розкладеться ніяк.
 */
import { PDFDocument, type PDFFont, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  type PrintFontSubset,
  PRINT_FONT_SUBSETS_BOLD,
  PRINT_FONT_SUBSETS_REGULAR,
} from "./fonts.generated.ts";

/** Аркуш A4 у пунктах. */
export const PRINT_PAGE_SIZE_A4: { width: number; height: number } = { width: 595.28, height: 841.89 };

/** Поле сторінки з усіх боків. */
export const PRINT_MARGIN = 40;

/** Внутрішній відступ комірки таблиці з кожного боку. */
export const PRINT_CELL_PADDING = 4;

export type PrintOrientation = "portrait" | "landscape";

/**
 * Орієнтація, названа явно — або відмова.
 *
 * Доти невідоме значення означало «книжкова», і мовчки: виклик
 * `printContentWidth("A4", "landscape")` (аргументів у функції один) віддавав
 * 515.28 замість 761.89, а неправильними ставали ВСІ ширини, пораховані від
 * нього. Помилка при цьому не діагностується ніде, крім готового паперу, тож
 * тут єдиний безпечний бік — упасти.
 */
function pageBox(orientation: PrintOrientation): { width: number; height: number } {
  if (orientation !== "portrait" && orientation !== "landscape") {
    throw new TypeError(`Невідома орієнтація друку: ${JSON.stringify(orientation)}`);
  }

  return orientation === "landscape"
    ? { width: PRINT_PAGE_SIZE_A4.height, height: PRINT_PAGE_SIZE_A4.width }
    : PRINT_PAGE_SIZE_A4;
}

/**
 * Ширина області друку — саме її ділять між собою колонки таблиці.
 *
 * Аркуш мінус поля з обох боків; для альбомної орієнтації сторони міняються
 * місцями. Константа тут навмисно не «515.28»: число залежить від двох інших,
 * і виписане окремо воно розійшлося б із ними на першій же зміні поля.
 */
export function printContentWidth(orientation: PrintOrientation = "portrait"): number {
  return pageBox(orientation).width - PRINT_MARGIN * 2;
}

/**
 * Висота області друку — те, від чого рахується `yPercent` і `heightPercent`.
 *
 * Друга сторона потрібна нарівні з першою, бо відсотки в розкладці беруться від
 * РІЗНИХ сторін: `widthPercent` від ширини, `heightPercent` від висоти. Тому
 * розмір, який мусить бути однаковим по обох осях (квадратна клітинка, кругла
 * печатка), записується двома різними числами, і рахувати їх на око — це та
 * помилка, яку видно лише з паперу.
 */
export function printContentHeight(orientation: PrintOrientation = "portrait"): number {
  return pageBox(orientation).height - PRINT_MARGIN * 2;
}

/** Ширина рядка в пунктах при заданому кеглі. */
export type PrintTextMeasurer = (text: string, fontSize: number, bold?: boolean) => number;

/**
 * Розкласти текст по рядках заданої ширини — ОДНЕ правило переносу на весь друк.
 *
 * Тут воно тому, що читачів у нього два: рендерер, який малює, і рахівник ширин
 * колонок, який вирішує, скільки кожній дати. Дві копії цього правила розійшлися
 * б мовчки — ширина рахувалася б за одним переносом, а на папір ліг би інший, і
 * побачити це можна було б лише з готового PDF.
 *
 * Три речі, які воно вміє, і кожна з них — з болю:
 *
 * **Поважає явний `\n`.** У затверджених формах підписи довгі
 * («сільськогосподарська»), і той, хто малює бланк, часто знає краще за
 * алгоритм, де рядок має розірватися. Доти єдиним способом було вставити
 * пробіли з дефісами прямо в текст («сіль- сько- госпо- дарська») — тобто
 * зіпсувати дані заради верстки.
 *
 * **Розриває слово, ширше за комірку.** Доти таке слово не переносилося взагалі
 * й вилазило на сусідню колонку: сітка намальована, текст поверх неї, і бланк
 * зіпсований мовчки. Розрив некрасивий, але він у МЕЖАХ комірки, а вихід за
 * межі не має жодного правильного прочитання.
 *
 * **Ніколи не віддає порожній список.** Порожній текст — це один порожній
 * рядок: висота комірки рахується від кількості рядків, і нуль тут означав би
 * комірку без висоти.
 */
export function wrapPrintText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    const words = paragraph.split(/[ \t]+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      // Саме слово може не влізти й саме по собі — тоді ріжемо його.
      const pieces = breakLongWord(word, maxWidth, measure);
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1]!;
    }
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

/**
 * Порізати слово на шматки, що влазять у ширину.
 *
 * Символ за раз, а не двійковим пошуком: рядок може складатися з відрізків
 * різними шрифтами (кирилиця Roboto, латиниця Helvetica), тож ширина не є сумою
 * ширин символів, і «поділити навпіл» тут не працює. Слова, які доводиться
 * різати, короткі за визначенням — довгих у бланках не буває.
 *
 * Один символ у рядок кладеться беззастережно, навіть якщо не влазить і він:
 * інакше вузька колонка зациклила б розбір.
 */
function breakLongWord(word: string, maxWidth: number, measure: (value: string) => number): string[] {
  if (measure(word) <= maxWidth) return [word];

  const pieces: string[] = [];
  let piece = "";

  for (const char of word) {
    const candidate = piece + char;
    if (piece && measure(candidate) > maxWidth) {
      pieces.push(piece);
      piece = char;
      continue;
    }
    piece = candidate;
  }

  if (piece) pieces.push(piece);
  return pieces.length ? pieces : [word];
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Коди, які покриває WinAnsiEncoding — тобто Helvetica з `StandardFonts`.
 *
 * Латиниця-1 плюс те, що WinAnsi тримає у слотах 0x80–0x9F: лапки, тире,
 * апостроф, три крапки. Саме через цей набір ялинки й друкуються правильно —
 * у Roboto-субсеті їх немає, а тут є.
 *
 * Набір потрібен не заради краси, а заради відмови: pdf-lib падає, коли просиш
 * стандартний шрифт намалювати символ, якого в його кодуванні немає. Тобто без
 * цієї перевірки «віддамо все незнайоме Helvetice» валило б увесь друк.
 */
const WIN_ANSI_EXTRA = new Set([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
  0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
]);

function inWinAnsi(codePoint: number): boolean {
  return (codePoint >= 0x20 && codePoint <= 0x7E) ||
    (codePoint >= 0xA0 && codePoint <= 0xFF) ||
    WIN_ANSI_EXTRA.has(codePoint);
}

function subsetCovers(subset: PrintFontSubset, codePoint: number): boolean {
  return subset.ranges.some(([from, to]) => codePoint >= from && codePoint <= to);
}

/**
 * Який шрифт малює цей символ: `-1` — Helvetica, інакше індекс субсета Roboto.
 *
 * ЧОМУ ЦЕ ОКРЕМА ЧИСТА ФУНКЦІЯ. Тут сидів дефект, який не бачив ніхто: шрифт
 * вибирався за межею `код <= 0x7F`, тобто все, що вище, їхало в Roboto. Лапка
 * `«` — U+00AB, вище межі, у кирилічному субсеті її немає, і назва «ТОВ «Демо»»
 * друкувалася сміттям. У КОЖНОМУ бланку, бо лапки має назва будь-якої
 * української юрособи. Іронія була в тому, що Helvetica ці символи має —
 * питання просто ставилося не те: не «чи це ASCII», а «чи є гліф».
 *
 * Винесено з рендеру, щоб бути під пробою без pdf-lib: правило, яке видно лише
 * на надрукованому папері, мусить перевірятися інакше.
 *
 * Порядок правил: ASCII завжди Helvetica (так метрики збігаються з очікуваннями
 * pdf-lib), далі перший субсет, що покриває символ, далі Helvetica, якщо код у
 * WinAnsi. Останній рядок — не «правильний шрифт», а свідома відмова падати:
 * символ, якого немає ніде, друкується порожньою рамкою, а не валить документ.
 * Друк — остання ланка, і людина, яка натиснула «Друк», однаково не полагодить
 * шрифт.
 */
export function printFontIndexFor(codePoint: number, bold = false): number {
  if (codePoint <= 0x7F) return -1;

  const subsets = bold ? PRINT_FONT_SUBSETS_BOLD : PRINT_FONT_SUBSETS_REGULAR;
  const index = subsets.findIndex((subset) => subsetCovers(subset, codePoint));
  if (index >= 0) return index;

  return inWinAnsi(codePoint) ? -1 : 0;
}

/**
 * Шрифти бланка, вбудовані в документ.
 *
 * Не експортується з пакета навмисно: типи pdf-lib у публічній поверхні
 * `@altera/server` не потрібні нікому, крім самого рендерера, а `exports` тягне
 * за собою і сумісність, і перевірку «повільних типів» на JSR.
 */
export interface PrintFontSet {
  /** Розбивка рядка на відрізки з їхніми шрифтами (кирилиця/латиниця). */
  runs(text: string, bold: boolean): Array<{ text: string; font: PDFFont }>;
  measure: PrintTextMeasurer;
}

/**
 * Вбудувати шрифти бланка в документ і зібрати з них метрику.
 *
 * Кирилиця йде Roboto, латиниця — Helvetica: так метрики ASCII збігаються з
 * очікуваннями pdf-lib, а кирилиця не перетворюється на «крякозябри». Саме тому
 * ширину не порахувати «приблизно»: рядок може розпастися на кілька відрізків
 * різними шрифтами, і сума їхніх ширин — єдина правильна відповідь.
 */
export async function embedPrintFonts(pdf: PDFDocument): Promise<PrintFontSet> {
  pdf.registerFontkit(fontkit);

  const regular: PDFFont[] = [];
  for (const subset of PRINT_FONT_SUBSETS_REGULAR) {
    regular.push(await pdf.embedFont(decodeBase64(subset.base64)));
  }

  const bold: PDFFont[] = [];
  for (const subset of PRINT_FONT_SUBSETS_BOLD) {
    bold.push(await pdf.embedFont(decodeBase64(subset.base64)));
  }

  const regularAscii = await pdf.embedFont(StandardFonts.Helvetica);
  const boldAscii = await pdf.embedFont(StandardFonts.HelveticaBold);

  const runs = (text: string, isBold: boolean) => {
    const result: Array<{ text: string; font: PDFFont }> = [];
    const embedded = isBold ? bold : regular;
    const asciiFont = isBold ? boldAscii : regularAscii;

    for (const char of text) {
      const index = printFontIndexFor(char.codePointAt(0)!, isBold);
      const font = index < 0 ? asciiFont : embedded[index]!;
      const previous = result[result.length - 1];
      if (previous?.font === font) {
        previous.text += char;
        continue;
      }
      result.push({ text: char, font });
    }

    return result;
  };

  return {
    runs,
    measure: (text, fontSize, isBold = false) =>
      runs(text, isBold).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, fontSize), 0),
  };
}

/**
 * Вимірювач рядків бланка — публічний вхід для проб застосунку й редактора.
 *
 * Асинхронний, бо шрифт треба вбудувати в документ pdf-lib; сам документ
 * викидається, лишається тільки метрика. Створювати вимірювач варто ОДИН раз
 * на прогін: вбудовування шрифту коштує помітно більше, ніж усі вимірювання
 * разом.
 */
export async function createPrintTextMeasurer(): Promise<PrintTextMeasurer> {
  const pdf = await PDFDocument.create();
  const fonts = await embedPrintFonts(pdf);
  return fonts.measure;
}
