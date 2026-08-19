-- Відбір «цього виміру на боці НЕМАЄ» (`p_absent`): правильність і ціна.
--
-- Випадок принесли прикладники — altera-feedback/wishes/2026-08-18-dims-absence-filter:
-- сальдо розрахунків у розрізі «контрагент + договір», де договір НЕОБОВ'ЯЗКОВИЙ,
-- і `null` там означає значення «без договору», а не «будь-який». Відбір шару
-- працює на входження (`@>`), тож вимогу відсутності ним не висловити, і
-- функція відсіювала рядки поіменно вже після шару, читаючи `e.dims`. А `dims`
-- є лише в широкому вході — тобто те, що ПІДСУМОВУЄ, платило за складання
-- jsonb-аналітики на кожен рух, і саме на шляху проведення: `settlement_offset`
-- кличуть кожна оплата, надходження й відвантаження.
--
--   docker exec -i altera-pg-03 psql -U altera -d altera -q < scripts/bench/ledger-absence.sql
--
-- ЧОМУ ОКРЕМИЙ СКРИПТ, А НЕ ВИПАДКИ В ledger-equivalence.sql. По-перше, свій
-- зріз даних: у наборі ledger-dataset.sql усі три виміри стоять на КОЖНОМУ русі,
-- тож відсутність там нічого не відсіює й перевіряти нічим. По-друге, рівність
-- «до і після» тут неможлива за побудовою — до правки такого виклику не існувало.
-- Тому еталон інший і сильніший: та сама відповідь, порахована ОБХОДОМ, який ця
-- правка й скасовує.
--
-- ТІЛЬКИ ЛОКАЛЬНА ДЕВ-БАЗА. Свій зріз: організація 9002, документи 640000–660000,
-- виміри bench_counterparty/bench_contract. Прибирає ledger-purge.sql.

\set ON_ERROR_STOP on
\pset pager off
\timing off

-- ── Зріз даних: контрагент завжди, договір — не завжди ──────────────────────
-- Коди вимірів із префіксом `bench_` НАВМИСНО. Перша версія стенду назвала їх
-- `counterparty` і `contract` — а `counterparty` це вимір самого застосунку, з
-- живими рядками аналітики в дев-базі. Читанню це не заважало (стенд бере знімки
-- з journal_entry_analytic і до довідника не ходить), зате прибирання пробувало
-- знести чужий вимір: врятував зовнішній ключ, який відкотив усю транзакцію.
-- Тобто стенд мовчки не прибрався б, а на порожнішій базі — прибрав би чуже.
insert into app.analytic_dimension (code, name, entity_kind, model_key, target_table, id_column, code_column, name_column)
values
  ('bench_counterparty', 'Контрагент (стенд)', 'catalog', 'bench_cp', 'app.organization', 'id', 'code', 'name'),
  ('bench_contract',     'Договір (стенд)',    'catalog', 'bench_ct', 'app.organization', 'id', 'code', 'name')
on conflict (code) do nothing;

insert into app.organization (id, code, name)
values (9002, 'BENCH2', 'Стенд відсутності')
on conflict (id) do nothing;

alter table app.document disable trigger all;
alter table app.journal_entry disable trigger all;
alter table app.journal_entry_analytic disable trigger all;

-- Прибрати попередній прогін ПОІМЕННО: з вимкненими тригерами каскад по
-- зовнішньому ключу не спрацьовує, тож самим `delete from document` рядки
-- проводок лишилися б, і другий прогін падав би на первинному ключі.
delete from app.journal_entry_analytic where journal_entry_id between 1100000 and 1120000;
delete from app.journal_entry where id between 1100000 and 1120000;
delete from app.document where id between 640000 and 660000;

insert into app.document (id, document_type_id, organization_id, number, doc_date, total, presentation, is_posted, is_deleted)
select 640000+s, (select min(id) from app.document_type), 9002, 'AB-'||s,
       timestamp '2025-01-02' + ((s*17) % 700) * interval '1 day' + (s % 86399) * interval '1 second',
       100, 'bench settle '||s, true, false
from generate_series(1,20000) s;

insert into app.journal_entry (id, document_id, line_no, debit_account, credit_account, amount)
select 1100000+s, 640000+s, 1, '361', '702', 100 + (s % 97) from generate_series(1,20000) s;

-- Контрагент — на КОЖНОМУ русі, договір — не на кожному. Саме половина без
-- договору і є тим, чого відбором за входженням не дістати.
--
-- Один контрагент навмисно гарячий (700001, ~4 000 рухів проти 40 у решти):
-- ціна обходу — складання jsonb-аналітики на КОЖЕН рух відбору, тож на дрібному
-- контрагенті різниці не побачиш, і стенд показував би «однаково».
--
-- Присутність договору задана модулем 7, а не 2, і це не смак: номер контрагента
-- береться модулем 500, тобто при парному кроці всі рухи одного контрагента
-- мали б однакову парність — і відсутність або відсіювала б усе, або нічого.
insert into app.journal_entry_analytic (journal_entry_id, side, slot_no, dimension_code, value_id, value_presentation)
select 1100000+s, 'debit', 1, 'bench_counterparty',
       case when s <= 4000 then 700001 else 700002+(s % 499) end, 'cp'
