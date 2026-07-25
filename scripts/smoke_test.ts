/**
 * Димові проби HTTP-межі: `deno task smoke`.
 *
 * Застосунок піднімається в цьому ж процесі (див. app-client.ts) — ні порту,
 * ні очікування готовності, ні зовнішнього клієнта.
 *
 * Правило щодо даних: читати можна що завгодно, писати — тільки своє і тільки
 * з прибиранням за собою у `finally`. Ніяка проба не чіпає чужі рядки.
 */
import { assertEquals, assertExists } from "@std/assert";
import { AppClient, type Envelope } from "@scope/tools/app-client";
import { createServer } from "../app/server.ts";

/** Свідомо неіснуючий користувач: 401 від нього — доказ, що заголовок прочитано. */
const MISSING_USER_ID = "999999999";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

Deno.test("smoke: HTTP-межа застосунку", async (t) => {
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
  } finally {
    await client.close();
  }
});
