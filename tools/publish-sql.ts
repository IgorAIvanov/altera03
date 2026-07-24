import { resolve } from "jsr:@std/path";
import { assembleSqlPackage } from "./assemble-sql-package.ts";
import { publishAppSql } from "./publish-app-sql.ts";

async function main() {
  const verboseMode = Deno.args.includes("--verbose");
  const appArg = Deno.args.find((arg) => !arg.startsWith("--"));
  if (!appArg) {
    throw new Error("Вкажи каталог застосунку: publish-sql <appDir> [--verbose]");
  }
  const appDir = resolve(appArg);

  await assembleSqlPackage(appDir, { verbose: verboseMode });
  await publishAppSql({ appDir, verbose: verboseMode });
  console.log("SQL published OK");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  });
}
