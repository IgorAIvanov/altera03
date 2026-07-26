// Публікація зібраного SQL-пакета у базу.
//
// Це збірковий інструмент, а не частина server-бібліотеки: він читає sql.json
// застосунку й ходить у _sqlpackage, тобто знає про конкретний застосунок —
// рівно те, чого рантайму знати не можна. Тому живе поряд із рештою збірки.
import { join, resolve } from "@std/path";
import postgres from "postgres";
import { buildRepoPrintTemplateRepublishSql } from "./assemble-sql-package.ts";
import { configFromEnv } from "@scope/server";

interface SqlManifest {
  output?: string;
  outputs?: Record<string, string>;
}

/** Підключення бере з оточення напряму — рантаймової конфігурації тут немає. */
function createSqlClient() {
  const { host, port, database, username, password } = configFromEnv().database;
  return postgres({ host, port, database, username, password });
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
}

async function main() {
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