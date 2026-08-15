-- ═══════════════════════════════════════════════════════════════════════════
-- Шар обчислень над бухгалтерським регістром.
--
-- ЧОМУ В ЯДРІ. `app.journal_entry` і його аналітика — таблиці ЯДРА, застосунок
-- їх не оголошував. Той, хто володіє схемою руху, має володіти й способом його
-- прочитати; інакше кожен застосунок виводить сальдо активного, пасивного й
-- активно-пасивного рахунку самотужки — і в одному з них воно рано чи пізно
-- виявиться порахованим не так.
--
-- Це вже сталося, і саме тому шар існує. Доки кожен звіт рахував сам, вхідне
-- сальдо бралося умовою `date_from is null or doc_date < date_from` — при
-- виклику БЕЗ періоду кожен рух ставав ОДНОЧАСНО вхідним сальдо й оборотом, а
-- кінцеве виходило вдвічі більшим (перевірено: документ на 8 000 давав сальдо
-- 16 000). В інтерфейсі цього не видно — `<ui-period>` завжди підставляє
-- період; видно лише коли звіт кличуть напряму: з API, агентом, іншим звітом.
-- Правити довелося у двох місцях, і жодне не було джерелом правди.
--
-- Підсумків система не зберігає СВІДОМО, тож сальдо й обороти рахуються
-- скануванням регістру — тим важливіше, щоб їх ЧИТАЛИ одним кодом.
--
-- ЩО ТУТ Є:
--   app.acc_account_tree(code)                        — рахунок разом із субрахунками
--   app.acc_entries(…)                                — потік рухів ВІД РАХУНКУ (рядок = бік проводки)
--   app.acc_journal(…, document_id)                   — потік ПРОВОДОК (рядок = проводка)
--   app.acc_balance_turnover(…)                       — сальдо+обороти за один прохід
--   app.acc_balance_turnover_by_dim(…, dimension)     — те саме в розрізі субконто
--   app.acc_balance(org, before, …)                   — сальдо на дату
--   app.acc_turnover(org, from, to, …)                — обороти за період
--
-- КІЛЬКІСТЬ. `acc_balance_turnover` і `..._by_dim` віддають її поруч із грішми —
-- `opening_quantity`, `quantity_debit`, `quantity_credit`, `closing_quantity`.
-- Порожньо там, де рахунок кількості НЕ ВЕДЕ (`is_quantitative`), і нуль там, де
-- веде, але руху не було: нуль на негрошовому рахунку читався б як «поміряли й
-- вийшло нічого». Доти кількість жила тільки в `acc_entries`, тобто ДО будь-якої
-- арифметики сальдо, і складали її самотужки — а це та сама методологія (де межа
-- періоду, що вважається рухом), яку шар і мусить тримати один.
--
-- ЧОГО ТУТ НЕМАЄ СВІДОМО:
--   • РОЗРІЗ БІЛЬШ НІЖ ЗА ОДНИМ виміром: `..._by_dim` бере один
--     `p_dimension_code`. Запас живе у двох (склад × номенклатура), тож
--     «скільки чого й ДЕ» через шар поки не питається — це наступна робота, і
--     вона міняє форму результату, а не додає колонки;
--   • подання сальдо активного / пасивного / активно-пасивного рахунку. Шар
--     віддає ЧИСТЕ сальдо (`net` = дебет − кредит, дебетове додатне), а як його
--     показати — дебетом, кредитом чи обома — вирішує звіт за типом рахунку. Це
--     різні речі: одна — арифметика, друга — форма подання;
--   • кешу підсумків: він мав би сенс лише тоді, коли сканування справді стане
--     дорогим, і заводити його наперед означало б тримати другу правду.
--
-- ПАРАМЕТРИ, спільні для всіх функцій:
--   p_organization_id — обов'язковий: облік ведеться по організації, і сальдо
--                       «по всіх організаціях разом» — не бухгалтерська величина;
--   p_accounts        — масив КОДІВ рахунків; null означає «усі». Групи сюди
--                       передавати марно (проводок на групах не буває) — для
--                       рахунку з субрахунками є app.acc_account_tree();
--   p_dims            — відбір за субконто: {"counterparty": "42", "cost_item": "7"}.
--                       Умови поєднуються І. Значення — id як рядок.
--
-- ПАСТКА ВІДКРИТОЇ МЕЖІ, про яку варто знати заздалегідь. `acc_balance(…, null)`
-- означає «усі рухи», тобто сальдо на цей момент, — і це корисно саме по собі.
-- Але як ВХІДНЕ сальдо періоду з порожньою датою початку потрібен НУЛЬ: рух не
-- може бути одночасно залишком на початок і оборотом періоду. Тому звіти беруть
-- вхідне сальдо з `acc_balance_turnover` (там правило враховано), а не з
-- `acc_balance(org, date_from)`. Ця помилка вже двічі коштувала подвоєного
-- сальдо — спершу в обох звітах, потім у наростаючому залишку картки.
--
-- ПЛАН РАХУНКІВ ТУТ ЧУЖИЙ. `app.chart_of_account` оголошує ЗАСТОСУНОК — так
-- само, як на нього вже посилається сам регістр (`journal_entry.debit_account`).
-- Шар лише читає з нього назву рахунку й ієрархію по `parent_code`; складу плану
-- він не знає й знати не мусить.
-- ── Рахунок разом із субрахунками ────────────────────────────────────────────
-- Ієрархія плану — по коду (parent_code), тож обхід рекурсивний. Повертає й сам
-- рахунок: для конкретного рахунку без дітей це масив з одного елемента, і
-- викликати функцію можна беззастережно.
drop function if exists app.acc_account_tree(varchar);
create function app.acc_account_tree(p_code varchar)
returns varchar[]
language sql
stable
as $$
  with recursive tree as (
    select c.code from app.chart_of_account c where c.code = p_code
    union all
    select c.code
    from app.chart_of_account c
    join tree t on c.parent_code = t.code
  )
  select array_agg(code) from tree;
