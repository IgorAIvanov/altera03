/**
 * Резолв схеми шапки документа.
 *
 * Ламалося тут тихо і лише ЗА МЕЖАМИ монорепозиторію: інструмент шукав
 * `appRoot/../client/shared/schema.ts`, тобто розкладку цього репозиторію, а у
 * встановленому застосунку каталогу `client/` немає — фреймворк лежить у
 * `vendor/`, а `@client/` це аліас карти імпортів. Тип `document` не
 * генерувався взагалі (`Module not found`), і побачити це в монорепо неможливо:
 * тут обидві гілки ведуть в один файл.
 *
 * Тому проба перевіряє саме РЕЗОЛВ — без імпорту й без мережі.
 */
import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  booleanDefaultSql,
  collectModelDirs,
  documentHeaderSpecifier,
  type ModelMetaMap,
  refDisplaySql,
  refJoinSql,
  resolveRef,
} from "./generate-model-sql.ts";

/** Тимчасове дерево «застосунок»: `<root>/app` + `<root>/deno.json`. */
async function appWithConfig(config?: string): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "altera-header-" });
  await Deno.mkdir(join(root, "app"));
  if (config !== undefined) await Deno.writeTextFile(join(root, "deno.json"), config);
  return join(root, "app");
}

Deno.test("встановлений застосунок: аліас веде в реєстр", async () => {
  const appRoot = await appWithConfig(`{
    // Конфіг Deno — JSONC, і в шаблоні коментарі справді є.
    "imports": { "@client/": "jsr:/@altera/client@^0.9.1/" }
  }`);

  // Скісна після схеми — форма для КАРТИ імпортів; специфікатору імпорту вона
  // зайва, і саме на ній резолв мовчки промахнувся б.
  assertEquals(
    await documentHeaderSpecifier(appRoot),
    "jsr:@altera/client@^0.9.1/shared/schema.ts",
  );
});

Deno.test("ім'я пакета без аліаса теж годиться", async () => {
  const appRoot = await appWithConfig(`{
    "imports": { "@altera/client": "jsr:@altera/client@^0.9.1" }
  }`);

  assertEquals(
    await documentHeaderSpecifier(appRoot),
    "jsr:@altera/client@^0.9.1/shared/schema.ts",
  );
});

Deno.test("монорепозиторій: аліас веде в сусідній каталог", async () => {
  const appRoot = await appWithConfig(`{ "imports": { "@client/": "./client/" } }`);

  const specifier = await documentHeaderSpecifier(appRoot);
  assertStringIncludes(specifier, "file://");
  assertStringIncludes(specifier, "/client/shared/schema.ts");
});

Deno.test("немає ні карти, ні сусіда — відмова називає, чого бракує", async () => {
  const appRoot = await appWithConfig();

  const error = await assertRejects(() => documentHeaderSpecifier(appRoot), Error);
  assertStringIncludes(error.message, "@client/");
});

/**
 * Коло моделей, на які МОЖНА ПОСЛАТИСЯ, ширше за коло тих, чий SQL збирається.
 *
 * Доти карта `x-ref` будувалася з `app/sql.json`, і модель, чий SQL живе в ядрі
 * (`admin/user` — це `app.users` із `@core/access`), туди не потрапляла зовсім:
 * посилання на користувача падало з «модель не знайдена». Ознака «мій SQL
 * пишуть інші» та «на мене не можна посилатися» — різні речі.
 */
async function appTree(dirs: string[]): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "altera-modelmap-" });
  for (const dir of dirs) {
    await Deno.mkdir(join(root, dir), { recursive: true });
    await Deno.writeTextFile(
      join(root, dir, "manifest.json"),
      JSON.stringify({ model: dir.split("/").pop(), type: "catalog" }),
    );
  }
  return root;
}

