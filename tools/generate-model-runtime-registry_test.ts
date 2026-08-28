// Ім'я моделі унікальне на весь застосунок.
//
// Перевірка коштує п'яти рядків, а її відсутність коштувала б довго: усе далі
// ключується іменем моделі (SQL-функції однієї схеми, рядки прав, аудит), тож
// другий манифест із тим самим `model` мовчки перемагав би останнім записом у
// реєстрі, а зіткнення вилазило б аж при публікації SQL — або не вилазило
// зовсім, і застосунок працював би не з тією моделлю.
import { assertEquals, assertThrows } from "@std/assert";
import {
  agentCommandsFor,
  assertAgentCommands,
  assertCommandsBlock,
  assertUniqueModels,
  formatAgentSchemaFailures,
  stripCommentKeys,
} from "./generate-model-runtime-registry.ts";

Deno.test("унікальні імена проходять", () => {
  assertUniqueModels([
    { manifestPath: "app/catalog/bank/manifest.json", manifest: { model: "bank" } },
    { manifestPath: "app/document/invoice/manifest.json", manifest: { model: "invoice" } },
    // Манифест без імені не рахується за дублікат порожнього рядка.
    { manifestPath: "app/broken/manifest.json", manifest: {} },
    { manifestPath: "app/broken2/manifest.json", manifest: {} },
  ]);
});

Deno.test("дублікат називає обидва манифести", () => {
  const error = assertThrows(() =>
    assertUniqueModels([
      { manifestPath: "app/catalog/status/manifest.json", manifest: { model: "status" } },
      { manifestPath: "app/register/status/manifest.json", manifest: { model: "status" } },
    ])
  );

  const message = error instanceof Error ? error.message : String(error);
  // Обидва шляхи в тексті: інакше доведеться шукати другий руками.
  assertEquals(message.includes("catalog/status"), true);
  assertEquals(message.includes("register/status"), true);
  assertEquals(message.includes("'status'"), true);
});

/**
 * Ключі-коментарі в манифесті.
 *
 * `"//picker": "…"` — домовленість усього репозиторію: у JSON коментарів немає,
 * а пояснити рядок треба. Генератор про неї не знав і обходив ключі `views`
 * підряд, тож на коментарі діставав рядок замість опису в'ю й падав із
 * `Path must be a string, received "undefined"` — повідомленням, яке не називає
 * ні манифеста, ні ключа. Гірше за саме падіння те, що до нього генератор уже
 * записав реєстр, ts-commands і agent-routes: застосунок лишався з ЧАСТКОВО
 * оновленою генерацією, і виглядало це як зламаний застосунок.
 */
Deno.test("коментар прибирається на всіх рівнях манифеста", () => {
  const manifest = stripCommentKeys({
    model: "price_setting",
    "//views": "чому пікера немає",
    views: {
      list: { module: "./priceSettingList.ts" },
      "//picker": "пікера немає навмисно: на документ не посилаються",
    },
    commands: {
      // Той самий коментар нижче за течією мовчки став би командою «//at».
      sql: { at: {}, "//at": "зріз на дату" },
    },
  }) as Record<string, Record<string, unknown>>;

  assertEquals(Object.keys(manifest), ["model", "views", "commands"]);
  assertEquals(Object.keys(manifest.views), ["list"]);
  assertEquals(Object.keys(manifest.commands.sql as object), ["at"]);
});

Deno.test("масиви й скаляри лишаються собою", () => {
  const manifest = stripCommentKeys({
    agent: { aliases: ["банк", "банки"], allow: true, priority: 10 },
  }) as { agent: { aliases: string[]; allow: boolean; priority: number } };

  assertEquals(manifest.agent.aliases, ["банк", "банки"]);
  assertEquals(manifest.agent.allow, true);
  assertEquals(manifest.agent.priority, 10);
});

/**
 * Незнайома форма запису в `commands`.
 *
 * Генератор читає рівно три ключі, а манифест — звичайний JSON і приймає будь-який.
 * Три документи ПДВ у застосунку прожили з непрацездатною кнопкою «Заповнити» від
 * дня, коли їх зробили, до дня, коли хтось порівняв два манифести очима: у реєстрі
 * команди немає, рантайм fail-closed відмовляє, а SQL-функція в базі є й працює —
 * тобто проба на SQL зелена саме тому, що обходить рантайм.
 */
