import { dirname, fromFileUrl, resolve } from "jsr:@std/path";
import { assembleSqlPackage } from "./assemble-sql-package.ts";
import { publishAppSql } from "../server/database/publish-app-sql.ts";

async function main() {
  const verboseMode = Deno.args.includes("--verbose");
  const scriptsDir = dirname(fromFileUrl(import.meta.url));
  const repoRoot = resolve(scriptsDir, "..");

  await assembleSqlPackage(resolve(repoRoot, "app"), { verbose: verboseMode });
  await publishAppSql({ verbose: verboseMode });
  console.log("SQL published OK");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  });
}
