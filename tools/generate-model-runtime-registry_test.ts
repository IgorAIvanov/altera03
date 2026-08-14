// Ім'я моделі унікальне на весь застосунок.
//
// Перевірка коштує п'яти рядків, а її відсутність коштувала б довго: усе далі
// ключується іменем моделі (SQL-функції однієї схеми, рядки прав, аудит), тож
// другий манифест із тим самим `model` мовчки перемагав би останнім записом у
// реєстрі, а зіткнення вилазило б аж при публікації SQL — або не вилазило
// зовсім, і застосунок працював би не з тією моделлю.
import { assertEquals, assertThrows } from "@std/assert";
import { assertUniqueModels } from "./generate-model-runtime-registry.ts";

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