Deno.test("незнайомий ключ у commands валить генерацію", () => {
  const error = assertThrows(() =>
    assertCommandsBlock("app/document/vat_compensating/manifest.json", {
      model: "vat_compensating",
      commands: { fill: { access: "edit" } } as never,
    })
  );

  const message = error instanceof Error ? error.message : String(error);
  assertEquals(message.includes("vat_compensating/manifest.json"), true);
  assertEquals(message.includes('"fill" — невідомий ключ'), true);
  // Текст мусить називати правильну форму: помилку читає той, хто її й зробив.
  assertEquals(message.includes("commands.sql"), true);
});

Deno.test("access поза словником дій валить генерацію", () => {
  const error = assertThrows(() =>
    assertCommandsBlock("app/document/vat_compensating/manifest.json", {
      commands: { sql: { fill: "vat_compensating_fill" }, access: { fill: "vat_compensating.update" } },
    })
  );

  const message = error instanceof Error ? error.message : String(error);
  assertEquals(message.includes("access.fill"), true);
  assertEquals(message.includes("vat_compensating.update"), true);
});

Deno.test("правильна форма проходить мовчки", () => {
  assertCommandsBlock("app/document/vat_compensating/manifest.json", {
    commands: {
      sql: { fill: "vat_compensating_fill" },
      ts: { printPdf: { handlerKey: "runtime.printPdf" } },
      access: { fill: "edit", current: "authenticated" },
    },
  });
  // Моделі без нестандартних команд перевіряти нема чого.
  assertCommandsBlock("app/catalog/bank/manifest.json", { model: "bank" });
});


/**
 * Відмова замість порожніх схем агента.
 *
 * Перевіряємо не факт кидка, а ТЕКСТ: адміністратор бачить рівно його, і саме
 * тексту тут бракувало найдовше. Випадок, який це коштував, — `sql:registry`
 * до `deno install` у ланцюжку `solution:update`: не завантажилася жодна схема,
 * генератор дописав порожній `agent-tools.generated.ts` і вийшов з нулем.
 */
Deno.test("не завантажилася ЖОДНА схема — у відмові названо deno install", () => {
  const message = formatAgentSchemaFailures(
    [
      { model: "bank", schemaPath: "app/catalog/bank/bank.schema.ts", cause: new Error("not found") },
      { model: "invoice", schemaPath: "app/document/invoice/invoice.schema.ts", cause: new Error("not found") },
    ],
    2,
  );

  assertEquals(message.includes("deno install"), true);
  assertEquals(message.includes("bank"), true);
  assertEquals(message.includes("invoice"), true);
});

Deno.test("зламана схема однієї моделі не радить ставити залежності", () => {
  const message = formatAgentSchemaFailures(
    [{ model: "bank", schemaPath: "app/catalog/bank/bank.schema.ts", cause: new Error("Unexpected token") }],
    40,
  );

  // Тридцять дев'ять моделей завантажилися — справа не в залежностях, і
  // порада ставити їх повела б шукати не там.
  assertEquals(message.includes("deno install"), false);
  assertEquals(message.includes("Unexpected token"), true);
  assertEquals(message.includes("(1 з 40)"), true);
});

/**
 * `allowCommands` ДОДАЄ, а не лише віднімає.
 *
 * Доти список фільтрував фіксований базовий набір, тож ім'я нестандартної
 * команди не могло потрапити в перелік агента взагалі: `"allowCommands":
 * ["list", "get", "at"]` відрізав `save` і `delete`, а `at` тихо не давав
 * нічого. Наслідок бачив рівно той, хто спробував покликати: агент, що вводив
 * первинний документ, отримав «Команда 'at' не оголошена для агента», хоч
 * форма кличе цю саму команду й підставляє рахунок обліку сама.
 */
Deno.test("оголошена команда моделі доходить до агента", () => {
  const commands = agentCommandsFor({
    model: "item_account",
    type: "register",
    commands: {
      sql: { at: "item_account_at" },
      access: { at: "view" },
    },
    agent: { allow: true, allowCommands: ["list", "get", "at"] },
  });

  assertEquals(commands, ["list", "get", "at"]);
});

