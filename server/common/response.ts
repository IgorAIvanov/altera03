/**
 * Конверт відповіді — один на весь API.
 *
 * Раніше авторизація відповідала своїм форматом (`{ success, data, error }`),
 * а команди моделей — своїм (`{ ok, data: { item, rows, … }, messages }`), і
 * клієнтові доводилося знати обидва. Тепер форма одна: авторизація кладе свій
 * об'єкт в `item`, а списки — в `rows`.
 */

export interface EnvelopeData<TItem = unknown, TRow = unknown> {
  item: TItem | null;
  rows: TRow[];
  options: Record<string, unknown>;
  totals: Record<string, unknown>;
}

export interface Envelope<TItem = unknown, TRow = unknown> {
  ok: boolean;
  data: EnvelopeData<TItem, TRow>;
  messages: string[];
}

function emptyData<TItem, TRow>(): EnvelopeData<TItem, TRow> {
  return { item: null, rows: [], options: {}, totals: {} };
}

/** Успіх з одиночним об'єктом. `null` — «нічого немає», а не помилка. */
export function ok<TItem>(item: TItem | null): Envelope<TItem, never> {
  return { ok: true, data: { ...emptyData<TItem, never>(), item }, messages: [] };
}

/** Успіх зі списком. */
export function rows<TRow>(list: TRow[]): Envelope<never, TRow> {
  return { ok: true, data: { ...emptyData<never, TRow>(), rows: list }, messages: [] };
}

/** Відмова. Дані порожні, але форма та сама — клієнт розбирає відповідь однаково. */
export function err(...messages: string[]): Envelope<never, never> {
  return { ok: false, data: emptyData<never, never>(), messages };
}
