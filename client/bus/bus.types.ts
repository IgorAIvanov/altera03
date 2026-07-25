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

// --- Пиккер ---
export interface PickerOpenMessage {
  type: "picker.open";
  route: string;
  callbackId: string;
  params?: Record<string, unknown>;
}
export interface PickerSelectMessage {
  type: "picker.select";
  callbackId: string;
  value: { id: string; label: string };
}
export interface PickerCancelMessage {
  type: "picker.cancel";
  callbackId: string;
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
}

// --- Індикатор завантаження ---
export interface LoadingStartMessage { type: "loading.start"; }
export interface LoadingEndMessage   { type: "loading.end"; }

// --- Union ---
export type BusMessage =
  | TabOpenMessage
  | TabCloseMessage
  | TabClosedMessage
  | PickerOpenMessage
  | PickerSelectMessage
  | PickerCancelMessage
  | DataLoadMessage
  | DataSaveMessage
  | ModelChangedMessage
  | NoticeMessage
  | LoadingStartMessage
  | LoadingEndMessage;

export type BusMessageType = BusMessage["type"];

export type MessageOfType<T extends BusMessageType> = Extract<BusMessage, { type: T }>;

export type PickerValue = { id: string; label: string } | null;
