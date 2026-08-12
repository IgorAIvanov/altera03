/**
 * Сума прописом — обов'язковий рядок регламентованих бланків (касовий ордер,
 * платіжне доручення, довіреність), і саме той, який кожен застосунок доти
 * писав собі сам.
 *
 * Чому в ядрі, а не в застосунку: ядро вже вимагає від застосунку готові рядки
 * («рендерер не форматує»), тож єдине текстове перетворення, якого без
 * бібліотеки не написати за п'ять хвилин, лишати застосунку непослідовно. Але
 * головне інше — **тут кожен помиляється однаково**, і жодна з помилок не
 * видно на тестовому 1234,56:
 *
 *  - рід належить РОЗРЯДУ, а не числу: «дві тисячі», але «два мільйони»;
 *  - форма назви вибирається за ДВОМА останніми цифрами: 111 закінчується
 *    одиницею, але це «гривень»;
 *  - порожній розряд гривень усе одно називається: 1000 — «одна тисяча
 *    гривень», а не «одна тисяча».
 *
 * Чому не залежністю: `n2words` уміє все перелічене (звірено на 2011 числах —
 * розбіжностей немає), але його `toCurrency` не приймає валюти (вона зашита в
 * мовний модуль), а копійки пише словами, тоді як на бланку стандарт «56 коп.».
 * Латати чужий вивід рядковими операціями заради двох відмінностей дорожче за
 * ці рядки, а залежність в опублікованому пакеті дістається кожному застосунку
 * назавжди.
 *
 * Розрахунок чистий і без DOM/БД — з тієї самої причини, що символіки
 * штрих-кодів поруч: він перевіряється таблицею випадків у `deno task
 * test:unit`, а не оком на одному числі.
 */

/** Рід розряду: від нього залежить «один/одна» і «два/дві». */
type Gender = "m" | "f";

/** Три форми слов'янської назви: 1 / 2-4 / 5-0 — вибір за двома останніми цифрами. */
type SlavicForms = readonly [string, string, string];

interface SlavicVocab {
  units: Record<Gender, readonly string[]>;
  teens: readonly string[];
  tens: readonly string[];
  hundreds: readonly string[];
  /** Розряди від тисяч і вище; рід тут — властивість РОЗРЯДУ, не числа. */
  ranks: readonly { forms: SlavicForms; gender: Gender }[];
  zero: string;
  minus: string;
}

interface SlavicCurrency {
  major: SlavicForms;
  /** «одна гривня», але «один долар» — рід основної одиниці. */
  majorGender: Gender;
  /** Скорочення дрібної одиниці: на бланку вона цифрами, а не словами. */
  minorAbbr: string;
}

interface EnglishCurrency {
  one: string;
  many: string;
  minorAbbr: string;
}

const UK: SlavicVocab = {
  units: {
    m: ["", "один", "два", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"],
    f: ["", "одна", "дві", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"],
  },
  teens: [
    "десять", "одинадцять", "дванадцять", "тринадцять", "чотирнадцять",
    "п'ятнадцять", "шістнадцять", "сімнадцять", "вісімнадцять", "дев'ятнадцять",
  ],
  tens: [
    "", "", "двадцять", "тридцять", "сорок", "п'ятдесят",
    "шістдесят", "сімдесят", "вісімдесят", "дев'яносто",
  ],
  hundreds: [
    "", "сто", "двісті", "триста", "чотириста",
    "п'ятсот", "шістсот", "сімсот", "вісімсот", "дев'ятсот",
  ],
  ranks: [
    { forms: ["тисяча", "тисячі", "тисяч"], gender: "f" },
    { forms: ["мільйон", "мільйони", "мільйонів"], gender: "m" },
    { forms: ["мільярд", "мільярди", "мільярдів"], gender: "m" },
  ],
  zero: "нуль",
  minus: "мінус",
};

/**
 * Російська відрізняється від української не лише словами: у формі 2-4 там
 * родовий однини («два миллиона»), а не називний множини («два мільйони»).
 * Саме тому мови розведені словниками, а не одним із заміною літер.
 */
const RU: SlavicVocab = {
  units: {
    m: ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
    f: ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
  },
  teens: [
    "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать",
    "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать",
  ],
  tens: [
    "", "", "двадцать", "тридцать", "сорок", "пятьдесят",
    "шестьдесят", "семьдесят", "восемьдесят", "девяносто",
  ],
  hundreds: [
    "", "сто", "двести", "триста", "четыреста",
    "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот",
  ],
  ranks: [
    { forms: ["тысяча", "тысячи", "тысяч"], gender: "f" },
    { forms: ["миллион", "миллиона", "миллионов"], gender: "m" },
    { forms: ["миллиард", "миллиарда", "миллиардов"], gender: "m" },
  ],
  zero: "ноль",
  minus: "минус",
};

const EN_UNITS = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];

const EN_TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];

