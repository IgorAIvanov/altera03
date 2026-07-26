/**
 * EAN-13 — товарний штрих-код: 12 значущих цифр плюс контрольна.
 *
 * Потрібен номенклатурі й ціннику; для документів використовується Code 128.
 *
 * Таблиця тут одна — набір L. Набори G і R виводяться з неї: R — побітове
 * доповнення L, G — R навпаки. Так менше шансів на одруківку, ніж у трьох
 * таблицях, і залежність між ними видно прямо в коді.
 */
import { BarcodeValueError } from "./code128.ts";

/** Набір L (ліва частина, непарна парність). `1` — штрих. */
const L_CODES = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];

const R_CODES = L_CODES.map((code) => [...code].map((bit) => (bit === "0" ? "1" : "0")).join(""));
const G_CODES = R_CODES.map((code) => [...code].reverse().join(""));

/**
 * Перша цифра числа не малюється власним символом — вона закодована **чергуванням
 * наборів** L і G у лівій половині. Саме тому EAN-13 має 13 цифр, а місця в коді
 * лише на 12.
 */
const PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

const GUARD_EDGE = "101";
const GUARD_CENTER = "01010";

/** Тиха зона: зліва 11 модулів, справа 7 — так вимагає стандарт. */
export const EAN13_QUIET_ZONE_LEFT = 11;
export const EAN13_QUIET_ZONE_RIGHT = 7;

/** Контрольна цифра для перших 12: ваги 1 і 3, доповнення до десятки. */
export function ean13Checksum(digits: string): number {
  const sum = [...digits.slice(0, 12)].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );

  return (10 - (sum % 10)) % 10;
}

export interface Ean13Result {
  modules: boolean[];
  /** Повні 13 цифр — саме вони друкуються під кодом. */
  text: string;
}

/**
 * Кодує 12 або 13 цифр у модулі EAN-13.
 *
 * 12 цифр — контрольна дораховується; 13 — перевіряється. Мовчазно виправляти
 * чужу контрольну цифру не можна: у даних лежить артикул, і розбіжність означає,
 * що помилка в довіднику, а не в друку.
 */
export function encodeEan13(value: string): Ean13Result {
  const digits = value.replace(/\s+/g, "");

  if (!/^\d{12,13}$/.test(digits)) {
    throw new BarcodeValueError(`EAN-13: потрібно 12 або 13 цифр, отримано «${value}»`);
  }

  const checksum = ean13Checksum(digits);
  if (digits.length === 13 && Number(digits[12]) !== checksum) {
    throw new BarcodeValueError(
      `EAN-13: контрольна цифра не сходиться (у значенні ${digits[12]}, має бути ${checksum})`,
    );
  }

  const full = digits.length === 13 ? digits : `${digits}${checksum}`;
  const parity = PARITY[Number(full[0])]!;

  let bits = GUARD_EDGE;
  for (let index = 0; index < 6; index += 1) {
    const digit = Number(full[index + 1]);
    bits += parity[index] === "L" ? L_CODES[digit]! : G_CODES[digit]!;
  }

  bits += GUARD_CENTER;
  for (let index = 7; index < 13; index += 1) {
    bits += R_CODES[Number(full[index])]!;
  }

  bits += GUARD_EDGE;

  return { modules: [...bits].map((bit) => bit === "1"), text: full };
}

/** Тільки для тестів: похідні набори мають лишатися узгодженими з L. */
export const EAN13_CODES_FOR_TEST = { L_CODES, G_CODES, R_CODES };
