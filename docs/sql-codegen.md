# Генерація стандартних SQL-функцій моделі (`sql:gen`)

Дизайн-документ. Описує детермінований генератор CRUD-SQL зі схеми моделі, щоб
агент/розробник не писав руками стандартні `list/get/save/delete/lookup`, а
отримував їх із декларацій (`<model>.schema.ts` + `manifest.json`).

> **Статус:** реалізовано й перевірено на живому PG 17.
> Генератор `scripts/generate-model-sql.ts` покриває плоский catalog, `x-ref`,
> `x-table`. Інтегровано в `sql:assemble` (порядок generated → custom override →
> legacy), додано мета-таск `model:build`. `bank` повністю переведено на
> генерацію (рукописний `bank.sql` видалено). Тестові моделі: `counterparty`
> (ref-ціль), `invoice` (document зі ссылкою + табличною частиною).
> Не зроблено: винесення валідації у TS/TypeBox+i18n; UI-компоненти для
> `invoice`/`counterparty`.
> Параллельний інструктаж для AI-агента з'явиться у skill `db-function-contract`
> (розділ «Generated CRUD»). Тримати обидва в синхроні.

---

## Навіщо

Стандартна SQL-функція моделі (`{schema}.{model}_{command}`) на 90–95% механічно
виводиться з метаданих, які вже задекларовані у схемі:

| Що в SQL | Звідки виводиться |
|---|---|
| `{schema}.{model}` (таблиця) | `manifest.schema` + `model` |
| колонки + касти (`id::text`) | поля схеми + `x-db-type` |
| `camelCase ↔ snake_case` | ключ поля (snake_case від ключа), override `x-db-col` |
| `where … ilike` (пошук) | поля з `x-search` |
| білий список `sortBy` | поля з `x-list.sortable` |
| колонки lookup / пікера | поля з `x-lookup` |
| join + sort/search по найменуванню | поля з `x-ref` |
| табличні частини (`save`) | поля з `x-table` |
| конверт `{ok,data,messages,meta}` | константа |

Раніше це писав агент: повільно і коштує токени. Тепер це штампує
детермінований скрипт без агента — а **унікальна логіка лишається можливою**
через granular-override (див. §«Override»).

---

## Принципи

1. **Джерело правди — схема.** Метадані лишаються розкиданими по моделях
   (та сама локальність, що у feature-папці). Жодного центрального реєстру-джерела.
2. **БД лишається контрактом.** Генеруються конкретні PL/pgSQL-функції в БД,
   а не runtime-движок. Конверт будується в SQL, `user_id` протягнутий у кожну
   функцію (RLS/аудит) — як зараз.
3. **Override за наявністю файлу.** Стандартна модель не везе жодного рукописного
   SQL. Відхилення — окремий файл `db/<model>.custom.sql`, гранулярність до однієї
   функції.
4. **Fail-fast на генерації.** Межмодельні `x-ref` валідуються на етапі `sql:gen`
   (а не в проді).

---

## Анотації схеми, які читає генератор

Усе — у `app/<family>/<model>/<model>.schema.ts`. Чотири осі анотацій:

```ts
export const InvoiceItemSchema = Type.Object({
  id: Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint" }),

  number: Type.String({
    title: "Номер", maxLength: 20,
    "x-list":   { sortable: true },
    "x-search": true,                 // ← бере участь у ilike-пошуку
  }),

  // Ссылочне поле: у таблиці лежить counterparty_id (bigint),
  // у відповіді — вкладений об'єкт, сортування/пошук по найменуванню.
  counterpartyId: Type.String({
    "x-db-type": "bigint",
    "x-ref": {
      model:      "counterparty",     // цільова модель
      fk:         "counterparty_id",  // колонка-FK (default: snake_case ключа)
      display:    "name",             // що показувати / по чому сортувати
      as:         "counterparty",     // ім'я вкладеного об'єкта
      sortable:   true,
      searchable: true,
    },
  }),

  // Таблична частина (master-detail).
  lines: Type.Array(InvoiceLineSchema, {
    "x-table": {
      table:    "invoice_line",
      parentFk: "invoice_id",
      orderBy:  "line_no",
    },
  }),
});
```

Осі:

- **`x-search: true`** — поле входить у `where … ilike`. Якщо жодного не позначено —
  фоллбек «усі строкові поля» (щоб пошук не зник через забудькуватість).
- **`x-list.sortable: true`** — поле потрапляє в білий список `sortBy`.
- **`x-lookup: true`** — поле показується в пікері (`lookup`).
- **`x-ref: {…}`** — ссылка на іншу модель (див. §«Ссылочні поля»).
- **`x-table: {…}`** — таблична частина (див. §«Табличні частини»).
- **`x-db-type`** — тип у БД (для кастів, напр. `id::text`).
- **`x-db-col`** — override імені колонки, якщо порушено конвенцію snake_case.

---

## Ссылочні поля (`x-ref`)

