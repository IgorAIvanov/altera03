# Altera — бухгалтерська система для України

Deno monorepo. Три workspace-пакети: `app/` (фронтенд-модулі та SQL-джерела), `client/` (ui-kit, runtime), `server/` (Danet/Deno backend). База даних — PostgreSQL. Фронтенд — Lit Web Components + Vite + Tailwind CSS v4 + daisyUI v5.

## Команди

```bash
deno task dev          # запустити frontend + backend одночасно
deno task dev:server   # тільки backend (--watch)
deno task dev:front    # тільки Vite dev server
deno task sql:registry # згенерувати app/_generated/* (model-registry, agent-routes, view-manifest) з manifest.json
deno task check:deps   # перевірити напрямок залежностей (client/server не залежать від app)
deno task smoke        # димові проби HTTP-межі (застосунок у процесі, без порту)
deno task api          # дьоргнути команду моделі з консолі: api <model> <command> [json]
deno task sql:assemble # зібрати SQL-пакет з db/ файлів моделей
deno task sql:publish  # опублікувати SQL у PostgreSQL
deno task startdb      # docker compose up -d (PostgreSQL)
deno task stopdb       # docker compose down
```

## Структура репозиторію

```
app/                        # фронтенд-модулі та SQL-джерела (Deno workspace)
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
  _locales/                 # локалізація: en.json, uk.json ...
  _sqlpackage/              # зібрані SQL-файли (генеруються, не редагувати)
  _generated/               # авто-генерація (deno task sql:registry): model-registry, agent-routes, view-manifest
  server.ts                 # composition root бекенду: реєструє дані з _generated → bootstrap (Danet)
  shared/schema.ts          # спільні TypeBox-типи: OptionRow, PagePayload, SortDir
  sql.json                  # список моделей для sql:assemble

client/                     # ui-kit та клієнтський runtime (Deno workspace)
  ui-kit/components/        # web components: ui-picker, ...
  bus/bus.ts                # event bus: bus.request("data.load", { model, command, payload })

server/                     # Danet backend-БІБЛІОТЕКА (Deno workspace), не залежить від app
  main.ts                         # public API бібліотеки: bootstrap + register* (барель)
  modules/model-runtime/
    model-runtime.controller.ts   # REST: POST /api/model/:model/:command
    model-runtime.service.ts      # викликає PostgreSQL-функцію або TS-handler
    model-registry.ts             # холдер реєстру; наповнюється registerModelRegistry() з app/_generated
  modules/agent/
    agent.service.ts              # прямий диспетчер команд (без LLM)
    agent-llm.service.ts          # LLM-агент (OpenAI Responses API)
    agent-routes.ts               # холдер маршрутів агента; registerAgentRoutes()
  modules/model-view/
    model-view.registry.ts        # холдер view-маніфесту; registerViewManifest() (без ФС-скану)
  modules/auth/                   # JWT-авторизація
  database/
    publish-app-sql.ts            # публікація SQL у БД
```

> **Напрямок залежностей:** `app → client/server`, ніколи навпаки. Бекенд-runtime отримує
> дані про моделі/маршрути/в'ю ззовні (composition root `app/server.ts` реєструє їх із
> `app/_generated`). Перевірка — `deno task check:deps`.

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

**Форма списку** — наслідуй `ModelListBase` (`client/ui-kit/base/model-list-base.ts`): підклас задає лише `model`, `editRoute` та `columns`. Тулбар, серверне сортування, пагінація, пошук, вибір рядка — у базі. Документація для розробника — [`docs/ui-list-form.md`](docs/ui-list-form.md); skill для агента — [`model-list-form`](.github/skills/model-list-form/SKILL.md); еталон — `app/catalog/bank/bankList.ts`.

**Таблична частина документа** — контракт `.table-tabular` / `.cell-text` / `.cell-control` у `client/styles/tailwind.css`; контроли підключаються атрибутом `cell` (`<ui-decimal cell>`, `<ui-picker cell>`). Skill — [`document-tabular-section`](.github/skills/document-tabular-section/SKILL.md); еталон — `app/document/invoice/invoiceEdit.ts`.

**Розкладка форми редагування** — підпис поля тільки через `BaseUI.renderField(label, control, { field })`,
підвал тільки через `renderFormActions()` (Зберегти й закрити / Зберегти / Закрити). `field` вмикає
зірочку обов'язковості зі схеми, тому вона не розходиться з перевіркою в БД. Класів `form-control` і
`label-text` не існує в daisyUI 5 — це розмітка четвертої версії, і саме вона ламає вирівнювання підписів.

> **Стилі:** у `client/styles/tailwind.css` є власний шар теми (`.input`, `.btn`, `.table td`), написаний **поза `@layer`** — він перебиває utility-класи Tailwind незалежно від специфічності. Усе, що має перебити тему, пиши в тому ж файлі нижче за неї, а не класами в розмітці.

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
4. Створити `db/struc.sql`, `db/<model>.sql` (функції list/get/save/delete/lookup)
5. Додати модель у `app/sql.json`
6. Запустити `deno task sql:registry` → оновить generated-файли
7. Запустити `deno task sql:assemble && deno task sql:publish` → опублікувати SQL у БД

Окремий backend-модуль/контролер потрібен лише для нестандартної логіки.

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

Обидва спираються на `scripts/dev-guard.ts` і відмовляються стартувати, якщо оточення
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

## Змінні середовища (server/.env)

```
DATABASE_URL=postgres://...
JWT_SECRET=...
OPENAI_API_KEY=...          # для LLM-агента
OPENAI_MODEL=gpt-4o-mini    # модель-виконавець
OPENAI_ROUTER_MODEL=gpt-4o-mini  # модель-роутер
```
