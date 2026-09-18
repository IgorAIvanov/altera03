// Публікація зібраного SQL-пакета у базу.
//
// Це збірковий інструмент, а не частина server-бібліотеки: він читає sql.json
// застосунку й ходить у _sqlpackage, тобто знає про конкретний застосунок —
// рівно те, чого рантайму знати не можна. Тому живе поряд із рештою збірки.
import { join, resolve } from "@std/path";
import postgres from "postgres";
import { buildRepoPrintTemplateRepublishSql } from "./assemble-sql-package.ts";
import { configFromEnv } from "@altera/server";
import { assertDevEnvironmentOrExit } from "./dev-guard.ts";

interface SqlManifest {
  output?: string;
  outputs?: Record<string, string>;
}

/**
 * Підключення бере з оточення напряму — рантаймової конфігурації тут немає.
 *
 * `ssl` передається так само, як у рантаймі: публікація ходить у ту саму базу,
 * і керована без TLS її просто не пустить. Дефолт (за хостом) рахує вже
 * `configFromEnv`, тому тут лишається не загубити поле.
 */
function createSqlClient() {
  const { host, port, database, username, password, ssl } = configFromEnv().database;
  return postgres({ host, port, database, username, password, ssl: ssl ?? false });
}

async function loadManifest(appDir: string): Promise<SqlManifest> {
  const manifestRaw = await Deno.readTextFile(join(appDir, "sql.json"));
  return JSON.parse(manifestRaw) as SqlManifest;
}

export async function publishSqlText(sqlText: string, options?: { verbose?: boolean; successMessage?: string }) {
  const verboseMode = options?.verbose ?? false;
  const sql = createSqlClient();

  try {
    await sql.begin(async (tx) => {
      await tx`set local client_min_messages = error`;
      await tx.unsafe(sqlText);
    });

    if (verboseMode && options?.successMessage) {
      console.log(options.successMessage);
    }
  } finally {
    await sql.end();
  }
}

export async function publishAppSql(options: { appDir: string; verbose?: boolean }) {
  const { appDir } = options;
  const verboseMode = options.verbose ?? false;
  const manifest = await loadManifest(appDir);
  const sectionOutputs = manifest.outputs ?? {};
  const publishRepoPrintTemplates = async () => {
    const printTemplateRepublishSql = await buildRepoPrintTemplateRepublishSql(appDir);
    if (!printTemplateRepublishSql.trim()) {
      return;
    }

    await publishSqlText(printTemplateRepublishSql, {
      verbose: verboseMode,
      successMessage: "Published repository print templates marked with republishOnPublish.",
    });
  };

  const sectionOrder = [
    { key: "structure", fallback: "struc_app.sql" },
    { key: "migrations", fallback: "migration_app.sql" },
    { key: "models", fallback: "models_app.sql" },
    { key: "data", fallback: "data_app.sql" },
  ];

  if (Object.keys(sectionOutputs).length > 0) {
    for (const section of sectionOrder) {
      const fileName = sectionOutputs[section.key] || section.fallback;
      const filePath = join(appDir, "_sqlpackage", fileName);
      const sqlText = await Deno.readTextFile(filePath);

      if (sqlText.trim() === "") {
        throw new Error(`Bundled SQL section is empty: ${filePath}`);
      }

      await publishSqlText(sqlText, {
        verbose: verboseMode,
        successMessage: `Published SQL section: ${filePath}`,
      });
    }

    await publishRepoPrintTemplates();
    await reportDocumentLinkProblems();
    return;
  }

  const outputName = manifest.output || "app.sql";
  const bundledSqlPath = join(appDir, "_sqlpackage", outputName);
  const bundledSql = await Deno.readTextFile(bundledSqlPath);

  if (bundledSql.trim() === "") {
    throw new Error(`Bundled SQL file is empty: ${bundledSqlPath}`);
  }

  await publishSqlText(bundledSql, {
    verbose: verboseMode,
    successMessage: `Published SQL package: ${bundledSqlPath}`,
  });

  await publishRepoPrintTemplates();
  await reportDocumentLinkProblems();
}

type DocumentLinkProblem = {
  kind: "no_index" | "uncovered_fk";
  table_name: string;
  column_name: string;
  model: string | null;
  field: string | null;
};

/**
 * Проба ребер дерева пов'язаних документів — після публікації, на тій базі,
 * куди щойно накотили схему (`app.document_link_check()`, `@core/document_core`).
 *
 * Попередження, а не відмова: публікацію кличе й розгортання, і валити його
 * через індекс, якого бракує, означало б зупинити виправлення заради
 * продуктивності. Але й не мовчання: обидві знахідки на демо-наборі не видно
 * нічим — ні помилкою, ні повільністю, — вони проявляються через рік роботи
 * або неповним деревом, яке ніхто не перевіряє.
 *
 * Застосунок без `@core/document_core` функції не має — тоді й перевіряти
 * нічого.
 */
async function reportDocumentLinkProblems() {
  const sql = createSqlClient();
  let problems: DocumentLinkProblem[];
  try {
    problems = await sql<DocumentLinkProblem[]>`select * from app.document_link_check()`;
  } catch (error) {
    // 42883 — функції немає, 42P01 — представлення немає: ядро без документів.
    const code = (error as { code?: string }).code;
    if (code === "42883" || code === "42P01") return;
    throw error;
  } finally {
    await sql.end();
  }

  const unindexed = problems.filter((p) => p.kind === "no_index");
  const uncovered = problems.filter((p) => p.kind === "uncovered_fk");

  if (unindexed.length) {
    console.warn(
      `⚠ Пов'язані документи: ${unindexed.length} колонок ребер без індексу — ` +
        `обхід дерева перегляне ці таблиці цілком:`,
    );
    for (const p of unindexed) {
      console.warn(`    ${p.table_name} (${p.column_name}) — ${p.model}.${p.field}`);
    }
    console.warn(`  Індекс, що починається з колонки, — у db/struc.sql моделі.`);
  }

  if (uncovered.length) {
    console.warn(
      `⚠ Пов'язані документи: ${uncovered.length} FK документа на документ не стали ребром дерева:`,
    );
    for (const p of uncovered) console.warn(`    ${p.table_name} (${p.column_name})`);
    console.warn(
      `  Оголоси поле в схемі через "x-ref" (або "x-ref": { …, "related": false }, якщо це не зв'язок).`,
    );
  }
}

async function main() {
  // Той самий запобіжник, що й у publish-sql: пряма точка входу не має бути
  // дірою повз нього.
  assertDevEnvironmentOrExit("publish-app-sql");

  const verboseMode = Deno.args.includes("--verbose");
  const appArg = Deno.args.find((arg) => !arg.startsWith("--"));
  if (!appArg) {
    throw new Error("Вкажи каталог застосунку: publish-app-sql <appDir> [--verbose]");
  }
  await publishAppSql({ appDir: resolve(appArg), verbose: verboseMode });
}

if (import.meta.main) {
  main().catch(async (error) => {
    console.error("❌ SQL publication failed:", error);
    Deno.exit(1);
  });
}