Одна анотація закриває три вимоги: id зберігається, сортування по найменуванню,
на load приходить об'єктом.

- **`get`** — повертає і id, і об'єкт (щоб пікер у формі одразу показав значення):
  ```sql
  'counterpartyId', d.counterparty_id::text,
  'counterparty',  (select jsonb_build_object('id', c.id::text, 'name', c.name)
                    from app.counterparty c where c.id = d.counterparty_id),
  ```
- **`list`** — `left join` + гілка сортування; у Row — **вкладений об'єкт**:
  ```sql
  from app.invoice d
  left join app.counterparty c on c.id = d.counterparty_id
  ...
  'counterparty', jsonb_build_object('id', c.id::text, 'name', c.name)
  ...
  order by case when v_sort_by='counterparty' and v_sort_dir='asc' then c.name end asc, ...
  ```
- **`save`** — пише лише `counterparty_id`, join не потрібен.
- **`search`** — якщо `searchable:true`, у `ilike` додається `c.name`.

Ціна: кожна ссылка в Row = ще один `left join` у list-запиті. Для документів з
3–5 ссылками — нормально.

---

## `save` — єдиний паттерн MERGE

Усі upsert'и — і шапка, і табличні частини — пишуться через **`MERGE`** (один
паттерн на все, щоб простіше навчати розробників). Шапка — це upsert **однієї**
строки по `id`:

```sql
merge into app.bank t
using (
  select
    nullif(v_item->>'id', '')::bigint               as id,
    nullif(trim(coalesce(v_item->>'code', '')), '') as code,
    nullif(trim(coalesce(v_item->>'name', '')), '') as name,
    nullif(trim(coalesce(v_item->>'mfo', '')), '')  as mfo,
    (v_item->>'isActive')::boolean                  as is_active  -- raw, nullable
) s
  on t.id = s.id
when matched then update set
  code = s.code, name = s.name, mfo = s.mfo,
  is_active = coalesce(s.is_active, t.is_active),   -- keep-existing, якщо не передано
  updated_at = now()
when not matched then insert (code, name, mfo, is_active)
  values (s.code, s.name, s.mfo, coalesce(s.is_active, true))  -- default на insert
returning jsonb_build_object('id', t.id::text, …) into v_result;
```

Ключові моменти (перевірено на живому PG 17):

- **`MERGE … RETURNING … INTO` працює в plpgsql** — на insert повертає
  згенерований `id`.
- **Нова строка** приходить з `id = null` → `on t.id = s.id` не матчиться → insert.
- **`boolean`** в `using` тримаємо «сирим» (nullable): на update —
  `coalesce(s.x, t.x)` (зберегти попереднє), на insert — `coalesce(s.x, <default>)`.
- **Валідація** required-полів поки в SQL (`raise exception`); план — винести у
  `ModelRuntimeService` через TypeBox + i18n, тоді `save` буде без `raise`.

Той самий `MERGE` далі застосовується до кожної табличної частини (нижче) — звідси
єдиний паттерн.

## Табличні частини (`x-table`)

Master-detail. `InvoiceLineSchema` — звичайна TypeBox-об'єктна схема рядків
(зі своїми `x-ref`, якщо в рядку є, напр., номенклатура).

- **`get`** — `item.lines` збирається окремим `jsonb_agg(... order by line_no)`.
- **`save`** — синхронізація рядків нативним **`MERGE`** (PostgreSQL 17):

  ```sql
  merge into app.invoice_line t
  using (
    select * from jsonb_to_recordset(v_item->'lines')
      as x(id bigint, line_no int, product_id bigint, qty numeric, price numeric)
  ) s
    on  t.id = s.id and t.invoice_id = v_id
  when matched then update
    set line_no = s.line_no, product_id = s.product_id, qty = s.qty, price = s.price
  when not matched then insert (invoice_id, line_no, product_id, qty, price)
    values (v_id, s.line_no, s.product_id, s.qty, s.price)
  when not matched by source and t.invoice_id = v_id then delete;
  ```

  > **Критично.** `when not matched by source` оцінює **всі** рядки
  > `invoice_line`, не лише поточного документа. Гілка **зобов'язана** містити
  > `and t.invoice_id = v_id`, інакше видаляться рядки всіх інших накладних.
  > Саме такі «приколи» і є причиною не писати це руками — генератор зашиває
  > guard раз і назавжди.

  Колонки в `as x(...)`, insert/update set — виводяться зі схеми рядка +
  `x-db-type`. Нові рядки приходять з `id = null` → не матчаться → insert.

- **`delete`** — покладається на `on delete cascade` у DDL (або генерує явне
  видалення рядків перед видаленням шапки).

---

## Override: стандартна vs нестандартна

Визначається **наявністю файлу** `db/<model>.custom.sql`, з гранулярністю до
однієї функції. Жодних прапорців у manifest, жодних змін у рантаймі.

