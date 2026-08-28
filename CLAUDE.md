# Altera — бухгалтерська система для України

Deno monorepo. Три workspace-пакети: `app/` (фронтенд-модулі та SQL-джерела), `client/` (ui-kit, runtime), `server/` (Danet/Deno backend). База даних — PostgreSQL. Фронтенд — Lit Web Components + Vite + Tailwind CSS v4 + daisyUI v5.

## Команди

```bash
deno task dev          # запустити frontend + backend одночасно
deno task dev:server   # тільки backend (--watch)
deno task dev:front    # тільки Vite dev server
deno task sql:registry # згенерувати app/_generated/* (model-registry, agent-routes, view-manifest) з manifest.json
deno task sql:gen <model>  # перегенерувати CRUD-SQL ОДНІЄЇ моделі: sql:gen catalog/bank
deno task core:sql     # вбудувати server/sql/**/db/*.sql у core-sql.generated.ts (після правки SQL ядра)
deno task client:assets    # вбудувати тему й локалі фреймворку (після правки theme.css / client/_locales)
deno task locales:build    # зібрати app/_locales/* із _locales/ поряд із кодом (модель, shared, оболонка)
deno task print:fonts      # вбудувати шрифти друку (після зміни версії @fontsource/roboto)
deno task scaffold:template # вбудувати create/template/** у create/template.generated.ts
deno task skills:build      # перелік гліфів у скіл + вбудувати прикладні скіли у skills.generated.ts
                            #   (після правки skills/src/** або client/ui-kit/icons.ts)
deno task scaffold:verify   # згенерувати застосунок у тимчасовий каталог і перевірити типи й збірку
deno task scaffold:verify:local  # те саме проти вихідників репо — ДО публікації пакетів
deno task solution:export   # вивантажити прикладне рішення (app/) у переносимий пакет
deno task solution:import -- <пакет.tar.gz> [каталог] [--check] [--force]  # завантажити його
deno task check        # перевірити типи ВСЬОГО дерева (app/client/server/tools/scripts)
deno task check:deps   # перевірити напрямок залежностей (client/server не залежать від app)
deno task smoke        # димові проби HTTP-межі (застосунок у процесі, без порту)
deno task test:unit    # юніт-проби бібліотек без БД і HTTP (символіки штрих-кодів)
deno task mcp:test     # проба MCP-обгортки: підроблена база + обгортка підпроцесом
deno task api          # дьоргнути команду моделі з консолі: api <model> <command> [json]
deno task passwd       # встановити пароль користувача: passwd <логін> [пароль]
deno task sql:assemble # зібрати SQL-пакет з db/ файлів моделей
deno task sql:publish  # опублікувати SQL у PostgreSQL
deno task startdb      # docker compose up -d (PostgreSQL)
deno task stopdb       # docker compose down
```

## Структура репозиторію

```
app/                        # застосунок: фронтенд-модулі та SQL-джерела (Deno workspace)
  index.html                # точка входу фронтенду
  main.ts                   # composition root клієнта: реєструє оболонку → tab-controller
  <family>/<model>/         # один каталог на модель
    manifest.json           # декларація моделі (model, type, schema, views, agent)
    <Model>Edit.ts          # форма редагування (Lit)
    <Model>List.ts          # список (Lit)
    <Model>Picker.ts        # picker / autocomplete (Lit)
    <model>.schema.ts       # TypeBox-схема (єдине джерело типів)
    _locales/               # рядки ЦІЄЇ моделі: en.json, uk.json
    db/
      struc.sql             # DDL таблиць
      <model>.sql           # PostgreSQL-функції моделі
      migration.sql         # міграції
      data.sql              # seed-дані
  styles/
    tailwind.css            # ЄДИНИЙ вхід збірки Tailwind: @source, daisyUI, шрифти, тема
    app-styles.ts           # ?inline → setAppStyles(): віддає зібраний CSS у client
  _locales/                 # ЗІБРАНІ локалі (deno task locales:build) — не редагувати
  _sqlpackage/              # зібрані SQL-файли (генеруються, не редагувати)
  # SQL ядра (доступ, меню, attachment, document, journal_entry, print_template,
  # help_*) лежить у server/sql/ і підключається записами "@core/<назва>" у sql.json.
  # Файли там — звичайні .sql, але в модуль текст потрапляє через згенерований
  # core-sql.generated.ts (deno task core:sql): text-імпорти не приймає JSR.
  # У меню в ядрі тільки структура й функції; сід (склад пунктів — маршрути цього
  # застосунку) лишається в app/admin/menu/db/data.sql, там же й екрани.
  # Те саме правило і в субконто: ядро тримає механізм (analytic_dimension,
  # chart_of_account_analytic, doc_analytic_set), а СКЛАД — застосунок. Вимір
  # оголошує модель, чий довідник ним працює (app/catalog/bank/db/data.sql),
  # прив'язку до рахунків — план рахунків (app/catalog/chart_of_account/db/data.sql),
  # обидва з on conflict do nothing. Ознака неправильної межі проста: у пакеті
  # ядра не має бути ані коду рахунку конкретного плану, ані імені таблиці
  # застосунку. Порядок у sql.json через це значущий — модель, що оголошує
  # вимір, стоїть ВИЩЕ за план рахунків.
  _generated/               # авто-генерація (deno task sql:registry): model-registry, ts-commands,
                            #   agent-routes, view-manifest
                            # model-registry — ЧИСТІ ДАНІ, ts-commands — статичні import модулів
                            #   TS-команд. Розділені навмисно: реєстр читає не лише сервер (екран
                            #   admin/user_group бере з нього перелік моделей для прав), тож поки
                            #   вони лежали разом, кожна серверна команда їхала в бандл КЛІЄНТА
                            #   з усім, що імпортує. ts-commands імпортує тільки app/server.ts.
  server.ts                 # composition root бекенду: реєструє дані з _generated → bootstrap (Danet)
  shared/                   # app-стан: current-organization, view-route
                            #   (TypeBox-контракти фреймворку переїхали в client/shared/schema.ts)
    _locales/               # рядки, що не належать жодній моделі: common.*, document.*
  sql.json                  # список моделей для sql:assemble

client/                     # ui-kit та клієнтський runtime — БІБЛІОТЕКА (Deno workspace)
  ui-kit/components/        # web components: ui-picker, ...
  bus/bus.ts                # event bus: bus.request("data.load", { model, command, payload })
  styles/theme.css          # тема й контракти компонентів — ПЛОСКИЙ CSS, без директив Tailwind
  shared/styles.ts          # `tw`: порожній CSSStyleSheet, який заповнює застосунок
  shared/schema.ts          # спільні TypeBox-контракти: SortDir, Query, Totals, DocumentHeader
  vite.ts                   # пресет defineAlteraConfig() — уся машинерія Vite (експорт "@altera/client/vite")
  vite-notices.ts           # плагін: dist/THIRD-PARTY-NOTICES.md з ліцензіями того,
                            #   що бандлер справді поклав у вихід (див. нижче)
  # index.html і main.ts тут немає навмисно: вони належать застосунку (app/).
  # Вхід збірки Tailwind (app/styles/tailwind.css) — теж: він сканує каталоги
  # застосунку. Але сама машинерія Vite — пресет тут: вона однакова для всіх застосунків.

server/                     # Danet backend-БІБЛІОТЕКА (Deno workspace), не залежить від app
  main.ts                         # public API бібліотеки: bootstrap + configFromEnv + типи (барель)
  # Плюс два вузьких входи повз барель — `@altera/server/print` (формат шаблону
  # друку) і `@altera/server/password` (хешування). Барель тягне bootstrap, а з
  # ним контролери Danet із декораторами; у збірці ФРОНТЕНДУ це фатально, і
  # фронтенд туди справді дістає: `_generated/model-registry.generated.ts`
  # статично імпортує всі TS-команди, а реєстр тягне екран admin/user_group.
  # `import type` безпечний завжди — стирається при збірці.
  sql/                            # SQL ядра + core-sql.ts (окремий експорт "@altera/server/sql")
    access/                       # користувачі, сесії, групи, права (див. нижче)
  config/
    server-config.ts              # ServerOptions/ServerConfig — увесь контракт налаштувань
    config-from-env.ts            # configFromEnv(): збірка конфігурації з оточення (явний виклик)
  modules/model-runtime/
    model-runtime.controller.ts   # REST: POST /api/model/:model/:command
    model-runtime.service.ts      # викликає PostgreSQL-функцію або TS-handler
    model-registry.ts             # реєстр моделей; будується з config.models на першу потребу
  modules/agent/
    agent.service.ts              # прямий диспетчер команд (LLM у сервері немає взагалі)
    agent-tools.service.ts        # GET /api/agent/tools — опис команд правами користувача
    agent-routes.ts               # getAgentRoutes() — маршрути з config.agentRoutes
  modules/model-view/
    model-view.registry.ts        # view-реєстр з config.views (без ФС-скану)
  modules/auth/                   # авторизація; методи входу — з config.auth.methods
  database/                       # тільки рантайм: модуль і пул з'єднань

create/                     # scaffold нового застосунку (@altera/create)
  template/                 # дерево шаблону звичайними файлами — джерело
  template.generated.ts     # воно ж мапою: команду запускають без установки,
                            #   тож пакет може віддати лише модулі

mcp/                        # MCP-обгортка над HTTP-API (@altera/mcp)
  main.ts                   # шість інструментів + stdio: models / describe / call
                            #   плюс канал байтів в обидва боки: attach / fetch / print
  altera-client.ts          # HTTP до ОДНІЄЇ бази: токен, впізнавання старого сервера
  README.md                 # запис у конфізі хоста, кілька баз, токен «тільки читання»
                            #   публікується окремо: у пакета свій цикл версій, а D6
                            #   бороняє тягнути версію протоколу в @altera/server —
                            #   не публікувати обгортку

skills/                     # скіли агента (@altera/skills)
  src/<name>/SKILL.md       # ЄДИНЕ джерело; сюди дивляться симлінки .claude/skills
                            #   і .github/skills цього репозиторію
  skills.generated.ts       # прикладні скіли мапою — те саме, що з шаблоном scaffold
  mod.ts                    # syncSkills(): розкласти їх у .claude/skills застосунку

tools/                      # пакет інструментів (@altera/tools): codegen, publish, дев-клієнт
  generate-model-sql.ts           # генерація SQL моделей
  generate-model-runtime-registry.ts  # генерація app/_generated (registry/routes/views)
  assemble-sql-package.ts         # збірка SQL-пакета: db/ моделей + @core (ядро — АРГУМЕНТОМ)
  publish-app-sql.ts / publish-sql.ts  # публікація зібраного SQL у БД
  app-client.ts                   # AppClient: застосунок у процесі; createServer — інжекцією
  dev-guard.ts                    # захист дев-інструментів від продуктивної БД
  set-password.ts                 # встановлення пароля користувача (пряма БД)
  # знання про застосунок приходить ззовні: codegen/publish — аргументом appDir,
  # AppClient — фабрикою createServer, SQL ядра — фабрикою getCoreSqlPackage;
  # статичного імпорту app у пакеті немає.

scripts/                    # репо-локальні обгортки (НЕ пакет): імпортують app + @altera/tools
  api.ts, smoke_test.ts           # дев-обгортки: інжектять createServer з ../app/server.ts
  sql-assemble.ts, sql-publish.ts # інжектять SQL ядра зі СВОГО @altera/server
  check-deps.ts                   # guardrail меж пакетів (client/server/tools vs app)
```