$$;

-- ── Потік рухів ──────────────────────────────────────────────────────────────
-- Один рядок = один БІК проводки. Проводка Дт 301 Кт 311 дає два рядки: для 301
-- (дебетовий) і для 311 (кредитовий). Саме так її бачать усі звіти від рахунку:
-- картка 301 показує надходження, картка 311 — списання, і кожен бік несе СВОЮ
-- аналітику.
--
-- Тут — і тільки тут — сказано, що вважається рухом: проведений документ, не
-- позначений на видалення, потрібної організації. Забудеш `is_posted` в
-- одному звіті — і він розійдеться з рештою; тому умова живе в одному місці.
drop function if exists app.acc_entries(bigint, date, date, varchar[], jsonb);
create function app.acc_entries(
  p_organization_id bigint,
  p_date_from       date default null,
  p_date_to         date default null,
  p_accounts        varchar[] default null,
  p_dims            jsonb default null
)
returns table (
  entry_id        bigint,
  document_id     bigint,
  doc_date        timestamp,
  doc_number      varchar,
  doc_type_code   varchar,
  doc_type_name   varchar,
  line_no         int,
  side            varchar,
  account         varchar,
  account_name    varchar,
  corr_account    varchar,
  corr_account_name varchar,
  debit           numeric,
  credit          numeric,
  currency_id     bigint,
  currency_code   varchar,
  currency_debit  numeric,
  currency_credit numeric,
  quantity_debit  numeric,
  quantity_credit numeric,
  description     text,
  dims            jsonb,
  corr_dims       jsonb
)
language sql
stable
as $$
  select
    je.id                                   as entry_id,
    d.id                                    as document_id,
    d.doc_date,
    d.number                                as doc_number,
    dt.code                                 as doc_type_code,
    coalesce(dt.short_name, dt.name)        as doc_type_name,
    je.line_no,
    s.side::varchar,
    case when s.side = 'debit' then je.debit_account else je.credit_account end as account,
    coalesce(ca.name, '')                   as account_name,
    case when s.side = 'debit' then je.credit_account else je.debit_account end as corr_account,
    coalesce(cc.name, '')                   as corr_account_name,
    case when s.side = 'debit' then je.amount else 0::numeric end as debit,
    case when s.side = 'debit' then 0::numeric else je.amount end as credit,
    je.currency_id,
    cur.name                                as currency_code,
    case when s.side = 'debit' then je.currency_amount else null end as currency_debit,
    case when s.side = 'debit' then null else je.currency_amount end as currency_credit,
    -- Кількість належить тому боку, чий рахунок її ВЕДЕ, а не обом. У регістрі
    -- колонка одна, і заповнюється вона, коли кількісний ХОЧ ОДИН бік
    -- (`doc_entry_add`), — тож у проводці «Дт 281 Кт 631 на 10 шт» друга сторона
    -- діставала ті самі 10 штук, хоч рахунок 631 кількості не веде взагалі.
    -- Помітно це не одразу: у картці 631 з'являлася колонка кількості з
    -- правдоподібними числами, а в оборотці по 63-му вони б іще й склалися.
    case when s.side = 'debit'  and coalesce(ca.is_quantitative, false) then je.quantity end as quantity_debit,
    case when s.side = 'credit' and coalesce(ca.is_quantitative, false) then je.quantity end as quantity_credit,
    je.description,
    coalesce(an.list, '[]'::jsonb)          as dims,
    coalesce(corr.list, '[]'::jsonb)        as corr_dims
  from app.document d
  join app.document_type dt on dt.id = d.document_type_id
  join app.journal_entry je on je.document_id = d.id
  cross join (values ('debit'), ('credit')) as s(side)
  left join app.chart_of_account ca
    on ca.code = case when s.side = 'debit' then je.debit_account else je.credit_account end
  left join app.chart_of_account cc
    on cc.code = case when s.side = 'debit' then je.credit_account else je.debit_account end
  left join app.currency cur on cur.id = je.currency_id
  -- Аналітика свого боку: `list` для показу, `map` для відбору. Два подання
  -- одного й того самого — щоб звіт не розбирав список, а відбір не будував
  -- рядки, які нікому не потрібні.
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'dimensionCode', a.dimension_code,
        'dimensionName', dim.name,
        'modelKey',      dim.model_key,
        'valueId',       a.value_id::text,
        'valueCode',     a.value_code,
        'presentation',  a.value_presentation
      ) order by a.slot_no) as list,
      jsonb_object_agg(a.dimension_code, a.value_id::text) as map
    from app.journal_entry_analytic a
    join app.analytic_dimension dim on dim.code = a.dimension_code
    where a.journal_entry_id = je.id and a.side = s.side
  ) an on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'dimensionCode', a.dimension_code,
             'dimensionName', dim.name,
             'modelKey',      dim.model_key,
             'valueId',       a.value_id::text,
             'valueCode',     a.value_code,
             'presentation',  a.value_presentation
           ) order by a.slot_no) as list
    from app.journal_entry_analytic a
    join app.analytic_dimension dim on dim.code = a.dimension_code
    where a.journal_entry_id = je.id
      and a.side = case when s.side = 'debit' then 'credit' else 'debit' end
  ) corr on true
  where d.organization_id = p_organization_id
    and d.is_posted
    and not d.is_deleted
    and (p_date_from is null or d.doc_date::date >= p_date_from)
    and (p_date_to   is null or d.doc_date::date <= p_date_to)
    -- Бік без рахунку рядка не дає взагалі. Забалансова проводка однобічна за
    -- визначенням («Дт 021» не кореспондує ні з чим), і без цієї умови її
    -- порожня сторона збиралася б у сальдо окремим рахунком «null» — з сумою,
    -- яка робить підсумки зведеними, хоча такого рахунку немає.
    and (case when s.side = 'debit' then je.debit_account else je.credit_account end) is not null
    and (p_accounts  is null or
         (case when s.side = 'debit' then je.debit_account else je.credit_account end) = any (p_accounts))
    -- `@>` — саме та семантика, що потрібна: усі задані пари присутні, зайві
    -- субконто в проводці відбору не заважають.
    and (p_dims is null or p_dims = '{}'::jsonb or coalesce(an.map, '{}'::jsonb) @> p_dims)
  order by d.doc_date, d.id, je.line_no, je.id, s.side desc;
