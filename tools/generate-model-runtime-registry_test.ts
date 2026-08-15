// Ім'я моделі унікальне на весь застосунок.
//
// Перевірка коштує п'яти рядків, а її відсутність коштувала б довго: усе далі
// ключується іменем моделі (SQL-функції однієї схеми, рядки прав, аудит), тож
// другий манифест із тим самим `model` мовчки перемагав би останнім записом у
// реєстрі, а зіткнення вилазило б аж при публікації SQL — або не вилазило
// зовсім, і застосунок працював би не з тією моделлю.
import { assertEquals, assertThrows } from "@std/assert";
import { assertUniqueModels, stripCommentKeys } from "./generate-model-runtime-registry.ts";

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