> **Напрямок залежностей:** `app → client/server/tools`, ніколи навпаки. Бекенд-runtime
> отримує все ззовні — одним аргументом `bootstrap()`. Збіркові інструменти — окремий пакет
> `tools/`, а не всередині бібліотек client/server: те, що читає `app/sql.json` чи
> `_sqlpackage`, знає про застосунок, але отримує його **аргументом** (`appDir`), не імпортом,
> тож у пакет це знання не зашите. `deno task check:deps` перевіряє це для `client`, `server`
> і `tools`: ані залежності від застосунку імпортом, ані виходу відносним імпортом за межі пакета.
>
> **Версію фреймворку теж називає застосунок.** SQL ядра приходить у збірку аргументом
> (`assembleSqlPackage(appDir, { coreSql })`), а не імпортом з `@altera/server` усередині
> `tools` — інакше в установленому застосунку жили б ДВІ версії сервера: схема з однієї,
> рантайм з іншої (падало входом на чистій базі). Тримають це три речі: залежність
> `tools` → `server` оголошена явно, версії в задачах шаблону пінені, а `scaffold:verify`
> вимагає рівно однієї версії `@altera/server` у графі. Правила пінів і порядок релізу —
> skill [`framework-release`](skills/src/framework-release/SKILL.md).

## Конфігурація сервера

`server/` — бібліотека: вона не читає ні файлову систему в пошуках моделей, ні `Deno.env`.
Усе приходить одним типізованим аргументом:

```ts
// app/server.ts — composition root
const application = await bootstrap({
  ...configFromEnv(),                       // database, auth, blob, agent — з оточення, явно
  models: { registry: generatedModelRegistry, tsCommands: generatedTsCommandBindings },
  agentRoutes: agentModelRoutes,
  views: { manifest: viewManifest, projectRoot, dev: !!Deno.env.get("VITE_DEV_URL") },
});
```

Обов'язкові поля — `database`, `models`, `views`; `auth`/`blob`/`agent`/`agentRoutes` мають
дефолти. Пропущене обов'язкове поле — помилка типів, а не падіння на першому запиті.

`configFromEnv()` — єдине місце, де читається оточення, і викликає його **застосунок**, а не
бібліотека. Там же перевіряються суперечності: `DEV_AUTH_BYPASS` у продуктивному оточенні
валить старт сервера, а не спрацьовує на першому запиті.

Змінні оточення (усі — лише через `configFromEnv`): `DATABASE_URL` **або**
`PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD/PGSSLMODE`, `DB_POOL_SIZE`,
`AUTH_SESSION_TTL_HOURS`, `BOOTSTRAP_LOGIN/PASSWORD/FULL_NAME`,
`DEV_AUTH_BYPASS`, `DEV_AUTH_USER_ID`, `DEFAULT_USER_ID`, `AUTH_PUBLIC_BASE_URL`,
`NODE_ENV`/`APP_ENV`/`DENO_ENV`, `DENO_DEPLOY`,
`BLOB_TOKEN_SECRET`, `JWT_SECRET`, `BLOB_TOKEN_TTL_HOURS`, `BLOB_MAX_SIZE_MB`.

