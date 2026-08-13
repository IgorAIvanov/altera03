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
import { PRINT_FONT_BOLD_BASE64, PRINT_FONT_REGULAR_BASE64 } from "./fonts.generated.ts";

/** Аркуш A4 у пунктах. */
export const PRINT_PAGE_SIZE_A4: { width: number; height: number } = { width: 595.28, height: 841.89 };

/** Поле сторінки з усіх боків. */
export const PRINT_MARGIN = 40;

/** Внутрішній відступ комірки таблиці з кожного боку. */
export const PRINT_CELL_PADDING = 4;

/**
 * Ширина області друку — саме її ділять між собою колонки таблиці.
 *
 * Аркуш мінус поля з обох боків; для альбомної орієнтації сторони міняються
 * місцями. Константа тут навмисно не «515.28»: число залежить від двох інших,
 * і виписане окремо воно розійшлося б із ними на першій же зміні поля.
 */
export function printContentWidth(orientation: "portrait" | "landscape" = "portrait"): number {
  const width = orientation === "landscape" ? PRINT_PAGE_SIZE_A4.height : PRINT_PAGE_SIZE_A4.width;
  return width - PRINT_MARGIN * 2;
}

/** Ширина рядка в пунктах при заданому кеглі. */
export type PrintTextMeasurer = (text: string, fontSize: number, bold?: boolean) => number;

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
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

  const regular = await pdf.embedFont(decodeBase64(PRINT_FONT_REGULAR_BASE64));
  const bold = await pdf.embedFont(decodeBase64(PRINT_FONT_BOLD_BASE64));
  const regularAscii = await pdf.embedFont(StandardFonts.Helvetica);
  const boldAscii = await pdf.embedFont(StandardFonts.HelveticaBold);

  const runs = (text: string, isBold: boolean) => {
    const result: Array<{ text: string; font: PDFFont }> = [];
    const unicodeFont = isBold ? bold : regular;
    const asciiFont = isBold ? boldAscii : regularAscii;

    for (const char of text) {
      const font = char.codePointAt(0)! <= 0x7f ? asciiFont : unicodeFont;
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
