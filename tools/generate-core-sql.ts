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
import { dirname, join, relative, SEPARATOR } from "@std/path";
import { findMarkers } from "./scan-translation-markers.ts";

const HEADER = `// ЗГЕНЕРОВАНО \`deno task core:sql\` з server/sql/**/db/*.sql — не редагувати.
//
// Текст SQL ядра, вбудований у модуль. Причина, чому не text-імпорти
// (\`with { type: "text" }\`) — у tools/generate-core-sql.ts: їх не розбирає
// граф JSR, і публікація server-пакета падає.
`;

/**
 * Правила, які оголошує САМЕ ЯДРО, — і кому вони стосуються.
 *
 * Реєстр обмежень збирається з джерел ЗАСТОСУНКУ, тож правила ядра в нього не
 * потрапляли взагалі. А найважчі з них там і живуть: усе, що відбиває
 * проведення (немає рахунку, не заповнене субконто, нульова сума, однобічна
 * проводка на балансовому рахунку), написано в `document_core` — один раз на
 * всі документи всіх застосунків.
 *
 * Ключ мапи — не модель, а КОМУ правило стосується: `document_core` пише
 * правила будь-якого документа, а не якоїсь однієї моделі, і приписати їх
 * моделі з таким іменем було б неправдою. `"*"` — усім.
 *
 * Чого тут свідомо немає:
 *   - `database/database-error.ts` — це переклад кодів PostgreSQL (унікальність,
 *     зовнішній ключ), а не оголошене обмеження моделі. Одинадцять однакових
 *     рядків у кожної моделі — шум там, де перелік і цінний своєю стислістю;
 *   - `sql/access` — адміністрування токенів і користувачів; до того, що агент
 *     планує робити з обліком, воно не належить.
 */
const CORE_RULE_SCOPES: Record<string, string> = {
  document_core: "document",
  numerator: "*",
};

const RULES_HEADER = `// ЗГЕНЕРОВАНО \`deno task core:sql\` з server/sql/**/db/*.sql — не редагувати.
//
// Правила, які оголошує ядро, за тим, кому вони стосуються: "*" — усім,
// "document" — будь-якому документу. Тексти НЕ дублюються: тут лише ключі,
// рядок береться в рантаймі зі словників повідомлень.
`;

/** Ключі маркерів пакета ядра, згруповані за тим, кому правило стосується. */
function collectCoreRules(files: string[], sqlDir: string): Record<string, string[]> {
  const scopes: Record<string, string[]> = {};

  for (const file of files) {
    const pkg = relative(sqlDir, file).replaceAll(SEPARATOR, "/").split("/")[0];
    const scope = CORE_RULE_SCOPES[pkg];
    if (!scope) continue;

    const list = scopes[scope] ??= [];
    for (const use of findMarkers(Deno.readTextFileSync(file), file)) {
      if (!list.includes(use.key)) list.push(use.key);
    }
  }

  for (const list of Object.values(scopes)) list.sort();
  return scopes;
}

function renderCoreRules(scopes: Record<string, string[]>): string {
  const body = Object.keys(scopes).sort()
    .map((scope) => `  ${JSON.stringify(scope)}: ${JSON.stringify(scopes[scope])},`)
    .join("\n");

  return `${RULES_HEADER}
export const coreAgentRules: Record<string, string[]> = {\n${body}\n};\n`;
}

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
): Promise<{ outFile: string; rulesFile: string; count: number }> {
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

  // Правила ядра — сусідній вихід того самого прогону: джерело в них те саме,
  // і розійтися вони не мають права.
  const rulesFile = join(dirname(sqlDir), "modules", "agent", "core-agent-rules.generated.ts");
  await Deno.writeTextFile(rulesFile, renderCoreRules(collectCoreRules(files, sqlDir)));

  return { outFile, rulesFile, count: files.length };
}

async function main() {
  const verbose = Deno.args.includes("--verbose");
  const dirArg = Deno.args.find((arg) => !arg.startsWith("--"));
  if (!dirArg) {
    throw new Error("Вкажи каталог SQL ядра: generate-core-sql <sqlDir> [--verbose]");
  }

  const { outFile, rulesFile, count } = await generateCoreSql({ sqlDir: dirArg, verbose });
  console.log(`✓ ${count} файлів → ${outFile}`);
  console.log(`✓ правила ядра → ${rulesFile}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Генерація SQL ядра впала:", error);
    Deno.exit(1);
  });
}
