/**
 * Контракт входу агента (`POST /api/agent/call`).
 *
 * Команд для інтерфейсу тут немає: колишні `uiActions` («відкрий цей документ»,
 * «покажи тост») наказували щось зробити оболонці, яка їх не слухала й не
 * слухає — зовнішній агент екрана не має. Лишилося те, що має сенс без екрана:
 * {@link AgentCommandResult.route}, тобто ПОСИЛАННЯ. Різниця не словесна: наказ
 * потребує каналу до відкритого браузера й довіри до того, хто наказує, а
 * посилання доходить саме собою — агент кладе його в чат хоста, людина клікає.
 */
export interface AgentCommandResult {
  ok: boolean;
  model: string;
  command: string;
  id?: string;
  /**
   * Глибоке посилання на вкладку — `/document/invoice/edit/42`, той самий
   * формат, що в `buildTabUrl` клієнта. Шлях, а не повна адреса: походження
   * знає той, хто нас кличе, а сервер за зворотним проксі — не завжди.
   *
   * Відборів посилання не несе (їх немає у форматі вкладки), тож звіт
   * відкриється порожнім — це видно й це поки так.
   */
  route?: string;
  messages: AgentMessage[];
  data?: unknown;
}

/**
 * Повідомлення конверта, як його бачить агент.
 *
 * Форма подвійна, бо такою вона приходить із бази: проста відмова — рядок,
 * прив'язана до поля — об'єкт. Маркери перекладу тут уже розгорнуті (див.
 * `common/messages.ts`), а `key` лишається поруч із текстом: це ідентифікатор
 * правила, за який чіпляється все, що спитають далі («де це налаштоване»).
 */
export type AgentMessage = string | {
  type?: string;
  text: string;
  field?: string;
  key?: string;
  [extra: string]: unknown;
};

export interface AgentResponse {
  ok: boolean;
  result: AgentCommandResult | null;
  messages: AgentMessage[];
}

export interface AgentCallRequest {
  model: string;
  command: string;
  payload: Record<string, unknown>;
  /**
   * Якою мовою відповідати. Умовчання — `messages.locale` конфігурації:
   * браузера в цьому каналі немає, тож мову нема в кого спитати, і хтось мусить
   * її назвати.
   */
  lang?: string;
}