Механізм — порядок збирання + `drop function … → create`:

```
порядок assemble для моделі:
  1) db/struc.sql                       ← DDL (поки руками)
  2) db/_generated/<model>.crud.gen.sql ← завжди (стандартна п'ятірка)
  3) db/<model>.custom.sql              ← ОПЦІОНАЛЬНО, перекриває окремі функції
  4) db/migration.sql
  5) db/data.sql
```

`db/<model>.custom.sql` йде **після** генерованого і теж робить
`drop function … → create` — тож перекриває лише ті функції, що в ньому є.
Приклад: для `invoice` унікальний лише `save` → у custom-файлі лежить **тільки**
`invoice_save`, решта чотири беруться з генерованих.

> **PostgreSQL gotcha.** `create or replace function` **не вміє** міняти тип
> повернення та **імена вхідних параметрів** (`cannot change name of input
> parameter` / `cannot change return type`). Тому стандарт — **`drop function if
> exists <name>(<типи аргументів>); create function …`** (не `create or
> replace`). DROP **з типами аргументів** — інакше за перевантажень помилка
> неоднозначності. Саме `drop+create` робить override безпечним за будь-яких
> відмінностей сигнатури.

**Рантайм не змінюється.** `ModelRuntimeService` як і раніше кличе
`app.{model}_{command}` — функція з цим іменем завжди існує, а чиє тіло всередині
(генероване чи override) йому байдуже.

---

## `post` / `unpost`

Для `type:"document"` генеруються **заглушки** — валідний конверт
`{ok:true, messages:[…]}` без логіки (поки немає регістрів обліку). З'явиться
проведення — заміниш на `invoice_post` у `db/invoice.custom.sql`. Для
`catalog`/`register` не генеруються.

---

## Розкидані метадані + межмодельні ссылки

Авторські метадані лишаються в моделях — це добре (локальність). Єдине місце, де
одній моделі треба знати про іншу, — `x-ref`. Щоб не угадувати конвенцією
(опечатка в `x-ref.model`, ціль в іншій схемі, нестандартний display):

`sql:gen` **першим проходом** будує транзиентну in-memory карту
`{ model → {schema, table, pk, displayCol} }` по всіх моделях зі `sql.json`
(можна перевикористати `app/_generated/model-registry.generated.ts`), **другим
проходом** генерує SQL, резолвлячи кожен `x-ref` по цій карті. Карта ефемерна —
у репозиторій не комітиться, перебудовується щоразу.

Це дає **fail-fast**: `invoice.counterpartyId → model 'counterprty' не знайдена`
падає в `sql:gen`, а не в проді. Перевірка ссылкової цілісності метаданих — і є
головна додаткова цінність генератора проти «агент пише SQL руками».

---

## Повний флоу та таски

```bash
# по черзі (відлагодження / CI):
deno task sql:registry    # TS-реєстри: model-registry / agent-routes / view-manifest
deno task sql:gen         # ← НОВИЙ: CRUD-SQL зі схем → db/_generated/<model>.crud.gen.sql
deno task sql:assemble    # пакет: struc → _generated CRUD → *.custom.sql → migration → data
deno task sql:publish     # у PostgreSQL

# однією командою (повсякденна розробка):
deno task model:build     # = registry → gen → assemble → publish
```

`sql:gen` для кожної моделі зі `sql.json`:

1. `import`-ить `<model>.schema.ts` (TypeBox у рантаймі = JSON-Schema об'єкт,
   читаємо `.properties` напряму — без парсингу AST);
2. виводить таблицю/колонки/касти/search/sort/lookup/ref/table/required;
3. емітить `db/_generated/<model>.crud.gen.sql` зі стандартною п'ятіркою.

Згенерований файл **комітиться** (read-only) — щоб був видний у diff,
`EXPLAIN`-абельний і відтворюваний. Редагувати руками не можна — перезатреться.

---

## Що комітиться

| Файл | Хто пише | У git |
|---|---|---|
| `manifest.json`, `*.schema.ts`, `*List/Edit/Picker.ts` | агент | так |
| `db/struc.sql` (DDL) | агент (поки) | так |
| `db/_generated/<model>.crud.gen.sql` | `sql:gen` | так, read-only |
| `db/<model>.custom.sql` | агент/людина, лише за відхилення | так |

---

## Відкриті питання (на майбутнє)

1. **Авто-DDL зі схеми** (`struc.sql`). Колонки/типи виводяться з `x-db-type`, але
   `created_at/updated_at`/індекси в Item-схемі не описані — потрібна доп.
   конвенція. Поки лишаємо `struc.sql` руками.
2. **`sql:gen` окремим таском чи фазою в `sql:assemble`.** Зараз — окремим
   (наочніше у відлагодженні).
3. **Фоллбек `delete+on conflict`** замість MERGE — лишаємо як опцію в
   `*.custom.sql`, якщо десь знадобиться тонша покрокова логіка.
