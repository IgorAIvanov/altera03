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
--   app.acc_balance_turnover_by_dims(…, dimensions[]) — те саме в розрізі СУБКОНТО
--                                                       (одного чи кількох: склад × номенклатура)
--   app.acc_balance_turnover_by_dim(…, dimension)     — плоска обгортка для одного виміру
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
--
-- ВХІД ВИБІРКИ ЗАЛЕЖИТЬ ВІД `p_dims`. Джерело пар (проводка, бік) — підзапит
-- `src` із двох взаємовиключних гілок. Без відбору за субконто пари — всі
-- (перша гілка; той самий cross join боків, що був тут завжди). З відбором
-- перебирати весь журнал марно — ціна виклику не залежала від вибірковості:
-- скан усього журналу організації плюс jsonb-агрегат аналітики на КОЖЕН рядок,
-- і лише в кінці `@>`. Залишок номенклатури з 90 рухами коштував як із 6 000
-- (~900 мс на 80 тис. проводок), а стоїть такий виклик у проведенні — на кожен
-- рядок документа. Тому друга гілка входить з ix_journal_entry_analytic_value
-- за заданими парами (вимір, значення) і віддає лише боки, де присутні ВСІ
-- задані пари. Обидві гілки лише ЗВУЖУЮТЬ перебір: правило руху й контрольний
-- `@>` стоять нижче, у спільному where, — семантика сказана один раз, і навіть
-- розбіжність гілки з нею дала б не зайві рядки, а пропущені. Мертву гілку
-- планувальник відкидає, коли значення `p_dims` відоме на момент планування.
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
    src.side::varchar,
    case when src.side = 'debit' then je.debit_account else je.credit_account end as account,
    coalesce(ca.name, '')                   as account_name,
    case when src.side = 'debit' then je.credit_account else je.debit_account end as corr_account,
    coalesce(cc.name, '')                   as corr_account_name,
    case when src.side = 'debit' then je.amount else 0::numeric end as debit,
    case when src.side = 'debit' then 0::numeric else je.amount end as credit,
    -- Валюта СВОГО боку. Доти сума була одна на проводку й діставалася обом
    -- бокам без огляду на is_currency: картка гривневого рахунку в проводці
    -- «Дт 312 Кт 311» показувала валютну суму. Тепер зберігається по боках
    -- (конвертація «Дт USD Кт EUR» — дві валюти), і тут просто читається.
    case when src.side = 'debit' then je.currency_id_debit else je.currency_id_credit end as currency_id,
    cur.name                                as currency_code,
    case when src.side = 'debit'  then je.currency_amount_debit  end as currency_debit,
    case when src.side = 'credit' then je.currency_amount_credit end as currency_credit,
    -- Кількість зберігається по боках (складна проводка: комплектація списує
    -- 6 корпусів і оприбутковує 2 комплекти одним рядком), тож тут вона просто
    -- читається. Що значення лежить лише на боці, який його веде, гарантує
    -- запис — doc_entry_add; сторожів удруге тут немає навмисно.
    case when src.side = 'debit'  then je.quantity_debit  end as quantity_debit,
    case when src.side = 'credit' then je.quantity_credit end as quantity_credit,
    je.description,
    coalesce(an.list, '[]'::jsonb)          as dims,
    coalesce(corr.list, '[]'::jsonb)        as corr_dims
  from (
    select je0.id as entry_id, v.side
    from app.journal_entry je0
    cross join (values ('debit'), ('credit')) v(side)
    where p_dims is null or p_dims = '{}'::jsonb
    union all
    select m.journal_entry_id, m.side::text
    from (
      select a.journal_entry_id, a.side
      from (
        -- Пара відбору в індексній формі: значення — id, тобто bigint.
        -- Регулярка відсіює те, що id бути не може (зокрема задовге для
        -- bigint: у `@>` таке значення просто не збігалося, а cast упав би
        -- помилкою); звірка канонічної форми нижче — щоб '007' не збіглося
        -- із 7, як не збігалося і в `@>`.
        select d2.key as dimension_code, d2.value::bigint as value_id, d2.value as value_text
        from jsonb_each_text(coalesce(p_dims, '{}'::jsonb)) d2
        where d2.value ~ '^[0-9]{1,18}$'
      ) p
      join app.journal_entry_analytic a
        on a.dimension_code = p.dimension_code
       and a.value_id = p.value_id
      where a.value_id::text = p.value_text
      group by a.journal_entry_id, a.side
      -- Бік підходить, коли в ньому знайшлися ВСІ задані пари. Лічимо від
      -- p_dims, а не від відсіяного списку: пара, що не пройшла регулярку,
      -- не збіглася б і в `@>` — результат мусить лишитися порожнім.
      having count(distinct a.dimension_code) = (select count(*) from jsonb_each_text(p_dims))
    ) m
    where p_dims is not null and p_dims <> '{}'::jsonb
  ) src
  join app.journal_entry je on je.id = src.entry_id
  join app.document d on d.id = je.document_id
  join app.document_type dt on dt.id = d.document_type_id
  left join app.chart_of_account ca
    on ca.code = case when src.side = 'debit' then je.debit_account else je.credit_account end
  left join app.chart_of_account cc
    on cc.code = case when src.side = 'debit' then je.credit_account else je.debit_account end
  left join app.currency cur
    on cur.id = case when src.side = 'debit' then je.currency_id_debit else je.currency_id_credit end
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
    where a.journal_entry_id = je.id and a.side = src.side
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
      and a.side = case when src.side = 'debit' then 'credit' else 'debit' end
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
    and (case when src.side = 'debit' then je.debit_account else je.credit_account end) is not null
    and (p_accounts  is null or
         (case when src.side = 'debit' then je.debit_account else je.credit_account end) = any (p_accounts))
    -- `@>` — саме та семантика, що потрібна: усі задані пари присутні, зайві
    -- субконто в проводці відбору не заважають.
    and (p_dims is null or p_dims = '{}'::jsonb or coalesce(an.map, '{}'::jsonb) @> p_dims)
  order by d.doc_date, d.id, je.line_no, je.id, src.side desc;
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
--
-- Вхід вибірки — той самий `src`, що в `acc_entries` (див. коментар там), лише
-- без боку: з відбором за субконто друга гілка віддає проводки, у яких усі
-- задані пари знайшлися бодай на одному боці — індексом, а не перебором.
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
  -- Валюта й кількість — по боках, як у самій проводці: у конвертації валюти
  -- боків РІЗНІ (Дт USD ← Кт EUR), у складній проводці різні кількості
  -- (2 комплекти ← 6 корпусів), і спільна колонка ховала б половину операції.
  currency_code_debit    varchar,
  currency_amount_debit  numeric,
  currency_code_credit   varchar,
  currency_amount_credit numeric,
  quantity_debit      numeric,
  quantity_credit     numeric,
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
    curd.name, je.currency_amount_debit, curc.name, je.currency_amount_credit,
    je.quantity_debit, je.quantity_credit, je.description,
    coalesce(dan.list, '[]'::jsonb),
    coalesce(can.list, '[]'::jsonb)
  from (
    select je0.id as entry_id
    from app.journal_entry je0
    where p_dims is null or p_dims = '{}'::jsonb
    union all
    select m.journal_entry_id
    from (
      select a.journal_entry_id
      from (
        select d2.key as dimension_code, d2.value::bigint as value_id, d2.value as value_text
        from jsonb_each_text(coalesce(p_dims, '{}'::jsonb)) d2
        where d2.value ~ '^[0-9]{1,18}$'
      ) p
      join app.journal_entry_analytic a
        on a.dimension_code = p.dimension_code
       and a.value_id = p.value_id
      where a.value_id::text = p.value_text
      group by a.journal_entry_id, a.side
      having count(distinct a.dimension_code) = (select count(*) from jsonb_each_text(p_dims))
    ) m
    where p_dims is not null and p_dims <> '{}'::jsonb
    group by m.journal_entry_id
  ) src
  join app.journal_entry je on je.id = src.entry_id
  join app.document d on d.id = je.document_id
  join app.document_type dt on dt.id = d.document_type_id
  left join app.chart_of_account cd on cd.code = je.debit_account
  left join app.chart_of_account cc on cc.code = je.credit_account
  left join app.currency curd on curd.id = je.currency_id_debit
  left join app.currency curc on curc.id = je.currency_id_credit
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

