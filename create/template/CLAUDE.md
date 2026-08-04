# {{name}} — застосунок на фреймворку Altera

> Цей файл твій. Scaffold поклав його один раз і більше не чіпає — дописуй сюди правила
> свого проєкту (доменні домовленості, схему рахунків, порядок проведення документів).
> Знання про сам фреймворк живе не тут, а в `.claude/skills/` — воно оновлюється разом
> з пакетами (`deno task skills:sync`).

Deno + Lit Web Components + Vite + Tailwind CSS v4 + daisyUI v5 на фронтенді, Danet на
бекенді, PostgreSQL як база. Фреймворк приходить пакетами `@altera/client`,
`@altera/server`, `@altera/tools` — його вихідники лежать у `vendor/` і **не редагуються**.
Тут живе тільки застосунок: моделі, їх SQL і оболонка.

## Команди

```bash
deno task dev              # frontend + backend разом
deno task dev:server       # тільки backend (--watch)
deno task dev:front        # тільки Vite
deno task sql:gen <family>/<model>   # згенерувати CRUD-SQL ОДНІЄЇ моделі зі схеми
deno task sql:registry     # перегенерувати app/_generated/** з manifest.json
deno task sql:assemble     # зібрати SQL-пакет з db/ файлів моделей
deno task sql:publish      # опублікувати SQL у PostgreSQL
deno task skills:sync      # оновити .claude/skills з @altera/skills
deno task startdb          # docker compose up -d (PostgreSQL)
deno task build:front      # продуктивна збірка
```

Після зміни моделі майже завжди потрібне одне й те саме:

```bash
deno task sql:registry && deno task sql:assemble && deno task sql:publish
```

## Структура

```
app/
  <family>/<model>/         # одна модель — один каталог
    manifest.json           # декларація: model, type, schema, views, commands, agent
    <model>.schema.ts       # TypeBox-схема — ЄДИНЕ джерело типів для форм і SQL
    <Model>List.ts          # список        (наслідує ModelListBase)
    <Model>Edit.ts          # форма         (наслідує BaseUI)
    <Model>Picker.ts        # діалог вибору (наслідує ModelPickerBase)
    db/
      struc.sql             # DDL таблиць
      _generated/*.crud.gen.sql   # згенерований CRUD — правити не тут
      <model>.custom.sql    # доробки поверх генерації: проведення, нестандартні команди
      migration.sql         # міграції
      data.sql              # seed-дані
    prints/                 # шаблони друкованих форм
  _generated/               # реєстр моделей, маршрути агента, маніфест в'ю
  _locales/                 # локалізація застосунку: en.json, uk.json
  styles/tailwind.css       # ЄДИНИЙ вхід збірки Tailwind
  main.ts                   # composition root клієнта
  server.ts                 # composition root бекенду
  sql.json                  # порядок збірки SQL-пакета (важливий: за FK)
```

## Чого не чіпати

| Шлях | Чому | Як оновити |
|------|------|------------|
| `vendor/` | вихідники фреймворку з JSR | `deno install` |
| `app/_generated/**` | реєстр з манифестів | `deno task sql:registry` |
| `app/_sqlpackage/**` | зібраний SQL | `deno task sql:assemble` |
| `db/_generated/*.crud.gen.sql` | CRUD зі схеми | `deno task sql:gen <family>/<model>` |
| `.claude/skills/**` | скіли з пакета | `deno task skills:sync` |

Згенерований CRUD **комітиться** — це вихідник, а не продукт збірки: він має потрапляти
в дифф рев'ю разом зі схемою, з якої зроблений. Правки поверх нього пишуться в
`db/<model>.custom.sql`, ніколи не в сам `.gen.sql`.

## Додати модель

Спершу застосуй skill `model-feature-architecture` — він описує структуру каталогу
й контракт SQL-функцій. Далі за кроками:

1. `manifest.json` — модель, тип (`catalog` / `document` / `register`), в'ю, команди.
2. `<model>.schema.ts` — TypeBox (skill `typebox-model-schema`).
3. UI: `<Model>List.ts` (skill `model-list-form`), `<Model>Edit.ts` (skill `model-form-root`),
   `<Model>Picker.ts` (skill `model-picker-form`).
4. `db/struc.sql`, потім `deno task sql:gen <family>/<model>`.
5. Додати модель у `app/sql.json` — **порядок за зовнішніми ключами**.
6. `deno task sql:registry && deno task sql:assemble && deno task sql:publish`.

Тулбар, таблицю, пагінацію, сортування, пошук руками не писати — усе це в базових класах.
Форму, що не наслідує базовий клас, доводиться потім переписувати цілком.

## Якщо фреймворку бракує функціональності

Буває, що потрібного немає: компонента, гака в базовому класі, команди ядра. Тоді —
записати прогалину у [`FRAMEWORK-GAPS.md`](FRAMEWORK-GAPS.md) у корені (формат у самому
файлі: де вилізло, чого бракує, чим обійшлися), **зробити обхід у застосунку і йти далі**.
Запис не привід спинятися.

Чого не робити натомість:

- **не правити `vendor/`** — наступний `deno install` затре зміну, і зникне вона мовчки;
- **не копіювати базовий клас фреймворку в `app/`**, щоб дописати один метод: копія
  перестане отримувати виправлення, а розійдеться з оригіналом на першому ж оновленні.
  Якщо гака справді немає — обхід у підкласі, а запис у `FRAMEWORK-GAPS.md`;
- **не залишати прогалину лише в голові чи в коментарі `// TODO`** — з коментаря вона не
  дійде до того, хто розвиває фреймворк.

Записувати варто саме випадок, а не побажання: що будували, що не вийшло, скільки коду
коштував обхід. Побажання без випадку неможливо ані оцінити, ані перевірити, коли його
закриють.

## Контракти, про які легко забути

- **Відповідь завжди конверт**: `{ ok, data: { item, rows, options, totals }, messages }`.
  Одиночний запис — в `item`, список — у `rows`, відмова — `ok: false` + `messages`.
- **Ім'я SQL-функції** виводиться з моделі: `{schema}.{model}_{command}(user_id bigint, payload jsonb)`.
- **Нестандартна команда мусить оголосити своє право** в `manifest.json` (`commands.access`),
  інакше рантайм її не виконає — 501, fail-closed (skill `model-command-access`).
- **Primary key** — `bigint` у базі, `string` у TypeScript і JSON (щоб не втратити точність).
- **Дати** — тільки через `<ui-date>`; у моделі значення завжди ISO.

## Оточення

`.env` у корені (шаблон — `.env.example`, він же годує docker-compose). Логін і пароль у
`BOOTSTRAP_LOGIN`/`BOOTSTRAP_PASSWORD` створюють адміністратора на старті; цей пароль
тимчасовий — до його зміни жодна команда моделі не виконується.
