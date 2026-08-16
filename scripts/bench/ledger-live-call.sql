-- Живий шлях виклику шару: `p_dims` — ОБЧИСЛЮВАНИЙ вираз, а не літерал.
--
-- Чому окремий випадок. Решта стенда кличе `acc_entries` прямо з psql, тобто
-- завжди з літеральним `p_dims`. У такому виклику мертва гілка `union all`
-- згортається ще на плануванні, і план виходить не той, що на живому шляху:
-- застосунок кличе шар із СВОЄЇ функції, а та збирає відбір виразом
-- (`jsonb_build_object('nomenclature', …) || case when … end`). Після
-- вбудовування це не константа, гілка лишається в плані, і її оцінка —
-- «увесь журнал × 2 боки» — їде в `Append` цілком.
--
-- Стенд 0.21.2 цього не бачив саме тому, що міряв прямі виклики. Випадок
-- принесли прикладники:
-- altera-feedback/gaps/2026-08-16-acc-entries-dims-dead-branch-estimate.md
--
--   docker exec -i altera-pg-03 psql -U altera -d altera -q < scripts/bench/ledger-live-call.sql
--
-- Функція повторює `app.inventory_balance` altera-buh: та сама форма аргументу,
-- та сама роль — добір собівартості, який проведення кличе НА КОЖЕН РЯДОК
-- документа.

\set ON_ERROR_STOP on
\pset pager off
\timing off

create or replace function public.bench_live_balance(
  p_organization_id bigint,
  p_account         varchar,
  p_nomenclature_id bigint,
  p_warehouse_id    bigint default null
)
returns table (quantity numeric, amount numeric)
language sql
stable
as $$
  select
    coalesce(sum(coalesce(e.quantity_debit, 0) - coalesce(e.quantity_credit, 0)), 0::numeric),
    coalesce(sum(e.debit - e.credit), 0::numeric)
  from app.acc_entries(
         p_organization_id,
         null,
         null,
         array[p_account]::varchar[],
         jsonb_build_object('nomenclature', p_nomenclature_id::text)
           || case when p_warehouse_id is null then '{}'::jsonb
                   else jsonb_build_object('warehouse', p_warehouse_id::text) end
       ) e;
$$;

\echo ''
\echo '########## L1 живий виклик: p_dims виразом (холодна номенклатура) ##########'
explain (analyze, costs on, timing off, summary on)
select * from public.bench_live_balance(9001, '281', 200100);

\echo ''
\echo '########## L2 те саме значення, але p_dims ЛІТЕРАЛОМ ##########'
explain (analyze, costs on, timing off, summary on)
select coalesce(sum(e.debit - e.credit), 0::numeric)
from app.acc_entries(9001, null, null, array['281']::varchar[], '{"nomenclature":"200100"}'::jsonb) e;

\echo ''
\echo '########## L3 час: 20 живих викликів поспіль (як 20 рядків документа) ##########'
\timing on
select count(*) from generate_series(1, 20) i, lateral public.bench_live_balance(9001, '281', 200100) b;
select count(*) from generate_series(1, 20) i, lateral public.bench_live_balance(9001, '281', 200100) b;
select count(*) from generate_series(1, 20) i, lateral public.bench_live_balance(9001, '281', 200100) b;
\timing off

\echo ''
\echo '########## L4 контроль: живий виклик БЕЗ відбору не мусить постраждати ##########'
\timing on
select count(*) from (select * from app.acc_entries(9001, null, null, null, null)) x;
select count(*) from (select * from app.acc_entries(9001, null, null, null, null)) x;
\timing off
