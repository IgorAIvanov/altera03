/**
 * Публікація SQL застосунку в базу з `.env`: `deno task sql:publish`.
 *
 * Обгортка над `@altera/tools` — версію ядра називає застосунок, чому саме так
 * написано в `sql-assemble.ts` поряд.
 */
import { getCoreSqlPackage } from "@altera/server/sql";
import { publishAppSqlPackage } from "@altera/tools/publish-sql";

const verbose = Deno.args.includes("--verbose");
const appDir = Deno.args.find((arg) => !arg.startsWith("--")) ?? "./app";

await publishAppSqlPackage({ appDir, coreSql: getCoreSqlPackage, verbose });