-- ── Сальдо й обороти в розрізі субконто (кілька вимірів) ────────────────────
-- Те саме, що `acc_balance_turnover`, але згруповане ще й за значеннями
-- ПЕРЕЛІЧЕНИХ вимірів: `array['warehouse','nomenclature']` — «скільки чого й
-- ДЕ» одним проходом. Запас живе у двох вимірах (склад × номенклатура), і
-- одновимірний розріз відповідав на це половиною: сума складу без позицій або
-- позиція без складів.
--
-- Розріз їде колонкою `dims jsonb` — об'єкт, ключований КОДОМ виміру:
--   {"warehouse": {"valueId": "3", "valueCode": "01", "presentation": "Основний"},
--    "nomenclature": {...}}
-- Об'єкт, а не масиви по позиціях: звіт дістає значення за ім'ям
-- (`dims->'warehouse'->>'presentation'`), а не за індексом, який мусив би
-- збігатися з порядком параметра.
--
-- Рух, у якого якогось виміру НЕМА, не зникає — його ключа просто немає в
-- об'єкті (рух без жодного — `{}`). Правило успадковане від одновимірного
-- розрізу, і воно там вистраждане: субконто веде не рахунок, а ПРОВОДКА, тож
-- на рахунку з оборотним субконто майже завжди є рухи без нього (уведення
-- залишків, закриття, коригування) — і з `cross join lateral` вони мовчки
-- зникали. Кожен рядок вибірки лишався правильним, неправильною ставала їхня
-- СУМА: рахунок 311 давав 117 500 через `acc_balance_turnover` і 5 500 у
-- розрізі статті руху коштів, а звіряти підсумки нікому. Тепер сума рядків
-- дорівнює сальдо рахунку — властивість, на яку звіт може спиратися; що робити
-- з рядком без виміру — назвати «<не вказано>», згорнути чи відсіяти —
-- вирішує звіт: шар віддає рух, а не подання.
--
-- Порядок: за поданнями вимірів у порядку параметра, потім за рахунком; рядки
-- без виміру — наприкінці (порожній рядок подання).
drop function if exists app.acc_balance_turnover_by_dims(bigint, date, date, varchar[], jsonb, varchar[]);
create function app.acc_balance_turnover_by_dims(
  p_organization_id bigint,
  p_date_from       date default null,
  p_date_to         date default null,
  p_accounts        varchar[] default null,
  p_dims            jsonb default null,
  p_dimension_codes varchar[] default null
)
returns table (
  dims             jsonb,
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
    select
      -- Ключ групи: значення перелічених вимірів цього боку. `coalesce` до
      -- `{}` — jsonb-рівність у group by не терпить null.
      coalesce((
        select jsonb_object_agg(el->>'dimensionCode', jsonb_build_object(
                 'valueId',      el->>'valueId',
                 'valueCode',    el->>'valueCode',
                 'presentation', el->>'presentation'))
        from jsonb_array_elements(e.dims) el
        where el->>'dimensionCode' = any (p_dimension_codes)
      ), '{}'::jsonb) as dim_key,
      e.account, e.account_name, e.doc_date, e.debit, e.credit,
      coalesce(e.quantity_debit,  0::numeric) as quantity_debit,
      coalesce(e.quantity_credit, 0::numeric) as quantity_credit,
      (e.quantity_debit is not null or e.quantity_credit is not null) as has_quantity
    from app.acc_entries(p_organization_id, null, p_date_to, p_accounts, p_dims) e
  ),
  agg as (
    select
      m.dim_key,
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
    group by m.dim_key, m.account
  )
  select
    a.dim_key,
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
  order by (
    select string_agg(coalesce(a.dim_key->u.code->>'presentation', ''), ' ' order by u.ord)
    from unnest(p_dimension_codes) with ordinality as u(code, ord)
  ), a.account;
$$;

-- ── Сальдо й обороти в розрізі ОДНОГО виміру ─────────────────────────────────
-- Обгортка над `acc_balance_turnover_by_dims`: методологія (межа періоду, що
-- вважається рухом, «рух без виміру не зникає») сказана ОДИН раз — там. Форма
-- відповіді лишається плоскою (`value_id`/`value_code`/`value_presentation`),
-- бо на ній стоять наявні звіти: аналіз субконто, картка субконто.
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
  select
    b.dims->p_dimension_code->>'valueId',
    b.dims->p_dimension_code->>'valueCode',
    b.dims->p_dimension_code->>'presentation',
    b.account, b.account_name,
    b.opening_net, b.debit, b.credit, b.closing_net,
    b.opening_quantity, b.quantity_debit, b.quantity_credit, b.closing_quantity
  from app.acc_balance_turnover_by_dims(
         p_organization_id, p_date_from, p_date_to, p_accounts, p_dims,
         array[p_dimension_code]
       ) b
  order by b.dims->p_dimension_code->>'presentation', b.account;
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