$$;

-- ── Потік проводок (рядок = проводка, а не бік) ──────────────────────────────
-- Другий погляд на той самий регістр. `acc_entries` дивиться ВІД РАХУНКУ (по
-- рядку на кожен бік) — це потрібно картці, сальдо й оборотам. Тут навпаки:
-- рядок = проводка, дебет і кредит поруч, — це потрібно журналу проводок,
-- зведеним проводкам, шахматці й рухам документа.
--
-- Два подання, але правило «що вважається рухом» одне: обидві функції ставлять
-- ті самі три умови (проведений, непозначений, тієї організації).
--
-- Відбір за рахунком і субконто тут — «ХОЧ ОДИН бік», а не «свій бік»: у
-- журналі проводок відбір за рахунком означає «проводки, які його торкаються».
drop function if exists app.acc_journal(bigint, date, date, varchar[], jsonb, bigint);
create function app.acc_journal(
  p_organization_id bigint,
  p_date_from       date default null,
  p_date_to         date default null,
  p_accounts        varchar[] default null,
  p_dims            jsonb default null,
  p_document_id     bigint default null
)
returns table (
  entry_id            bigint,
  document_id         bigint,
  doc_date            timestamp,
  doc_number          varchar,
  doc_type_code       varchar,
  doc_type_name       varchar,
  line_no             int,
  debit_account       varchar,
  debit_account_name  varchar,
  credit_account      varchar,
  credit_account_name varchar,
  amount              numeric,
  currency_code       varchar,
  currency_amount     numeric,
  quantity            numeric,
  description         text,
  debit_dims          jsonb,
  credit_dims         jsonb
)
language sql
stable
as $$
  select
    je.id, d.id, d.doc_date, d.number,
    dt.code, coalesce(dt.short_name, dt.name),
    je.line_no,
    je.debit_account, coalesce(cd.name, ''),
    je.credit_account, coalesce(cc.name, ''),
    je.amount,
    cur.name, je.currency_amount, je.quantity, je.description,
    coalesce(dan.list, '[]'::jsonb),
    coalesce(can.list, '[]'::jsonb)
  from app.document d
  join app.document_type dt on dt.id = d.document_type_id
  join app.journal_entry je on je.document_id = d.id
  left join app.chart_of_account cd on cd.code = je.debit_account
  left join app.chart_of_account cc on cc.code = je.credit_account
  left join app.currency cur on cur.id = je.currency_id
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'dimensionCode', a.dimension_code, 'dimensionName', dim.name,
        'modelKey', dim.model_key, 'valueId', a.value_id::text,
        'valueCode', a.value_code, 'presentation', a.value_presentation
      ) order by a.slot_no) as list,
      jsonb_object_agg(a.dimension_code, a.value_id::text) as map
    from app.journal_entry_analytic a
    join app.analytic_dimension dim on dim.code = a.dimension_code
    where a.journal_entry_id = je.id and a.side = 'debit'
  ) dan on true
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'dimensionCode', a.dimension_code, 'dimensionName', dim.name,
        'modelKey', dim.model_key, 'valueId', a.value_id::text,
        'valueCode', a.value_code, 'presentation', a.value_presentation
      ) order by a.slot_no) as list,
      jsonb_object_agg(a.dimension_code, a.value_id::text) as map
    from app.journal_entry_analytic a
    join app.analytic_dimension dim on dim.code = a.dimension_code
    where a.journal_entry_id = je.id and a.side = 'credit'
  ) can on true
  where d.organization_id = p_organization_id
    and d.is_posted
    and not d.is_deleted
    and (p_document_id is null or d.id = p_document_id)
    and (p_date_from is null or d.doc_date::date >= p_date_from)
    and (p_date_to   is null or d.doc_date::date <= p_date_to)
    and (p_accounts is null
         or je.debit_account = any (p_accounts)
         or je.credit_account = any (p_accounts))
    and (p_dims is null or p_dims = '{}'::jsonb
         or coalesce(dan.map, '{}'::jsonb) @> p_dims
         or coalesce(can.map, '{}'::jsonb) @> p_dims)
  order by d.doc_date, d.id, je.line_no, je.id;
