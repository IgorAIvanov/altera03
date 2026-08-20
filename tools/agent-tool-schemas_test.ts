/**
 * Межа між «схеми немає» і «схема не завантажилася».
 *
 * Доти обидва випадки ловив один `catch { return [] }`, і найдешевший спосіб у
 * нього потрапити — запустити `sql:registry` до `deno install`: не резолвиться
 * жоден імпорт, кожна модель віддає порожньо, `agent-tools.generated.ts`
 * виходить у двадцять разів менший, а код виходу нуль. Установка після такого
 * оновлення працює екранами й мовчки лишається з агентом БЕЗ інструментів.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";

import { AgentSchemaLoadError, buildAgentToolsForModel } from "./agent-tool-schemas.ts";

Deno.test("схеми немає — модель просто не має інструментів", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const tools = await buildAgentToolsForModel(
      "bank",
      join(dir, "bank.schema.ts"),
      ["list", "get"],
    );
    assertEquals(tools, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("схема є, але не завантажилася — це відмова, а не порожній опис", async () => {
  const dir = await Deno.makeTempDir();
  const schemaPath = join(dir, "bank.schema.ts");
  try {
    // Рівно те, що бачить генератор без установлених залежностей: файл на
    // місці, а імпорт усередині не резолвиться.
    await Deno.writeTextFile(schemaPath, 'export * from "./not-installed.ts";\n');

    const error = await assertRejects(
      () => buildAgentToolsForModel("bank", schemaPath, ["list", "get"]),
      AgentSchemaLoadError,
    );

    // Модель і шлях — у самій помилці: генератор складає з них поіменний
    // перелік, а без них лишилося б «щось не завантажилося».
    assertEquals(error.model, "bank");
    assertEquals(error.schemaPath, schemaPath);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
