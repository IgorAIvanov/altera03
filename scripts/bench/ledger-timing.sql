-- Швидкодія шару на стендовому обсязі. Кожен випадок тричі: перший прогін
-- гріє кеш, до протоколу йде останній. Числа — docs/ledger-performance.md.
--
--   docker exec -i altera-pg-03 psql -U altera -d altera -q < scripts/bench/ledger-timing.sql
\timing on

\echo === T1 гаряча номенклатура, ~6 000 рухів (acc_entries) ===
select count(*) from (select * from app.acc_entries(9001,null,null,array['281'],'{"nomenclature":"200001"}')) x;
select count(*) from (select * from app.acc_entries(9001,null,null,array['281'],'{"nomenclature":"200001"}')) x;
select count(*) from (select * from app.acc_entries(9001,null,null,array['281'],'{"nomenclature":"200001"}')) x;

\echo === T2 холодна номенклатура, ~90 рухів ===
select count(*) from (select * from app.acc_entries(9001,null,null,array['281'],'{"nomenclature":"200100"}')) x;
select count(*) from (select * from app.acc_entries(9001,null,null,array['281'],'{"nomenclature":"200100"}')) x;
select count(*) from (select * from app.acc_entries(9001,null,null,array['281'],'{"nomenclature":"200100"}')) x;

\echo === T3 залишки по партіях гарячої номенклатури (шлях ФІФО) ===
select count(*) from app.acc_balance_turnover_by_dims(9001,null,null,array['281'],'{"nomenclature":"200001"}',array['batch']);
select count(*) from app.acc_balance_turnover_by_dims(9001,null,null,array['281'],'{"nomenclature":"200001"}',array['batch']);
select count(*) from app.acc_balance_turnover_by_dims(9001,null,null,array['281'],'{"nomenclature":"200001"}',array['batch']);

\echo === T4 ОСВ за місяць з відбором ===
select count(*) from app.acc_balance_turnover(9001,'2025-06-01','2025-06-30',null,'{"nomenclature":"200001"}');
select count(*) from app.acc_balance_turnover(9001,'2025-06-01','2025-06-30',null,'{"nomenclature":"200001"}');
select count(*) from app.acc_balance_turnover(9001,'2025-06-01','2025-06-30',null,'{"nomenclature":"200001"}');

\echo === T5 БЕЗ відбору: повний журнал (контроль регресії — не мусить змінитися) ===
select md5(coalesce(string_agg(x::text, E'\n' order by x::text),'')) from (select * from app.acc_entries(9001,null,null,null,null)) x;
select md5(coalesce(string_agg(x::text, E'\n' order by x::text),'')) from (select * from app.acc_entries(9001,null,null,null,null)) x;

\echo === T6 БЕЗ відбору: три розрізи за місяць (контроль регресії) ===
select count(*) from app.acc_balance_turnover_by_dims(9001,'2025-06-01','2025-06-30',array['281'],null,array['warehouse','nomenclature','batch']);
select count(*) from app.acc_balance_turnover_by_dims(9001,'2025-06-01','2025-06-30',array['281'],null,array['warehouse','nomenclature','batch']);
