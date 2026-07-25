/**
 * Розпізнавання «бази немає» — окремо від «запит невдалий».
 *
 * Це різні події. Помилка запиту (порушення обмеження, немає функції) стосується
 * даних і має адресата — того, хто натиснув кнопку. Недоступна БД до даних не має
 * стосунку взагалі: докер не піднятий, `DB_HOST` не той, порт закритий. Досі і те,
 * і те доходило до браузера однаково — `{"code":"ETIMEDOUT","message":"Internal
 * server error!"}` — і щоразу доводилося здогадуватись, що PostgreSQL просто не
 * запущено.
 */

/**
 * Коди транспорту: запит не доїхав до сервера БД.
 *
 * `ETIMEDOUT` тут не випадково поруч із `ECONNREFUSED`: на Windows `localhost`
 * резолвиться спершу в IPv6 `::1`, де докер порт не публікує, тож замість швидкої
 * відмови виходить очікування до тайм-ауту. `ENOBUFS` — наслідок тієї ж
 * подвійної спроби, коли сокети врешті закінчуються.
 */
const TRANSPORT_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "ENOBUFS",
  "EPIPE",
  "EAI_AGAIN",
]);

/** Коди самого драйвера postgres.js — з'єднання було, але його не стало. */
const DRIVER_CODES = new Set([
  "CONNECTION_REFUSED",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECT_TIMEOUT",
]);

/**
 * Текст для клієнта. Свідомо без `host:port` і без назви задачі, що піднімає
 * докер: тіло відповіді бачить будь-хто, зокрема неавторизований, а деталі
 * потрібні тому, хто читає консоль сервера — вони й лишаються там.
 */
export const DATABASE_UNAVAILABLE_MESSAGE =
  "База даних недоступна. Сервер не може виконати запит — спробуйте пізніше або зверніться до адміністратора.";

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Чи означає ця помилка, що БД недоступна.
 *
 * Обхід у глибину обов'язковий: Deno загортає невдалу спробу по кількох адресах
 * (`::1`, потім `127.0.0.1`) в `AggregateError`, у якого власного `code` немає —
 * коди лежать усередині. `cause` перевіряється з тієї ж причини: драйвер інколи
 * перепаковує помилку сокета у свою.
 */
export function isDatabaseUnavailable(error: unknown, depth = 0): boolean {
  if (depth > 4 || typeof error !== "object" || error === null) return false;

  const code = errorCode(error);
  if (code && (TRANSPORT_CODES.has(code) || DRIVER_CODES.has(code))) return true;

  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      if (isDatabaseUnavailable(inner, depth + 1)) return true;
    }
  }

  return isDatabaseUnavailable((error as { cause?: unknown }).cause, depth + 1);
}
