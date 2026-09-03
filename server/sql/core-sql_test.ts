// Згенерований `core-sql.generated.ts` не розійшовся з `.sql` на диску.
//
// Без цієї проби розсинхрон непомітний: збірка пакета мовчки взяла б старий
// текст, і в базу поїхала б попередня версія функції. Новий файл впаде сам
// (`file()` кидає, коли ключа немає в мапі) — тут ловиться саме ЗМІНЕНИЙ.
import { assertEquals } from "@std/assert";
import { join, relative, SEPARATOR } from "@std/path";
import { CORE_SQL_TEXT } from "./core-sql.generated.ts";

const SQL_DIR = import.meta.dirname!;

async function readSqlFromDisk(): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  for await (const pkg of Deno.readDir(SQL_DIR)) {
    if (!pkg.isDirectory) continue;
    const dbDir = join(SQL_DIR, pkg.name, "db");

    try {
      for await (const entry of Deno.readDir(dbDir)) {
        if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
        const path = join(dbDir, entry.name);
        const key = relative(SQL_DIR, path).split(SEPARATOR).join("/");
        // Та сама нормалізація, що й у генераторі: інакше проба падала б на
        // машині з core.autocrlf=true після звичайного чекауту.
        files.set(key, (await Deno.readTextFile(path)).replaceAll("\r\n", "\n"));
      }
    } catch {
      // Пакет без db/ — не помилка.
    }
  }

  return files;
}

Deno.test("core-sql.generated.ts збігається з .sql на диску", async (t) => {
  const onDisk = await readSqlFromDisk();

  await t.step("склад файлів той самий", () => {
    assertEquals(
      Object.keys(CORE_SQL_TEXT).sort(),
      [...onDisk.keys()].sort(),
      "склад .sql змінився — виконай `deno task core:sql`",
    );
  });

  await t.step("текст кожного файлу той самий", () => {
    for (const [key, sql] of onDisk) {
      assertEquals(
        CORE_SQL_TEXT[key],
        sql,
        `${key} змінився після генерації — виконай \`deno task core:sql\``,
      );
    }
  });
});

/**
 * Правила ядра — сусідній вихід того самого прогону, і застаріти вони можуть
 * тихіше за SQL: новий `raise exception` у `document_core` просто не з'явиться
 * в переліку, який агент читає перед тим, як радити порядок дій. Тобто вийде
 * рівно те, від чого перелік і рятує, — правило є, а видно його не буде.
 */
Deno.test("core-agent-rules.generated.ts збігається з маркерами ядра", async () => {
  const { coreAgentRules } = await import("../modules/agent/core-agent-rules.generated.ts");
  const { findMarkers } = await import("@altera/tools/scan-translation-markers");

  const documentKeys = new Set<string>();
  const dbDir = join(SQL_DIR, "document_core", "db");
  for await (const entry of Deno.readDir(dbDir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const path = join(dbDir, entry.name);
    for (const use of findMarkers(await Deno.readTextFile(path), path)) {
      documentKeys.add(use.key);
    }
  }

  assertEquals(
    coreAgentRules.document ?? [],
    [...documentKeys].sort(),
    "маркери document_core змінилися — виконай `deno task core:sql`",
  );
});
