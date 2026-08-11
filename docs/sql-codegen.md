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
- **`x-blob: true`** — поле-вкладення: у колонці лежить id з `app.attachment`.
  Генератор віддає поруч ключ доступу під ім'ям `<field>Token` (`logoId` →
  `logoToken`); підписаний токен підставляє рантайм. Див.
  [`docs/blob-subsystem.md`](blob-subsystem.md).
- **`x-transient: true`** — поле є в типі форми, але не в таблиці (напр. сам
  токен вкладення). Генератор його повністю ігнорує.
- **`x-db-type`** — тип у БД (для кастів, напр. `id::text`). Значення — **голе ім'я
  зі списку**: `bigint`, `int`, `integer`, `numeric`, `json`, `jsonb`, `date`,
  `timestamp`, `timestamptz`, `text`, `varchar`. Точність і довжина належать DDL:
  природне `numeric(10,2)` тут — помилка генерації, і саме голосна. Доти розбір
  звіряв рядки на рівність, тож незнайоме значення мовчки провалювалося в
  текстовий fallback, і поле ламалося аж на першому `save`:
  `column "markup" is of type numeric but expression is of type text`.
- **`x-db-col`** — override імені колонки, якщо порушено конвенцію snake_case.

> **Таблиця генерованої моделі мусить мати `created_at` і `updated_at`.** `save`
> пише `updated_at = now()` беззастережно — це не виводиться зі схеми й не
> вимикається. Без цих колонок генерація зелена, публікація зелена, а падає
> перший же запис.

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
  1) db/struc.sql                        ← DDL (поки руками)
  2) db/_generated/<model>.crud.gen.sql  ← стандартна п'ятірка (catalog/document/register)
  3) db/_generated/<model>.index.gen.sql ← обгортка звіту (type: report)
  4) db/<model>.custom.sql               ← ОПЦІОНАЛЬНО, перекриває окремі функції
  5) db/migration.sql
  6) db/data.sql
```

Рукописний `db/<model>.sql` береться **лише коли немає генерованого CRUD** — тобто
модель із написаним руками CRUD просто не має файлу `.crud.gen.sql`. Обгортка звіту
цього правила не вмикає: вона нічого рукописного не заміняє, і `db/<model>.sql` зі
самим запитом лишається на місці.

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

## `type: "document"` — дві таблиці, один ідентифікатор

Документ живе у двох таблицях: спільна шапка `app.document` (аліас `h`, вона ж
володіє `id`) і таблиця реквізитів `app.<model>` (аліас `t`) з первинним ключем
`document_id`. Тому:

- **`<Model>ItemSchema` описує лише власні реквізити документа.** Спільні поля
  (`organizationId`, `number`, `docDate`, `total`, `presentation`, `isPosted`…)
  генератор підмішує сам із `DocumentHeaderSchema` (`client/shared/schema.ts`).
  Описати їх у схемі моделі — помилка збірки, а не тихе дублювання.
- `list`/`get`/`lookup` читають `app.document h join app.<model> t` і завжди
  відсікають `is_deleted`.
- `save` робить два MERGE: спершу шапка (вона повертає `id`), потім реквізити,
  потім табличні частини. Номер підставляє `app.doc_next_number` (обгортка над
  нумератором), **лише якщо документ новий**; для збереженого відсутній у
  payload номер означає «не чіпати». Номер, набраний руками, приймається як є,
  але підтягує лічильник — `app.doc_bump_number`. `isPosted`/`isDeleted` форма
  не пише — для них є окремі команди.
- `delete` видаляє рядок `app.document`; реквізити, рядки й проводки йдуть
  каскадом.

У `manifest.json` документа обов'язковий блок `document`:

```json
"document": { "name": "Накладна", "shortName": "Накл.", "prefix": "НК", "sortOrder": 10 }
```

З нього `sql:assemble` генерує рядки `app.document_type`
(`_generated/document-types.data.sql`) — код типу дорівнює ключу моделі, тому
розійтися вони не можуть.

### Хук денормалізації

Після запису генерований `save` викликає `app.<model>_denormalize(user_id,
document_id)`, **якщо така функція існує** (перевірка через `to_regprocedure`).
У ній документ заповнює службові поля шапки — `total` і `presentation`, потрібні
журналу документів і спискам посилань. Рахувати підсумок у генераторі не можна:
у кожного документа він свій. Еталон — `app/document/invoice/db/invoice.custom.sql`.

## `post` / `unpost`

Для `type:"document"` генеруються обгортки навколо ядра:

```
post   → doc_post_begin (зносить попередні рухи)
       → app.<model>_post_entries(user_id, document_id)   ← рукописна
       → doc_post_finish
