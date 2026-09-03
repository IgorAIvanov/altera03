/**
 * Димові проби HTTP-межі: `deno task smoke`.
 *
 * Застосунок піднімається в цьому ж процесі (див. app-client.ts) — ні порту,
 * ні очікування готовності, ні зовнішнього клієнта.
 *
 * Правило щодо даних: читати можна що завгодно, писати — тільки своє і тільки
 * з прибиранням за собою у `finally`. Ніяка проба не чіпає чужі рядки.
 *
 * Прибирає проба **фізично**, прямим запитом до бази (`purge`), а не командою
 * `delete` моделі. Причина не в чистоті, а в тому, що `delete` тепер лише
 * ПОЗНАЧАЄ запис: рядок лишався в таблиці разом зі своїм унікальним кодом, і
 * другий прогін `deno task smoke` поспіль падав на `SMOKEUQ1` — тобто проби
 * були одноразовими, а виглядало це як зламаний застосунок. Дозволено це
 * рівно тут: власні рядки проби, локальна база, запобіжник оточення нижче.
 */
import postgres from "postgres";
import { assertEquals, assertExists } from "@std/assert";
import { AppClient, type Envelope } from "@altera/tools/app-client";
import { configFromEnv } from "@altera/server";
import { createServer } from "../app/server.ts";

/** Свідомо неіснуючий користувач: 401 від нього — доказ, що заголовок прочитано. */
const MISSING_USER_ID = "999999999";

/** Свій користувач для проб redirect-входу. Прибирається у `finally`. */
const REDIRECT_PROBE_LOGIN = "smoke-redirect-probe";
const REDIRECT_PROBE_SUBJECT = "smoke-redirect-subject";

/**
 * Свій користувач для проб агента — окремий від redirect-проби навмисно: цьому
 * потрібні права на запис (інакше «токен-читач не пише» нічого не доводить —
 * такому користувачеві й так не можна), а роздавати їх чужій пробі не варто.
 */
const AGENT_PROBE_LOGIN = "smoke-agent-probe";
const AGENT_PROBE_SUBJECT = "smoke-agent-subject";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Значення cookie сесії з відповіді. Порожній рядок означає, що сервер її
 * **гасить** — саме так виглядає відмова, і з «заголовка немає взагалі» це
 * плутати не можна.
 */
