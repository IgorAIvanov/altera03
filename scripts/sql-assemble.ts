/**
 * Збірка SQL-пакета застосунку: `deno task sql:assemble`.
 *
 * Обгортка, а не сам інструмент — і рівно з тієї ж причини, що й `api.ts` зі
 * `smoke_test.ts`: знання про застосунок передається інжекцією. Тут це версія
 * ядра. `@altera/server/sql` резолвиться картою імпортів ЦЬОГО застосунку, тож
 * у базу гарантовано їде SQL тієї самої версії сервера, на якій він працює.
 *
 * Поки цей імпорт стояв усередині `@altera/tools`, версію ядра називав
 * інструмент: у пакет була зашита та @altera/server, що стояла у воркспейсі на
 * момент публікації tools. Наслідок побачили на чистій базі —
 * `column "must_change_password" does not exist`.
 */
import { getCoreSqlPackage } from "@altera/server/sql";
import { assembleSqlPackage } from "@altera/tools/assemble-sql-package";

const verbose = Deno.args.includes("--verbose");
const appDir = Deno.args.find((arg) => !arg.startsWith("--")) ?? "./app";

await assembleSqlPackage(appDir, { coreSql: getCoreSqlPackage, verbose });