const EN_SCALES = ["thousand", "million", "billion"];

/**
 * Валюти, для яких форми названі — окремо в кожній мові.
 *
 * Незнайома валюта — ВІДМОВА, а не здогадка з коду ISO: неправильне слово на
 * бланку робить бланк недійсним, і побачить це не той, хто друкував. Додати
 * валюту — це кілька слів тут і рядок у таблиці проб; назвати їх мусить той,
 * хто відповідає за формулювання.
 */
const SLAVIC_CURRENCIES: Record<string, Record<string, SlavicCurrency>> = {
  uk: {
    UAH: { major: ["гривня", "гривні", "гривень"], majorGender: "f", minorAbbr: "коп." },
  },
  ru: {
    UAH: { major: ["гривна", "гривны", "гривен"], majorGender: "f", minorAbbr: "коп." },
  },
};

const EN_CURRENCIES: Record<string, EnglishCurrency> = {
  UAH: { one: "hryvnia", many: "hryvnias", minorAbbr: "kop." },
};

/** Стеля — три розряди понад тисячу. Вище бланків не буває, а мовчки обрізати не можна. */
const MAX_MAJOR = 999_999_999_999;

/**
 * Вибір слов'янської форми за двома останніми цифрами.
 *
 * Саме за двома: 11, 12, 13, 14 поводяться як «багато», хоч і закінчуються на
 * 1-4. Перевірка лише за останньою цифрою — класична помилка, і на числах до
 * десяти вона не видно.
 */
function slavicPlural(n: number, forms: SlavicForms): string {
  const tail100 = n % 100;
  const tail10 = n % 10;
  if (tail100 >= 11 && tail100 <= 14) return forms[2];
  if (tail10 === 1) return forms[0];
  if (tail10 >= 2 && tail10 <= 4) return forms[1];
  return forms[2];
}

/** Трійка (1..999) словами в потрібному роді. */
function slavicTriplet(value: number, gender: Gender, vocab: SlavicVocab): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;

  if (hundreds) words.push(vocab.hundreds[hundreds]);

  if (rest >= 10 && rest <= 19) {
    words.push(vocab.teens[rest - 10]);
  } else {
    const tens = Math.floor(rest / 10);
    const units = rest % 10;
    if (tens) words.push(vocab.tens[tens]);
    if (units) words.push(vocab.units[gender][units]);
  }

  return words;
}

/** Розбір числа на трійки — спільний для обох сімей мов. */
function triplets(value: number): number[] {
  const parts: number[] = [];
  let rest = value;
  while (rest > 0) {
    parts.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  return parts;
}

function slavicInteger(value: number, gender: Gender, vocab: SlavicVocab): string[] {
  if (value === 0) return [vocab.zero];

  const parts = triplets(value);
  const words: string[] = [];

  for (let index = parts.length - 1; index >= 0; index--) {
    const triplet = parts[index];
    if (triplet === 0) continue;
    // index 0 — сама одиниця (гривні), тож рід приходить іззовні.
    const rank = index > 0 ? vocab.ranks[index - 1] : null;
    words.push(...slavicTriplet(triplet, rank ? rank.gender : gender, vocab));
    if (rank) words.push(slavicPlural(triplet, rank.forms));
  }

  return words;
}

/**
 * Англійська трійка. Дефіс у «twenty-one» — не косметика: без нього рядок
 * читається як два окремі числа.
 */
function englishTriplet(value: number): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;

  if (hundreds) words.push(EN_UNITS[hundreds], "hundred");

  if (rest < 20) {
    if (rest) words.push(EN_UNITS[rest]);
  } else {
    const tens = EN_TENS[Math.floor(rest / 10)];
    const units = rest % 10;
    words.push(units ? `${tens}-${EN_UNITS[units]}` : tens);
  }

  return words;
}