unpost → doc_unpost
```

`app.<model>_post_entries` пише розробник у `db/<model>.custom.sql` — логіка
проводок лишається видимим SQL, а не декларацією в маніфесті. Перепроведення
завжди переписує регістр начисто, тому проводки не дублюються. Для
`catalog`/`register` ці функції не генеруються.

---

## `type: "register"` — та сама п'ятірка без `lookup`

Регістр отримує звичайний CRUD довідника — `list`, `get`, `save`, `delete` — і
**не отримує `lookup`**; `<Model>LookupRowSchema` від нього не вимагається зовсім.
Причина не в економії: на регістр ніхто не посилається, тож підбирати його в
пікері нема кому, а представлення в рядка курсу валют немає взагалі — писати
схему заради функції, яку ніхто не покличе, було б обманом.

**Позначки на видалення в регістра зазвичай немає, і це не окреме рішення.**
Генератор дивиться на поле `isDeleted` у схемі, а не на тип моделі: є воно —
`delete` ставить позначку й з'являється `undelete`, немає — `delete` фізичний.
Для регістра фізичне видалення й правильне: позначений рядок курсу мовчки псував
би «зріз останнього», бо його довелося б відсікати в кожному запиті окремо.

Чого генерація НЕ дає — власного читання регістру: `<model>_at` (значення на
дату), `<model>_history`, `<model>_set`. Воно періодичне за природою, у кожного
регістру своє, і пишеться руками в `db/<model>.custom.sql`.

Список регістру відкривається за першою сортованою колонкою **за зростанням** —
для періоду це найстаріший запис угорі. Дефолт задає екран, а не схема:
`defaultSortBy` / `defaultSortDir` у `QueryTableBase` (`override defaultSortDir =
"desc"`). Значення в згенерованому SQL лишається тільки для прямих викликів —
з API чи агентом, де сортування ніхто не передав.

---

## `type: "report"` — генерується обгортка, не запит

У звіту немає CRUD: є одна команда вибірки. Але навколо самого запиту щоразу
писалося те саме — розбір `payload.filters`, зворотне представлення ссылочного
фільтра і конверт. Тому генерується саме обгортка:

```
db/_generated/<report>.index.gen.sql   app.<report>_index(user_id, payload)  ← sql:gen
db/<report>.sql                        app.<report>_data(user_id, filters)   ← руками
```

Обгортка будується зі **схеми фільтрів** — `<Pascal>FiltersSchema`, тієї самої, з
якою зв'язаний екран, — і робить чотири речі:

1. **розбирає** `payload.filters`, згортаючи ссылку до id: `organization`
   (об'єкт `{id, name}`) приходить у тіло як `organizationId`; порожній рядок
   означає «не задано», тобто ключ у нормалізованому наборі просто зникає;
2. **відмовляє**, коли не заповнений обов'язковий фільтр, — конвертом `ok:false`
   з маркером `@[core.reportFilterRequired]` і прив'язкою до поля;
3. **вертає эхо** `$filters` із підписом із бази — id міг прийти сам, без назви
   (перехід з іншого звіту), і тоді пікер стояв би порожнім при діючому фільтрі.
   Эхо кладеться і у відмову: інакше панель губила б підписи рівно тоді, коли
   користувач має їх доповнювати;
4. **загортає** результат у конверт, доповнюючи відсутні ключі `data`.

У схемі фільтрів звіту оголошується **походження** ссылки — тим самим `x-ref`,
що в моделях (без нього підпис для эха брати нізвідки), а обов'язковість — це
`Type.Optional`, як і в полях форми:

```ts
const refFilter = (model: string) =>
  Type.Union([Type.Object({ id: Type.String(), name: Type.String() }), Type.Null()],
    { default: null, "x-ref": { model } });

export const TurnoverBalanceFiltersSchema = Type.Object({
  organization: refFilter("organization"),                    // обов'язковий
  dateFrom:     Type.Optional(Type.String({ default: "" })),  // необов'язковий
  dateTo:       Type.Optional(Type.String({ default: "" })),
});
```

Тіло звіту починається з уже розібраних значень і віддає лише вміст `data` —
ні конверта, ні эха, ні перевірки обов'язкових:

```sql
create function app.turnover_balance_data(user_id bigint, filters jsonb)
returns jsonb language sql as $$
  with params as (
    select
      nullif(filters->>'organizationId', '')::bigint as org_id,
      nullif(filters->>'dateFrom', '')::date         as date_from,
      nullif(filters->>'dateTo', '')::date           as date_to
  ),
  -- … запит …
  select jsonb_build_object('rows', …, 'totals', …);   -- 'extra', якщо потрібне екрану
$$;
```

Кожна з чотирьох дій обгортки окремо не варта уваги — і саме тому вони й
розходилися: методологію вхідного сальдо одного разу правили у двох звітах
нарізно, і обидва однаково вважалися джерелом правди.

Звіт без `<Pascal>FiltersSchema` можливий — обгортка вийде без фільтрів, — але
генератор про це попереджає рядком `⚠`: майже завжди це описка в імені експорту,
а виглядає вона як робоча генерація.

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