$$;

-- ── Сальдо й обороти за один прохід ──────────────────────────────────────────
-- Те, чого потребує оборотно-сальдова відомість: по кожному рахунку вхідне
-- сальдо, обороти періоду й кінцеве сальдо. Один прохід, а не три виклики: 90%
-- роботи в них спільні.
--
-- `p_date_from` порожня означає «з початку часів» — і тоді ВХІДНОГО САЛЬДА
-- НЕМАЄ. Це те саме правило, на якому раніше розійшлися два звіти: рух не може
-- бути одночасно вхідним залишком і оборотом періоду.
-- `p_date_to` порожня означає «до кінця часів».
drop function if exists app.acc_balance_turnover(bigint, date, date, varchar[], jsonb);
create function app.acc_balance_turnover(
  p_organization_id bigint,
  p_date_from       date default null,
  p_date_to         date default null,
  p_accounts        varchar[] default null,
  p_dims            jsonb default null
)
returns table (
  account          varchar,
  account_name     varchar,
  opening_net      numeric,
  debit            numeric,
  credit           numeric,
  closing_net      numeric,
  opening_quantity numeric,
  quantity_debit   numeric,
  quantity_credit  numeric,
  closing_quantity numeric
)
language sql
stable
as $$
  with moves as (
    -- Беремо все ДО кінця періоду одним заходом: рухи до початку дадуть вхідне
    -- сальдо, рухи в межах — обороти.
    select
      e.account, e.account_name, e.doc_date, e.debit, e.credit,
      coalesce(e.quantity_debit,  0::numeric) as quantity_debit,
      coalesce(e.quantity_credit, 0::numeric) as quantity_credit,
      (e.quantity_debit is not null or e.quantity_credit is not null) as has_quantity
    from app.acc_entries(p_organization_id, null, p_date_to, p_accounts, p_dims) e
  ),
  agg as (
    select
      m.account,
      max(m.account_name) as account_name,
      coalesce(sum(m.debit - m.credit) filter (
        where p_date_from is not null and m.doc_date::date < p_date_from
      ), 0::numeric) as opening_net,
      coalesce(sum(m.debit) filter (
        where p_date_from is null or m.doc_date::date >= p_date_from
      ), 0::numeric) as debit,
      coalesce(sum(m.credit) filter (
        where p_date_from is null or m.doc_date::date >= p_date_from
      ), 0::numeric) as credit,
      -- Ознака рахунку, а не рядка: питання «чи ведеться тут кількість» має одну
      -- відповідь на весь рахунок, і саме вона вирішує, порожньо буде в колонці
      -- чи нуль. Нуль на негрошовому рахунку читався б як «поміряли й вийшло
      -- нічого», а це різні речі.
      bool_or(m.has_quantity) as has_quantity,
      coalesce(sum(m.quantity_debit - m.quantity_credit) filter (
        where p_date_from is not null and m.doc_date::date < p_date_from
      ), 0::numeric) as opening_quantity,
      coalesce(sum(m.quantity_debit) filter (
        where p_date_from is null or m.doc_date::date >= p_date_from
      ), 0::numeric) as quantity_debit,
      coalesce(sum(m.quantity_credit) filter (
        where p_date_from is null or m.doc_date::date >= p_date_from
      ), 0::numeric) as quantity_credit
    from moves m
    group by m.account
  )
  select
    a.account,
    a.account_name,
    a.opening_net,
    a.debit,
    a.credit,
    a.opening_net + a.debit - a.credit as closing_net,
    case when a.has_quantity then a.opening_quantity end,
    case when a.has_quantity then a.quantity_debit end,
    case when a.has_quantity then a.quantity_credit end,
    case when a.has_quantity
         then a.opening_quantity + a.quantity_debit - a.quantity_credit end
  from agg a
  -- Рахунки без руху й без сальдо не повертаємо: показувати 460 порожніх рядків
  -- плану — марно, а відсіювати їх у кожному звіті — зайва робота. Кількість у
  -- цій умові теж є: рух, у якого сума нульова, а штуки не нульові (безоплатна
  -- передача, перекомплектація), інакше зник би разом із рядком.
  where a.opening_net <> 0 or a.debit <> 0 or a.credit <> 0
     or a.opening_quantity <> 0 or a.quantity_debit <> 0 or a.quantity_credit <> 0
  order by a.account;
