/**
 * Збірка SQL-пакета застосунку: `deno task sql:assemble`.
 *
 * Обгортка, а не прямий виклик інструмента — і це принципово. SQL ядра мусить
 * приїхати з тієї версії `@altera/server`, на якій працює цей застосунок, а
 * назвати її може лише він сам: імпорт нижче резолвиться картою імпортів із
 * `deno.json` поряд.
 *
 * Поки цей імпорт стояв усередині `@altera/tools`, версію ядра називав
 * інструмент — у пакет була зашита та версія сервера, що стояла у воркспейсі
 * фреймворку на момент публікації tools. У базу їхала схема однієї версії, а
 * читав її рантайм іншої; видно це тільки на чистій базі.
 */
import { getCoreSqlPackage } from "@altera/server/sql";
import { assembleSqlPackage } from "@altera/tools/assemble-sql-package";

const verbose = Deno.args.includes("--verbose");
const appDir = Deno.args.find((arg) => !arg.startsWith("--")) ?? "./app";

await assembleSqlPackage(appDir, { coreSql: getCoreSqlPackage, verbose });
