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

/**
 * Коди PostgreSQL, що означають «того, що викликають, у базі немає».
 *
 * `42883` — немає функції з такою сигнатурою, `3F000` — немає схеми. Для
 * рантайму моделей це та сама подія: SQL моделі не опубліковано (або
 * опубліковано в іншу базу), а не помилка в даних.
 */
const MISSING_OBJECT_CODES = new Set(["42883", "3F000"]);

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Переклад помилок PostgreSQL для клієнта — за SQLSTATE, не за текстом.
 *
 * Сире повідомлення (`duplicate key value violates unique constraint
 * "bank_code_key"`) назовні не виходить: воно називає таблиці й констрейнти,
 * тобто внутрішню будову бази, і нічого не пояснює тому, хто натиснув кнопку.
 * Але й ховати все під «Внутрішня помилка» не можна: порушення унікальності чи
 * задовге значення — помилка ДАНИХ, і адресат у неї є. Тому відомі класи
 * перекладаються, а решта стає загальною помилкою з деталями в консолі сервера.
 */
const SQLSTATE_CLIENT_MESSAGES: Record<string, string> = {
  "23505": "Такий запис уже існує: значення має бути унікальним.",
  "23503": "Запис пов'язаний з іншими даними: його використовують інші записи, або він посилається на неіснуючий.",
  "23502": "Не заповнене обов'язкове поле.",
  "23514": "Значення не проходить перевірку, задану в базі.",
  "22001": "Значення задовге для поля.",
  "22003": "Число виходить за дозволені межі.",
  "22007": "Неправильний формат дати або часу.",
  "22008": "Дата або час поза допустимими межами.",
  "22P02": "Значення має неправильний формат.",
  "40001": "Дані одночасно змінив хтось інший — повторіть операцію.",
  "40P01": "Операції заблокували одна одну — повторіть операцію.",
};

/**
 * `raise exception 'текст'` у plpgsql без явного ERRCODE. Це навмисна
 * бізнес-відмова — так згенерований CRUD каже «code обов'язковий» — і її текст
 * писався для користувача, тож віддається як є, без перекладу.
 */
const PLPGSQL_RAISE_CODE = "P0001";

/**
 * Чи це помилка від самого PostgreSQL (а не транспорту, драйвера чи TS-коду).
 * У postgres.js такі помилки несуть поля протоколу: п'ятизначний SQLSTATE у
 * `code` і `severity`. Транспортні (`ETIMEDOUT`) і драйверні
 * (`CONNECTION_CLOSED`) коди під шаблон не підходять і `severity` не мають.
 */
export function isPostgresError(error: unknown): error is { code: string; message: string } {
  if (typeof error !== "object" || error === null) return false;
  const { code, severity } = error as { code?: unknown; severity?: unknown };
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && typeof severity === "string";
}

/**
 * Текст помилки PostgreSQL для клієнта: повідомлення навмисного `raise` — як є,
 * відомий SQLSTATE — перекладом, невідомий — `null` (той, хто викликав, віддає
 * загальну помилку, а деталі лишає в консолі сервера).
 */
export function postgresErrorClientMessage(error: { code: string; message: string }): string | null {
  if (error.code === PLPGSQL_RAISE_CODE) return error.message;
  return SQLSTATE_CLIENT_MESSAGES[error.code] ?? null;
}

/** Чи означає помилка, що викликаної функції (або її схеми) у базі немає. */
export function isMissingDatabaseFunction(error: unknown): boolean {
  const code = errorCode(error);
  return code !== null && MISSING_OBJECT_CODES.has(code);
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