Deno.test("без allowCommands оголошена команда лишається закритою", () => {
  // Умовчання не міняється: `commands.access` каже, з яким правом команду
  // МОЖНА виконати, а не «покажіть її агенту».
  const commands = agentCommandsFor({
    model: "item_account",
    type: "register",
    commands: { sql: { at: "item_account_at" }, access: { at: "view" } },
  });

  assertEquals(commands, ["list", "get", "save", "delete"]);
});

Deno.test("allowCommands звужує базовий набір, як і раніше", () => {
  const commands = agentCommandsFor({
    model: "nomenclature",
    type: "catalog",
    agent: { allow: true, allowCommands: ["get", "save", "list", "lookup"] },
  });

  // Порядок базових лишається порядком типу, а не манифеста: інакше перелік
  // перетасувався б у кожному застосунку на першій же генерації.
  assertEquals(commands, ["list", "get", "save", "lookup"]);
});

/**
 * Стандартне ім'я на моделі, чий тип не дає в умовчанні нічого.
 *
 * Саме на цьому мовчки стояв шаблон scaffold'а: `admin/remark` оголошує
 * `["list", "get", "answer"]`, `agentBaseCommands("admin")` віддає порожньо —
 * і агент не бачив там НІЧОГО, включно з `list`, хоч `app.remark_list` існує.
 */
Deno.test("стандартне ім'я на admin-моделі приймається як заява застосунку", () => {
  const commands = agentCommandsFor({
    model: "remark",
    type: "admin",
    commands: {
      sql: { answer: "remark_answer", verify: "remark_verify" },
      access: { answer: "edit", verify: "edit" },
    },
    agent: { allow: true, allowCommands: ["list", "get", "answer"] },
  });

  assertEquals(commands, ["list", "get", "answer"]);
});

Deno.test("друк і періодична трійка доступні на ім'я", () => {
  const commands = agentCommandsFor({
    model: "price_setting",
    type: "register",
    periodic: { by: "nomenclature_id" },
    prints: { card: {} },
    agent: { allow: true, allowCommands: ["list", "at", "printPdf"] },
  });

  assertEquals(commands, ["list", "printPdf", "at"]);
});

/**
 * Ім'я, якого модель ніде не оголосила, валить генерацію.
 *
 * Той самий принцип, що вже прийнятий для незнайомого ключа в `commands`:
 * команда, якої не буде в переліку, — це непрацездатний виклик, а не стиль
 * запису. `allowCommands` лишався останнім місцем у манифесті, де ім'я можна
 * було написати й не отримати нічого.
 */
Deno.test("невідоме ім'я в allowCommands валить генерацію", () => {
  const error = assertThrows(() =>
    assertAgentCommands("app/catalog/nomenclature/manifest.json", {
      model: "nomenclature",
      type: "catalog",
      agent: { allowCommands: ["list", "groupTree"] },
    })
  );

  const message = error instanceof Error ? error.message : String(error);
  assertEquals(message.includes("nomenclature/manifest.json"), true);
  assertEquals(message.includes('"groupTree"'), true);
  // Текст мусить називати правильну форму — читає його той, хто це й написав.
  assertEquals(message.includes("commands.sql"), true);
});

Deno.test("оголошена команда без права теж валить генерацію", () => {
  const error = assertThrows(() =>
    assertAgentCommands("app/catalog/nomenclature/manifest.json", {
      model: "nomenclature",
      type: "catalog",
      commands: { sql: { groupTree: "nomenclature_group_tree" } },
      agent: { allowCommands: ["list", "groupTree"] },
    })
  );

  const message = error instanceof Error ? error.message : String(error);
  assertEquals(message.includes("commands.access"), true);
  assertEquals(message.includes("501"), true);
});

Deno.test("правильний allowCommands проходить мовчки", () => {
  assertAgentCommands("app/data/item_account/manifest.json", {
    model: "item_account",
    type: "register",
    commands: { sql: { at: "item_account_at" }, access: { at: "view" } },
    agent: { allowCommands: ["list", "get", "at"] },
  });
  // Періодична трійка права не оголошує — воно виводиться з блока `periodic`,
  // так само як і самі функції.
  assertAgentCommands("app/data/price_setting/manifest.json", {
    model: "price_setting",
    type: "register",
    periodic: { by: "nomenclature_id" },
    agent: { allowCommands: ["at", "history"] },
  });
  // Моделі без `allowCommands` перевіряти нема чого.
  assertAgentCommands("app/catalog/bank/manifest.json", { model: "bank" });
});