**Підключення до бази — імена libpq** (`PGHOST`/`PGDATABASE`/…, або `DATABASE_URL`):
`psql` без аргументів іде туди ж, куди застосунок. Джерело вибирається **ціле**, а
компоненти сильніші за рядок — порядок продиктований Deno Deploy (у його `DATABASE_URL`
немає імені бази, у `PGDATABASE` є). **TLS виводиться з хоста**, якщо `PGSSLMODE` не
заданий: локальна база без шифрування, інша — `require`; явне значення завжди сильніше,
незнайоме валить старт. **`DENO_DEPLOY` рахується позначкою продуктиву** нарівні з
`NODE_ENV=production` — інакше забутий у панелі `NODE_ENV` означав би cookie без `Secure`
і дозволений `DEV_AUTH_BYPASS`, мовчки. Список локальних хостів один —
`isLocalDatabaseHost` з `@altera/server`.

## Модель — основна одиниця

Кожна модель живе у `app/<family>/<model>/` і має `manifest.json`:

```json
{
  "model": "bank",
  "type": "catalog",
  "schema": "app",
  "views": {
    "list":   { "module": "./bankList.ts",   "titleKey": "bank.titleMany" },
    "edit":   { "module": "./bankEdit.ts",   "titleKey": "bank.titleOne" },
    "picker": { "module": "./bankPicker.ts", "titleKey": "bank.titleMany" }
  },
  "agent": {
    "allow": true,
    "allowCommands": ["get", "save", "list", "lookup"],
    "aliases": ["банк", "банки"],
    "priority": 10
  }
}
```

Типи моделей: `catalog` (довідник), `document` (документ з проведенням), `register` (регістр).

**Що журналювати — налаштування УСТАНОВКИ, а не властивість моделі.** Рівень лежить у
`app.audit_setting` (пакет ядра `@core/audit`), міняється на екрані
`app/admin/audit_setting/`; блока `audit` у манифесті більше немає (залишений — генератор
не читає і друкує `⚠`). Рівні: `none` (умовчання) / `changes` (команди з правом
`create`/`edit`/`delete`/`post`/`unpost` — **кошик визначає ПРАВО команди, а не ім'я**,
тож нестандартні команди потрапляють куди слід самі) / `all` (плюс читання). Перелік
моделей сіє деплой (`_generated/audit-settings.data.sql`, `on conflict do nothing`) —
застосунок називає, ЩО можна налаштувати, рівень належить адміністратору. Рівні рантайм
кешує (TTL 30 с). Журнал містить виконавця, час, модель, команду, ID і результат —
payload не зберігається.

## Нумерація: коди довідників і номери документів

Один механізм на все — пакет ядра `@core/numerator`. Двох немає свідомо: правило
«префікс плюс лічильник, що обнуляється щороку» однакове для накладної та для
контрагента, а розведене по двох місцях воно розходиться мовчки. Модель оголошує
нумерацію в `manifest.json`:

```json
"numbering": { "field": "code",   "template": "{NNNNNN}" }                              // довідник
"numbering": { "field": "number", "template": "{ORG}{TYPE}-{NNNNNN}", "period": "year" } // документ
```

Манифест дає **умовчання**: сід іде `on conflict do nothing`, далі правило живе на
admin-екрані (`app/admin/numerator/`), і деплой правку не затирає — той самий шлях, що в
шаблонів друку. Зворотний бік того самого: змінений у манифесті шаблон на вже налаштованій
базі **не застосується**.

Три речі до того, як писати шаблон: **шаблон задає вигляд номера, `period` — коли
лічильник обнуляється** (одне з одного не виводиться); **рік береться з дати документа,
а не з `now()`** (`month` вимагає `{MM}` у шаблоні); **виданий номер редагується** —
ручне значення приймається й підтягує лічильник, заборона — прапорець `is_editable`
(серверна відмова). Ручними лишаються коди-дані: `currency.code`, `chart_of_account.code`;
у `bank` кодом є МФО. Деталі — [`docs/numbering-plan.md`](docs/numbering-plan.md).


## SQL-функції моделі

Кожна модель реалізує набір PostgreSQL-функцій. Сигнатура:

```sql
{schema}.{model}_{command}(user_id bigint, payload jsonb) returns jsonb
```

Стандартні команди: `list`, `get`, `save`, `delete`, `undelete`, `lookup`.

**`delete` ПОЗНАЧАЄ, а не знищує**: ставить `is_deleted = true`, `undelete` знімає;
`list` позначені показує, `lookup` ховає. **Позначка на документі = скасування
проведення**: позначений документ не тримає проводок, а зняття позначки проведення НЕ
повертає — проводь заново, свідомо. Довідники застосунку живуть на `is_deleted`; моделі
ядра (`user`, `menu`, `print_template`) — на `is_active` навмисно: деактивований
користувач не кандидат на знищення. Документи додатково: `post`, `unpost`. Деталі й
наслідки — skill [`db-function-contract`](skills/src/db-function-contract/SKILL.md).

Відповідь завжди у форматі:
```json
{ "ok": true, "data": { "item": {}, "rows": [], "options": {}, "totals": {} }, "messages": [] }
```

**Регістр читають одним шаром — `@core/ledger`** (`acc_entries`, `acc_entries_agg`,
`acc_journal`, `acc_balance_turnover`, `acc_balance`, `acc_turnover`, `acc_account_tree`);
підсумків система не зберігає свідомо. **Входів у рухи два, і вибір між ними не смаковий:**
`acc_entries` віддає аналітику (`dims`/`corr_dims`) і потрібен тому, хто показує РЯДКИ —
картці рахунку, аналізу субконто; `acc_entries_agg` тієї аналітики не будує взагалі, і
кличе його все, що ПІДСУМОВУЄ (залишки, обороти, добір собівартості). Ціна різниці — 85%
часу відбіркового виклику, тож підсумок через широкий вхід це не «трохи дорожче», а вдвічі.
До свого запиту варто знати: **що вважається рухом** сказано
один раз — у спільному тілі обох входів; **вхідне сальдо з відкритою датою початку — нуль** (тому звіти
беруть його з `acc_balance_turnover`, а не з `acc_balance(org, from)`); подання
(дебетове/кредитове) шар не робить — віддає чисте `net`. Кількість шар віддає поруч із
грішми, і **порожньо ≠ нуль** (порожньо — рахунок виміру не веде); розріз — один чи
кілька вимірів (`acc_balance_turnover_by_dims(…, array['warehouse','nomenclature'])`,
значення їдуть колонкою `dims jsonb`; `_by_dim` — плоска обгортка для одного).
**Відсутність виміру** («договору немає» — а це ЗНАЧЕННЯ, не «будь-який») висловлюється
окремим параметром `p_absent` обох входів: `p_dims` працює на входження і протилежної
вимоги нести не може. Дві межі, обидві виміряні: відсутність УТОЧНЮЄ відбір і вимагає
хоч однієї пари в `p_dims` (сама по собі вона коштувала б секунди JIT-компіляції
кожному викликові шару — див. документ нижче), а `acc_journal` її не приймає взагалі:
там рядок це проводка, а не бік. Еталони — три звіти в `app/report/`.

