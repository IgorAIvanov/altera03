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

/**
 * Повідомлення конверта. Голий рядок лишається дійсним і означає помилку —
 * так пише більшість SQL-функцій. Об'єкт потрібен, коли є що додати:
 * `type` для «інформаційно, не відмова» і `field` — ім'я поля форми, яке
 * клієнт має підсвітити (див. `docs/ui-form-validation.md`).
 */
export interface ResponseMessage {
  type?: "info" | "warn" | "error";
  text: string;
  /** Поле форми (camelCase, як у схемі), а не колонка бази. */
  field?: string;
  /**
   * Показати окремим вікном, а не банером у формі. Для того, що не прив'язане
   * до даних і не має губитися: «користувача деактивовано, а не видалено».
   * Банер для такого не годиться — екран після дії міг і закритися.
   * Перехоплює клієнтський data-service, форми про це не знають.
   */
  modal?: boolean;
}

export interface Envelope<TItem = unknown, TRow = unknown> {
  ok: boolean;
  data: EnvelopeData<TItem, TRow>;
  messages: (string | ResponseMessage)[];
}

/** Відмова, прив'язана до поля форми: банер плюс підсвітка саме цього поля. */
export function fieldErr(field: string, text: string): Envelope<never, never> {
  return {
    ok: false,
    data: emptyData<never, never>(),
    messages: [{ type: "error", text, field }],
  };
}

/**
 * Успіх, якому є що сказати окремим вікном: операція пройшла, але не так, як
 * очікував користувач («деактивовано, а не видалено»).
 */
export function okWithNotice<TItem>(
  item: TItem | null,
  text: string,
  type: ResponseMessage["type"] = "info",
): Envelope<TItem, never> {
  return {
    ok: true,
    data: { ...emptyData<TItem, never>(), item },
    messages: [{ type, text, modal: true }],
  };
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
