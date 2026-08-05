/**
 * Публікація SQL у базу, яка НЕ є локальною: продуктив, staging, Deno Deploy.
 *
 * Чому окремий вхід, а не прапорець до `sql:publish`. Запобіжник дев-інструментів
 * (`tools/dev-guard.ts`) стереже не публікацію як таку — він стереже те, що
 * `smoke`, `api` й `passwd` **пишуть тестові дані** в базу з `.env`, і промах у
 * `.env` не має коштувати чужих даних. Обходу в нього немає навмисно, і додавати
 * його означало б відкрити діру всім чотирьом інструментам одразу. Тут інша дія
 * з іншим наміром: накотити схему саме на віддалену базу. Вона ідемпотентна
 * (структура → міграції → функції → сіди з `on conflict do nothing`) і рівно
 * та, яку доти виконували руками через `psql`.
 *
 * Два запобіжники лишаються:
 *
 * - **`--yes` обов'язковий.** Без нього нічого не відбувається. На Deno Deploy
 *   прапорець стоїть у самій команді `predeploy`, тобто його написали свідомо;
 *   локально його треба дописати руками, і випадково це не виходить.
 * - **Ціль друкується до роботи.** Найімовірніша помилка тут — не зловмисник, а
 *   не той `.env`; рядок `→ host:port/база` ловить саме її, і лишається в логах
 *   розгортання.
 *
 * Складання пакета робиться тут само: `_sqlpackage/*.sql` у git не лежить
 * (`.gitignore`), тож без цього кроку публікувати було б нічого. Виняток —
 * `--no-assemble`: на розгортанні пакет уже зібрано кроком збірки, а файлова
 * система там не для запису.
 *
 *   deno task sql:deploy --yes                # з машини розробника
 *   deno run -A ./scripts/sql-deploy.ts ./app --yes --no-assemble   # predeploy
 */
import { resolve } from "@std/path";
import { configFromEnv } from "@altera/server";
import { getCoreSqlPackage } from "@altera/server/sql";
import { assembleSqlPackage } from "@altera/tools/assemble-sql-package";
import { publishAppSql } from "@altera/tools/publish-app-sql";

const verbose = Deno.args.includes("--verbose");
const confirmed = Deno.args.includes("--yes");
const skipAssemble = Deno.args.includes("--no-assemble");
const appDir = resolve(Deno.args.find((arg) => !arg.startsWith("--")) ?? "./app");

const { host, port, database } = configFromEnv().database;
const target = `${host}:${port}/${database}`;

if (!confirmed) {
  console.error(
    `⛔ sql:deploy накотить схему на ${target}.\n` +
      `   Це шлях для віддаленої бази — запобіжник дев-інструментів тут не діє.\n` +
      `   Якщо ціль правильна, додай --yes: deno task sql:deploy --yes`,
  );
  Deno.exit(2);
}

console.log(`→ публікую SQL у ${target}`);
if (!skipAssemble) {
  await assembleSqlPackage(appDir, { coreSql: getCoreSqlPackage, verbose });
}
await publishAppSql({ appDir, verbose });
console.log(`✅ SQL опубліковано в ${target}`);