**Форму запиту в шарі не міняй, не прочитавши [`docs/ledger-performance.md`](docs/ledger-performance.md).**
Вхід у вибірку залежить від `p_dims` — з відбором за субконто він індексний, і
властивість «ціна росте з вибірковістю, а не з розміром журналу» тримається на формі
`where`. Зламати її можна одним `or`, і жодна проба цього не побачить: на демо-наборі
різниці немає, вона з'являється в першого застосунку, що відпрацював рік. Там же —
стенд (`scripts/bench/`), яким це заміряно, і що саме лишилося незаміряним.

**Кількість і валюта зберігаються по боках проводки** — небалансові виміри, як у джерелі
моделі; балансова лише сума (це і є подвійний запис). Складна проводка (комплектація:
2 комплекти ← 6 корпусів) — кілька звичайних рядків; конвертація «Дт 312 USD Кт 314 EUR» —
дві валюти в одній проводці, і обхід через рахунки «в дорозі» тепер вибір, а не єдиний
спосіб. У `doc_entry_add` два шляхи: legacy-параметри — одне значення на всі боки виміру,
строго, як було; `p_quantities` / `p_currencies` — по боках, і перелік ВИСЛОВЛЮЄ НАМІР
(відсутній у ньому бік — законно порожній, `{}` — переоцінка). **Порожній бік проводки
можливий лише на забалансовому рахунку** (однобічний облік за визначенням; свої
`union all` мусять відсікати `null`). **Перед кожним записом шапки ядро кличе гак
застосунку** `app.doc_before_write(user_id, op, doc, prev)` — тригером, вмикається
створенням функції; сюди лягає заборона закритого періоду, і свого тригера на
`app.document` застосунок не ставить. Деталі всього переліченого — skill
[`db-function-contract`](skills/src/db-function-contract/SKILL.md).

**Цей конверт — один на весь API, включно з авторизацією.** Одиночний об'єкт іде в `item`,
список — у `rows`, відмова — `ok: false` + `messages`. Хелпери для TS-відповідей:
`ok()`, `rows()`, `err()` у `server/common/response.ts`.

## Backend runtime

`ModelRuntimeService.execute(model, command, payload, userId)`:
1. Якщо є TS-handler у реєстрі — викликає його.
2. Інакше будує ім'я функції `{schema}.{model}_{command}` і викликає PostgreSQL.

Додати нестандартну TS-команду: оголосити її в `manifest.json` моделі в блоці `commands.ts` (поле `module` — шлях до TS-файлу поряд із моделлю, напр. `./db/<model>.commands.ts`), потім `deno task sql:registry`. Хендлер має сигнатуру `(payload, ctx) => Promise<envelope>`, SQL-контекст приходить аргументом `ctx.db`. Деталі — [`docs/ts-model-command.md`](docs/ts-model-command.md); skill — [`db-function-contract`](skills/src/db-function-contract/SKILL.md).

## Фронтенд-компоненти

