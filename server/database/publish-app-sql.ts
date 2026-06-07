import { dirname, fromFileUrl, join, resolve } from "jsr:@std/path@^1.1.2";
import postgres from "postgres";
import { buildRepoPrintTemplateRepublishSql } from "../../scripts/assemble-sql-package.ts";

interface SqlManifest {
  output?: string;
  outputs?: Record<string, string>;
}

const DB_HOST = Deno.env.get("DB_HOST") || "localhost";
const DB_PORT = Number(Deno.env.get("DB_PORT") || 5432);
const DB_NAME = Deno.env.get("DB_NAME") || "altera";
const DB_USERNAME = Deno.env.get("DB_USERNAME") || "altera";
const DB_PASSWORD = Deno.env.get("DB_PASSWORD") || "";

const backendDatabaseDir = dirname(fromFileUrl(import.meta.url));
const repoRootDir = resolve(backendDatabaseDir, "../..");
const appDir = join(repoRootDir, "app");
const manifestPath = join(appDir, "sql.json");

function createSqlClient() {
  return postgres({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    username: DB_USERNAME,
    password: DB_PASSWORD,
  });
}

async function loadManifest(): Promise<SqlManifest> {
  const manifestRaw = await Deno.readTextFile(manifestPath);
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

export async function publishAppSql(options?: { verbose?: boolean }) {
  const verboseMode = options?.verbose ?? false;
  const manifest = await loadManifest();
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
  await publishAppSql({ verbose: verboseMode });
}

if (import.meta.main) {
  main().catch(async (error) => {
    console.error("❌ SQL publication failed:", error);
    Deno.exit(1);
  });
}