function englishInteger(value: number): string[] {
  if (value === 0) return ["zero"];

  const parts = triplets(value);
  const words: string[] = [];

  for (let index = parts.length - 1; index >= 0; index--) {
    const triplet = parts[index];
    if (triplet === 0) continue;
    words.push(...englishTriplet(triplet));
    // Розряд у множину не ставиться: «two thousand», не «two thousands».
    if (index > 0) words.push(EN_SCALES[index - 1]);
  }

  return words;
}

/**
 * Розбір суми на цілу й дробову частини БЕЗ плаваючої крапки.
 *
 * Рядок приймається навмисно: з бази `numeric` приходить рядком, і перегін
 * через `number` — це те місце, де 1234.56 стає 1234.5599999999999. Округлення
 * половини — вгору, як в обліку.
 */
function splitAmount(amount: number | string): { negative: boolean; major: number; minor: number } {
  const text = typeof amount === "string" ? amount.trim() : String(amount);
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new Error(`Сума прописом: «${text}» не число`);
  }

  const negative = text.startsWith("-");
  const [wholePart, fractionPart = ""] = text.replace("-", "").split(".");
  const fraction = (fractionPart + "00").slice(0, 3);
  let major = Number(wholePart);
  let minor = Math.round(Number(fraction) / 10);

  // Округлення могло переповнити дрібну частину: 0.999 → 100 копійок.
  if (minor >= 100) {
    minor -= 100;
    major += 1;
  }

  if (major > MAX_MAJOR) {
    throw new Error(`Сума прописом: ${text} більша за межу ${MAX_MAJOR}`);
  }

  return { negative, major, minor };
}

/** Мови, у яких названі числівники. Незнайома — відмова, а не тихий фолбек. */
export const AMOUNT_IN_WORDS_LOCALES = ["uk", "ru", "en"] as const;
export type AmountInWordsLocale = typeof AMOUNT_IN_WORDS_LOCALES[number];

export interface AmountInWordsOptions {
  /**
   * Мова бланка. Граматика числівників — це алгоритм, а не словник, тож нова
   * мова тут єдине місце у фреймворку, яке вимагає релізу пакета.
   */
  locale?: string;
  /** Код ISO 4217. Незнайомий — відмова. */
  currency?: string;
}

/**
 * Сума прописом: `1234.56` → `Одна тисяча двісті тридцять чотири гривні 56 коп.`
 *
 * Перша літера велика — рядок на бланку самостійний, а не частина речення.
 * Копійки цифрами: так на регламентованих формах, і так їх читає той, хто
 * звіряє суму з цифровим полем поруч.
 */
export function amountInWords(
  amount: number | string,
  options: AmountInWordsOptions = {},
): string {
  const locale = (options.locale || "uk") as AmountInWordsLocale;
  const code = (options.currency || "UAH").toUpperCase();
  const { negative, major, minor } = splitAmount(amount);

  let words: string[];
  let minorAbbr: string;

  if (locale === "en") {
    const currency = EN_CURRENCIES[code];
    if (!currency) throw new Error(`Сума прописом: валюта «${code}» не оголошена для мови «${locale}»`);
    words = [
      ...(negative ? ["minus"] : []),
      ...englishInteger(major),
      major === 1 ? currency.one : currency.many,
    ];
    minorAbbr = currency.minorAbbr;
  } else if (locale === "uk" || locale === "ru") {
    const vocab = locale === "uk" ? UK : RU;
    const currency = SLAVIC_CURRENCIES[locale][code];
    if (!currency) throw new Error(`Сума прописом: валюта «${code}» не оголошена для мови «${locale}»`);
    words = [
      ...(negative ? [vocab.minus] : []),
      ...slavicInteger(major, currency.majorGender, vocab),
      slavicPlural(major, currency.major),
    ];
    minorAbbr = currency.minorAbbr;
  } else {
    throw new Error(`Сума прописом: мова «${locale}» не підтримується`);
  }

  const text = words.join(" ");
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  return `${capitalized} ${String(minor).padStart(2, "0")} ${minorAbbr}`;
}
