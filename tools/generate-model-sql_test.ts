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
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { documentHeaderSpecifier } from "./generate-model-sql.ts";

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