function sessionCookie(headers: Headers): string | null {
  const raw = headers.get("set-cookie");
  if (!raw) return null;

  const name = Deno.env.get("AUTH_COOKIE_NAME")?.trim() || "altera_session";
  const match = raw.match(new RegExp(`(?:^|,\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Фізичне прибирання власного рядка проби.
 *
 * З'єднання своє, а не пул застосунку: `bootstrap()` пул назовні не віддає, і
 * віддавати не повинен — це рантайм. Параметри ті самі, що в решти
 * дев-інструментів (`configFromEnv`), тож промахнутися базою неможливо.
 *
 * Ім'я таблиці підставляється як ідентифікатор (`sql(table)`), а не рядком:
 * значення тут свої, але правило «жодної конкатенації в SQL» не має винятків
 * навіть у пробах — саме з таких винятків беруться зразки для копіювання.
 */
async function purge(table: string, id: string): Promise<void> {
  await withDb((sql) => sql`delete from ${sql(table)} where id = ${id}`);
}

/**
 * З'єднання на один крок проби — тими самими параметрами, що в решти
 * дев-інструментів. Потрібне там, де перевіряється не команда моделі, а
 * домовленість самої БАЗИ (гак перед записом документа): завести й прибрати
 * функцію застосунку командою моделі неможливо.
 */
async function withDb<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const { host, port, database, username, password, ssl } = configFromEnv().database;
  const sql = postgres({ host, port, database, username, password, ssl: ssl ?? false });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

type NumeratorState = { scope_key: string; last_value: string };

/**
 * Знімок лічильників нумератора — і повернення їх на місце.
 *
 * Проба нумерації неминуче ЇХ ВИТРАЧАЄ, а це такий самий чужий стан, як зайнятий
 * код: лишивши лічильник зрушеним, проба назавжди зсунула б номери реальних
 * записів у базі розробника. Тому знімок береться цілком (областей у моделі
 * кілька — своя на організацію й рік) і цілком же відновлюється у `finally`.
 */
async function numeratorSnapshot(model: string): Promise<NumeratorState[]> {
  const { host, port, database, username, password, ssl } = configFromEnv().database;
  const sql = postgres({ host, port, database, username, password, ssl: ssl ?? false });
  try {
    return await sql<NumeratorState[]>`
      select scope_key, last_value from app.numerator_state where model = ${model}`;
  } finally {
    await sql.end();
  }
}

async function numeratorRestore(model: string, snapshot: NumeratorState[]): Promise<void> {
  const { host, port, database, username, password, ssl } = configFromEnv().database;
  const sql = postgres({ host, port, database, username, password, ssl: ssl ?? false });
  try {
    // Саме заміна, а не оновлення: проба могла завести область, якої не було
    // (наприклад, рік, у якому документів ще немає), і та мусить зникнути.
    await sql`delete from app.numerator_state where model = ${model}`;
    for (const row of snapshot) {
      await sql`
        insert into app.numerator_state (model, scope_key, last_value)
        values (${model}, ${row.scope_key}, ${row.last_value})`;
    }
  } finally {
    await sql.end();
  }
}

/**
 * Команди, записані в журнал для одного запису моделі.
 *
 * Прямим запитом до бази, як і `purge`: журнал назовні віддає лише список із
 * пагінацією й фільтрами, а пробі потрібен факт «рядок є / рядка немає» по
 * конкретному запису.
 */
async function auditCommands(model: string, recordId: string): Promise<string[]> {
  const { host, port, database, username, password, ssl } = configFromEnv().database;
  const sql = postgres({ host, port, database, username, password, ssl: ssl ?? false });
  try {
    const rows = await sql<{ command: string }[]>`
      select command from app.audit_log
      where model = ${model} and record_id = ${recordId}
      order by id`;
    return rows.map((row) => row.command);
  } finally {
    await sql.end();
  }
}

async function purgeAudit(model: string, recordId: string): Promise<void> {
  const { host, port, database, username, password, ssl } = configFromEnv().database;
  const sql = postgres({ host, port, database, username, password, ssl: ssl ?? false });
  try {
    await sql`delete from app.audit_log where model = ${model} and record_id = ${recordId}`;
  } finally {
    await sql.end();
  }
}

/** `state` із заголовка Location, який віддав authorize. */
function stateFromLocation(location: string): string {
  return new URL(location, "http://in-process").searchParams.get("state") ?? "";
}

Deno.test("smoke: HTTP-межа застосунку", async (t) => {
  // Провайдер-заглушка вмикається до підняття застосунку: конфігурацію читає
  // composition root, і після bootstrap міняти оточення вже пізно.
  Deno.env.set("DEV_AUTH_REDIRECT", "1");
  Deno.env.set("DEV_AUTH_REDIRECT_SUBJECT", REDIRECT_PROBE_SUBJECT);

  const client = await AppClient.start("smoke", createServer, { quiet: true });

  try {
    // Авторизація відповідає тим самим конвертом, що й команди моделей:
    // список — у data.rows, одиночний об'єкт — у data.item.
    await t.step("auth: список методів входу", async () => {
      const { status, body } = await client.json<Envelope>("/api/auth/methods");

      assertEquals(status, 200);
      assertEquals(body.ok, true);
      assertEquals(body.data.rows.length > 0, true);
    });

    await t.step("auth: без токена сесії немає", async () => {
      const { status, body } = await client.json<Envelope>("/api/auth/me");

      assertEquals(status, 200);
      assertEquals(body.ok, true);
      assertEquals(body.data.item, null);
    });

    await t.step("auth: сміттєвий Bearer не створює сесію", async () => {
      const { status, body } = await client.json<Envelope>("/api/auth/me", {
        headers: { authorization: "Bearer not-a-real-token" },
      });

      assertEquals(status, 200);
      assertEquals(body.data.item, null);
    });

    // Обхід авторизації підставляє користувача там, де облікових даних НЕМАЄ, —
    // і тільки там. Запит із `Bearer`, який не підійшов, мусить дістати 401
    // навіть при ввімкненому обході: інакше зіпсований токен мовчки працює від
    // імені дефолтного користувача, а помітно це лише на чужій базі, де обходу
    // немає. Проба має сенс саме тому, що смоук ходить із `DEV_AUTH_BYPASS=1`.
    await t.step("auth: сміттєвий Bearer не провалюється в dev-bypass", async () => {
      const { status, body } = await client.json<Envelope>("/api/model/bank/list", {
        method: "POST",
        headers: { authorization: "Bearer not-a-real-token", "content-type": "application/json" },
        body: "{}",
      });

      assertEquals(status, 401);
      assertEquals(body.ok, false);
    });

    await t.step("auth: відмова має ту саму форму конверта", async () => {
      const { body } = await client.json<Envelope>("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: "no-such-user", password: "nope" }),
      });

      assertEquals(body.ok, false);
      assertEquals(body.data.item, null);
      assertEquals(body.messages.length > 0, true);
    });

    // Регресія на HttpRequest: якщо `req.header()` перестане віддавати значення
    // (а мовчки поверне undefined), обидві проби нижче зійдуться в 200 — і різниця
    // між «заголовок прочитано» та «заголовка ніби немає» зникне непоміченою.
    await t.step("заголовок читається: неіснуючий x-dev-user-id дає 401", async () => {
      const { status, body } = await client.json<Envelope>("/api/model/bank/list", {
        method: "POST",
        headers: { "content-type": "application/json", "x-dev-user-id": MISSING_USER_ID },
        body: "{}",
      });

      assertEquals(status, 401);
      assertEquals(body.ok, false);
    });

    await t.step("заголовок читається: без нього спрацьовує фолбек", async () => {
      const { status, body } = await client.model("bank", "list");

      assertEquals(status, 200);
      assertEquals(body.ok, true);
    });

    await t.step("модель: bank/list віддає рядки", async () => {
      const { body } = await client.model("bank", "list");

      assertEquals(body.ok, true);
      assertEquals(Array.isArray(body.data.rows), true);
    });

    // Резолв в'ю був єдиним ендпоінтом поза конвертом (`{ ok, chunkUrl, message }`).
    // Обидві проби стережуть саме форму відповіді: до неї прив'язані `tab-controller`
    // і `picker-host`, і мовчазний відкат зламав би відкриття будь-якої форми.
    await t.step("в'ю: резолв віддає чанк у data.item", async () => {
      const { status, body } = await client.json<Envelope>("/api/view/catalog/bank/list");

      assertEquals(status, 200);
      assertEquals(body.ok, true);
      const item = body.data.item as { chunkUrl?: string } | null;
      assertExists(item);
      assertEquals(typeof item.chunkUrl, "string");
    });

    await t.step("в'ю: неіснуючий маршрут — 404 у тому ж конверті", async () => {
      const { status, body } = await client.json<Envelope>("/api/view/no_such/no_such/list");

      assertEquals(status, 404);
      assertEquals(body.ok, false);
      assertEquals(body.data.item, null);
      assertEquals(body.messages.length > 0, true);
    });

    // Посилання на вкладку — звичайний шлях (`/catalog/bank/list`), а не хеш,
    // тож сервер МУСИТЬ віддавати на нього index.html. Це ж вимога й до
    // зворотного проксі при розгортанні. Без проби вона ламається мовчки: усе
    // працює, доки хтось не відкриє чуже посилання й не дістане 404.
    await t.step("посилання на вкладку: глибокий шлях віддає застосунок", async () => {
      if (!await pathExists("./dist")) {
        // Не мовчимо: у CI фронтенд збирає інша джоба, і тут перевіряти нічого.
        console.log("    ⏭ dist/ немає — фолбек не перевіряється (потрібен build:front)");
        return;
      }
      const response = await client.fetch("/catalog/bank/list");
      assertEquals(response.status, 200);
      assertEquals(response.headers.get("content-type")?.includes("text/html"), true);
      // Статику віддає serveDir, і саме index.html має прийти цілим документом.
      assertEquals((await response.text()).includes("<!doctype html"), true);
    });

    await t.step("модель: невідома команда не вдає успіх", async () => {
      const { status, body } = await client.model("bank", "no_such_command");

      assertEquals(status, 404);
      assertEquals(body.ok, false);
      assertEquals(body.messages.length > 0, true);
    });

    // Вхід під іншим користувачем у сусідній вкладці міняє cookie одразу для
    // всього походження, а стара сторінка про це не знає. Без цієї перевірки її
    // запит виконався б від імені нового користувача — і документ дістав би
    // автором того, кого на екрані ніхто не бачив. Проба стереже саме те, що
    // відмова приходить ДО виконання команди.
    await t.step("сесія: заявлений користувач не збігається з сесією — 409", async () => {
      const { status, body, headers } = await client.json<Envelope>("/api/model/bank/list", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "altera",
          "x-session-user": MISSING_USER_ID,
        },
        body: "{}",
      });

      assertEquals(status, 409);
      assertEquals(body.ok, false);
      // Позначка потрібна клієнтові: за самим 409 звичайний конфлікт даних від
      // зміни сесії не відрізнити.
      assertEquals(headers.get("x-session-changed"), "1");
    });

    // Заявка необов'язкова: `POST /api/auth/login` іде ще до того, як користувач
    // відомий, а скрипти з `Authorization: Bearer` носять один токен і плутати
    // їм нічого. Без заголовка поведінка має лишитися рівно тією самою.
    await t.step("сесія: без заявки перевірки немає", async () => {
      const { status, body } = await client.model("bank", "list");

      assertEquals(status, 200);
      assertEquals(body.ok, true);
    });

    // Модель, для якої немає SQL-функції: PostgreSQL кидає 42883, і саме це
    // раніше долітало до форми сирим текстом (`function app.…_list(bigint,
    // jsonb) does not exist`). Проба стереже переклад, а не сам факт відмови.
    await t.step("модель: неопублікована SQL-функція — 501, без тексту від PostgreSQL", async () => {
      const { status, body } = await client.model("no_such_model_at_all", "list");

      assertEquals(status, 501);
      assertEquals(body.ok, false);
      assertEquals(body.messages.length > 0, true);
      assertEquals(body.messages.some((m) => `${m}`.includes("does not exist")), false);
    });

    // Порушення унікальності раніше долітало до форми сирим текстом PostgreSQL
    // (`duplicate key value violates unique constraint "uq_bank_mfo"`) зі
    // статусом 200. Проба стереже переклад за SQLSTATE: відмова — конвертом,
    // без внутрішньої будови бази.
    await t.step("модель: порушення унікальності — конверт без тексту PostgreSQL", async () => {
      const mfo = "SMK001";
      const created = await client.model("bank", "save", {
        item: { mfo, name: "Smoke unique probe" },
      });

      assertEquals(created.body.ok, true);
      const bank = created.body.data.item as { id: string } | null;
      assertExists(bank);

      // Прибирання — у finally: проба нижче може впасти, але свій рядок ми
      // приберемо в будь-якому разі.
      try {
        const duplicate = await client.model("bank", "save", {
          item: { mfo, name: "Smoke unique probe 2" },
        });

        assertEquals(duplicate.status, 200);
        assertEquals(duplicate.body.ok, false);
        assertEquals(duplicate.body.messages.length > 0, true);

        // Повідомлення тепер може бути об'єктом (несе поле форми), тож текст
        // дістаємо явно: `${m}` на об'єкті дав би "[object Object]", і перевірки
        // нижче проходили б не тому, що сирий текст не витік.
        const texts = duplicate.body.messages.map((m) =>
          typeof m === "string" ? m : String((m as { text?: unknown }).text ?? "")
        );
        assertEquals(texts.some((text) => text.includes("duplicate key")), false);
        assertEquals(texts.some((text) => text.includes("uq_bank_mfo")), false);

        // Поле форми поруч із текстом — з нього клієнт підсвічує саме `mfo`.
        assertEquals(
          duplicate.body.messages.some((m) =>
            typeof m === "object" && m !== null && (m as { field?: unknown }).field === "mfo"
          ),
          true,
        );
      } finally {
        // Фізично: позначка на видалення лишила б МФО `SMK001` у таблиці, і
        // наступний прогін впав би на тій самій унікальності, яку й перевіряє.
        await purge("app.bank", bank.id);
      }
    });

    // Журнал: що писати, вирішує НАЛАШТУВАННЯ в базі, а не манифест. Три рівні
    // видно лише пробою — у відповіді самої команди різниці немає жодної.
    //
    // Заразом це перевірка скидання кеша рівнів: усі три відрізки живуть в
    // ОДНОМУ процесі застосунку, тобто без скидання після `audit_setting/save`
    // другий і третій відрізки читали б рівень першого й проба падала б.
    await t.step("журнал: рівень вирішує, що писати", async () => {
      const level = async (value: string) =>
        await client.model("audit_setting", "save", { item: { id: "bank", level: value } });

      const before = await client.model("audit_setting", "get", { id: "bank" });
      const restore = (before.body.data.item as { level?: string } | null)?.level ?? "none";

      await level("changes");
      const created = await client.model("bank", "save", {
        item: { mfo: "SMK002", name: "Smoke audit probe" },
      });
      const bank = created.body.data.item as { id: string } | null;
      assertExists(bank);

      try {
        // `changes`: запис у журналі, читання — ні.
        await client.model("bank", "get", { id: bank.id });
        assertEquals(await auditCommands("bank", bank.id), ["save"]);

        // `all`: до журналу потрапляє й читання.
        await level("all");
        await client.model("bank", "get", { id: bank.id });
        assertEquals(await auditCommands("bank", bank.id), ["save", "get"]);

        // `none` — умовчання для всіх моделей: не пишеться нічого.
        await level("none");
        await client.model("bank", "get", { id: bank.id });
        assertEquals(await auditCommands("bank", bank.id), ["save", "get"]);
      } finally {
        await purgeAudit("bank", bank.id);
        await purge("app.bank", bank.id);
        await level(restore);
      }
    });

    // Нумератор: код видається сам, ручний код підтягує лічильник, а відкат
    // транзакції номер ПОВЕРТАЄ. Останнє й відрізняє стратегію `counter` від
    // `sequence`, і побачити це можна лише пробою — у відповіді успішного
    // запису різниці немає.
    await t.step("нумератор: авто-код, ручний код, відкат", async () => {
      const before = await numeratorSnapshot("counterparty");
      const created: string[] = [];

      const add = async (item: Record<string, unknown>) => {
        const res = await client.model("counterparty", "save", { item });
        const row = res.body.data.item as { id: string; code: string } | null;
        if (row) created.push(row.id);
        return { ok: res.body.ok, row };
      };

      try {
        const first = await add({ name: "Smoke нумератор 1" });
        assertEquals(first.ok, true);
        assertExists(first.row);
        // Ширина з шаблона {NNNNNN}: доповнення нулями, а не сире число.
        assertEquals(/^\d{6}$/.test(first.row.code), true);

        const second = await add({ name: "Smoke нумератор 2" });
        assertExists(second.row);
        assertEquals(BigInt(second.row.code), BigInt(first.row.code) + 1n);

        // Ручний код лічильник не видає, але лишити його позаду не можна:
        // інакше наступний авто-код упреться в уже зайнятий.
        const manual = (BigInt(second.row.code) + 10n).toString().padStart(6, "0");
        const manualSaved = await add({ code: manual, name: "Smoke нумератор ручний" });
        assertExists(manualSaved.row);
        assertEquals(manualSaved.row.code, manual);

        const afterManual = await add({ name: "Smoke нумератор 3" });
        assertExists(afterManual.row);
        assertEquals(BigInt(afterManual.row.code), BigInt(manual) + 1n);

        // Код не за шаблоном лічильника не стосується взагалі.
        const alien = await add({ code: "SMOKE-NUM", name: "Smoke нумератор чужий код" });
        assertEquals(alien.ok, true);

        // Відкат: назва довша за колонку валить запис ПІСЛЯ того, як номер уже
        // взято. Номер мусить повернутися — наступний успішний запис отримує
        // рівно те значення, яке взяв невдалий.
        const failed = await add({ name: "Ы".repeat(300) });
        assertEquals(failed.ok, false);

        const afterRollback = await add({ name: "Smoke нумератор 4" });
        assertExists(afterRollback.row);
        assertEquals(BigInt(afterRollback.row.code), BigInt(afterManual.row.code) + 1n);
      } finally {
        for (const id of created) await purge("app.counterparty", id);
        await numeratorRestore("counterparty", before);
      }
    });

    // Нумерація в межах року — і саме тоді, коли року в номері НЕМАЄ. Це те
    // місце, де конструкція легко зривається назад у «період видно з номера»:
    // лічильник мусить починатися спочатку щороку, номер лишатися тим самим
    // рядком, а унікальність триматися на індексі по даті документа.
    await t.step("нумератор: період року при номері без року", async () => {
      const before = await numeratorSnapshot("invoice");
      // Організацію й контрагента проба заводить СВОЇХ, а не бере перших-ліпших
      // із бази. Не з чистоти: у CI база порожня (див. .github/workflows/ci.yml),
      // і проба, що спирається на чужі рядки, там просто не має за що взятися.
      // Тому й лічильників на відновлення троє — кожен заведений запис витрачає
      // свій, а лишити їх зрушеними означає зсунути коди реальних записів.
      const beforeParty = await numeratorSnapshot("counterparty");
      const beforeOrg = await numeratorSnapshot("organization");

      // Префікс — щоб {ORG} у шаблоні номера був не порожній: проба перевіряє
      // саме той вигляд номера, який отримає застосунок.
      const organization = await client.model("organization", "save", {
        item: { name: "Smoke період організація", prefix: "SMK" },
      });
      const org = organization.body.data.item as { id: string } | null;
      assertExists(org);

      const party = await client.model("counterparty", "save", {
        item: { name: "Smoke період контрагент" },
      });
      const partyRow = party.body.data.item as { id: string } | null;
      assertExists(partyRow);

      const docs: string[] = [];
      const invoice = async (date: string, number?: string) => {
        const item: Record<string, unknown> = {
          organizationId: org.id,
          docDate: `${date}T00:00:00`,
          counterpartyId: partyRow.id,
        };
        if (number !== undefined) item.number = number;
        const res = await client.model("invoice", "save", { item });
        const row = res.body.data.item as { id: string; number: string } | null;
        if (row) docs.push(row.id);
        return { ok: res.body.ok, row, messages: res.body.messages };
      };

      try {
        const first2026 = await invoice("2026-08-09");
        assertExists(first2026.row);
        const second2026 = await invoice("2026-09-01");
        assertExists(second2026.row);

        // Лічильник іде далі в межах року.
        assertEquals(second2026.row.number !== first2026.row.number, true);

        // А в іншому році починається спочатку — і дає ТОЙ САМИЙ рядок номера,
        // бо року в ньому немає. Саме це й неможливо, поки період виводять із
        // шаблона.
        const first2025 = await invoice("2025-12-15");
        assertExists(first2025.row);
        assertEquals(first2025.row.number, first2026.row.number);

        // Унікальність при цьому не втрачена: у своєму році номер зайнятий.
        const clash = await invoice("2026-03-03", first2026.row.number);
        assertEquals(clash.ok, false);
        assertEquals(
          clash.messages.some((m) =>
            typeof m === "object" && m !== null && (m as { field?: unknown }).field === "number"
          ),
          true,
        );

        // Без дати номер не видається «з поточного року» мовчки: періодний
        // лічильник без дати не знає своєї області, тож save відмовляє ще до
        // видачі номера — і відмова сідає на поле дати, а не приходить
        // внутрішньою помилкою нумератора.
        const dateless = await client.model("invoice", "save", {
          item: { organizationId: org.id, counterpartyId: partyRow.id },
        });
        assertEquals(dateless.body.ok, false);
        assertEquals(
          dateless.body.messages.some((m) =>
            typeof m === "object" && m !== null && (m as { field?: unknown }).field === "docDate"
          ),
          true,
        );
      } finally {
        // Шапка володіє id — рядки документа й проводки йдуть каскадом.
        // Організація йде ПІСЛЯ документів: на неї посилається app.document.
        for (const id of docs) await purge("app.document", id);
        await purge("app.counterparty", partyRow.id);
        await purge("app.organization", org.id);
        await numeratorRestore("invoice", before);
        await numeratorRestore("counterparty", beforeParty);
        await numeratorRestore("organization", beforeOrg);
      }
    });

    // Гак «перед записом документа» — точка розширення, якої з боку застосунку
    // не видно взагалі: вона є, лише поки ядро кличе її з тригера на
    // app.document. Пропаде виклик — заборона закритого періоду перестане діяти
    // МОВЧКИ, і виявиться це проведенням у закритому місяці, а не помилкою.
    // Тому проба заводить свій гак, звіряє назви дій на всіх шляхах запису й
    // прибирає його у finally.
    await t.step("документ: гак перед записом кличеться на всіх шляхах", async () => {
      const before = await numeratorSnapshot("invoice");
      const beforeParty = await numeratorSnapshot("counterparty");
      const beforeOrg = await numeratorSnapshot("organization");

      const organization = await client.model("organization", "save", {
        item: { name: "Smoke гак організація", prefix: "SMG" },
      });
      const org = organization.body.data.item as { id: string } | null;
      assertExists(org);

      const party = await client.model("counterparty", "save", {
        item: { name: "Smoke гак контрагент" },
      });
      const partyRow = party.body.data.item as { id: string } | null;
      assertExists(partyRow);

      // Рядок документа потрібен, щоб його можна було ПРОВЕСТИ: документ без
      // суми відмовляється проводитися, і крок мовчки перевіряв би не те.
      const bank = await client.model("bank", "save", {
        item: { mfo: "999871", name: "Smoke гак банк" },
      });
      const bankRow = bank.body.data.item as { id: string } | null;
      assertExists(bankRow);

      const docs: string[] = [];
      /**
       * Назви дій без службових `update`.
       *
       * Запис документа доходить до шапки двічі — сам запис і денормалізація
       * підсумку з представленням, — але це подробиця генерованого `save`, а не
       * контракт гака. Звіряємо те, що ядро ОБІЦЯЄ: дію названо словом
       * застосунку на кожному шляху.
       */
      const ops = async () =>
        (await withDb((sql) =>
          sql<{ op: string }[]>`select op from app.smoke_guard_log order by id`
        )).map((r) => r.op).filter((op) => op !== "update");

      try {
        await withDb(async (sql) => {
          await sql.unsafe(`
            create table app.smoke_guard_log (id bigserial primary key, op text not null);
            create function app.doc_before_write(
              p_user_id bigint, p_op text, p_doc jsonb, p_prev jsonb
            ) returns void language plpgsql as $fn$
            begin
              insert into app.smoke_guard_log (op) values (p_op);
            end $fn$;
          `);
        });

        const saved = await client.model("invoice", "save", {
          item: {
            organizationId: org.id,
            docDate: "2026-08-12T00:00:00",
            counterpartyId: partyRow.id,
            lines: [{ lineNo: 1, bankId: bankRow.id, qty: 2, price: 50 }],
          },
        });
        const doc = saved.body.data.item as { id: string } | null;
        assertExists(doc);
        docs.push(doc.id);

        // Сухий прогін: показати проводки, не проводячи. Кличе ту саму
        // `invoice_post` і відкочує транзакцію — тобто це не модель поведінки,
        // а сама поведінка, тільки без запису.
        const preview = await client.model("invoice", "postPreview", { id: doc.id });
        assertEquals(preview.body.ok, true);
        const previewRows = preview.body.data.rows as Array<
          { debitAccount: string | null; creditAccount: string | null; amount: string }
        >;
        assertEquals(previewRows.length > 0, true);

        // Слідів не лишилося: ні проведення, ні проводок. Третій доказ —
        // нижче: журнал гака `doc_before_write` не бачить цього `post`, бо
        // його запис відкотився разом із усім іншим.
        const afterPreview = await client.model("invoice", "get", { id: doc.id });
        assertEquals((afterPreview.body.data.item as { isPosted?: boolean }).isPosted, false);
        await withDb(async (sql) => {
          const [row] = await sql<{ count: number }[]>`
            select count(*)::int as count from app.journal_entry where document_id = ${doc.id}::bigint
          `;
          assertEquals(row.count, 0);
        });

        // Проведений документ прогону не отримує: там дивляться справжні рухи.
        assertEquals((await client.model("invoice", "post", { id: doc.id })).body.ok, true);
        assertEquals((await client.model("invoice", "postPreview", { id: doc.id })).body.ok, false);
        assertEquals((await client.model("invoice", "unpost", { id: doc.id })).body.ok, true);

        assertEquals((await client.model("invoice", "delete", { id: doc.id })).body.ok, true);

        // Проведення й позначка на видалення — обидва `update` у TG_OP, тож
        // назвати їх може лише ядро. Саме через це гак і приймає `op`.
        assertEquals(await ops(), ["insert", "post", "unpost", "delete"]);

        // Відмова гака доходить конвертом, а не 500 — інакше заборона періоду
        // виглядала б для користувача як зламаний застосунок. Журнал тут не
        // допоміг би: разом із відмовою відкочується й запис у нього.
        await withDb(async (sql) => {
          await sql.unsafe(`
            create or replace function app.doc_before_write(
              p_user_id bigint, p_op text, p_doc jsonb, p_prev jsonb
            ) returns void language plpgsql as $fn$
            begin raise exception 'smoke guard: заборонено'; end $fn$;
          `);
        });
        assertEquals((await client.model("invoice", "undelete", { id: doc.id })).body.ok, false);

        // Гак із чужим підписом не кликався б — і застосунок вважав би, що
        // заборона діє. Ядро валить запис замість того, щоб мовчати.
        await withDb(async (sql) => {
          await sql.unsafe(`
            drop function app.doc_before_write(bigint, text, jsonb, jsonb);
            create function app.doc_before_write(p_user_id bigint, p_op text) returns void
            language plpgsql as $fn$ begin end $fn$;
          `);
        });
        assertEquals((await client.model("invoice", "undelete", { id: doc.id })).body.ok, false);
      } finally {
        await withDb(async (sql) => {
          await sql.unsafe(`
            drop function if exists app.doc_before_write(bigint, text, jsonb, jsonb);
            drop function if exists app.doc_before_write(bigint, text);
            drop table if exists app.smoke_guard_log;
          `);
        });
        for (const id of docs) await purge("app.document", id);
        await purge("app.counterparty", partyRow.id);
        await purge("app.bank", bankRow.id);
        await purge("app.organization", org.id);
        await numeratorRestore("invoice", before);
        await numeratorRestore("counterparty", beforeParty);
        await numeratorRestore("organization", beforeOrg);
      }
    });

    // Відбір підбору. Половина механізму була давно — параметри доїжджали в
    // payload, — а друга ні: фільтри збиралися лише для `list`, тож у `lookup`
    // вони МОВЧКИ ігнорувалися. Мовчання й перевіряємо: звужений підбір мусить
    // віддати менше, а невідомий ключ — відмову, а не повний перелік.
    await t.step("підбір: відбір звужує, невідомий ключ відхиляється", async () => {
      const all = await client.model("invoice", "lookup", {});
      assertEquals(all.body.ok, true);

      const narrowed = await client.model("invoice", "lookup", {
        // Ссылочний фільтр приходить об'єктом — так само, як у списку.
        filters: { counterparty: { id: "-1" } },
      });
      assertEquals(narrowed.body.ok, true);
      assertEquals((narrowed.body.data.rows as unknown[]).length, 0);

      const unknown = await client.model("invoice", "lookup", { filters: { partner: { id: "1" } } });
      assertEquals(unknown.body.ok, false);
      assertEquals(
        unknown.body.messages.some((m) => JSON.stringify(m).includes("lookupUnknownFilter")),
        true,
      );

      // Модель без оголошених фільтрів мовчати теж не має права.
      const noFilters = await client.model("bank", "lookup", { filters: { mfo: "300" } });
      assertEquals(noFilters.body.ok, false);
      assertEquals(
        noFilters.body.messages.some((m) => JSON.stringify(m).includes("lookupNoFilters")),
        true,
      );
    });

    // Періодичні дані: ключ, дата, значення. Перевіряємо не CRUD (він такий
    // самий, як у решти регістрів), а те, заради чого блок `periodic` і
    // з'явився: зріз на дату бере ПОПЕРЕДНЄ значення, а не найсвіжіше, і
    // перезапис на ту саму дату не плодить другого рядка.
    await t.step("періодичні дані: зріз на дату й перезапис", async () => {
      const rates: string[] = [];
      const currency = await client.model("currency", "save", {
        item: { code: "SMK", name: "Smoke валюта" },
      });
      const cur = currency.body.data.item as { id: string } | null;
      assertExists(cur);

      const set = async (period: string, rate: number) => {
        const res = await client.model("currency_rate", "set", {
          item: { currencyId: cur.id, period, rate, multiplicity: 1 },
        });
        const row = res.body.data.item as { id: string; rate: number } | null;
        if (row) rates.push(row.id);
        return { ok: res.body.ok, row };
      };

      try {
        const first = await set("2026-01-01", 41.5);
        assertEquals(first.ok, true);
        await set("2026-08-01", 43.2);

        // Зріз на березень — січневий курс: те, що діяло НА ДАТУ.
        const at = await client.model("currency_rate", "at", {
          onDate: "2026-03-01",
          currencyId: cur.id,
        });
        const slice = at.body.data.item as { period: string; rate: number } | null;
        assertExists(slice);
        assertEquals(slice.period, "2026-01-01");
        assertEquals(Number(slice.rate), 41.5);

        // Перезапис тієї самої дати — той самий рядок: ключ природний
        // (валюта + період), а не id. Тримає це унікальний індекс, який
        // генератор кладе поруч із функціями.
        const again = await set("2026-01-01", 41.9);
        assertExists(again.row);
        assertEquals(again.row.id, first.row?.id);
        assertEquals(Number(again.row.rate), 41.9);

        const history = await client.model("currency_rate", "history", { currencyId: cur.id });
        assertEquals((history.body.data.rows as unknown[]).length, 2);
      } finally {
        for (const id of rates) await purge("app.currency_rate", id);
        await purge("app.currency", cur.id);
      }
    });

    // Забалансовий облік однобічний за визначенням: «Дт 021» не кореспондує ні
    // з чим. Обхід (парна проводка через допоміжний рахунок) псує самі дані —
    // у регістрі з'являється кореспонденція, якої в обліку немає. Тому ядро
    // приймає порожній бік, але рівно там, де це задум, а не недописаний рядок.
    await t.step("проводка: однобічна лише на забалансовому рахунку", async () => {
      const before = await numeratorSnapshot("manual_entry");
      const beforeOrg = await numeratorSnapshot("organization");

      const organization = await client.model("organization", "save", {
        item: { name: "Smoke забаланс організація", prefix: "SMB" },
      });
      const org = organization.body.data.item as { id: string } | null;
      assertExists(org);

      const docs: string[] = [];
      const entry = async (account: string, amount: number) => {
        const res = await client.model("manual_entry", "save", {
          item: {
            organizationId: org.id,
            docDate: "2026-08-12T00:00:00",
            entries: [{
              lineNo: 1,
              debitAccount: account,
              debitAnalytics: {},
              creditAccount: null,
              creditAnalytics: {},
              amount,
            }],
          },
        });
        const doc = res.body.data.item as { id: string } | null;
        if (doc) docs.push(doc.id);
        return doc;
      };

      try {
        // Рахунок свій: у порожній базі CI забалансових немає, а спиратися на
        // чужі рядки проба не має права.
        await withDb((sql) => sql`
          insert into app.chart_of_account (code, name, account_type, is_group, is_off_balance)
          values ('0SMOKE', 'Smoke забалансовий', 'active', false, true)
          on conflict (code) do nothing`);

        const offBalance = await entry("0SMOKE", 1500);
        assertExists(offBalance);
        assertEquals((await client.model("manual_entry", "post", { id: offBalance.id })).body.ok, true);

        const posted = await withDb((sql) =>
          sql<{ debit_account: string | null; credit_account: string | null }[]>`
            select debit_account, credit_account from app.journal_entry
            where document_id = ${offBalance.id}`
        );
        assertEquals(posted.length, 1);
        assertEquals(posted[0].debit_account, "0SMOKE");
        assertEquals(posted[0].credit_account, null);

        // А на балансовому рахунку порожній бік — це недописаний рядок, і
        // мовчки прийняти його не можна: у балансі він дасть розходження, яке
        // шукатимуть у документах, а не в проводці.
        const balance = await entry("301", 10);
        assertExists(balance);
        const refused = await client.model("manual_entry", "post", { id: balance.id });
        assertEquals(refused.body.ok, false);
        assertEquals(
          refused.body.messages.some((m) => JSON.stringify(m).includes("entryOneSidedNotOffBalance")),
          true,
        );
      } finally {
        for (const id of docs) await purge("app.document", id);
        await withDb((sql) => sql`delete from app.chart_of_account where code = '0SMOKE'`);
        await purge("app.organization", org.id);
        await numeratorRestore("manual_entry", before);
        await numeratorRestore("organization", beforeOrg);
      }
    });

    // Розріз за субконто мусить давати ту саму суму, що й рахунок цілком.
    //
    // Проба тут, а не в юніт-пробах, бо перевіряється домовленість БАЗИ, і
    // ламається вона мовчки: `cross join lateral` викидав рухи без цього
    // виміру, кожен рядок лишався правильним, а неправильною ставала тільки
    // ЇХНЯ СУМА — величина, якої ніхто не звіряє. Саме тому потрібен сторож:
    // помилка не має жодного способу виявитися сама.
    await t.step("регістр: розріз за субконто не губить рухів без нього", async () => {
      const before = await numeratorSnapshot("manual_entry");
      const beforeOrg = await numeratorSnapshot("organization");
      const beforeParty = await numeratorSnapshot("counterparty");

      const organization = await client.model("organization", "save", {
        item: { name: "Smoke розріз організація", prefix: "SMD" },
      });
      const org = organization.body.data.item as { id: string } | null;
      assertExists(org);

      const party = await client.model("counterparty", "save", {
        item: { name: "Smoke розріз контрагент" },
      });
      const counterparty = party.body.data.item as { id: string; name: string } | null;
      assertExists(counterparty);

      const docs: string[] = [];
      const post = async (analytics: Record<string, { id: string; name: string }>) => {
        const res = await client.model("manual_entry", "save", {
          item: {
            organizationId: org.id,
            docDate: "2026-08-12T00:00:00",
            entries: [{
              lineNo: 1,
              debitAccount: "0SMKD",
              debitAnalytics: analytics,
              creditAccount: "0SMKC",
              creditAnalytics: {},
              amount: "100.00",
            }],
          },
        });
        const doc = res.body.data.item as { id: string } | null;
        assertExists(doc, JSON.stringify(res.body.messages));
        docs.push(doc.id);
        const posted = await client.model("manual_entry", "post", { id: doc.id });
        assertEquals(posted.body.ok, true, JSON.stringify(posted.body.messages));
      };

      try {
        // Рахунки свої: чужі правила аналітики можуть змінитися, а проба має
        // перевіряти шар читання, а не склад плану рахунків.
        //
        // Слот НЕОБОВ'ЯЗКОВИЙ (`is_required = false`) — і це суть випадку: ядро
        // саме дозволяє рух без цього субконто, а шар читання його викидав.
        await withDb((sql) => sql`
          insert into app.chart_of_account (code, name, account_type, is_group)
          values ('0SMKD', 'Smoke розріз Дт', 'active', false),
                 ('0SMKC', 'Smoke розріз Кт', 'passive', false)
          on conflict (code) do nothing`);
        await withDb((sql) => sql`
          insert into app.chart_of_account_analytic (account_code, slot_no, dimension_code, is_required)
          values ('0SMKD', 1, 'counterparty', false)
          on conflict (account_code, slot_no) do nothing`);

        // Два рухи на ОДНОМУ рахунку: з субконто й без нього. Другий — не
        // екзотика, а буденність: уведення залишків, закриття, коригування.
        await post({ counterparty: { id: counterparty.id, name: counterparty.name } });
        await post({});

        const [total] = await withDb((sql) =>
          sql<{ debit: string }[]>`
            select debit from app.acc_balance_turnover(${org.id}::bigint, null, null, array['0SMKD']::varchar[], null)`
        );
        const rows = await withDb((sql) =>
          sql<{ value_id: string | null; debit: string }[]>`
            select value_id, debit
            from app.acc_balance_turnover_by_dim(
              ${org.id}::bigint, null, null, array['0SMKD']::varchar[], null, 'counterparty'::varchar)`
        );

        assertExists(total);
        const sum = rows.reduce((acc, r) => acc + Number(r.debit), 0);
        assertEquals(sum, Number(total.debit));
        // Рух без виміру приходить окремим рядком, а не зникає й не приклеюється
        // до чужого значення.
        assertEquals(rows.some((r) => r.value_id === null && Number(r.debit) === 100), true);
      } finally {
        for (const id of docs) await purge("app.document", id);
        await purge("app.counterparty", counterparty.id);
        await purge("app.organization", org.id);
        // Слот аналітики зникає разом із рахунком (on delete cascade).
        await withDb((sql) => sql`delete from app.chart_of_account where code in ('0SMKD', '0SMKC')`);
        await numeratorRestore("manual_entry", before);
        await numeratorRestore("counterparty", beforeParty);
        await numeratorRestore("organization", beforeOrg);
      }
    });

    // Екран нумераторів: прапорець is_editable — не мертвий перемикач, а
    // серверна заборона. Вимкнений — ручний код відхиляється з прив'язкою до
    // поля; запис при цьому не створюється. Знімок правила повертається у
    // finally: сама відмова стану не лишає, а от вимкнений прапорець лишився б.
    await t.step("нумератор: is_editable вимикає ручний номер", async () => {
      const before = await client.model("numerator", "get", { id: "counterparty" });
      const rule = before.body.data.item as Record<string, unknown> | null;
      assertExists(rule);

      try {
        const off = await client.model("numerator", "save", {
          item: { ...rule, isEditable: false },
        });
        assertEquals(off.body.ok, true);

        const manual = await client.model("counterparty", "save", {
          item: { code: "999998", name: "Smoke ручний код заборонено" },
        });
        assertEquals(manual.body.ok, false);
        assertEquals(manual.body.data.item, null);
        assertEquals(
          manual.body.messages.some((m) =>
            typeof m === "object" && m !== null && (m as { field?: unknown }).field === "code"
          ),
          true,
        );
      } finally {
        await client.model("numerator", "save", { item: rule });
      }
    });

    // Ієрархічний довідник (патерн A2v10): проба ганяє повний цикл на СВОЇХ
    // даних — група → підгрупа → позиція; фільтр по батьківській групі мусить
    // бачити вміст підгрупи, непорожня група не видаляється, перенесення в
    // корінь працює. Прибирання — вкладені finally.
    await t.step("ієрархія: групи, фільтр з підгрупами, перенесення", async () => {
      const grp = await client.model("nomenclature", "groupSave", { item: { name: "Smoke група" } });
      assertEquals(grp.body.ok, true);
      const g = grp.body.data.item as { id: string } | null;
      assertExists(g);

      try {
        const sub = await client.model("nomenclature", "groupSave", {
          item: { parentId: g.id, name: "Smoke підгрупа" },
        });
        assertEquals(sub.body.ok, true);
        const s = sub.body.data.item as { id: string } | null;
        assertExists(s);

        try {
          const created = await client.model("nomenclature", "save", {
            item: { code: "SMOKE-H1", name: "Smoke позиція", groupId: s.id },
          });
          assertEquals(created.body.ok, true);
          const item = created.body.data.item as { id: string } | null;
          assertExists(item);

          try {
            const filtered = await client.model("nomenclature", "list", { groupIds: [g.id] });
            assertEquals(filtered.body.ok, true);
            const rows = filtered.body.data.rows as Array<{ id: string }>;
            assertEquals(rows.some((r) => r.id === item.id), true);

            const refuse = await client.model("nomenclature", "groupDelete", { id: s.id });
            assertEquals(refuse.body.ok, false);
            assertEquals(refuse.body.messages.length > 0, true);

            const moved = await client.model("nomenclature", "moveToGroup", {
              id: item.id,
              groupId: null,
            });
            assertEquals(moved.body.ok, true);
          } finally {
            // Фізично, як і в пробі банку: позначена позиція лишилася б у
            // таблиці з кодом `SMOKE-H1` і зайняла б його назавжди. Групи
            // нижче прибирає `groupDelete` — у нього позначки немає, він
            // видаляє по-справжньому.
            await purge("app.nomenclature", item.id);
          }
        } finally {
          const removed = await client.model("nomenclature", "groupDelete", { id: s.id });
          assertEquals(removed.body.ok, true);
        }
      } finally {
        const removed = await client.model("nomenclature", "groupDelete", { id: g.id });
        assertEquals(removed.body.ok, true);
      }
    });

    await t.step("вкладення: повний цикл із прибиранням", async () => {
      const payload = "smoke payload";
      const uploaded = await client.upload({
        name: "smoke-probe.txt",
        type: "text/plain",
        bytes: bytes(payload),
      });

      assertEquals(uploaded.status, 200);
      const item = uploaded.body.data.item as { id: string; token: string } | null;
      assertExists(item);

      // Прибирання — у finally: проба нижче може впасти, але свій рядок ми
      // приберемо в будь-якому разі.
      try {
        const url = `/api/blob/${item.id}?token=${encodeURIComponent(item.token)}`;

        const download = await client.fetch(url);
        assertEquals(download.status, 200);
        assertEquals(await download.text(), payload);

        const etag = download.headers.get("etag");
        assertExists(etag);

        const cached = await client.fetch(url, { headers: { "if-none-match": etag } });
        assertEquals(cached.status, 304);

        const stale = await client.fetch(url, { headers: { "if-none-match": '"stale"' } });
        assertEquals(stale.status, 200);

        const forbidden = await client.fetch(`/api/blob/${item.id}`);
        assertEquals(forbidden.status, 403);
      } finally {
        const removed = await client.model("attachment", "delete", { id: item.id });
        assertEquals(removed.body.ok, true);
      }
    });

    // ── Redirect-вхід ────────────────────────────────────────────────────────
    //
    // Живого OAuth-провайдера в розробці немає, тому шлях проходить заглушка
    // (`app/login/dev-redirect-auth.method.ts`): вона одразу «підтверджує»
    // особу й повертає браузер на наш же callback. Усе, що перевіряється далі,
    // належить фреймворку — state, обмін, зв'язка, cookie.

    await t.step("redirect: метод видно у списку способів входу", async () => {
      const { body } = await client.json<Envelope>("/api/auth/methods");
      const methods = body.data.rows as { key: string; kind: string }[];

      const dev = methods.find((method) => method.key === "dev");
      assertExists(dev);
      // Без `kind` екран входу не відрізнив би провайдера від пароля.
      assertEquals(dev.kind, "redirect");
      assertEquals(methods.find((method) => method.key === "password")?.kind, "direct");
    });

    await t.step("redirect: authorize віддає перехід зі state", async () => {
      const response = await client.fetch("/api/auth/authorize/dev?redirect=/");

      assertEquals(response.status, 302);
      const location = response.headers.get("location") ?? "";
      assertEquals(location.includes("/api/auth/callback/dev"), true);
      assertEquals(stateFromLocation(location).length > 0, true);
    });

    await t.step("redirect: невідомий метод не заводить потік", async () => {
      const response = await client.fetch("/api/auth/authorize/no_such_provider");

      assertEquals(response.status, 400);
      assertEquals((await response.text()).includes("authError"), true);
    });

    // Без state callback приймав би будь-який code ззовні — тобто дозволяв би
    // посадити користувача в чужу сесію переходом за підсунутим посиланням.
    await t.step("redirect: чужий state не створює сесію", async () => {
      const response = await client.fetch(
        `/api/auth/callback/dev?code=dev:${REDIRECT_PROBE_SUBJECT}&state=not-a-real-state`,
      );

      assertEquals(response.status, 200);
      assertEquals(sessionCookie(response.headers), "");
      assertEquals((await response.text()).includes("authError"), true);
    });

    // Політика зв'язки: провайдер підтвердив особу, але користувача з нею не
    // пов'язано — вхід відхиляється. База непорожня, тож гілка bootstrap
    // недосяжна, і створюватися нічого не повинно.
    await t.step("redirect: непов'язана особа не пускає", async () => {
      const started = await client.fetch("/api/auth/authorize/dev");
      const state = stateFromLocation(started.headers.get("location") ?? "");

      const response = await client.fetch(
        `/api/auth/callback/dev?code=dev:${REDIRECT_PROBE_SUBJECT}&state=${state}`,
      );

      assertEquals(response.status, 200);
      assertEquals(sessionCookie(response.headers), "");
      assertEquals(decodeURIComponent(await response.text()).includes("не пов'язаний"), true);
    });

    await t.step("redirect: повний цикл зі зв'язкою", async () => {
      const created = await client.model("user", "save", {
        item: {
          login: REDIRECT_PROBE_LOGIN,
          fullName: "Smoke redirect probe",
          isActive: true,
          groupIds: [],
          identities: [{ provider: "dev", externalId: REDIRECT_PROBE_SUBJECT }],
        },
      });

      assertEquals(created.body.ok, true);
      const user = created.body.data.item as { id: string; login: string } | null;
      assertExists(user);

      // Прибирання — у finally: перевірки нижче можуть впасти, але свій рядок
      // ми приберемо в будь-якому разі.
      try {
        const started = await client.fetch("/api/auth/authorize/dev?redirect=/");
        const state = stateFromLocation(started.headers.get("location") ?? "");

        const callback = await client.fetch(
          `/api/auth/callback/dev?code=dev:${REDIRECT_PROBE_SUBJECT}&state=${state}`,
        );

        assertEquals(callback.status, 200);
        // Документ, а не 302: cookie з SameSite=Strict не пережила б редирект
        // із крос-сайтового ланцюжка (див. auth-redirect-page.ts).
        assertEquals(callback.headers.get("content-type")?.includes("text/html"), true);

        const token = sessionCookie(callback.headers);
        assertExists(token);
        assertEquals(token.length > 0, true);

        const me = await client.json<Envelope>("/api/auth/me", {
          headers: { cookie: `${Deno.env.get("AUTH_COOKIE_NAME")?.trim() || "altera_session"}=${token}` },
        });

        const session = me.body.data.item as
          | { user: { login: string }; session: { authMethod: string } }
          | null;
        assertExists(session);
        assertEquals(session.user.login, REDIRECT_PROBE_LOGIN);
        // Метод входу лишається в сесії — інакше не видно, ким саме зайшли.
        assertEquals(session.session.authMethod, "dev");

        // Той самий state удруге: погашення й читання роблять одним UPDATE,
        // тому повтор не має жодного вікна, в яке міг би прослизнути.
        const replay = await client.fetch(
          `/api/auth/callback/dev?code=dev:${REDIRECT_PROBE_SUBJECT}&state=${state}`,
        );

        assertEquals(sessionCookie(replay.headers), "");
      } finally {
        const removed = await client.model("user", "delete", { id: user.id });
        assertEquals(removed.body.ok, true);
      }
    });

    /**
     * Агентський контур: персональний токен, межі токена, підтвердження змін.
     *
     * Жодна перевірка тут не питає «чи прийшла відповідь» — і це головне в
     * цьому кроці. З увімкненим `DEV_AUTH_BYPASS` виклик без чинних облікових
     * даних тихо стає викликом дефолтного користувача, тож зламаний токен
     * віддавав би 200 і виглядав робочим (одного разу так і сталося). Тому
     * питають лише про те, чого обхід дати не може: про відсутність
     * інструментів запису в токена-читача, про вимогу `confirm` і про відмову
     * записати. Обхід — не токен, і запобіжники агента на нього не діють, тож
     * підміна валить перевірку, а не ховається за нею.
     */
    await t.step("агент: токен, його межі й підтвердження змін", async () => {
      const [adminGroup] = await withDb((sql) =>
        sql<Array<{ id: string }>>`select id::text as id from app.user_group where code = 'admin'`
      );
      assertExists(adminGroup);

      const created = await client.model("user", "save", {
        item: {
          login: AGENT_PROBE_LOGIN,
          fullName: "Smoke agent probe",
          isActive: true,
          groupIds: [adminGroup.id],
          identities: [{ provider: "dev", externalId: AGENT_PROBE_SUBJECT }],
        },
      });

      assertEquals(created.body.ok, true);
      const user = created.body.data.item as { id: string } | null;
      assertExists(user);

      try {
        // Сесія потрібна рівно щоб ВИДАТИ токени: `/api/auth/tokens` доступний
        // тільки з браузера — агент, який тримає токен, не має карбувати нові.
        const started = await client.fetch("/api/auth/authorize/dev?redirect=/");
        const state = stateFromLocation(started.headers.get("location") ?? "");
        const callback = await client.fetch(
          `/api/auth/callback/dev?code=dev:${AGENT_PROBE_SUBJECT}&state=${state}`,
        );

        const session = sessionCookie(callback.headers);
        assertExists(session);

        // Cookie плюс `x-requested-with`: по cookie запит міг ініціювати чужий
        // сайт, тому змінювальні методи вимагають заголовка, якого крос-доменно
        // не поставити. Токен цим не користується — він і є `Bearer`.
        const browser = {
          cookie: `${Deno.env.get("AUTH_COOKIE_NAME")?.trim() || "altera_session"}=${session}`,
          "x-requested-with": "XMLHttpRequest",
          "content-type": "application/json",
        };

        const issue = async (name: string, isReadOnly: boolean) => {
          const { body } = await client.json<Envelope>("/api/auth/tokens", {
            method: "POST",
            headers: browser,
            body: JSON.stringify({ name, isReadOnly }),
          });

          assertEquals(body.ok, true);
          const item = body.data.item as { id: string; token?: string };
          // Значення віддається один раз і більше ніде: у таблиці лише хеш.
          assertExists(item.token);
          return item as { id: string; token: string };
        };

        const full = await issue("smoke agent", false);
        const reader = await issue("smoke agent readonly", true);

        /** Каталог моделей — те, що агент читає першим і тримає цілком. */
        const catalogOf = async (token: string) => {
          const { status, body } = await client.json<Envelope>("/api/agent/tools", {
            headers: { authorization: `Bearer ${token}` },
          });

          assertEquals(status, 200);
          return body.data.rows as Array<{
            model: string;
            type: string;
            titles?: Record<string, string>;
            aliases?: string[];
            commands: string[];
          }>;
        };

        /** Схеми — на вимогу, однієї моделі. */
        const toolsOf = async (token: string, model: string) => {
          const { status, body } = await client.json<Envelope>(
            `/api/agent/tools?model=${model}`,
            { headers: { authorization: `Bearer ${token}` } },
          );

          assertEquals(status, 200);
          return body.data.rows as Array<{ model: string; command: string; input: unknown }>;
        };

        const callModel = async (
          token: string,
          model: string,
          command: string,
          payload: Record<string, unknown>,
        ) => {
          return await client.json<{ ok: boolean; result: unknown; messages: string[] }>(
            "/api/agent/call",
            {
              method: "POST",
              headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
              body: JSON.stringify({ model, command, payload }),
            },
          );
        };

        const call = (token: string, command: string, payload: Record<string, unknown>) =>
          callModel(token, "bank", command, payload);

        // Каталог: моделі з переліком команд і БЕЗ схем — саме він лишається
        // малим, коли моделей стане сотня. Схема тут була б тим самим шматком
        // на 200 КБ, від якого поділ і рятує.
        const catalog = await catalogOf(full.token);
        const bankEntry = catalog.find((entry) => entry.model === "bank");
        assertExists(bankEntry);
        assertEquals(bankEntry.commands.includes("save"), true);
        assertEquals("input" in bankEntry, false);

        // Назва мовами застосунку: технічне ім'я `bank` не каже нічого тому,
        // хто цієї бази не бачив, а на сотні моделей вибирати доводиться саме
        // за назвою. Мов кілька — мову називає застосунок, не фреймворк.
        assertExists(bankEntry.titles);
        assertEquals(bankEntry.titles.uk, "Банки");
        assertEquals(typeof bankEntry.titles.en, "string");

        // Синоніми доїжджають до агента: на сотні моделей саме вони й
        // відрізняють «номенклатуру» від «номенклатурної групи».
        const named = catalog.find((entry) => (entry.aliases?.length ?? 0) > 0);
        assertExists(named);

        // Схеми — на вимогу й лише названої моделі.
        const tools = await toolsOf(full.token, "bank");
        assertEquals(tools.every((tool) => tool.model === "bank"), true);
        const save = tools.find((tool) => tool.command === "save");
        assertExists(save);
        assertExists((save.input as { properties?: unknown }).properties);

        // Оголошені обмеження їдуть разом зі схемою.
        //
        // Схема каже, які в моделі є ПОЛЯ, і мовчить про те, чого застосунок
        // робити не стане: поле буває, а команда його відбиває. Побачити це
        // доти можна було лише спрацьованим — тобто на живих даних у замовника,
        // після того, як людина вже вибудувала на цьому роботу.
        const described = await client.json<
          { data?: { extra?: { rules?: Record<string, Array<{ key: string; text: string }>> } } }
        >("/api/agent/tools?model=invoice", {
          headers: { authorization: `Bearer ${full.token}` },
        });
        const invoiceRules = described.body.data?.extra?.rules?.invoice ?? [];
        const noAmount = invoiceRules.find((rule) => rule.key === "invoice.postNoAmount");
        assertExists(noAmount);
        assertEquals(noAmount.text, "Накладна без суми — проведення неможливе");

        // Правила ядра — теж тут, і саме вони найважчі: усе, що відбиває
        // ПРОВЕДЕННЯ, написано в `document_core` один раз на всі документи всіх
        // застосунків, тобто з реєстру застосунку не видно взагалі. Підбирає їх
        // ТИП моделі: «немає рахунку» — правило будь-якого документа, а не
        // якоїсь однієї моделі.
        const coreRule = invoiceRules.find((rule) => rule.key === "core.entryNoAccount");
        assertExists(coreRule);
        assertEquals(coreRule.text.includes("@["), false);

        // А довіднику проводочні правила не приписуються.
        const bankRules = (await client.json<
          { data?: { extra?: { rules?: Record<string, Array<{ key: string }>> } } }
        >("/api/agent/tools?model=bank", {
          headers: { authorization: `Bearer ${full.token}` },
        })).body.data?.extra?.rules?.bank ?? [];
        assertEquals(bankRules.some((rule) => rule.key === "core.entryNoAccount"), false);

        // Правило називається тим самим ключем, яким позначена сама відмова
        // (`messages[].key`), — тобто агент може сказати, що вперся саме в це.
        const englishRules = await client.json<
          { data?: { extra?: { rules?: Record<string, Array<{ key: string; text: string }>> } } }
        >("/api/agent/tools?model=invoice&lang=en", {
          headers: { authorization: `Bearer ${full.token}` },
        });
        assertEquals(
          englishRules.body.data?.extra?.rules?.invoice?.find((rule) =>
            rule.key === "invoice.postNoAmount"
          )?.text,
          "An invoice with no amount cannot be posted",
        );

        // Маркер перекладу в АГЕНТСЬКОМУ каналі розгортає сервер.
        //
        // Браузера тут немає, а тексту сервер не перекладає — він його називає
        // (`@[core.lookupNoFilters]{"model":"bank"}`), і доти агент отримував
        // саме ім'я ключа. Причому рівно в тому класі повідомлень, яким база
        // пояснює, чому щось не вийшло: правила обліку живуть у SQL. Браузерний
        // канал маркер отримує й далі — інакше зникла б друга мова.
        const refusal = await client.json<{ ok: boolean; messages: unknown[] }>(
          "/api/agent/call",
          {
            method: "POST",
            headers: { authorization: `Bearer ${full.token}`, "content-type": "application/json" },
            body: JSON.stringify({ model: "bank", command: "lookup", payload: { filters: { bogus: "1" } } }),
          },
        );
        assertEquals(refusal.body.ok, false);
        const refused = refusal.body.messages[0] as { text: string; key?: string };
        assertEquals(
          refused.text.includes("@["),
          false,
          `маркер доїхав до агента нерозгорнутим: ${refused.text}`,
        );
        assertEquals(refused.text.includes("Підбір «bank» відборів не оголошує"), true);
        // Ключ лишається поруч із текстом: це ідентифікатор правила, за який
        // чіпляється питання «а де воно налаштоване».
        assertEquals(refused.key, "core.lookupNoFilters");

        // Мову каналу називає виклик, бо спитати нема в кого.
        const english = await client.json<{ messages: unknown[] }>("/api/agent/call", {
          method: "POST",
          headers: { authorization: `Bearer ${full.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: "bank",
            command: "lookup",
            payload: { filters: { bogus: "1" } },
            lang: "en",
          }),
        });
        assertEquals(
          (english.body.messages[0] as { text: string }).text.includes("picker declares no filters"),
          true,
        );

        // Кілька моделей одним запитом — заради цього список і зроблено:
        // диспетчеру потрібні дві-три одразу, а три запити коштують трьох
        // обертів.
        const pair = await client.json<Envelope>("/api/agent/tools?model=bank,counterparty", {
          headers: { authorization: `Bearer ${full.token}` },
        });
        const pairModels = new Set(
          (pair.body.data.rows as Array<{ model: string }>).map((tool) => tool.model),
        );
        assertEquals([...pairModels].sort(), ["bank", "counterparty"]);

        // Названа модель, якої немає, — відмова, а не порожнеча: «нічого» агент
        // прочитав би як «прав немає» й пішов би шукати не там. У списку
        // відмовляє й одна невідома серед відомих: віддати решту мовчки
        // означало б дати агенту вважати, що він отримав усе, що просив.
        const unknown = await client.json<{ ok: boolean }>("/api/agent/tools?model=nosuchmodel", {
          headers: { authorization: `Bearer ${full.token}` },
        });
        assertEquals(unknown.body.ok, false);

        const partly = await client.json<{ ok: boolean }>(
          "/api/agent/tools?model=bank,nosuchmodel",
          { headers: { authorization: `Bearer ${full.token}` } },
        );
        assertEquals(partly.body.ok, false);

        // Той самий користувач, ті самі права — різниця тільки в прапорці
        // токена. Тому порожнеча тут доводить, що читали саме токен, і однаково
        // в обох режимах.
        const readerCatalog = await catalogOf(reader.token);
        const readerBank = readerCatalog.find((entry) => entry.model === "bank");
        assertExists(readerBank);
        assertEquals(readerBank.commands.includes("list"), true);
        assertEquals(
          readerBank.commands.some((command) =>
            ["save", "delete", "undelete", "post", "unpost"].includes(command)
          ),
          false,
        );

        const readerTools = await toolsOf(reader.token, "bank");
        assertEquals(readerTools.some((tool) => tool.command === "list"), true);
        assertEquals(
          readerTools.some((tool) =>
            ["save", "delete", "undelete", "post", "unpost"].includes(tool.command)
          ),
          false,
        );

        // Читання токеном виконується від імені його власника, а у відповіді
        // є посилання на вкладку — те, що агент кладе людині в чат. Формат
        // саме клієнтський (`route`, не `?id=`): іншого оболонка не відкриє.
        const list = await call(full.token, "list", {});
        assertEquals(list.body.ok, true);
        assertEquals((list.body.result as { route?: string }).route, "/catalog/bank/list");

        // Той самий формат для запису — саме він і потрібен у сценарії «агент
        // завів документ, людина його відкрила». Читанням, а не записом: тут
        // перевіряється форма посилання, а не робота `save`.
        const rows = (list.body.result as { data?: { rows?: Array<{ id: string }> } }).data?.rows;
        const existing = rows?.[0];
        if (existing) {
          const one = await call(full.token, "get", { id: existing.id });
          assertEquals(one.body.ok, true);
          assertEquals(
            (one.body.result as { route?: string }).route,
            `/catalog/bank/edit/${existing.id}`,
          );
        }

        // Зміна стану без `confirm` не виконується, і у відмові сказано, чого
        // бракує: агент має дізнатися вимогу з тексту, а не вгадувати.
        const removal = await call(full.token, "delete", { id: MISSING_USER_ID });
        assertEquals(removal.body.ok, false);
        assertEquals(removal.body.messages.join(" ").includes("confirm"), true);

        // Токен-читач не пише навіть там, де людині можна.
        const write = await call(reader.token, "save", { item: { name: "Smoke agent bank" } });
        assertEquals(write.body.ok, false);
        assertEquals(write.body.messages.join(" ").includes("тільки для читання"), true);

        // …і не пише ІНШИМ ВХОДОМ. Байти вкладень ходять власним каналом, повз
        // рантайм моделей, тож перевірка прапорця мусить стояти і там. Доти не
        // стояла: токеном для читання можна було залити в базу будь-який файл,
        // і жодна проба цього не бачила — цей крок і є та проба.
        const readerForm = new FormData();
        readerForm.set(
          "file",
          new File([bytes("denied") as BufferSource], "smoke-readonly.txt", { type: "text/plain" }),
        );
        const readerUpload = await client.json<Envelope>("/api/blob/upload", {
          method: "POST",
          headers: { authorization: `Bearer ${reader.token}` },
          body: readerForm,
        });
        assertEquals(readerUpload.status, 403);
        assertEquals(readerUpload.body.messages.join(" ").includes("тільки для читання"), true);

        // Звіт — те, заради чого агента здебільшого й кличуть: звірка
        // починається з читання регістру, а не з запису. Він є і в каталозі, і
        // в схемах (право прийшло з `commands.access`, а не з виводу за іменем)...
        assertEquals(
          catalog.find((entry) => entry.model === "turnover_balance")?.commands,
          ["index"],
        );
        assertExists(
          (await toolsOf(full.token, "turnover_balance")).find((tool) => tool.command === "index"),
        );

        // ...і виклик доходить до самого звіту, а не спиняється в диспетчері:
        // без обов'язкового відбору відмовляє SQL звіту, і у відповіді є
        // `result` із луною фільтрів, тоді як відмова диспетчера лишає його
        // порожнім. Саме цим два білих списки й розходилися.
        const noFilter = await callModel(full.token, "turnover_balance", "index", { filters: {} });
        assertEquals(noFilter.body.ok, false);
        assertExists(noFilter.body.result);

        // Успішний прогін вимагає організації, а вона тут не своя: заводити її
        // пробі задорого (з'їсть номер із лічильника), тож беремо наявну. На
        // порожній базі звіту й так нема про що звітувати.
        const organizations = await client.model("organization", "lookup", { pageSize: 1 });
        const organization = (organizations.body.data.rows as Array<{ id: string }>)[0];
        if (organization) {
          const turnover = await callModel(full.token, "turnover_balance", "index", {
            filters: { organization: { id: organization.id } },
          });
          assertEquals(turnover.body.ok, true);
          // У звіту немає запису, тож посилання веде на сам екран звіту.
          assertEquals(
            (turnover.body.result as { route?: string }).route,
            "/report/turnover_balance/list",
          );
        }

        // Друкована форма — те, що людина називає «дай накладну»: не JSON
        // документа, а бланк. Команда `printPdf` виводиться з непорожнього
        // `prints` манифеста, і в переліку агента вона мусить бути так само,
        // як у формі, — інакше диспетчер відмовляє тому, що перелік показує.
        assertEquals(catalog.find((entry) => entry.model === "invoice")?.commands.includes("printPdf"), true);
        // Друк читає, а не пише, тож токен «тільки для читання» його бачить.
        assertEquals(
          readerCatalog.find((entry) => entry.model === "invoice")?.commands.includes("printPdf"),
          true,
        );

        const invoices = await client.model("invoice", "list", { pageSize: 1 });
        const invoice = (invoices.body.data.rows as Array<{ id: string }>)[0];
        if (invoice) {
          const printed = await callModel(full.token, "invoice", "printPdf", { id: invoice.id });
          assertEquals(printed.body.ok, true);

          const extra = (printed.body.result as { data?: { extra?: Record<string, unknown> } })
            .data?.extra ?? {};
          // `JVBERi0` — це «%PDF-» у base64: перевіряємо, що приїхав саме
          // документ, а не порожнеча з правильною формою конверта.
          assertEquals(String(extra.pdfBase64 ?? "").startsWith("JVBERi0"), true);
          assertEquals(typeof extra.fileName, "string");
        }

        // Вкладення назовні — ланцюжок із двох кроків, і перевіряти його треба
        // цілим. Команда моделі віддає ПІДПИСАНИЙ токен (сирий access_key
        // назовні не виходить ніколи), а байти забираються вже ним, власним
        // каналом. Розірвати ланцюг можна з обох боків — прибрати `attachment`
        // із переліку агента або перестати підписувати токени в конверті, — і
        // жодна з половин сама собою про це не скаже.
        assertEquals(
          catalog.find((entry) => entry.model === "attachment")?.commands.sort(),
          ["get", "list"],
        );

        if (existing) {
          const scan = await client.upload(
            { name: "smoke-agent-scan.txt", type: "text/plain", bytes: bytes("scan") },
            { ownerModel: "bank", ownerId: existing.id },
          );
          const attachment = scan.body.data.item as { id: string } | null;
          assertExists(attachment);

          try {
            const listed = await callModel(full.token, "attachment", "list", {
              ownerModel: "bank",
              ownerId: existing.id,
            });
            assertEquals(listed.body.ok, true);

            const row = ((listed.body.result as { data?: { rows?: Array<Record<string, string>> } })
              .data?.rows ?? []).find((entry) => entry.id === attachment.id);
            assertExists(row);
            // Підпис, а не сирий uuid: токен складається з претензій і HMAC
            // через крапку, і саме цим він і не вгадується за id.
            assertEquals(row.token.includes("."), true);

            const downloaded = await client.fetch(
              `/api/blob/${row.id}?token=${encodeURIComponent(row.token)}&disp=attachment`,
            );
            assertEquals(downloaded.status, 200);
            assertEquals(await downloaded.text(), "scan");
          } finally {
            await purge("app.attachment", attachment.id);
          }
        }

        const revoked = await client.json<Envelope>("/api/auth/tokens/revoke", {
          method: "POST",
          headers: browser,
          body: JSON.stringify({ id: full.id }),
        });
        assertEquals(revoked.body.ok, true);

        // Просто 401, без хитрощів: запит із `Bearer` до dev-bypass не доходить
        // навіть при ввімкненому обході — облікові дані були, і вони не
        // підійшли. Доти відкликаний токен тихо ставав дефолтним користувачем,
        // тобто перевірити його відкликання було нічим.
        const afterRevoke = await client.json<{ ok: boolean }>("/api/agent/tools", {
          headers: { authorization: `Bearer ${full.token}` },
        });
        assertEquals(afterRevoke.status, 401);
        assertEquals(afterRevoke.body.ok, false);
      } finally {
        // Прибирання фізичне, як і всюди в цьому файлі: `user_delete` лишає
        // деактивований рядок, щойно на користувача послався журнал, — а логін
        // унікальний, тож наступний прогін упав би на ньому. Токени й членство
        // у групі йдуть каскадом за користувачем; журнал — ні.
        await withDb((sql) => sql`delete from app.audit_log where user_id = ${user.id}::bigint`);
        await purge("app.users", user.id);
      }
    });

    // Модуль рішення лишився тільки на читання: установку робить окремий
    // інструмент. Перевіряємо, що маршрут відповідає й чесно каже «невідомо»
    // там, де манифесту поставки немає, — а не мовчазне «на підтримці».
    await t.step("стан рішення: маршрут читається без особливих прав", async () => {
      const response = await client.json<Envelope>("/api/solution/status");

      assertEquals(response.body.ok, true);
      const state = response.body.data.item as { supported: boolean | null };
      // У цьому репозиторії app/ не встановлювали пакетом, тож манифесту немає.
      assertEquals(state.supported, null);
    });
  } finally {
    await client.close();
  }
});
