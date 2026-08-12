/**
 * Порядок секцій у зібраному пакеті — те, що ламається мовчки й дорого.
 *
 * Метадані застосунку (типи документів, оголошення нумераторів) мусять стояти
 * ПЕРЕД сідами моделей: сід, що заводить документ через `<model>_save` — саме
 * так, як радить документація, — інакше падає на порожній базі з «Тип документа
 * не зареєстровано», причому невідновно: публікація зупиняється ДО реєстрації
 * типів, тож наступна впирається в те саме.
 *
 * А пересів лічильника — навпаки, ПІСЛЯ сідів: він підтягує нумератор під рядки,
 * які сід вставив прямим `insert` із власним кодом.
 *
 * Проба дивиться на порядок ЗАГОЛОВКІВ секцій, а не на сам SQL: предметом
 * домовленості є саме порядок.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { assembleSqlPackage } from "./assemble-sql-package.ts";

async function writeFile(path: string, content: string) {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, content);
}

/** Найменший застосунок, у якому є всі три учасники порядку. */
async function buildFixture(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "altera-assemble-probe-" });

  await Deno.writeTextFile(
    join(dir, "sql.json"),
    JSON.stringify({ models: ["catalog/thing", "document/bill"] }),
  );

  await writeFile(
    join(dir, "catalog/thing/manifest.json"),
    JSON.stringify({
      model: "thing",
      type: "catalog",
      schema: "app",
      numbering: { field: "code", template: "{NNNNNN}" },
    }),
  );
  await writeFile(join(dir, "catalog/thing/db/data.sql"), "-- сід довідника\n");

  await writeFile(
    join(dir, "document/bill/manifest.json"),
    JSON.stringify({
      model: "bill",
      type: "document",
      schema: "app",
      document: { name: "Рахунок", prefix: "BL" },
      numbering: { field: "number", template: "{NNNNNN}", period: "year" },
    }),
  );
  // Сід, що заводить документ, — рівно той випадок, заради якого порядок і потрібен.
  await writeFile(
    join(dir, "document/bill/db/data.sql"),
    "select app.bill_save(1, '{}'::jsonb);\n",
  );

  return dir;
}

Deno.test("пакет: метадані до сідів застосунку, пересів лічильників після", async () => {
  const dir = await buildFixture();
  try {
    await assembleSqlPackage(dir, { coreSql: () => undefined });

    const sql = await Deno.readTextFile(join(dir, "_sqlpackage", "data_app.sql"));
    const sections = [...sql.matchAll(/^-- >>> BEGIN (.+)$/gm)].map((m) => m[1].trim());

    const at = (name: string) => {
      const index = sections.indexOf(name);
      assert(index >= 0, `секції «${name}» немає: ${sections.join(", ")}`);
      return index;
    };

    // Типи документів і оголошення нумераторів — раніше за будь-який сід моделі.
    const firstModelSeed = sections.findIndex((name) => name.endsWith("/db/data.sql"));
    assert(firstModelSeed >= 0, "сідів моделей немає — фікстура зламана");
    assert(
      at("_generated/document-types.data.sql") < firstModelSeed,
      "типи документів мусять реєструватися ДО сідів застосунку",
    );
    assert(
      at("_generated/numerators.data.sql") < firstModelSeed,
      "оголошення нумераторів мусять стояти ДО сідів застосунку",
    );

    // Пересів — після всіх сідів: він рахує те, що вони вставили.
    const lastModelSeed = sections.map((name) => name.endsWith("/db/data.sql"))
      .lastIndexOf(true);
    assert(
      at("_generated/numerators-reseed.data.sql") > lastModelSeed,
      "пересів лічильників мусить іти ПІСЛЯ сідів застосунку",
    );

    // Пересів і оголошення — різні секції, а не одна: у них різні місця.
    assertEquals(
      sql.includes("app.numerator_reseed('bill')") &&
        sql.includes("insert into app.numerator (model, name, template"),
      true,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
