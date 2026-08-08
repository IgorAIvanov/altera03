// --- Вкладки ---
export interface TabOpenMessage {
  type: "tab.open";
  route: string;
  id?: string | null;
  params?: Record<string, unknown>;
}
export interface TabCloseMessage {
  type: "tab.close";
  tabId: string;
}
export interface TabClosedMessage {
  type: "tab.closed";
  tabId: string;
  route: string;
  id?: string | null;
}
/** Форма повідомляє про зміну стану «є незбережені зміни» — для «*» на вкладці. */
export interface TabDirtyMessage {
  type: "tab.dirty";
  tabId: string;
  dirty: boolean;
}

// --- Пиккер ---
export interface PickerOpenMessage {
  type: "picker.open";
  route: string;
  callbackId: string;
  params?: Record<string, unknown>;
  /**
   * Множинний вибір: діалог показує позначки рядків і повертає масив.
   * Вирішує ТОЙ, ХТО ВІДКРИВАЄ (`bus.pickMany`), а не сам пікер: один і той
   * самий довідник підбирають то одним значенням у поле, то пачкою в табличну
   * частину.
   */
  multiple?: boolean;
}
export interface PickerSelectMessage {
  type: "picker.select";
  callbackId: string;
  /** Один вибір. При множинному — перший із `values`, щоб старі читачі не впали. */
  value: { id: string; label: string };
  /** Усі позначені. Є лише коли діалог відкривали як множинний. */
  values?: { id: string; label: string }[];
}
export interface PickerCancelMessage {
  type: "picker.cancel";
  callbackId: string;
}

// --- Підтвердження / вибір ---

/** Іконка діалогу: знак питання, знак оклику, хрест, «i». */
export type DialogIcon = "question" | "warning" | "error" | "info";

export interface ConfirmOpenMessage {
  type: "confirm.open";
  text: string;
  callbackId: string;
  /** Ключ локалізації кнопки підтвердження; без нього — common.yes. */
  okKey?: string;
  icon?: DialogIcon;
}
export interface ConfirmResultMessage {
  type: "confirm.result";
  callbackId: string;
  value: boolean;
}

/** Кнопка діалогу вибору; primary — та, що спрацьовує на Enter. */
export interface ChoiceButton {
  key: string;
  labelKey: string;
  primary?: boolean;
}
export interface ChoiceOpenMessage {
  type: "choice.open";
  text: string;
  callbackId: string;
  buttons: ChoiceButton[];
  icon?: DialogIcon;
}
export interface ChoiceResultMessage {
  type: "choice.result";
  callbackId: string;
  /** key натиснутої кнопки; null — Esc / хрестик / клік повз вікно. */
  value: string | null;
}

// --- Данные ---
export interface DataLoadMessage {
  type: "data.load";
  model: string;
  command: string;
  payload?: unknown;
}
export interface DataSaveMessage {
  type: "data.save";
  model: string;
  command: string;
  payload: unknown;
}

// --- Оповещения ---
export interface ModelChangedMessage {
  type: "model.changed";
  model: string;
}

/**
 * Коротке повідомлення користувачеві — те, що раніше або показувалося через
 * `alert()` (з адресою сайту й блокуванням усього), або не показувалося взагалі
 * і лишалося в консолі. Показує оболонка; хто відправив — не знає, де саме воно
 * з'явиться, і це навмисно.
 */
export interface NoticeMessage {
  type: "notice";
  text: string;
  /**
   * Вид сплиття. Без нього — `error` (так було завжди: банер заводився саме
   * під невдачі й пофарбований у червоне). `info` потрібен для підтверджень
   * на кшталт «URL скопійовано»: червоне «все добре» читається як помилка.
   */
  kind?: "error" | "info";
}

// --- Індикатор завантаження ---
export interface LoadingStartMessage { type: "loading.start"; }
export interface LoadingEndMessage   { type: "loading.end"; }

// --- Union ---
export type BusMessage =
  | TabOpenMessage
  | TabCloseMessage
  | TabClosedMessage
  | TabDirtyMessage
  | PickerOpenMessage
  | PickerSelectMessage
  | PickerCancelMessage
  | ConfirmOpenMessage
  | ConfirmResultMessage
  | ChoiceOpenMessage
  | ChoiceResultMessage
  | DataLoadMessage
  | DataSaveMessage
  | ModelChangedMessage
  | NoticeMessage
  | LoadingStartMessage
  | LoadingEndMessage;

export type BusMessageType = BusMessage["type"];

export type MessageOfType<T extends BusMessageType> = Extract<BusMessage, { type: T }>;

export type PickerValue = { id: string; label: string } | null;