from generate_series(1,20000) s
union all
select 1100000+s, 'debit', 2, 'bench_contract', 800001+(s % 37), 'ct'
from generate_series(1,20000) s where s % 7 < 4;

alter table app.document enable trigger all;
alter table app.journal_entry enable trigger all;
alter table app.journal_entry_analytic enable trigger all;
analyze app.document; analyze app.journal_entry; analyze app.journal_entry_analytic;

\echo ''
\echo '########## A1 правильність: шар проти обходу (той самий контрагент) ##########'
-- Еталон — рівно те, чим обходилися: широкий вхід плюс поіменний відсів по dims.
with layer as (
  select count(*) as rows, coalesce(sum(e.debit - e.credit), 0) as net
  from app.acc_entries_agg(9002, null, null, array['361']::varchar[],
         '{"bench_counterparty":"700001"}'::jsonb, array['bench_contract']::varchar[]) e
), workaround as (
  select count(*) as rows, coalesce(sum(e.debit - e.credit), 0) as net
  from app.acc_entries(9002, null, null, array['361']::varchar[],
         '{"bench_counterparty":"700001"}'::jsonb) e
  where not exists (
    select 1 from jsonb_array_elements(e.dims) d where d->>'dimensionCode' = 'bench_contract'
  )
)
select l.rows as layer_rows, l.net as layer_net, w.rows as workaround_rows, w.net as workaround_net,
       case when l.rows = w.rows and l.net = w.net then 'MATCH' else 'DIFFER' end as verdict
from layer l, workaround w;

\echo ''
\echo '########## A2 контроль: без p_absent видно обидві половини ##########'
select count(*) as all_sides,
       count(*) filter (where exists (select 1 from jsonb_array_elements(e.dims) d
                                      where d->>'dimensionCode' = 'bench_contract')) as with_contract
from app.acc_entries(9002, null, null, array['361']::varchar[], '{"bench_counterparty":"700001"}'::jsonb) e;

\echo ''
\echo '########## A3 контроль: відсутність без жодної присутньої пари — порожньо ##########'
select count(*) as rows_returned
from app.acc_entries_agg(9002, null, null, array['361']::varchar[], null, array['bench_contract']::varchar[]);

-- ── Живий шлях: аргументи ВИРАЗОМ, як їх збирає settlement_balance ───────────
create or replace function public.bench_settlement_balance(
  p_organization_id bigint,
  p_counterparty_id bigint,
  p_contract_id     bigint default null
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(e.debit - e.credit), 0::numeric)
  from app.acc_entries_agg(
         p_organization_id, null, null, array['361']::varchar[],
         jsonb_build_object('bench_counterparty', p_counterparty_id::text)
           || case when p_contract_id is null then '{}'::jsonb
                   else jsonb_build_object('bench_contract', p_contract_id::text) end,
         case when p_contract_id is null then array['bench_contract']::varchar[] end
       ) e;
$$;

-- Те саме обходом: широкий вхід і відсів по dims.
create or replace function public.bench_settlement_workaround(
  p_organization_id bigint,
  p_counterparty_id bigint,
  p_contract_id     bigint default null
)
returns numeric
language sql
stable
as $$
  select coalesce(sum(e.debit - e.credit), 0::numeric)
  from app.acc_entries(
         p_organization_id, null, null, array['361']::varchar[],
         jsonb_build_object('bench_counterparty', p_counterparty_id::text)
           || case when p_contract_id is null then '{}'::jsonb
                   else jsonb_build_object('bench_contract', p_contract_id::text) end
       ) e
  where p_contract_id is not null
     or not exists (
          select 1 from jsonb_array_elements(e.dims) d
          where d->>'dimensionCode' = 'bench_contract'
        );
$$;

\echo ''
\echo '########## A4 живий виклик шаром (план і час) ##########'
explain (analyze, costs off, timing off, summary on)
select * from public.bench_settlement_balance(9002, 700001);

\echo ''
\echo '########## A5 живий виклик обходом (план і час) ##########'
explain (analyze, costs off, timing off, summary on)
select * from public.bench_settlement_workaround(9002, 700001);

\echo ''
\echo '########## A6 час: 20 викликів поспіль, шар проти обходу ##########'
-- `700001 + 0*i` — не описка: зі сталим аргументом планувальник виносить виклик
-- STABLE-функції з циклу й рахує його ОДИН раз, тобто «20 викликів» міряли б
-- один. Залежність від лічильника цього не дає.
\timing on
select count(*) from generate_series(1,20) i, lateral public.bench_settlement_balance(9002, 700001 + 0*i) b;
select count(*) from generate_series(1,20) i, lateral public.bench_settlement_balance(9002, 700001 + 0*i) b;
select count(*) from generate_series(1,20) i, lateral public.bench_settlement_balance(9002, 700001 + 0*i) b;
select count(*) from generate_series(1,20) i, lateral public.bench_settlement_workaround(9002, 700001 + 0*i) b;
select count(*) from generate_series(1,20) i, lateral public.bench_settlement_workaround(9002, 700001 + 0*i) b;
select count(*) from generate_series(1,20) i, lateral public.bench_settlement_workaround(9002, 700001 + 0*i) b;
\timing off