Deno.test("карта моделей: обхід бере манифести, а не sql.json", async () => {
  const root = await appTree(["catalog/bank", "admin/user"]);
  try {
    // `sql.json` тут навмисно згадує лише одну модель — карту це не звужує.
    await Deno.writeTextFile(join(root, "sql.json"), JSON.stringify({ models: ["catalog/bank"] }));

    const dirs = (await collectModelDirs(root)).map((dir) => dir.slice(root.length + 1).replaceAll("\\", "/"));
    assertEquals(dirs.sort(), ["admin/user", "catalog/bank"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("карта моделей: службові каталоги не є моделями", async () => {
  const root = await appTree(["catalog/bank"]);
  try {
    // `_generated`, `_locales` — не моделі; манифеста в них немає, але й
    // спускатися туди нема потреби.
    await Deno.mkdir(join(root, "_generated"), { recursive: true });
    await Deno.writeTextFile(join(root, "_generated", "manifest.json"), "{}");
    // Каталог без манифеста лишається прохідним: моделі лежать під родиною.
    await Deno.mkdir(join(root, "report", "empty"), { recursive: true });

    const dirs = (await collectModelDirs(root)).map((dir) => dir.slice(root.length + 1).replaceAll("\\", "/"));
    assertEquals(dirs, ["catalog/bank"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/**
 * Умовчання логічного поля.
 *
 * Проба тут не про арифметику, а про напрямок помилки: генератор ставить це
 * значення в `coalesce` для поля, якого може не бути в payload, — і `true`
 * нізвідки означав би вигаданий факт («ціни з ПДВ», «враховувати знижку»),
 * тобто інші суми в документі. Валідності SQL це не порушує, типів — теж,
 * тому не ловилося нічим.
 */
Deno.test("логічне поле: умовчання — false, якщо в схемі не сказано інакше", () => {
  assertEquals(booleanDefaultSql(undefined), "false");
  assertEquals(booleanDefaultSql(false), "false");
  // Не-булеві значення теж не роблять поле істинним: схема з таким умовчанням
  // помилкова, і вигадувати за неї «так» — найгірше з можливого.
  assertEquals(booleanDefaultSql(null), "false");
  assertEquals(booleanDefaultSql("true"), "false");
  assertEquals(booleanDefaultSql(1), "false");

  // Явне `true` — єдине, що дає `true`.
  assertEquals(booleanDefaultSql(true), "true");
});

/**
 * Ссылка на ДОКУМЕНТ.
 *
 * Правило `x-ref` виведене з довідників, і на документи не поширювалося: join
 * будувався за колонкою `id`, якої в таблиці документа немає взагалі —
 * первинний ключ там `document_id`, а номер, дата й представлення живуть у
 * спільній шапці `app.document`. Тобто послатися на документ у схемі моделі не
 * можна було НІ НА ЯКИЙ, і падало це аж на публікації SQL («column
 * r_shipment.id does not exist»), тобто за два кроки від причини.
 *
 * Проби тут на SQL-рядках, а не на базі: розкладка «шапка в ядрі, реквізити в
 * таблиці моделі» видно рівно в них.
 */
const META: ModelMetaMap = new Map([
  ["bank", { schema: "app", model: "bank", table: "bank", pk: "id", displayCol: "name", isDocument: false }],
  ["goods_sale", {
    schema: "app",
    model: "goods_sale",
    table: "goods_sale",
    pk: "document_id",
    displayCol: "presentation",
    isDocument: true,
  }],
]);

Deno.test("ссылка на документ: join за document_id плюс шапка", () => {
  const ref = resolveRef({ model: "goods_sale", as: "shipment" }, "shipment_id", META, "return.shipmentId");

  assertEquals(ref.targetPk, "document_id");
  assertEquals(ref.displayInHeader, true);
  assertEquals(refJoinSql(ref, "t"), [
    "left join app.goods_sale r_shipment on r_shipment.document_id = t.shipment_id",
    "left join app.document d_shipment on d_shipment.id = r_shipment.document_id",
  ]);
});

/**
 * Подання документа за умовчанням — денормалізоване `presentation`, і воно
 * буває порожнім: заповнює його НЕОБОВ'ЯЗКОВИЙ хук `_denormalize`. Порожній
 * підпис у пікері невідрізненний від зламаного поля, тому падаємо на номер.
 *
 * Складати «номер від дати» тут не можна: «від» — це текст мовою, а сервер
 * тексту не перекладає. Хто хоче такий підпис, складає його у своєму
 * `_denormalize` — мовою свого застосунку.
 */
Deno.test("подання документа: presentation із падінням на номер", () => {
  const ref = resolveRef({ model: "goods_sale", as: "shipment" }, "shipment_id", META, "return.shipmentId");

  assertEquals(ref.displayKey, "presentation");
  assertEquals(
    refDisplaySql(ref),
    "coalesce(nullif(d_shipment.presentation, ''), d_shipment.number)",
  );
  // Эхо ссылочного фільтра будує той самий вираз на своїх аліасах.
  assertEquals(
    refDisplaySql(ref, "x", "xh"),
    "coalesce(nullif(xh.presentation, ''), xh.number)",
  );
});

Deno.test("явний display: колонка шапки береться з шапки, ключ — camelCase", () => {
  const ref = resolveRef(
    { model: "goods_sale", as: "shipment", display: "doc_date" },
    "shipment_id",
    META,
    "return.shipmentId",
  );

  assertEquals(ref.displayKey, "docDate");
  assertEquals(refDisplaySql(ref), "d_shipment.doc_date");
});

/**
 * `display` цілком може називати ВЛАСНИЙ реквізит документа — тоді шапка не
 * потрібна зовсім. Куди йти, вирішує колонка, а не тип цілі.
 */
Deno.test("display власного реквізиту документа: другого join немає", () => {
  const ref = resolveRef(
    { model: "goods_sale", as: "shipment", display: "warehouse_note" },
    "shipment_id",
    META,
    "return.shipmentId",
  );

  assertEquals(ref.displayInHeader, false);
  assertEquals(ref.headerAlias, undefined);
  assertEquals(refJoinSql(ref, "t").length, 1);
  assertEquals(refDisplaySql(ref), "r_shipment.warehouse_note");
});

/** Довідник лишається таким, як був: один join за `id`, подання — `name`. */
Deno.test("ссылка на довідник не змінилася", () => {
  const ref = resolveRef({ model: "bank" }, "bank_id", META, "account.bankId");

  assertEquals(ref.displayKey, "name");
  assertEquals(refDisplaySql(ref), "r_bank.name");
  assertEquals(refJoinSql(ref, "t"), [
    "left join app.bank r_bank on r_bank.id = t.bank_id",
  ]);
});

/** Подання їде в SQL текстом — ім'я колонки мусить бути ідентифікатором. */
Deno.test("display перевіряється як ідентифікатор", () => {
  assertThrows(
    () => resolveRef({ model: "bank", display: "name; drop table" }, "bank_id", META, "account.bankId"),
    Error,
    "x-ref.display",
  );
});

/**
 * Пошук по подання йде `ilike`, а в шапці документа є і дата, і сума. Без цієї
 * відмови воно проходило б генерацію й публікацію (тіло `list` — plpgsql,
 * `create function` його не перевіряє) і вилазило на першому наборі символів у
 * полі пошуку — помилкою типу, за крок від причини.
 */
Deno.test("searchable по нетекстовій колонці шапки — відмова на генерації", () => {
  assertThrows(
    () =>
      resolveRef(
        { model: "goods_sale", as: "shipment", display: "doc_date", searchable: true },
        "shipment_id",
        META,
        "return.shipmentId",
      ),
    Error,
    "не текст",
  );

  // Текстове подання лишається придатним для пошуку.
  const ref = resolveRef(
    { model: "goods_sale", as: "shipment", searchable: true },
    "shipment_id",
    META,
    "return.shipmentId",
  );
  assertEquals(ref.searchable, true);
});
