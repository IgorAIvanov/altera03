// Реєстр наборів імпорту: що саме береться в граф модулів, а що лишається
// файлом.
//
// Перевіряється тут не зручність, а єдина властивість, заради якої реєстр і
// існує: імпорти мусять бути СТАТИЧНИМИ. Обхід каталогу в рантаймі працює в
// `deno task dev` і мовчки не працює в бінарі та на Deploy — тобто саме там,
// де набір правил і потрібен. Помилка при цьому виглядає не як «набору немає»,
// а як «перенесення нічого не знайшло».
import { assertEquals } from "@std/assert";
import { collectImportSets, importIdentifier, renderImportSets } from "./import-sets.ts";

async function withApp(
  files: Record<string, string>,
  run: (appDir: string) => Promise<void>,
): Promise<void> {
  const appDir = await Deno.makeTempDir({ prefix: "altera-import-sets-" });
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = `${appDir}/${path}`;
      await Deno.mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
      await Deno.writeTextFile(full, content);
    }
    await run(appDir);
  } finally {
    await Deno.remove(appDir, { recursive: true });
  }
}

Deno.test("немає каталогу _import — порожній перелік, а не помилка", async () => {
  await withApp({ "catalog/bank/manifest.json": "{}" }, async (appDir) => {
    assertEquals(await collectImportSets(appDir), []);
  });
});

Deno.test("правила, запити й решта файлів розкладаються за суфіксом", async () => {
  await withApp({
    "_import/bas-2.1/counterparty.rule.ts": "export default {};",
    "_import/bas-2.1/catalogs/nomenclature.rule.ts": "export default {};",
    "_import/bas-2.1/queries/settlement.query.ts": "export default '';",
    "_import/bas-2.1/metadata.json": "{}",
    "_import/bas-2.1/adapter.epf": "binary",
    // `.ts`, який не оголосив себе ні правилом, ні запитом, у граф не їде:
    // імпортувати наосліп хелпери й чернетки означало б падати на першій же.
    "_import/bas-2.1/helpers.ts": "export const x = 1;",
  }, async (appDir) => {
    const [set] = await collectImportSets(appDir);
    assertEquals(set.name, "bas-2.1");
    assertEquals(set.dir, "_import/bas-2.1");
    assertEquals(set.rules.map((rule) => rule.name), ["catalogs/nomenclature", "counterparty"]);
    // Домовлена тека `queries/` в імені не лишається: набір звертається до
    // запиту його власним іменем.
    assertEquals(set.queries.map((query) => query.name), ["settlement"]);
    assertEquals(set.files, ["adapter.epf", "helpers.ts", "metadata.json"]);
  });
});

Deno.test("у модулі реєстру імпорти статичні, а шлях веде в набір", async () => {
  await withApp({
    "_import/bas-2.1/counterparty.rule.ts": "export default {};",
    "_import/excel/nomenclature.rule.ts": "export default {};",
  }, async (appDir) => {
    const sets = await collectImportSets(appDir);
    const source = renderImportSets(sets, `${appDir}/_generated`, appDir);

    // Саме `import … from`, а не `await import(...)`: різниця між тим, що
    // потрапить у бінар, і тим, що не потрапить.
    assertEquals(source.includes('import rule_bas_2_1_counterparty from "../_import/bas-2.1/counterparty.rule.ts";'), true);
    assertEquals(source.includes("await import("), false);

    // Два набори з однойменними правилами не стикаються: ідентифікатор несе
    // ім'я набору.
    assertEquals(importIdentifier("bas-2.1", "rule", "counterparty"), "rule_bas_2_1_counterparty");
    assertEquals(importIdentifier("excel", "rule", "counterparty"), "rule_excel_counterparty");
    assertEquals(source.includes('"bas-2.1"'), true);
    assertEquals(source.includes('"excel"'), true);
  });
});

Deno.test("порожній застосунок дає порожній реєстр, а не відсутній файл", async () => {
  // Відсутній файл — це помилка імпорту в застосунку, який його вже чекає;
  // порожній — чесна відповідь «наборів немає».
  const source = renderImportSets([], "/app/_generated", "/app");
  assertEquals(source.includes("export const importSets"), true);
  assertEquals(source.includes("{};"), true);
});

Deno.test("два файли з одним іменем — голосна відмова", async () => {
  await withApp({
    "_import/bas-2.1/settlement.query.ts": "export default '';",
    "_import/bas-2.1/queries/settlement.query.ts": "export default '';",
  }, async (appDir) => {
    let message = "";
    try {
      await collectImportSets(appDir);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // Обидва шляхи в тексті: інакше другий доведеться шукати руками.
    assertEquals(message.includes("settlement.query.ts"), true);
    assertEquals(message.includes("queries/settlement.query.ts"), true);
  });
});
