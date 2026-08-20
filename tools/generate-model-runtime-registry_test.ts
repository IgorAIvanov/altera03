// Ім'я моделі унікальне на весь застосунок.
//
// Перевірка коштує п'яти рядків, а її відсутність коштувала б довго: усе далі
// ключується іменем моделі (SQL-функції однієї схеми, рядки прав, аудит), тож
// другий манифест із тим самим `model` мовчки перемагав би останнім записом у
// реєстрі, а зіткнення вилазило б аж при публікації SQL — або не вилазило
// зовсім, і застосунок працював би не з тією моделлю.
import { assertEquals, assertThrows } from "@std/assert";
import {
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
