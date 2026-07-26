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
deno task check:deps   # перевірити напрямок залежностей (client/server не залежать від app)
deno task smoke        # димові проби HTTP-межі (застосунок у процесі, без порту)
deno task test:unit    # юніт-проби бібліотек без БД і HTTP (символіки штрих-кодів)
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
    db/
      struc.sql             # DDL таблиць
      <model>.sql           # PostgreSQL-функції моделі
      migration.sql         # міграції
      data.sql              # seed-дані
  styles/
    tailwind.css            # ЄДИНИЙ вхід збірки Tailwind: @source, daisyUI, шрифти, тема
    app-styles.ts           # ?inline → setAppStyles(): віддає зібраний CSS у client
  _locales/                 # локалізація: en.json, uk.json ...
  _sqlpackage/              # зібрані SQL-файли (генеруються, не редагувати)
  # SQL ядра (доступ, меню, attachment, document, journal_entry, print_template,
  # help_*) лежить у server/sql/ і підключається записами "@core/<назва>" у sql.json.
  # Файли там — звичайні .sql, але в модуль текст потрапляє через згенерований
  # core-sql.generated.ts (deno task core:sql): text-імпорти не приймає JSR.
  # У меню в ядрі тільки структура й функції; сід (склад пунктів — маршрути цього
  # застосунку) лишається в app/admin/menu/db/data.sql, там же й екрани.
  _generated/               # авто-генерація (deno task sql:registry): model-registry, agent-routes, view-manifest
  server.ts                 # composition root бекенду: реєструє дані з _generated → bootstrap (Danet)
  shared/                   # app-стан: current-organization, view-route
                            #   (TypeBox-контракти фреймворку переїхали в client/shared/schema.ts)
  sql.json                  # список моделей для sql:assemble

client/                     # ui-kit та клієнтський runtime — БІБЛІОТЕКА (Deno workspace)
  ui-kit/components/        # web components: ui-picker, ...
  bus/bus.ts                # event bus: bus.request("data.load", { model, command, payload })
  styles/theme.css          # тема й контракти компонентів — ПЛОСКИЙ CSS, без директив Tailwind
  shared/styles.ts          # `tw`: порожній CSSStyleSheet, який заповнює застосунок
  shared/schema.ts          # спільні TypeBox-контракти: SortDir, Query, Totals, DocumentHeader
  vite.ts                   # пресет defineAlteraConfig() — уся машинерія Vite (експорт "@altera/client/vite")
  # index.html і main.ts тут немає навмисно: вони належать застосунку (app/).
  # Вхід збірки Tailwind (app/styles/tailwind.css) — теж: він сканує каталоги
  # застосунку. Але сама машинерія Vite — пресет тут: вона однакова для всіх застосунків.

server/                     # Danet backend-БІБЛІОТЕКА (Deno workspace), не залежить від app
  main.ts                         # public API бібліотеки: bootstrap + configFromEnv + типи (барель)
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
    agent.service.ts              # прямий диспетчер команд (без LLM)
    agent-llm.service.ts          # LLM-агент (OpenAI Responses API)
    agent-routes.ts               # getAgentRoutes() — маршрути з config.agentRoutes
  modules/model-view/
    model-view.registry.ts        # view-реєстр з config.views (без ФС-скану)
  modules/auth/                   # авторизація; методи входу — з config.auth.methods
  database/                       # тільки рантайм: модуль і пул з'єднань

tools/                      # пакет інструментів (@altera/tools): codegen, publish, дев-клієнт
  generate-model-sql.ts           # генерація SQL моделей
  generate-model-runtime-registry.ts  # генерація app/_generated (registry/routes/views)
  assemble-sql-package.ts         # збірка SQL-пакета з db/ файлів моделей + @core
  publish-app-sql.ts / publish-sql.ts  # публікація зібраного SQL у БД
  app-client.ts                   # AppClient: застосунок у процесі; createServer — інжекцією
  dev-guard.ts                    # захист дев-інструментів від продуктивної БД
  set-password.ts                 # встановлення пароля користувача (пряма БД)
  # знання про застосунок приходить ззовні: codegen/publish — аргументом appDir,
  # AppClient — фабрикою createServer; статичного імпорту app у пакеті немає.