$$;

-- ── Сальдо й обороти в розрізі субконто ──────────────────────────────────────
-- Те саме, що `acc_balance_turnover`, але згруповане ще й за значенням одного
-- виміру: основа «аналізу субконто» й «картки субконто».
--
-- Рух, у якого цього виміру НЕМА, повертається окремим рядком із `value_id is
-- null`, а не зникає. Спершу тут стояв `cross join lateral`, і міркування було
-- таке: рахунок, який цього субконто не веде, не має «сальдо в розрізі нього»,
-- тож і рядка бути не повинно. Міркування помилкове, і ось чому.
--
-- Субконто веде не рахунок, а ПРОВОДКА. На рахунку з оборотним субконто майже
-- завжди є рухи без нього — уведення залишків, закриття, коригування, — і всі
-- вони мовчки зникали: кожен рядок вибірки лишався правильним, неправильною
-- ставала тільки їхня СУМА. На даних altera-buh рахунок 311 на 30.04.2026 давав
-- 117 500 через `acc_balance_turnover` і 5 500 у розрізі статті руху коштів;
-- різниця — початкові залишки, де статті руху немає й бути не може. Звіряти
-- підсумок розрізу з підсумком рахунку нікому, тож помилка не мала жодного
-- шансу виявитися сама.
--
-- Тепер сума рядків дорівнює сальдо рахунку — це властивість, на яку звіт може
-- спиратися. Рядок без виміру приходить останнім (`null` в ASC сортується в
-- кінець), а ЩО з ним робити — назвати «<не вказано>», згорнути чи відсіяти —
-- вирішує звіт: шар віддає рух, а не подання.
drop function if exists app.acc_balance_turnover_by_dim(bigint, date, date, varchar[], jsonb, varchar);
create function app.acc_balance_turnover_by_dim(
  p_organization_id bigint,
  p_date_from       date default null,
  p_date_to         date default null,
  p_accounts        varchar[] default null,
  p_dims            jsonb default null,
  p_dimension_code  varchar default null
)
returns table (
  value_id           text,
  value_code         text,
  value_presentation text,
  account            varchar,
  account_name       varchar,
  opening_net        numeric,
  debit              numeric,
  credit             numeric,
  closing_net        numeric,
  opening_quantity   numeric,
  quantity_debit     numeric,
  quantity_credit    numeric,
  closing_quantity   numeric
)
language sql
stable
as $$
  with moves as (
    select
      v.value_id, v.value_code, v.presentation,
      e.account, e.account_name, e.doc_date, e.debit, e.credit,
      coalesce(e.quantity_debit,  0::numeric) as quantity_debit,
      coalesce(e.quantity_credit, 0::numeric) as quantity_credit,
      (e.quantity_debit is not null or e.quantity_credit is not null) as has_quantity
    from app.acc_entries(p_organization_id, null, p_date_to, p_accounts, p_dims) e
    -- `left … on true`: рух без цього виміру мусить лишитися в вибірці з
    -- порожнім значенням (див. довід у заголовку функції).
    left join lateral (
      select el->>'valueId' as value_id, el->>'valueCode' as value_code,
             el->>'presentation' as presentation
      from jsonb_array_elements(e.dims) el
      where el->>'dimensionCode' = p_dimension_code
    ) v on true
  ),
  agg as (
    select
      m.value_id,
      max(m.value_code)   as value_code,
      max(m.presentation) as presentation,
      m.account,
      max(m.account_name) as account_name,
      coalesce(sum(m.debit - m.credit) filter (
        where p_date_from is not null and m.doc_date::date < p_date_from
      ), 0::numeric) as opening_net,
      coalesce(sum(m.debit) filter (
        where p_date_from is null or m.doc_date::date >= p_date_from
      ), 0::numeric) as debit,
      coalesce(sum(m.credit) filter (
        where p_date_from is null or m.doc_date::date >= p_date_from
      ), 0::numeric) as credit,
      -- Кількість — так само, як у `acc_balance_turnover`: порожньо там, де
      -- рахунок її не веде, і нуль там, де веде, але руху не було.
      bool_or(m.has_quantity) as has_quantity,
      coalesce(sum(m.quantity_debit - m.quantity_credit) filter (
        where p_date_from is not null and m.doc_date::date < p_date_from
      ), 0::numeric) as opening_quantity,
      coalesce(sum(m.quantity_debit) filter (
        where p_date_from is null or m.doc_date::date >= p_date_from
      ), 0::numeric) as quantity_debit,
      coalesce(sum(m.quantity_credit) filter (
        where p_date_from is null or m.doc_date::date >= p_date_from
      ), 0::numeric) as quantity_credit
    from moves m
    group by m.value_id, m.account
  )
  select
    a.value_id, a.value_code, a.presentation,
    a.account, a.account_name,
    a.opening_net, a.debit, a.credit,
    a.opening_net + a.debit - a.credit,
    case when a.has_quantity then a.opening_quantity end,
    case when a.has_quantity then a.quantity_debit end,
    case when a.has_quantity then a.quantity_credit end,
    case when a.has_quantity
         then a.opening_quantity + a.quantity_debit - a.quantity_credit end
  from agg a
  where a.opening_net <> 0 or a.debit <> 0 or a.credit <> 0
     or a.opening_quantity <> 0 or a.quantity_debit <> 0 or a.quantity_credit <> 0
  order by a.presentation, a.account;
