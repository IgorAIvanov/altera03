# Altera — бухгалтерська система для України

Deno monorepo. Три workspace-пакети: `app/` (фронтенд-модулі та SQL-джерела), `client/` (ui-kit, runtime), `server/` (Danet/Deno backend). База даних — PostgreSQL. Фронтенд — Lit Web Components + Vite + Tailwind CSS v4 + daisyUI v5.

## Команди

```bash
deno task dev          # запустити frontend + backend одночасно
deno task dev:server   # тільки backend (--watch)
deno task dev:front    # тільки Vite dev server
deno task sql:registry # згенерувати model-registry.generated.ts та agent-routes.generated.ts з manifest.json
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
  shared/schema.ts          # спільні TypeBox-типи: OptionRow, PagePayload, SortDir
  sql.json                  # список моделей для sql:assemble

client/                     # ui-kit та клієнтський runtime (Deno workspace)
  ui-kit/components/        # web components: ui-picker, ...
  bus/bus.ts                # event bus: bus.request("data.load", { model, command, payload })

server/                     # Danet backend (Deno workspace)
  modules/model-runtime/
    model-runtime.controller.ts   # REST: POST /api/model/:model/:command
    model-runtime.service.ts      # викликає PostgreSQL-функцію або TS-handler
    model-registry.ts             # збирає реєстр з generated + TS-handlers
    model-registry.generated.ts   # авто-генерація (deno task sql:registry)
  modules/agent/
    agent.service.ts              # прямий диспетчер команд (без LLM)
    agent-llm.service.ts          # LLM-агент (OpenAI Responses API)
    agent-routes.generated.ts     # авто-генерація (deno task sql:registry)
  modules/auth/                   # JWT-авторизація
  database/
    publish-app-sql.ts            # публікація SQL у БД
```

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
Picker-поля використовують компонент `<ui-picker url="/api/model/bank/lookup">`.  
Локалізація: `t("bank.titleOne")` через сигнальний store + JSON-файли у `app/_locales/`.

**Форма списку** — наслідуй `ModelListBase` (`client/ui-kit/base/model-list-base.ts`): підклас задає лише `model`, `editRoute` та `columns`. Тулбар, серверне сортування, пагінація, пошук, вибір рядка — у базі. Документація для розробника — [`docs/ui-list-form.md`](docs/ui-list-form.md); skill для агента — [`model-list-form`](.github/skills/model-list-form/SKILL.md); еталон — `app/catalog/bank/bankList.ts`.

**Діалог вибору (picker)** — наслідуй `ModelPickerBase` (`client/ui-kit/base/model-picker-base.ts`): підклас задає лише `model` та `columns`. Пошук, вибір, підтвердження/скасування — у базі. Документація — [`docs/ui-picker-form.md`](docs/ui-picker-form.md); skill — [`model-picker-form`](.github/skills/model-picker-form/SKILL.md); еталон — `app/catalog/bank/bankPicker.ts`.

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

## Змінні середовища (server/.env)

```
DATABASE_URL=postgres://...
JWT_SECRET=...
OPENAI_API_KEY=...          # для LLM-агента
OPENAI_MODEL=gpt-4o-mini    # модель-виконавець
OPENAI_ROUTER_MODEL=gpt-4o-mini  # модель-роутер
```