scripts/                    # репо-локальні обгортки (НЕ пакет): імпортують app + @altera/tools
  api.ts, smoke_test.ts           # дев-обгортки: інжектять createServer з ../app/server.ts
  check-deps.ts                   # guardrail меж пакетів (client/server/tools vs app)
```

> **Напрямок залежностей:** `app → client/server/tools`, ніколи навпаки. Бекенд-runtime
> отримує все ззовні — одним аргументом `bootstrap()`. Збіркові інструменти — окремий пакет
> `tools/`, а не всередині бібліотек client/server: те, що читає `app/sql.json` чи
> `_sqlpackage`, знає про застосунок, але отримує його **аргументом** (`appDir`), не імпортом,
> тож у пакет це знання не зашите. `deno task check:deps` перевіряє це для `client`, `server`
> і `tools`: ані залежності від застосунку імпортом, ані виходу відносним імпортом за межі пакета.

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

Змінні оточення (усі — лише через `configFromEnv`): `DB_HOST/PORT/NAME/USERNAME/PASSWORD`,
`DB_POOL_SIZE`, `AUTH_SESSION_TTL_HOURS`, `BOOTSTRAP_LOGIN/PASSWORD/FULL_NAME`,
`DEV_AUTH_BYPASS`, `DEV_AUTH_USER_ID`, `DEFAULT_USER_ID`, `AUTH_PUBLIC_BASE_URL`,
`NODE_ENV`/`APP_ENV`/`DENO_ENV`,
`BLOB_TOKEN_SECRET`, `JWT_SECRET`, `BLOB_TOKEN_TTL_HOURS`, `BLOB_MAX_SIZE_MB`,
`OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_ROUTER_MODEL`.

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

## SQL-функції моделі

Кожна модель реалізує набір PostgreSQL-функцій. Сигнатура:

```sql
{schema}.{model}_{command}(user_id bigint, payload jsonb) returns jsonb
```

Стандартні команди: `list`, `get`, `save`, `delete`, `lookup`.  
Документи додатково: `post`, `unpost`.

Відповідь завжди у форматі:
```json
{ "ok": true, "data": { "item": {}, "rows": [], "options": {}, "totals": {} }, "messages": [] }
```

**Цей конверт — один на весь API, включно з авторизацією.** Одиночний об'єкт іде в `item`,
список — у `rows`, відмова — `ok: false` + `messages`. Хелпери для TS-відповідей:
`ok()`, `rows()`, `err()` у `server/common/response.ts`.

## Backend runtime

`ModelRuntimeService.execute(model, command, payload, userId)`:
1. Якщо є TS-handler у реєстрі — викликає його.
2. Інакше будує ім'я функції `{schema}.{model}_{command}` і викликає PostgreSQL.

Додати нестандартну TS-команду: оголосити її в `manifest.json` моделі в блоці `commands.ts` (поле `module` — шлях до TS-файлу поряд із моделлю, напр. `./db/<model>.commands.ts`), потім `deno task sql:registry`. Хендлер має сигнатуру `(payload, ctx) => Promise<envelope>`, SQL-контекст приходить аргументом `ctx.db`. Деталі — [`docs/ts-model-command.md`](docs/ts-model-command.md); skill — [`db-function-contract`](.github/skills/db-function-contract/SKILL.md).

## Фронтенд-компоненти

Lit Web Components, Shadow DOM увімкнений (стандартна інкапсуляція стилів).  
Дані отримують через `bus.request("data.load", { model, command, payload })`.  
Picker-поля використовують компонент `<ui-picker url="catalog/bank" fetch="lookup">` — `url` це
**маршрут в'ю** (`family/model`), а не API-шлях; деталі й контр-приклад — [`ui-picker.md`](client/ui-kit/components/ui-picker.md).  
Дати — тільки через `<ui-date>` (нативний `<input type="date">` не форматується): вигляд задає
шаблон `format` (`DD.MM.YY`, `MM.YYYY`, `DD.MM.YY HH:mm`), у моделі значення завжди ISO. Константи
й функції — [`client/shared/datetime.ts`](client/shared/datetime.ts), опис —
[`ui-date.md`](client/ui-kit/components/ui-date.md); у списках той самий шаблон через `ListColumn.format`.  
Локалізація: `t("bank.titleOne")` через сигнальний store + JSON-файли у `app/_locales/`.

**Контракт даних форм (`$root`)** — усі екрани (список, пікер, форма) наслідують `BaseUI`
(`client/ui-kit/base/base-ui.ts`). `$root` — реактивне дзеркало поля `data` з конверта
`{ ok, data, messages }`, засіяне зі схеми через `Value.Create` (жодних рукописних порожніх
об'єктів). Поля без префікса — дані моделі (`item`, `rows`, `totals`); `$`-префікс — службовий стан,
що дзеркалиться з БД (`$query`). Транзієнт (`running`, `busy`, `messages`) у `$root` не потрапляє.
Skill — [`model-form-root`](.github/skills/model-form-root/SKILL.md); еталони —
`app/catalog/bank/bankEdit.ts` (проста форма), `app/document/invoice/invoiceEdit.ts` (з табличною частиною).

**Форма списку** — наслідуй `ModelListBase` (`client/ui-kit/base/model-list-base.ts`): підклас задає лише `model`, `editRoute` та `columns`. Тулбар, серверне сортування, пагінація, пошук, вибір рядка — у базі. Кнопка **Excel** теж у базі: вивантажується **весь відбір** (та сама команда `list` з `pageSize` на весь результат, стеля `exportRowLimit` = 10 000), лист будується з оголошених колонок. Колонка без заголовка (кнопки дій) у файл не йде; колонці, чий `render` малює не сире поле (вкладений об'єкт, перекладений код), потрібен `exportText`. Документація для розробника — [`docs/ui-list-form.md`](docs/ui-list-form.md); skill для агента — [`model-list-form`](.github/skills/model-list-form/SKILL.md); еталон — `app/catalog/bank/bankList.ts`.

**Таблична частина документа** — контракт `.table-tabular` / `.cell-text` / `.cell-control` у `client/styles/theme.css`; контроли підключаються атрибутом `cell` (`<ui-decimal cell>`, `<ui-picker cell>`). Skill — [`document-tabular-section`](.github/skills/document-tabular-section/SKILL.md); еталон — `app/document/invoice/invoiceEdit.ts`.

**Розкладка форми редагування** — підпис поля тільки через `BaseUI.renderField(label, control, { field })`,
підвал тільки через `renderFormActions()` (Зберегти й закрити / Зберегти / Закрити). `field` вмикає
зірочку обов'язковості зі схеми, тому вона не розходиться з перевіркою в БД. Класів `form-control` і
`label-text` не існує в daisyUI 5 — це розмітка четвертої версії, і саме вона ламає вирівнювання підписів.

> **Стилі:** збірка Tailwind одна і належить застосунку — вхід `app/styles/tailwind.css`. Авто-детекція увімкнена (сканує `app/` і `client/` від кореня репо); фреймворк додатково вказаний явно `@source "../../client"` — бо в пакеті він у `node_modules`, який авто-детекція виключає. `@source` НЕ приймає аліас Vite чи сентинел: сканер Tailwind читає його з диска, повз бандлер — лише реальний шлях. Тема підключається `@import "@client/styles/theme.css"` **останньою** (на відміну від `@source`, `@import` резолвить enhanced-resolve Tailwind, і той аліаси Vite розуміє). Фреймворк Tailwind не компілює — віддає тему плоским активом `client/styles/theme.css`. Inline-SVG іконки задають розмір атрибутами (`width`/`height`), не Tailwind-класами: у shadow DOM вони не мають залежати від того, чи згенеровано `h-4`. У темі є власний шар (`.input`, `.btn`, `.table td`), написаний **поза `@layer`** — він перебиває utility-класи Tailwind незалежно від специфічності. Усе, що має перебити тему, пиши в тому ж файлі нижче за неї, а не класами в розмітці. Зібраний CSS потрапляє у shadow root через спільний `CSSStyleSheet` `tw` (`client/shared/styles.ts`), який заповнює `app/styles/app-styles.ts`; сама бібліотека CSS не імпортує — інакше пакет не публікується.

**Діалог вибору (picker)** — наслідуй `ModelPickerBase` (`client/ui-kit/base/model-picker-base.ts`): підклас задає лише `model` та `columns`. Пошук, вибір, підтвердження/скасування — у базі. Документація — [`docs/ui-picker-form.md`](docs/ui-picker-form.md); skill — [`model-picker-form`](.github/skills/model-picker-form/SKILL.md); еталон — `app/catalog/bank/bankPicker.ts`.

## Друковані форми

Друк — у ядрі (`server/modules/print/`): формат шаблону, план рендеру і PDF-рендерер
на pdf-lib. Клієнт не рендерить нічого — викликає команду, сервер повертає готовий PDF;
прев'ю редактора малює той самий рендерер (`runtime.printPreview`), тому розійтися з
друком не може. У застосунку лишається тільки опис форми в `manifest.json`
(`prints`: файл шаблону + `dataCommand`, і `commands.sql.printData` — саму команду
`printPdf` генератор виводить із непорожнього `prints`) і сам файл шаблону в `prints/`.
Таблиця шаблонів і `print_template_resolve` — у `app/_sqlinit/print_template/`;
редагування шаблонів — звичайна admin-модель `app/admin/print_template/`. Skill —
[`model-print-form`](.github/skills/model-print-form/SKILL.md); деталі —
[`docs/print-subsystem.md`](docs/print-subsystem.md); еталон — `app/document/invoice`.

**Штрих-коди** — блок `barcode` у шаблоні: `code128` (документи), `ean13`
(номенклатура), `qr`. Значення береться як у комірці таблиці — статичне
перекриває прив'язку. Кольору в блока немає навмисно (код мусить бути чорним на
білому), тихі зони входять у сам код, помилкове значення друкується текстом
замість коду. Code 128 і EAN-13 написані в ядрі (`server/modules/print/barcode/`),
QR узятий залежністю `qrcode-generator` — Ріда-Соломона з голови не пишуть.
Символіки перевіряє `deno task test:unit`.

## Звіти

Екран звіту наслідує `ReportBase` (`client/ui-kit/base/report-base.ts`): підклас задає
`reportTitle`, `buildReport()`, `renderFilters()` і `renderBody()` — закріплений тулбар
**Оновити / Друк / Excel**, банер помилок і шапка «назва · організація · період» для
паперу приходять з бази. Кнопки друку й експорту працюють **без опису колонок**: обидві
беруть уже намальовану таблицю.

Друк — браузером (`window.print()`), а не серверним PDF: колонки в звітах з'являються за
наявністю даних (валюта, кількість), тож шаблон розійшовся б з екраном. Правила
`@media print` живуть на трьох рівнях — документ (`client/ui-kit/report/print.ts`),
оболонка (`tab-controller`: розабсолютити панель, сховати меню й вкладки), компонент
(тема: `.no-print` / `.print-only`, компактна таблиця).

Excel — справжній `.xlsx`, зібраний **у браузері** без залежностей
(`client/ui-kit/report/xlsx.ts`: zip методом `store` + мінімальний OOXML). Дані читаються
з DOM таблиці (`table-model.ts`), тому файл повторює екран один-в-один. Звідси контракт
розмітки: числова комірка мусить мати `tabular-nums` (інакше сума приїде текстом), а код
рахунку — навпаки, не мусить; `<th>`, `colspan`/`rowspan` стають шапкою й об'єднаннями
аркуша. Класи `table-tabular`/`cell-text` у звіті не використовуються — це контракт
табличної частини документа, він обнуляє вертикальні відступи рядків.

Деталі — [`docs/report-screen.md`](docs/report-screen.md); skill —
[`model-report-form`](.github/skills/model-report-form/SKILL.md); еталони —
`app/report/turnover_balance` (фільтри, дворівнева шапка) і `app/report/document_movements`
(звіт без власних фільтрів).

## Доступ (користувачі, групи, права)

У ядрі (`server/sql/access/`, пакет `@core/access`): `app.users`, `app.auth_session`,
`app.user_group`, `app.user_group_member`, `app.user_group_permission`. Живе у фреймворку,
бо на `app.users` посилаються `app.document` і `app.attachment`, а без сесій немає авторизації.

Право — трійка **група → модель → дія**. Модель це ім'я з `manifest.json`, тобто те саме, що
приходить у `ModelRuntimeService.execute(model, command, …)`; `model = '*'` означає всі моделі.
Дії: `view` (list/get/lookup), `create`, `edit`, `delete` — для будь-якої моделі; `post` і
`unpost` — додатково для документів.

```sql
app.access_can(user_id, model, action) returns boolean   -- перевірка права
app.access_effective(user_id, payload)                   -- плоский список (model, action)
app.user_list / user_get / user_save / user_delete / user_lookup
app.user_group_list / user_group_get / user_group_save / user_group_delete / user_group_lookup
```

`user_save` пароля не приймає: хеш рахує TS (PBKDF2-SHA256, `password-hash.ts`), новий
користувач створюється з порожнім хешем і увійти не може, доки пароль не встановлять.
Зробити це можна з консолі — `deno task passwd <логін> [пароль]` — або з адмін-екрана
застосунку через `hashPassword()` з `@altera/server`. Перевірка вимагає префікс
`pbkdf2_sha256$`, тому «сирий» рядок у `password_hash` означає, що увійти неможливо
взагалі — саме так виглядає користувач, заведений в обхід цієї схеми. `user_delete` не видаляє користувача, на якого посилаються документи чи
вкладення, — деактивує.

Дві групи «з коробки»: `admin` (усі дії над `*`) і `viewer` (лише `view`).

**Сесія — httpOnly-cookie.** Токен назовні не віддається взагалі: ані в тілі відповіді, ані
в JS. Браузер носить його сам, тому XSS до нього не дістанеться. `Authorization: Bearer`
лишається для скриптів і сторонніх клієнтів — вони беруть токен із `set-cookie`.

Захист від CSRF подвійний: `SameSite=Strict` плюс обов'язковий заголовок `X-Requested-With`
для методів, що змінюють стан. Заголовок перевіряється **лише** коли токен прийшов із cookie:
`Authorization` чужа сторінка підставити не може, бо для цього потрібен preflight, а CORS
сервер не вмикає. Змінні: `AUTH_COOKIE_NAME`, `AUTH_COOKIE_SECURE` (у продуктиві — завжди).

На клієнті всі запити до `/api` йдуть через `apiFetch` (`client/data/api.ts`) — єдине місце,
де ставиться CSRF-заголовок і обробляється 401: одна спроба `refresh`, повтор запиту, і лише
потім вихід у екран входу. Стан сесії й права — `client/auth/session.ts` (`can(model, action)`).

**Екран входу** належить застосунку: `app/login/app-login.ts`, реєструється як `login`
у `registerShell(...)`. `app/main.ts` піднімає оболонку **тільки** після успішної сесії —
`tab-controller` імпортується динамічно, тож неавторизований користувач не тягне граф UI.
Перший запуск — не окрема сторінка, а стан того самого екрана (див. `bootstrap-state`).

**Методи входу.** Вбудований — пароль (`AUTH_PASSWORD_ENABLED=false` вимикає). Зовнішні
провайдери застосунок підкладає сам, поклавши екземпляр у конфіг:

```ts
const env = configFromEnv();
bootstrap({ ...env, auth: { ...env.auth, methods: [new GoogleAuthMethod(...)] }, … })
```

Контракт — об'єднання двох різновидів: `AuthDirectMethod` (обмін на місці, як пароль) і
`AuthRedirectMethod` (похід у браузер: OAuth/OIDC — `authorizeUrl` + `exchange`). Саме
об'єднання, тому `implements AuthMethod` не компілюється — реалізуй конкретний вид.

Redirect-потік веде фреймворк: маршрути `GET /api/auth/authorize/:method` і
`/callback/:method`, разовий `state` у `app.auth_login_state`, зв'язка з користувачем,
cookie. Метод відповідає лише за розмову з провайдером — discovery і JWKS у ядрі немає
навмисно. Вхід пускає **тільки за наявності зв'язки** `app.user_identity (provider,
external_id)`, яку заводить адміністратор на екрані користувача; єдиний виняток —
порожня база, де зовнішній вхід створює першого адміністратора.

Дві речі, що виглядають дивно, поки не знаєш причини: callback віддає HTML-сторінку, а не
302 (cookie `SameSite=Strict` не пережила б редирект із крос-сайтового ланцюжка), і `state`
лежить у БД, а не в пам'яті (`--watch` вбивав би його посеред відлагодження). Перевірити
без живого провайдера можна заглушкою `DEV_AUTH_REDIRECT=1`
(`app/login/dev-redirect-auth.method.ts`). Деталі — [`docs/external-login.md`](docs/external-login.md).
**Інтерфейсної частини у фреймворку немає навмисно** — структури й функції дає ядро, а екрани
керування доступом застосунок робить як і де йому зручно (у цьому застосунку — `app/admin/user`
і `app/admin/user_group`).

**Перевірка права ввімкнена для всіх команд.** `ModelRuntimeService.execute()` вкладає її в той
самий `select`, що викликає команду: `case when app.access_can(...) then <команда>(...) else
app.access_denied(...) end`. Один round-trip, кешу немає, при відмові команда не виконується.
Відмова приходить звичайним конвертом `ok:false` — «немає команди» ж лишається винятком 404/501.

Дія виводиться з імені команди: `list`/`get`/`lookup` → `view`, `delete` → `delete`,
`post`/`unpost` → `post`/`unpost`, `save` → `create` або `edit` залежно від наявності
`payload.item.id`. **Нестандартна команда мусить оголосити своє право** в `manifest.json`:

```json
"commands": {
  "sql": { "current": "menu_current", "copy": "menu_copy" },
  "access": { "current": "authenticated", "copy": "create" }
}
```

`"authenticated"` — «досить бути авторизованим» (для команд «про себе», як `menu/current`).
Неоголошена команда не виконується взагалі: 501 із підказкою, що додати в манифест. Це
свідомо fail-closed — забуте оголошення видно на першому виклику, мовчазний дозвіл не видно
ніколи. `dev-bypass` окремої гілки не має: він відключає автентифікацію, а не авторизацію,
тож `DEV_AUTH_USER_ID` має вказувати на реального користувача в потрібній групі.

Деталі, вибір дії та відлагодження — [`docs/access-control.md`](docs/access-control.md);
skill для агента — [`model-command-access`](.github/skills/model-command-access/SKILL.md).

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

## Винесення фреймворку в пакети

`server/` і `client/` рухаються до того, щоб бути окремими пакетами, на яких
новий застосунок піднімається scaffold-ом. План, зроблені кроки, відкриті борги
(перевірка прав у рантаймі, redirect-потік для зовнішніх провайдерів, дрейф схеми
меню/інтерфейсів) і вже прийняті рішення —
[`docs/framework-extraction-plan.md`](docs/framework-extraction-plan.md).

## TypeBox-схема

> Деталі та шаблон — у skill [`typebox-model-schema`](.github/skills/typebox-model-schema/SKILL.md).

`app/<family>/<model>/<model>.schema.ts` — єдине джерело типів для frontend і backend:
- `BankItemSchema` — поля форми + id (`Type.Union([Type.String(), Type.Null()])` для нового запису)
- `BankRowSchema` — колонки списку
- `BankLookupRowSchema` — рядки picker (`id` + `name`)
- `BankListPayloadSchema`, `BankGetPayloadSchema`, `BankSavePayloadSchema` тощо

Primary key: `bigint` у БД, `string` у TypeScript/JSON (щоб уникнути втрати точності).  
Анотації `x-form`, `x-list`, `x-lookup` керують відображенням у UI.

## Додати нову модель (чек-лист)

> **Перед створенням моделі застосуй skill [`model-feature-architecture`](.github/skills/model-feature-architecture/SKILL.md)** — він описує структуру feature-папки, manifest-маршрути та контракт SQL-функцій. Цей skill, своєю чергою, посилається на [`typebox-model-schema`](.github/skills/typebox-model-schema/SKILL.md) для визначення `<model>.schema.ts`.

1. Створити `app/<family>/<model>/manifest.json`
2. Створити `<model>.schema.ts` з TypeBox-схемами
3. Створити UI-компоненти: `<Model>List.ts` (skill [`model-list-form`](.github/skills/model-list-form/SKILL.md) — наслідувати `ModelListBase`, не писати тулбар/таблицю/пагінацію вручну), `<Model>Edit.ts`, `<Model>Picker.ts`
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

Збирач бере файли в такому порядку: `_generated/<model>.crud.gen.sql` → `<model>.custom.sql`,
а `<model>.sql` — **лише якщо генерації немає**. Тобто модель із рукописним CRUD просто не
має генерованого файлу. Щоб це було оголошено, а не випадково, у `manifest.json` пишеться:

```json
"sql": { "generate": false }
```

Без цього пропуск тримався б на тому, що ім'я файлу схеми не збіглося з очікуваним
(`userGroup.schema.ts` замість `user_group.schema.ts`) — генератор про таке тепер попереджає
окремим рядком `⚠`, бо модель при цьому виглядає охопленою, хоча не генерується. Моделі з
`type`, відмінним від `catalog`/`document` (звіт, admin), пропускаються за типом — їм
оголошення не потрібне.

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
позначене як `production`/`prod`/`staging` або `DB_HOST` не локальний — БД береться з `.env`,
і промах у ньому не має коштувати чужих даних. Обхід не передбачено свідомо.

Нову пробу додавай кроком у `scripts/smoke_test.ts`; запис у БД — тільки свій рядок і тільки
з прибиранням у `finally`.

### DENO_EMIT_CACHE_MODE=disable у задачах

Три задачі, що піднімають граф Danet (`dev:server`, `smoke`, `api`), запускаються з
`DENO_EMIT_CACHE_MODE=disable`. Причина не в продуктивності: Windows Defender хибно
позначає кеш транспіляції як `Trojan:Script/ObfusScript.A!ml`. Спрацьовує ML-евристика на
формі файлу — 68% його обсягу це base64 інлайн-sourcemap, і за силуетом це збігається з
упакованим скриптом. Код при цьому звичайнісінький (`@danet/core/src/events/events.ts`,
`EventEmitter` над `EventTarget`), і побайтово той самий, що був до оновлення — змінився
лише номер версії у шляху, а з ним і хеш імені файлу в кеші.

Без кеша файл на диск не лягає — нічого сканувати, і антивірус лишається на повну силу
(на відміну від виключення теки). Ціна заміряна: різниці у швидкості немає. `deno check`
і `deno lint` цей файл не створюють — вони не виконують код.

Коли Defender оновить визначення, префікс можна буде прибрати.

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
DB_HOST=localhost           # ці ж значення йдуть у docker compose
DB_PORT=5432
DB_NAME=altera
DB_USERNAME=altera
DB_PASSWORD=altera_secret
PORT=3000                   # читає app/server.ts, не configFromEnv
JWT_SECRET=change-me-in-production
AUTH_SESSION_TTL_HOURS=720
BOOTSTRAP_LOGIN=            # логін+пароль разом → створюється адміністратор на старті
BOOTSTRAP_PASSWORD=
DEV_AUTH_BYPASS=0           # у продуктивному оточенні валить старт сервера
DEV_AUTH_USER_ID=
VITE_DEV_URL=http://localhost:5173   # непорожній → сервер віддає в'ю через Vite
OPENAI_API_KEY=             # LLM-агент; без ключа агент просто не працює
OPENAI_MODEL=gpt-4o-mini
OPENAI_ROUTER_MODEL=gpt-4o-mini
```

Решта змінних має дефолти й у `.env` не потрібна — повний список у розділі «Конфігурація
сервера» вище, єдине джерело істини — `server/config/config-from-env.ts`.
