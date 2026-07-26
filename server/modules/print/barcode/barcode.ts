/**
 * Штрих-коди друкованих форм: один вхід на всі символіки.
 *
 * Модуль нічого не малює — він віддає **фігуру** (набір модулів), а прямокутники
 * з неї робить рендерер. Завдяки цьому один і той самий код лягає і в PDF, і в
 * будь-який інший вивід, якщо він колись з'явиться.
 *
 * Чому Code 128 і EAN-13 написані тут, а QR узятий залежністю: перші два — це
 * таблиця шаблонів і контрольна сума, тобто десятки рядків, які легко перевірити
 * інваріантами. QR — це коди Ріда — Соломона, вибір версії й вісім масок; писати
 * це з голови без еталонного декодера означає з високою ймовірністю отримати код,
 * який виглядає правильним і не читається. Тому матрицю дає `qrcode-generator`
 * (без власних залежностей), а малюємо її все одно самі.
 */
import qrcode from "qrcode-generator";
import { BarcodeValueError, CODE128_QUIET_ZONE, encodeCode128 } from "./code128.ts";
import { EAN13_QUIET_ZONE_LEFT, EAN13_QUIET_ZONE_RIGHT, encodeEan13 } from "./ean13.ts";
import type { BarcodeSymbology } from "./symbology.ts";

export { BarcodeValueError } from "./code128.ts";
export { BARCODE_SYMBOLOGIES, normalizeBarcodeSymbology } from "./symbology.ts";
export type { BarcodeSymbology } from "./symbology.ts";

/**
 * Лінійний код: смуга модулів зліва направо плюс тихі зони.
 *
 * Тихі зони входять у `modules` навмисно — інакше при вписуванні коду в рамку
 * блока вони б з'їдалися розкладкою, і код перестав би зчитуватися рівно там, де
 * дизайнер поставив його впритул до краю.
 */
export interface LinearBarcodeShape {
  kind: "linear";
  modules: boolean[];
  /** Що друкувати під кодом. Для EAN-13 — з дорахованою контрольною цифрою. */
  text: string;
}

/** Матричний код: квадрат `size × size`, рядок за рядком. Тиха зона включена. */
export interface MatrixBarcodeShape {
  kind: "matrix";
  size: number;
  modules: boolean[];
  text: string;
}

export type BarcodeShape = LinearBarcodeShape | MatrixBarcodeShape;

export type BarcodeBuildResult =
  | { ok: true; shape: BarcodeShape }
  | { ok: false; message: string };

/** Тиха зона QR — рівно 4 модулі з кожного боку. */
const QR_QUIET_ZONE = 4;

/**
 * Рівень корекції M: приблизно 15 % площі коду можна втратити.
 *
 * Саме він, а не мінімальний L: друкована форма живе на папері, який мнуть,
 * ксерять і сканують під кутом. Вищі рівні (Q, H) роздули б код без потреби.
 */
const QR_ERROR_CORRECTION = "M";

function withQuietZone(modules: boolean[], left: number, right: number): boolean[] {
  return [...new Array<boolean>(left).fill(false), ...modules, ...new Array<boolean>(right).fill(false)];
}

function buildQr(value: string): MatrixBarcodeShape {
  // Без цього рядка бібліотека кодує рядок у Latin-1, і будь-яка кирилиця в QR
  // перетворюється на знаки питання. Присвоєння глобальне для модуля, тому
  // робимо його тут, а не на кожен виклик.
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

  // 0 — «підібрати найменшу версію, у яку влізе». Далі бібліотека кине помилку,
  // якщо не влізе навіть у сорокову: її ловить `buildBarcode`.
  const qr = qrcode(0, QR_ERROR_CORRECTION);
  qr.addData(value);
  qr.make();

  const count = qr.getModuleCount();
  const size = count + QR_QUIET_ZONE * 2;
  const modules = new Array<boolean>(size * size).fill(false);

  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (qr.isDark(row, column)) {
        modules[(row + QR_QUIET_ZONE) * size + (column + QR_QUIET_ZONE)] = true;
      }
    }
  }

  return { kind: "matrix", size, modules, text: value };
}

/**
 * Будує фігуру коду. Помилку не кидає, а повертає повідомленням: у друкованій
 * формі значення приходить із даних, і одне зіпсоване поле не має валити весь
 * документ — рендерер надрукує причину на місці коду.
 */
export function buildBarcode(symbology: BarcodeSymbology, value: string): BarcodeBuildResult {
  const normalized = value.trim();
  if (!normalized) {
    return { ok: false, message: "Немає значення для штрих-коду" };
  }

  try {
    if (symbology === "qr") {
      return { ok: true, shape: buildQr(normalized) };
    }

    if (symbology === "ean13") {
      const { modules, text } = encodeEan13(normalized);
      return {
        ok: true,
        shape: {
          kind: "linear",
          modules: withQuietZone(modules, EAN13_QUIET_ZONE_LEFT, EAN13_QUIET_ZONE_RIGHT),
          text,
        },
      };
    }

    const { modules } = encodeCode128(normalized);
    return {
      ok: true,
      shape: {
        kind: "linear",
        modules: withQuietZone(modules, CODE128_QUIET_ZONE, CODE128_QUIET_ZONE),
        text: normalized,
      },
    };
  } catch (error) {
    // Помилка значення — текст користувачеві; будь-яка інша теж не має валити
    // друк, але її варто бачити в логу.
    if (error instanceof BarcodeValueError) {
      return { ok: false, message: error.message };
    }

    console.error("[print] не вдалося побудувати штрих-код", error);
    return { ok: false, message: "Не вдалося побудувати штрих-код" };
  }
}