$$;

-- ── Сальдо на дату ───────────────────────────────────────────────────────────
-- `p_before` — рухи ДО цієї дати, не включно. Ім'я саме таке, щоб семантику не
-- доводилося вгадувати: сальдо «на 01.08» — це стан на ПОЧАТОК 1 серпня.
-- Кінцеве сальдо за серпень = app.acc_balance(org, '2026-09-01', …).
-- null означає «усі рухи», тобто сальдо на цей момент.
drop function if exists app.acc_balance(bigint, date, varchar[], jsonb);
create function app.acc_balance(
  p_organization_id bigint,
  p_before          date default null,
  p_accounts        varchar[] default null,
  p_dims            jsonb default null
)
returns table (account varchar, account_name varchar, net numeric)
language sql
stable
as $$
  select
    e.account,
    max(e.account_name)::varchar,
    coalesce(sum(e.debit - e.credit), 0::numeric)
  from app.acc_entries(
         p_organization_id,
         null,
         case when p_before is null then null else p_before - 1 end,
         p_accounts,
         p_dims
       ) e
  group by e.account
  having coalesce(sum(e.debit - e.credit), 0::numeric) <> 0
  order by e.account;
$$;

-- ── Обороти за період ────────────────────────────────────────────────────────
drop function if exists app.acc_turnover(bigint, date, date, varchar[], jsonb);
create function app.acc_turnover(
  p_organization_id bigint,
  p_date_from       date default null,
  p_date_to         date default null,
  p_accounts        varchar[] default null,
  p_dims            jsonb default null
)
returns table (account varchar, account_name varchar, debit numeric, credit numeric)
language sql
stable
as $$
  select
    e.account,
    max(e.account_name)::varchar,
    coalesce(sum(e.debit), 0::numeric),
    coalesce(sum(e.credit), 0::numeric)
  from app.acc_entries(p_organization_id, p_date_from, p_date_to, p_accounts, p_dims) e
  group by e.account
  order by e.account;
$$;
