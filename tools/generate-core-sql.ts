// Вбудовування SQL ядра у TS-модуль.
//
// Навіщо. Файли ядра лишаються звичайними `.sql` — їх редагують і читають як
// SQL. Раніше вони потрапляли в пакет text-імпортами (`with { type: "text" }`),
// але це експериментальна можливість Deno (`--unstable-raw-imports`), і граф
// на боці JSR її не розбирає: публікація `@altera/server` падає з
// «The import attribute type of "text" is unsupported». Локальний
// `deno publish --dry-run` цього не показує — граф там будує наш Deno, а не
// реєстр. Тому текст переїжджає в згенерований `.ts`, а `.sql` лишаються
// джерелом.
//
// Розсинхрон ловиться з двох боків: новий `.sql`, якого немає в мапі, валить
// збірку пакета (`getCoreSqlPackage` кидає), а змінений — пробу
// `server/sql/core-sql_test.ts` у `deno task test:unit`.
import { join, relative, SEPARATOR } from "@std/path";

const HEADER = `// ЗГЕНЕРОВАНО \`deno task core:sql\` з server/sql/**/db/*.sql — не редагувати.
//
// Текст SQL ядра, вбудований у модуль. Причина, чому не text-імпорти
// (\`with { type: "text" }\`) — у tools/generate-core-sql.ts: їх не розбирає
// граф JSR, і публікація server-пакета падає.
`;

/** Усі `.sql` пакета ядра: <назва>/db/<файл>.sql, у стабільному порядку. */
async function collectSqlFiles(sqlDir: string): Promise<string[]> {
  const found: string[] = [];

  for await (const pkg of Deno.readDir(sqlDir)) {
    if (!pkg.isDirectory) continue;
    const dbDir = join(sqlDir, pkg.name, "db");

    try {
      for await (const entry of Deno.readDir(dbDir)) {
        if (entry.isFile && entry.name.endsWith(".sql")) {
          found.push(join(dbDir, entry.name));
        }
      }
    } catch {
      // Пакет без db/ — не помилка: у ядрі є й суто кодові каталоги.
    }
  }

  return found.sort();
}

export async function generateCoreSql(
  options: { sqlDir: string; verbose?: boolean },
): Promise<{ outFile: string; count: number }> {
  const { sqlDir } = options;
  const files = await collectSqlFiles(sqlDir);

  const entries: string[] = [];
  for (const path of files) {
    const key = relative(sqlDir, path).split(SEPARATOR).join("/");
    // Переводи рядків нормалізуються в LF. Інакше артефакт залежав би від
    // налаштувань git: при core.autocrlf=true чекаут переписує файли в CRLF,
    // і той самий вміст дає інші байти на іншій машині — генерований файл
    // «змінювався» б після кожного клону, а проба на розсинхрон падала б на
    // рівному місці. Для SQL це нічого не означає.
    const sql = (await Deno.readTextFile(path)).replaceAll("\r\n", "\n");
    // JSON.stringify, а не шаблонний рядок: у SQL трапляються і зворотні
    // лапки, і `${`, і їх довелося б екранувати вручну.
    entries.push(`  ${JSON.stringify(key)}: ${JSON.stringify(sql)},`);
    if (options.verbose) console.log(`· ${key} (${sql.length} символів)`);
  }

  const outFile = join(sqlDir, "core-sql.generated.ts");
  const body = `${HEADER}
export const CORE_SQL_TEXT: Record<string, string> = {
${entries.join("\n")}
};
`;
  await Deno.writeTextFile(outFile, body);
  return { outFile, count: files.length };
}

async function main() {
  const verbose = Deno.args.includes("--verbose");
  const dirArg = Deno.args.find((arg) => !arg.startsWith("--"));
  if (!dirArg) {
    throw new Error("Вкажи каталог SQL ядра: generate-core-sql <sqlDir> [--verbose]");
  }

  const { outFile, count } = await generateCoreSql({ sqlDir: dirArg, verbose });
  console.log(`✓ ${count} файлів → ${outFile}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Генерація SQL ядра впала:", error);
    Deno.exit(1);
  });
}
