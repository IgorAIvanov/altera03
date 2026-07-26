/**
 * Code 128 — лінійний код змінної довжини для будь-якого ASCII.
 *
 * Основна символіка для обліку документів: номер накладної, код замовлення,
 * будь-який ідентифікатор, який має зчитуватися сканером із паперу.
 *
 * Реалізовано підмножину **Code B** (ASCII 32–127) плюс автоматичний перехід у
 * **Code C** для довгих цифрових ділянок — саме він удвічі стискає числа, а
 * номери документів у нас цифрові. Code A (керівні символи) не потрібен: у
 * друкованій формі їм нема чого робити.
 */

/**
 * Таблиця шаблонів: для кожного значення 0–106 — ширини елементів,
 * починаючи зі штриха (штрих, пропуск, штрих, пропуск, штрих, пропуск).
 *
 * Кожен шаблон 0–105 має рівно 11 модулів, стоп (106) — 13. Це перевіряється
 * тестом: одруківка в таблиці інакше вилізла б покрученим кодом на папері, а не
 * помилкою, і виявилася б аж на складі зі сканером у руках.
 */
const PATTERNS: string[] = [
  /*   0 */ "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  /*  10 */ "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  /*  20 */ "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  /*  30 */ "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  /*  40 */ "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  /*  50 */ "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  /*  60 */ "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  /*  70 */ "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  /*  80 */ "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  /*  90 */ "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  /* 100 */ "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

/** Службові значення. Start C стискає пари цифр в один символ. */
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

/** Скільки модулів тихої зони з кожного боку. Стандарт вимагає щонайменше 10. */
export const CODE128_QUIET_ZONE = 10;

const MIN_CHAR = 32;
const MAX_CHAR = 126;

/**
 * Довжина цифрової ділянки, з якої перехід у Code C вигідний.
 *
 * Перехід коштує один символ, а кожна пара цифр економить один. Тому на початку
 * рядка вигода починається з чотирьох цифр, усередині — з шести (треба ще й
 * повернутися в Code B). Менші ділянки лишаємо як є.
 */
function digitRunLength(value: string, from: number): number {
  let length = 0;
  while (from + length < value.length && value.charCodeAt(from + length) >= 48 && value.charCodeAt(from + length) <= 57) {
    length += 1;
  }
  return length;
}

/** Значення символів Code 128 для рядка — без старту, контрольної суми і стопа. */
function encodeSymbols(value: string): number[] {
  const symbols: number[] = [];
  let index = 0;
  // Стартовий символ вибирається за першою ділянкою, тому його додаємо нижче,
  // коли вже знаємо, в якому наборі починаємо.
  let mode: "B" | "C" | null = null;

  while (index < value.length) {
    const run = digitRunLength(value, index);
    // Ділянку беремо в Code C лише парною кількістю цифр: непарний «хвіст»
    // друкується в Code B, інакше остання цифра лишилася б без пари.
    const useC = mode === "C"
      ? run >= 2
      : run >= (index === 0 ? 4 : 6) || (index === 0 && run === value.length && run % 2 === 0);

    if (useC) {
      if (mode === null) {
        symbols.push(START_C);
      } else if (mode !== "C") {
        symbols.push(CODE_C);
      }
      mode = "C";

      const pairs = Math.floor(run / 2);
      for (let pair = 0; pair < pairs; pair += 1) {
        symbols.push(Number(value.slice(index, index + 2)));
        index += 2;
      }

      continue;
    }

    if (mode === null) {
      symbols.push(START_B);
    } else if (mode !== "B") {
      symbols.push(CODE_B);
    }
    mode = "B";

    // У Code B значення символу — це код ASCII мінус 32.
    const runEnd = run > 0 ? index + run : index + 1;
    const stop = run > 0 ? runEnd : Math.min(runEnd, value.length);
    for (let position = index; position < stop; position += 1) {
      symbols.push(value.charCodeAt(position) - MIN_CHAR);
    }
    index = stop;
  }

  return symbols;
}

export interface Code128Result {
  /** Модулі зліва направо: `true` — штрих. Тиха зона не входить. */
  modules: boolean[];
}

export class BarcodeValueError extends Error {}

/**
 * Кодує рядок у модулі Code 128.
 *
 * Кидає {@link BarcodeValueError} на порожньому рядку й на символах поза
 * ASCII 32–126: краще чесна помилка в шаблоні, ніж код, який сканер прочитає
 * інакше, ніж написано під ним.
 */
export function encodeCode128(value: string): Code128Result {
  if (!value) {
    throw new BarcodeValueError("Code 128: порожнє значення");
  }

  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < MIN_CHAR || code > MAX_CHAR) {
      throw new BarcodeValueError(`Code 128: символ «${char}» не кодується (лише ASCII 32–126)`);
    }
  }

  const symbols = encodeSymbols(value);

  // Контрольна сума: старт + сума значень із вагою позиції, за модулем 103.
  // Стартовий символ уже перший у списку, тому його вага 1 — як і належить.
  const checksum = symbols.reduce(
    (sum, symbol, position) => sum + symbol * (position === 0 ? 1 : position),
    0,
  ) % 103;

  const modules: boolean[] = [];
  for (const symbol of [...symbols, checksum, STOP]) {
    // Ширини йдуть парами «штрих, пропуск», починаючи зі штриха.
    let isBar = true;
    for (const width of PATTERNS[symbol]!) {
      for (let module = 0; module < Number(width); module += 1) {
        modules.push(isBar);
      }
      isBar = !isBar;
    }
  }

  return { modules };
}

/** Тільки для тестів: інваріанти таблиці шаблонів. */
export const CODE128_PATTERNS_FOR_TEST = PATTERNS;