Lit Web Components, Shadow DOM увімкнений (стандартна інкапсуляція стилів).  
Дані отримують через `bus.request("data.load", { model, command, payload })`.  
Picker-поля використовують компонент `<ui-picker url="catalog/bank" fetch="lookup">` — `url` це
**маршрут в'ю** (`family/model`), а не API-шлях; деталі й контр-приклад — [`ui-picker.md`](client/ui-kit/components/ui-picker.md).  
Дати — тільки через `<ui-date>` (нативний `<input type="date">` не форматується): вигляд задає
шаблон `format` (`DD.MM.YY`, `MM.YYYY`, `DD.MM.YY HH:mm`), у моделі значення завжди ISO. Константи
й функції — [`client/shared/datetime.ts`](client/shared/datetime.ts), опис —
[`ui-date.md`](client/ui-kit/components/ui-date.md); у списках той самий шаблон через `ListColumn.format`.  
Період (звіти, регістри) — одним полем `<ui-period date-from date-to>`, а не парою `ui-date`:
пресети, зсув ◀ ▶ і людська підпис («Липень 2026») вбудовані; хелпери періодів
(`periodOf`, `shiftPeriod`, `periodLabel`) — [`client/shared/period.ts`](client/shared/period.ts),
опис — [`ui-period.md`](client/ui-kit/components/ui-period.md).  
Вкладення на формі — два різні компоненти й це не дубль: `<ui-attachments>` дає
СПИСОК (додати, видалити, завантажити) і живе серед полів, а `<ui-file-dock>` з
кнопкою `<ui-attachment-button>` ДІЛИТЬ екран навпіл — файл і форма одночасно,
зі смугою між ними й окремою прокруткою в кожній половині. Друге зроблено під
звірку розпізнаного документа зі сканом; плавуче вікно лишається другим режимом
(перемикач у смузі заголовка), бо воно про інше — «глянути, що це», не розсовуючи
екран. Звідси вимога, яку варто знати наперед: **форма займає панель вкладки
цілком** (`BaseUI` задає `:host { height: 100% }`) — ділити можна лише те, що має
висоту. Математика обох режимів — у чистих
`client/ui-kit/split-geometry.ts` і `window-geometry.ts` (та сама причина, що в
`popover.ts`: помилка там не падає, а тихо з'їжджає). Опис — [`ui-file-dock.md`](client/ui-kit/components/ui-file-dock.md).  
Локалізація: `t("bank.titleOne")` через сигнальний store — деталі нижче.

## Локалізація

**Рядок живе там, де код, який його показує**: ключі моделі — у її `_locales/`, спільні —
в `app/shared/_locales/`; `app/_locales/*.json` — склейка (`locales:build`), комітиться,
руками не редагується. **Сервер тексту не перекладає — він його називає** маркером
`@[ключ]{...}`, розгортає клієнт; рядок без маркера не чіпається (діагностика). Ключі ядра
(`core.*`) живуть у локалях фреймворку — нове повідомлення ядра потребує релізу
`@altera/client`. Названий ключ без перекладу гірший за неперекладений текст — це під
пробою `scripts/translation-markers_test.ts` (вимагає обох мов). У меню в базі лежить
маркер; друк маркера не знає (шаблон на кожну мову). Деталі —
[`docs/localization.md`](docs/localization.md).

## Екрани: форми, списки, стилі

**Контракт даних форм (`$root`)** — усі екрани наслідують `BaseUI`: `$root` — реактивне
дзеркало поля `data` з конверта, засіяне зі схеми через `Value.Create` (жодних рукописних
порожніх об'єктів); `$`-префікс — службовий стан (`$query`), транзієнт у `$root` не
потрапляє. Skill — [`model-form-root`](skills/src/model-form-root/SKILL.md); еталони —
`app/catalog/bank/bankEdit.ts`, `app/document/invoice/invoiceEdit.ts`.

**Форма списку** — наслідуй `ModelListBase`: підклас задає лише `model`, `editRoute` та
`columns`, решта (тулбар, сортування, пагінація, пошук, Excel усього відбору) — у базі.
Деталі — [`docs/ui-list-form.md`](docs/ui-list-form.md); skill —
[`model-list-form`](skills/src/model-list-form/SKILL.md); еталон — `app/catalog/bank/bankList.ts`.

**Таблична частина документа** — примітив `TabularSection` (`client/ui-kit/tabular/`):
форма оголошує типізовані колонки, логіка (рядки, перенумерація, живі підсумки,
клавіатура) — у контролері; подання — два незалежні компоненти `<ui-tabular-table>` і
`<ui-tabular-toolbar>`. Skill — [`document-tabular-section`](skills/src/document-tabular-section/SKILL.md);
еталони — `app/document/invoice/invoiceEdit.ts` (простий) і
`app/operation/manual_entry/manualEntryEdit.ts` (custom-комірки, умовні колонки).
Кілька табличних частин лежать на вкладках `<ui-form-tabs>`.

**Розкладка форми, режим перегляду, вкладки** — [`docs/ui-edit-form.md`](docs/ui-edit-form.md).
Головне: каркас малює `renderForm(fields)` із панеллю **угорі** (підвал їде за екран саме
на найдовших формах); підпис поля — тільки `renderField`. Без права на запис і після
проведення форма відкривається незмінною (`readonlyMode`): нативні контроли гасить
`fieldset[disabled]` каскадом, компонентам ui-kit `?disabled` передається явно, а контрол
у перегляді **гасне, не зникає**. Помилку в схованій табличній частині банер називає, а
вкладку вмикає сам компонент за сигналом `pendingFocus`.

**Обов'язковість і перевірка полів** — [`docs/ui-form-validation.md`](docs/ui-form-validation.md);
skill — [`model-form-root`](skills/src/model-form-root/SKILL.md). Головне: правила задає
форма методом `fieldRules()` (умова вільно читає `$root`), схема — лише дефолт;
перевіряються оголошені поля, не вся схема; запуск — `trySave()`. Відмову може назвати й
сервер — повідомлення конверта несе `field`, і клієнт підсвічує те саме поле; повідомлення
без прив'язки до даних позначається `modal: true` і показується окремим вікном із
будь-якого екрана (`data-service.ts` + `bus.alert()`).

> **Стилі:** збірка Tailwind одна і належить застосунку — вхід `app/styles/tailwind.css`;
> фреймворк CSS не компілює, а віддає тему плоским текстом, і дописує її `setAppStyles()`
> **після** зібраного Tailwind — правила теми безшарові й мусять перебивати `utilities`.
> Звідси головне для того, хто щось у вигляді міняє: **усе, що має перебити тему, пиши в
> тому ж файлі нижче за неї, а не класами в розмітці** — клас у розмітці це намір, а не
> результат. Каталоги, які сканує Tailwind, перелічені в `@source`; шлях там реальний
> (сканер читає директиву з диска, повз бандлер), а шлях у нікуди валить збірку.
> Чому саме так і які пастки з цього ростуть (`background` проти `background-color`,
> неоголошені змінні daisyUI, `--icon-size`, граф чанків) — скіл
> [`framework-ui-internals`](skills/src/framework-ui-internals/SKILL.md).

**Права в інтерфейсі.** Кнопка, якої користувач не має права натиснути, не малюється;
джерело — `can(model, action)` із `client/auth/session.ts`, у формі — `this.may("post")`
і `maySave` (`save` — два різні права: `create` новому, `edit` наявному, рахується як на
сервері). Дві межі: це **підказка, а не захист** (відмовляє сервер, fail-closed), і набір
прав **не реактивний** — читається раз при вході. Видимість пунктів меню — інший механізм
(`app.user_group_menu`). Деталі — [`docs/access-control.md`](docs/access-control.md).

**Гарячі клавіші й посилання на вкладку** — [`docs/ui-shell.md`](docs/ui-shell.md).
Головне: канал клавіш один на застосунок (слухач у `tab-controller`, бо панелі всіх
вкладок у DOM одночасно), розкладка дивиться на `event.code`, а не `key`; нативний
`<dialog>` оболонка впізнає за `composedPath()`. Посилання — односторонній вхід
(`route` + `modelId`), а шлях без `#` вимагає налаштованого проксі — стереже крок smoke.

**Ліва панель меню** — дані, а не код: склад задає адміністратор (`app/admin/menu/`),
оболонка лише малює. Порожня тека не показується взагалі («щойно створена тека не
з'явилася» — не поломка), коренева тека `bottom` — закріплена нижня частина, а не розділ.
Деталі й пастки — [`docs/left-menu.md`](docs/left-menu.md).

**Діалог вибору (picker)** — наслідуй `ModelPickerBase` (`client/ui-kit/base/model-picker-base.ts`): підклас задає лише `model` та `columns`. Пошук, вибір, підтвердження/скасування — у базі. Документація — [`docs/ui-picker-form.md`](docs/ui-picker-form.md); skill — [`model-picker-form`](skills/src/model-picker-form/SKILL.md); еталон — `app/catalog/bank/bankPicker.ts`.

## Друковані форми

Друк — у ядрі (`server/modules/print/`): формат шаблону, план рендеру, PDF-рендерер;
клієнт не рендерить нічого, прев'ю редактора малює той самий рендерер. У застосунку —
лише блок `prints` у манифесті й файл шаблону; таблиця шаблонів — пакет ядра
`@core/print_template`, редагування — admin-модель. Шрифти друку вбудовані в модуль
(`print:fonts`) — у встановленому пакеті файлу на диску немає. Штрих-коди — блок
`barcode` (`code128`/`ean13`/`qr`), символіки під `test:unit`. Skill —
[`model-print-form`](skills/src/model-print-form/SKILL.md); деталі —
[`docs/print-subsystem.md`](docs/print-subsystem.md); еталон — `app/document/invoice`.

## Звіти

Екран звіту наслідує `ReportBase`: підклас задає `reportTitle`, `buildReport()`,
`renderFilters()` і `renderBody()`; закріплений тулбар **Оновити / Друк / Excel**, банер і
шапка для паперу — з бази, причому друк і експорт беруть уже намальовану таблицю, без
опису колонок. SQL звіту — дві функції, рукописна одна: обгортку `_index` генерує
`sql:gen` зі схеми фільтрів, тіло `_data(user_id, filters)` пишеться руками. Друк —
браузером (`window.print()`), Excel — справжній `.xlsx`, зібраний у браузері з DOM
таблиці; звідси контракт розмітки — числова комірка мусить мати `tabular-nums`.
Деталі — [`docs/report-screen.md`](docs/report-screen.md) і
[`docs/sql-codegen.md`](docs/sql-codegen.md) (розділ `type: "report"`); skill —
[`model-report-form`](skills/src/model-report-form/SKILL.md); еталони —
`app/report/turnover_balance` і `app/report/document_movements`.

## Доступ (користувачі, групи, права)

У ядрі (`server/sql/access/`, пакет `@core/access`): користувачі, сесії, групи, права.
Право — трійка **група → модель → дія** (`view`/`create`/`edit`/`delete`, документам ще
`post`/`unpost`; `model = '*'` — усі). **Перевірка ввімкнена для всіх команд** — у тому
самому `select`, що викликає команду; дія виводиться з імені (`save` → `create`/`edit` за
`item.id`), а **нестандартна команда мусить оголосити право** в `manifest.commands.access`
— інакше 501, свідомо fail-closed. Сесія — httpOnly-cookie (`SameSite=Strict` +
`X-Requested-With`); тимчасовий пароль вимагає зміни; екран входу належить застосунку.
Права → [`docs/access-control.md`](docs/access-control.md); вхід і сесія →
[`docs/authentication.md`](docs/authentication.md); skill —
[`model-command-access`](skills/src/model-command-access/SKILL.md).

## Вкладення (бінарні об'єкти)

Зображення й файли — у ядрі (`server/modules/blob/`): токен доступу, віддача
байтів, приймання завантажень. Байти лежать у PostgreSQL (`app.attachment`,
`bytea`) — зовнішнього сховища немає. Одна таблиця обслуговує і поле-посилання
(логотип: колонка `logo_id`), і список вкладень запису (`owner_model` +
`owner_id`) — для документів і довідників однаково.

Байти ходять окремим каналом (`GET/POST /api/blob`), а не командою моделі:
`<img src>` не вміє слати `Authorization`, тому право доступу несе підписаний
токен в URL. У відповідях моделей SQL віддає сирий `access_key` у полі `token`
/ `<field>Token`, а рантайм міняє його на токен поточної сесії — аналог типу
`!Token` в A2v10. Поле-вкладення в схемі позначається `x-blob` (плюс
`x-transient` для самого токена). Компоненти — `<ui-image>` і
`<ui-attachments>`; деталі — [`docs/blob-subsystem.md`](docs/blob-subsystem.md);
еталони — `app/catalog/organization` (логотип), `app/document/invoice`
(вкладення документа).

На вкладеннях будується документообіг (обмін підписаними документами з
контрагентами, AI-розпізнавання вхідних). Гіпотези, прийняті рішення й план —
[`docs/doc-exchange-plan.md`](docs/doc-exchange-plan.md); коду ще немає.

## Зовнішній агент

Працює **готовий зовнішній агент від імені реального користувача** — своєї LLM-частини
ми не пишемо, у `server/modules/agent/` жодного LLM немає. Два входи, як у MCP:
`GET /api/agent/tools` (каталог без схем; з `?model=…` — схеми payload-ів із TypeBox) і
`POST /api/agent/call` — диспетчер звіряє виклик із тим САМИМ переліком, що віддає
`tools` (другий список розійшовся б мовчки), і кличе рантайм від імені користувача.
Перелік фільтрується правами; звіти агенту доступні (команда `index` — право з
`commands.access`, вивід з імені знає лише стандартні дії). **Персональний токен**
(`app.access_token`) — `Authorization: Bearer`, прав не несе, видається лише з браузера
по сесії; керування на `/api/auth/tokens`, поза правами моделей. **Запобіжники запису
діють лише на токен**: `delete`/`post`/`unpost` вимагають `"confirm": true`, токен
`isReadOnly` відсікає запис узагалі. Перевірок ДВІ, і це не дубль: рантайм моделей
(`ModelRuntimeService.execute`) і приймання вкладень (`POST /api/blob/upload`) — байти
ходять власним каналом, повз команди моделей, і доти прапорця не бачили взагалі
(server 0.23.1). Тому новий вхід, який ПИШЕ, зобов'язаний покликати
`assertTokenMayWrite` з `server/common/http.ts`: обіцянка стосується токена, а не
одного споживача. **Файли ходять в обидва боки, але не через контекст агента**:
вкладення бере звичайна модель ядра `attachment` (право `attachment:view`; вона не
в реєстрі застосунку, тож на екрані груп дописана рядком), друк — команда `printPdf`
кожної моделі з непорожнім `prints`; обгортка кладе байти на диск і віддає ШЛЯХ, а з
відповіді `altera_call` їх зрізає. **MCP-обгортка** — окремий пакет `mcp/` (шість
інструментів замість дзеркала команд, одна база на процес) —
[`mcp/README.md`](mcp/README.md). Рішення й план —
[`docs/external-agent-plan.md`](docs/external-agent-plan.md).

## План розвитку

Фреймворк винесено в пакети (`@altera/client`, `@altera/server`, `@altera/tools`,
`@altera/create` на jsr.io); журнал того кроку — прийняті рішення й знайдені пастки —
[`docs/legacy/framework-extraction-plan.md`](docs/legacy/framework-extraction-plan.md).
Актуальний план — [`docs/development-plan.md`](docs/development-plan.md): критичні
виправлення, обов'язкові компоненти фреймворку (ієрархічні довідники, таблична
частина як примітив, audit log, dirty-форма), перший прикладний контур (банк/каса),
експлуатаційний контур. Виконані плани переїжджають у `docs/legacy/`.

## Зворотний зв'язок від прикладників

**Записи лежать поза цим репозиторієм** — у сусідньому каталозі `../altera-feedback/`
(свій git, локальний, без remote: канал спільний для двох репозиторіїв, копія в кожному
розійшлася б). Правила — `../altera-feedback/README.md`; коротко для боку ядра:
`gaps/` — є обхід у застосунку, `wishes/` — обходити нічого; ядро заповнює лише `стан` і
`версія` (плюс `причина` при відхиленні), а закриває запис прикладник (`обхід: прибрано`);
`INDEX.md` похідний — `python tools/build-index.py` після кожної правки шапки. Потік у
зворотний бік іде `CHANGELOG.md` → `@altera/skills` → `FRAMEWORK-CHANGELOG.md`. У
scaffold цього каналу немає навмисно — адресу називає власник застосунку.

## TypeBox-схема

> Деталі та шаблон — у skill [`typebox-model-schema`](skills/src/typebox-model-schema/SKILL.md).

`app/<family>/<model>/<model>.schema.ts` — єдине джерело типів для frontend і backend:
- `BankItemSchema` — поля форми + id (`Type.Union([Type.String(), Type.Null()])` для нового запису)
- `BankRowSchema` — колонки списку
- `BankLookupRowSchema` — рядки picker (`id` + `name`)
- `BankListPayloadSchema`, `BankGetPayloadSchema`, `BankSavePayloadSchema` тощо

Primary key: `bigint` у БД, `string` у TypeScript/JSON (щоб уникнути втрати точності).  
Анотації `x-form`, `x-list`, `x-lookup` керують відображенням у UI.

## Додати нову модель (чек-лист)

> **Перед створенням моделі застосуй skill [`model-feature-architecture`](skills/src/model-feature-architecture/SKILL.md)** — він описує структуру feature-папки, manifest-маршрути та контракт SQL-функцій. Цей skill, своєю чергою, посилається на [`typebox-model-schema`](skills/src/typebox-model-schema/SKILL.md) для визначення `<model>.schema.ts`.

1. Створити `app/<family>/<model>/manifest.json`
2. Створити `<model>.schema.ts` з TypeBox-схемами
3. Створити UI-компоненти: `<Model>List.ts` (skill [`model-list-form`](skills/src/model-list-form/SKILL.md) — наслідувати `ModelListBase`, не писати тулбар/таблицю/пагінацію вручну), `<Model>Edit.ts`, `<Model>Picker.ts`
4. Створити `db/struc.sql`, а CRUD — або згенерувати (`deno task sql:gen <family>/<model>`,
   вихід у `db/_generated/<model>.crud.gen.sql`), або написати руками в `db/<model>.sql`
   і оголосити відмову від генерації (див. нижче). Доробки поверх генерації — у
   `db/<model>.custom.sql`.
5. Додати модель у `app/sql.json`
6. Запустити `deno task sql:registry` → оновить generated-файли
7. Запустити `deno task sql:assemble && deno task sql:publish` → опублікувати SQL у БД

Окремий backend-модуль/контролер потрібен лише для нестандартної логіки.

**Згенерований CRUD — закомічений вихідник, а не продукт збірки.** `sql:gen` навмисно
не входить у `model:build`: генерація робиться свідомо і по одній моделі, коли змінилася
схема, і потрапляє в дифф рев'ю разом зі схемою. Пакетний прогін без аргументу лишається
(зручно перевірити, що нічого не роз'їхалося), але помилка однієї моделі більше не спиняє
решту — вона друкується рядком `✗`, а ненульовий код виходу віддається наприкінці.

**Що саме генерується — залежить від `type`:**

| `type` | що виходить |
|---|---|
| `catalog` | `list`/`get`/`save`/`delete`(/`undelete`)/`lookup` |
| `document` | те саме плюс `post`/`unpost`, дані у двох таблицях (шапка `app.document`) |
| `register` | те саме, що в довідника, **без `lookup`** |
| `report` | обгортка `index`, сам запит рукописний |

Інші типи (admin-екрани) пропускаються за типом. Модель із рукописним CRUD оголошує це
явно — `"sql": { "generate": false }` у манифесті: інакше пропуск тримався б на тому, що
ім'я файлу схеми не збіглося з очікуваним, і модель виглядала б охопленою.

Три речі, які видно лише на першому запису, тому названі й тут: таблиця генерованої
моделі мусить мати **`created_at`/`updated_at`** (`save` пише `updated_at` беззастережно);
**`x-db-type` — голе ім'я типу**, точність задає DDL; **позначка на видалення виводиться
з поля `isDeleted` у схемі**, а не з типу моделі — без нього `delete` фізичний.

Решта — [`docs/sql-codegen.md`](docs/sql-codegen.md): анотації схеми, порядок збирання,
override окремих функцій, дві таблиці документа, регістр і обгортка звіту.

## Скіли агента

**Порядок звертання: спершу скіл, потім приклади в репозиторії.** Правило діє на будь-яку
роботу в `client/` — базові класи, компоненти ui-kit, тема — і однаково на `server/`.
Спочатку `framework-ui-internals` (інваріанти `client/ui-kit`), далі скіл того боку, якого
торкаєшся (`model-list-form`, `model-form-root`, `screen-design-rules`, `lit`…), і лише
після цього — сусідні файли як зразок.

Причина не в дисципліні, а в тому, що з коду видно **як** зроблено і не видно **чому**:
скіл називає інваріант, а приклад показує один його наслідок. Хто копіює наслідок, повторює
його й там, де інваріант інший. Ціна помилки в `client/` вища, ніж у застосунку: це
опублікований пакет, і невдале рішення виїде до всіх застосунків мінорною версією, звідки
його вже не забрати.

Пастка тут в тому, що скіл легко прочитати **випадково** — він випадає з `grep` по
`skills/skills.generated.ts` разом із кодом — і сприйняти прочитане як «контекст зібрано».
Випадкове влучення покриває один скіл із п'яти й мовчить про решту; звертатися треба
поіменно й до початку роботи, а не після того, як рішення вже прийняте.

Те саме правило з боку застосунку живе не тут, а в `create/template/CLAUDE.md` (розділ
«Головне правило роботи тут»): там воно ще й каже прямо, що застосунок пишеться НА
фреймворку, а брак можливості **спиняє роботу**. Асиметрія навмисна: тут брак можливості
усувають на місці, бо фреймворк і є предмет роботи, а в застосунку обхід — це чужий борг,
який лишається назавжди. Після правки шаблону — `deno task scaffold:template`.

**Що змінилося — окремий канал.** Скіли кажуть, ЯК робити зараз, і не кажуть, що
змінилося й що доведеться поправити руками; `docs/` і цей файл у застосунок не їдуть
узагалі. Тому `CHANGELOG.md` у корені репозиторію вбудовується в `@altera/skills`
(`skills:build`) і лягає в корінь застосунку як `FRAMEWORK-CHANGELOG.md` при
`skills:sync` — з тією ж шапкою «не редагувати». Розділ на реліз ділиться на «Потребує
дії» й «Змінилося саме», а правки шаблону scaffold — на окремий підрозділ: наявні
застосунки їх не отримають ніколи. Свіжість вбудованого тексту стереже проба, зміст —
той, хто робить реліз (скіл `framework-release`).

Джерело одне — `skills/src/<name>/SKILL.md`; `.claude/skills` і `.github/skills` — симлінки
на нього. Аудиторію оголошує сам скіл у frontmatter (`metadata.audience`): `app` їде в пакет
`@altera/skills`, `framework` і `bootstrap` лишаються тут. Умовчання fail-closed — без
оголошення скіл у пакет не їде, `skills:build` друкує `⚠`, а проба падає.

Деталі — [`docs/agent-skills.md`](docs/agent-skills.md): три аудиторії й чому їх три, мова
скіла, згенерований перелік гліфів, що саме перевіряють проби, і три правила при правці
(скіл читається у ВСТАНОВЛЕНОМУ застосунку, розкладені файли комітяться, чужий скіл sync не
чіпає).


## Перенесення прикладного рішення

**Рішення — це `app/` цілком, і більше нічого**; решта кореня — каркас від scaffold.
Звідси вимога під `check:deps`: **`app/` не виходить відносним імпортом за свої межі** —
у фреймворк лише через `@client/…` і `@altera/server`. Команди: `solution:export` /
`solution:import` (повна поставка заміняє `app/` цілком; частковий пакет — інструмент
розробника, розведені номером формату). **Підтримка — вивідний стан**: `solution:status`
звіряє диск із манифестом поставки, правка одного файлу переводить установку в ручний
режим. Оновлює окрема команда `solution:update`, не кнопка в застосунку. Деталі —
[`docs/update-guide.md`](docs/update-guide.md) і
[`docs/solution-transfer-plan.md`](docs/solution-transfer-plan.md).

## Ліцензії сторонніх компонентів

**Списків тут немає — обидва переліки виводяться з того, що справді роздається.**
Причина в тому, що список старіє мовчки: MIT/BSD-3/Apache-2.0/OFL дозволяють усе,
що ми робимо, і просять рівно одного — щоб текст ліцензії їхав разом із байтами,
а невиконана вимога нічого не ламає.

Місць два, бо роздач дві. **`dist/`** — плагін пресету Vite
(`client/vite-notices.ts`) кладе поруч із бандлом `THIRD-PARTY-NOTICES.md`,
зібраний із графа чанків плюс `@import`/`@plugin` у CSS застосунку (шрифти
приходять саме звідти й у графі JS їх немає взагалі). Кожен застосунок дістає
це, не роблячи нічого. **`@altera/server`** — `deno task print:fonts` генерує
`server/THIRD-PARTY-NOTICES.md` тим самим прогоном, що й `fonts.generated.ts`,
бо пакет везе субсети Roboto та PT Sans під OFL-1.1 усередині себе; тому й поле
`license` там — `MIT AND OFL-1.1`, а не просто MIT.

Решта залежностей (`@danet/core`, `postgres`, `pdf-lib`, `vite`, `tailwindcss`)
у наші пакети не потрапляє — вона резолвиться споживачем із реєстру, і атрибуції
з нас не вимагає. Копілефту в дереві немає жодного.

## Розгортання

Повний шлях від порожньої машини до працюючої системи — [`docs/deployment.md`](docs/deployment.md):
створення застосунку через `jsr:@altera/create`, база, `deno install` **до** збірки
(`vendor: true` — не побажання, а вимога), публікація SQL, перший адміністратор, продуктивна
збірка й таблиця типових збоїв. Розділ про продуктивне оточення позначений як неперевірений —
там написано, що зробити, а не що вже робилося.

**Deno Deploy — окремо і перевірено**: [`docs/deno-deploy.md`](docs/deno-deploy.md). Платформа
бере на себе PostgreSQL (учасні дані підставляє сама, і фреймворк читає їх без перехідника —
імена libpq), TLS, порт і позначку продуктиву. Схему накочує `predeploy`: пакет збирається
кроком `build`, публікується перед розкатом тією ж командою `sql:deploy`, з тими самими
змінними, що отримує застосунок. Там же — пастки, які видно лише на живій платформі: гонка
в збірці Tailwind (лікується повтором), тунель, що веде в базу контексту Local, і відсутність
ротації пароля бази в панелі.

## Комміти

**Текст комміта — англійською.** Це стосується всього повідомлення: і заголовка, і тіла.
Код, назви змінних і рядки в них теж англійські, тож розбіжність мов усередині одного
повідомлення давала б суміш, у якій незручно і читати, і шукати (`git log --grep`).
Документація й коментарі в коді лишаються українськими — там мова цілісна.

Решта того, як писати повідомлення (чому, а не що; причина рішення, а не перелік файлів),
видно з історії — вона й є зразком.

## Інструменти розробника

`app/server.ts` експортує `createServer()` — застосунок як обробник `(Request) => Response`,
без прив'язки до порту (`Deno.serve` живе під `import.meta.main`). Завдяки цьому обидва
інструменти піднімають застосунок **у своєму процесі**: не треба ні вільного порту, ні
запущеного `dev:server`, ні очікування готовності, а у відповідь приходить справжній
`Response` зі справжнім статусом — включно з 304, який HTTP-клієнти часто з'їдають.

```bash
deno task smoke                            # усі проби; проби, що пишуть, прибирають за собою
deno task api bank list                    # конверт команди моделі
deno task api bank get '{"id":"1"}'        # з payload
deno task api bank list --user 5           # від імені користувача
deno task api bank list --raw | jq .data   # чистий JSON під конвеєр
```

Обидва спираються на `tools/dev-guard.ts` і відмовляються стартувати, якщо оточення
позначене як `production`/`prod`/`staging` або хост БД не локальний — БД береться з `.env`,
і промах у ньому не має коштувати чужих даних. Обхід не передбачено свідомо.

Нову пробу додавай кроком у `scripts/smoke_test.ts`; запис у БД — тільки свій рядок і тільки
з прибиранням у `finally`.

**Прибирає проба фізично** — хелпером `purge(table, id)` прямим запитом до бази, а не
командою `delete` моделі. Команда тепер лише ПОЗНАЧАЄ запис, тож рядок лишався в таблиці
разом зі своїм унікальним кодом, і другий прогін `deno task smoke` поспіль падав на
`SMOKEUQ1` — на тій самій унікальності, яку проба й перевіряє. Тобто проби були
одноразовими, а виглядало це як зламаний застосунок; помітно лише тому, хто запустить
двічі. Пряма робота з базою дозволена рівно тут і рівно для цього: власні рядки проби,
локальна база, той самий `dev-guard`. Групи (`groupDelete`) і користувача redirect-проби
(`user_delete`) прибирають штатні команди — у них позначки немає, вони видаляють
по-справжньому.

### DENO_EMIT_CACHE_MODE=disable у задачах

Три задачі з графом Danet (`dev:server`, `smoke`, `api`) вимикають кеш транспіляції:
Windows Defender хибно позначає файл кеша (base64 інлайн-sourcemap за силуетом збігається
з упакованим скриптом) як `Trojan:Script/ObfusScript.A!ml`. Без кеша файл на диск не
лягає — нічого сканувати, антивірус лишається на повну силу; різниці у швидкості немає
(заміряно). Коли Defender оновить визначення, префікс можна прибрати.

## Змінні середовища (`.env` у корені репозиторію)

Файл один і лежить у корені — не в `server/`. `server/` і `client/` — бібліотеки, вони
`Deno.env` не читають узагалі; читає застосунок через `configFromEnv()`. Але той самий файл
потрібен і `scripts/` (`sql:publish`, `passwd`, `smoke`, `api`), які до `app/` не належать,
тому спільне місце — корінь. Задачі в `deno.json` передають `--env-file` без аргументу,
тобто беруть `./.env` відносно кореня.

`.env` у `.gitignore`; шаблон із повним переліком — `.env.example`, його й тримати в актуальному
стані. Той самий файл підхоплює `docker-compose.yml` для облікових даних PostgreSQL, тож
пароль БД описаний один раз.

```
# DATABASE_URL=postgres://…    # заданий — перекриває PG* цілком
PGHOST=localhost            # ці ж значення йдуть у docker compose
PGPORT=5432
PGDATABASE=altera
PGUSER=altera
PGPASSWORD=altera_secret
PGSSLMODE=                  # порожньо → з хоста: локальний без TLS, інший require
DB_POOL_SIZE=10             # на безсерверному розгортанні 1–3
DB_CONTAINER_NAME=altera-pg-03  # ім'я контейнера глобальне на демон — див. нижче
PORT=3000                   # читає app/server.ts і vite.config.ts, не configFromEnv
BLOB_TOKEN_SECRET=change-me-in-production  # підпис токенів вкладень; JWT_SECRET — legacy-фолбек;
                            # з плейсхолдером у продуктиві сервер не стартує
AUTH_SESSION_TTL_HOURS=720
AUTH_COOKIE_NAME=altera_session  # унікальне на машину, якщо екземплярів кілька
BOOTSTRAP_LOGIN=            # логін+пароль разом → створюється адміністратор на старті
BOOTSTRAP_PASSWORD=
DEV_AUTH_BYPASS=0           # у продуктивному оточенні валить старт сервера
DEV_AUTH_USER_ID=
VITE_PORT=5173              # порт Vite; читає vite.config.ts, strictPort увімкнено
VITE_DEV_URL=http://localhost:5173   # непорожній → сервер віддає в'ю через Vite
OPENAI_API_KEY=             # LLM-агент; без ключа агент просто не працює
OPENAI_MODEL=gpt-4o-mini
OPENAI_ROUTER_MODEL=gpt-4o-mini
```

Решта змінних має дефолти й у `.env` не потрібна — повний список у розділі «Конфігурація
сервера» вище, єдине джерело істини — `server/config/config-from-env.ts`.

**Кілька екземплярів на одній машині** — кожен у своєму каталозі зі своїм `.env`;
окремі `PORT`, `VITE_PORT`+`VITE_DEV_URL`, `PGDATABASE`, `BLOB_TOKEN_SECRET` і —
неочевидне — `AUTH_COOKIE_NAME`: **cookie не розрізняють порт**, тож зі спільним іменем
вхід у сусідній застосунок мовчки затирає цю сесію. Порти фронта й бекенда розійтися не
можуть за побудовою (`vite.config.ts` бере той самий `PORT` для проксі, зайнятий порт
Vite — помилка, а не тихий переїзд). Деталі — [`docs/deployment.md`](docs/deployment.md),
розділ 8.
