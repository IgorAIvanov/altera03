/**
 * Перелік символік — окремо від генераторів навмисно.
 *
 * Формат шаблону (`print-template.ts`) має знати, які значення допустимі, але
 * тягнути заради цього генератор QR разом із його залежністю ні до чого. Тут
 * немає жодного import — саме тому цей модуль можна підключати звідусіль.
 */

export type BarcodeSymbology = "code128" | "ean13" | "qr";

export const BARCODE_SYMBOLOGIES: BarcodeSymbology[] = ["code128", "ean13", "qr"];

/** Code 128 — дефолт: він єдиний приймає довільний ідентифікатор документа. */
export function normalizeBarcodeSymbology(value: unknown): BarcodeSymbology {
  return BARCODE_SYMBOLOGIES.includes(value as BarcodeSymbology) ? value as BarcodeSymbology : "code128";
}
