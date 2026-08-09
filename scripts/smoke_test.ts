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
  const { host, port, database, username, password, ssl } = configFromEnv().database;
  const sql = postgres({ host, port, database, username, password, ssl: ssl ?? false });
  try {
    await sql`delete from ${sql(table)} where id = ${id}`;
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
      // Контрагента проба теж заводить, тобто витрачає ЩЕ ОДИН лічильник —
      // повернути треба обидва, інакше кожен прогін зсуває коди контрагентів.
      const beforeParty = await numeratorSnapshot("counterparty");
      const orgs = await client.model("organization", "lookup", { pageSize: 1 });
      const org = (orgs.body.data.rows as { id: string }[])[0];
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
        for (const id of docs) await purge("app.document", id);
        await purge("app.counterparty", partyRow.id);
        await numeratorRestore("invoice", before);
        await numeratorRestore("counterparty", beforeParty);
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
