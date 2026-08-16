-- Рівність результатів шару: знімок «кейс → (кількість рядків, md5 усіх рядків)».
--
-- Сенс саме в ПАРНОМУ прогоні: знімок знімається ДО правки шару й ПІСЛЯ, і
-- дайджести мусять збігтися до останнього рядка. Швидкодія — окреме питання
-- (ledger-timing.sql); тут перевіряється, що вона не куплена зміною відповіді.
--
--   psql ... -v tbl=ledger_before < scripts/bench/ledger-equivalence.sql   -- до правки
--   psql ... -v tbl=ledger_after  < scripts/bench/ledger-equivalence.sql   -- після
--   psql ... -f scripts/bench/ledger-compare.sql
--
-- Дайджест береться з упорядкованої склейки рядків, тож він нечутливий до
-- порядку вибірки, але чутливий до будь-якої зміни значення. Метод і числа —
-- docs/ledger-performance.md.

drop table if exists public.:"tbl";
create table public.:"tbl" (case_id text primary key, note text, row_count bigint, digest text);

-- A: без відбору за субконто — весь журнал організації (гілка «усі пари»)
insert into public.:"tbl" select 'A', 'повний журнал, без p_dims', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_entries(9001,null,null,null,null)) x;
-- B: гаряча номенклатура (~6 000 рухів) — індексний вхід
insert into public.:"tbl" select 'B', 'гаряча номенклатура', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_entries(9001,null,null,array['281'],'{"nomenclature":"200001"}')) x;
-- C: холодна номенклатура (~90 рухів)
insert into public.:"tbl" select 'C', 'холодна номенклатура', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_entries(9001,null,null,array['281'],'{"nomenclature":"200100"}')) x;
-- D: маловибірковий вимір (склад — половина журналу) + період
insert into public.:"tbl" select 'D', 'склад + період', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_entries(9001,'2025-01-01','2025-12-31',null,'{"warehouse":"9001"}')) x;
-- E: дві пари одразу — перетин, а не об'єднання
insert into public.:"tbl" select 'E', 'дві пари (склад + номенклатура)', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_entries(9001,null,null,null,'{"warehouse":"9001","nomenclature":"200001"}')) x;
-- F: нечислове значення пари — id таким бути не може, отже порожньо (як у `@>`)
insert into public.:"tbl" select 'F', 'нечислове значення пари', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_entries(9001,null,null,null,'{"nomenclature":"abc"}')) x;
-- G: неканонічна форма id ('0200001') — у `@>` не збігалася, тут теж не має
insert into public.:"tbl" select 'G', 'неканонічний id', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_entries(9001,null,null,null,'{"nomenclature":"0200001"}')) x;
-- H: `{}` — відбору немає, мусить збігтися з A
insert into public.:"tbl" select 'H', 'порожній p_dims = без відбору', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_entries(9001,null,null,null,'{}'::jsonb)) x;
-- I: сальдо й обороти за місяць з відбором (успадковує вхід від acc_entries)
insert into public.:"tbl" select 'I', 'ОСВ за місяць з відбором', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_balance_turnover(9001,'2025-06-01','2025-06-30',null,'{"nomenclature":"200001"}')) x;
-- J: звіт у трьох розрізах за місяць, без відбору
insert into public.:"tbl" select 'J', 'три розрізи за місяць', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_balance_turnover_by_dims(9001,'2025-06-01','2025-06-30',array['281'],null,array['warehouse','nomenclature','batch'])) x;
-- K: журнал проводок з відбором за субконто («хоч один бік»)
insert into public.:"tbl" select 'K', 'acc_journal з відбором', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_journal(9001,null,null,null,'{"nomenclature":"200001"}')) x;
-- L: журнал проводок без відбору
insert into public.:"tbl" select 'L', 'acc_journal без відбору', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_journal(9001,null,null,array['281'],null)) x;
-- M: залишки по партіях гарячої номенклатури — шлях ФІФО
insert into public.:"tbl" select 'M', 'залишки по партіях (ФІФО)', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (select * from app.acc_balance_turnover_by_dims(9001,null,null,array['281'],'{"nomenclature":"200001"}',array['batch'])) x;
-- N: ЖИВІ дані репозиторію (не стендові): перша реальна пара субконто, виклик
--    lateral'ом — так шар кличуть звіти й добір собівартості
insert into public.:"tbl" select 'N', 'живі дані, виклик lateral', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text),''))
from (
  select e.* from (
    select d.organization_id as org, a.dimension_code, a.value_id
    from app.journal_entry_analytic a
    join app.journal_entry je on je.id = a.journal_entry_id
    join app.document d on d.id = je.document_id
    where a.journal_entry_id < 900000
    order by a.journal_entry_id limit 1
  ) pick
  cross join lateral app.acc_entries(pick.org, null, null, null,
    jsonb_build_object(pick.dimension_code, pick.value_id::text)) e
) x;

select case_id, note, row_count, digest from public.:"tbl" order by case_id;
