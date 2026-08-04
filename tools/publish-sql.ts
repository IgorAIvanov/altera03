// Зібрати SQL-пакет застосунку і накотити його в базу з `.env`.
//
// CLI тут немає навмисно — як і в assemble-sql-package.ts: SQL ядра приходить
// аргументом (`coreSql`), бо його версію мусить називати застосунок, а не
// інструмент. Точка входу — обгортка `scripts/sql-publish.ts` застосунку.
import { resolve } from "@std/path";
import { assembleSqlPackage, type CoreSqlLookup } from "./assemble-sql-package.ts";
import { publishAppSql } from "./publish-app-sql.ts";
import { assertDevEnvironmentOrExit } from "./dev-guard.ts";

export async function publishAppSqlPackage(
  options: { appDir: string; coreSql: CoreSqlLookup; verbose?: boolean },
) {
  // Публікація йде в БД із .env — це дев-інструмент. Продуктивну базу
  // накочують зібраним _sqlpackage через psql (docs/deployment.md, розділ 8).
  assertDevEnvironmentOrExit("sql:publish");

  const appDir = resolve(options.appDir);
  const verbose = options.verbose ?? false;

  await assembleSqlPackage(appDir, { coreSql: options.coreSql, verbose });
  await publishAppSql({ appDir, verbose });
  console.log("SQL published OK");
}
