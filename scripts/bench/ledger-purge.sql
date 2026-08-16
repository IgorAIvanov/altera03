-- Прибирання стенду: свої документи (каскадом заберуть проводки й аналітику),
-- свої виміри, свою організацію і знімки рівності.
--
--   docker exec -i altera-pg-03 psql -U altera -d altera -q < scripts/bench/ledger-purge.sql
--
-- Межі прибирання — це межі того, що насіяв ledger-dataset.sql: діапазон id
-- документів 500000–630000 і три коди вимірів. Нічого поза ними не чіпається,
-- тож живі дані дев-бази лишаються на місці.
begin;
delete from app.document where id between 500000 and 630000;
delete from app.chart_of_account_analytic where dimension_code in ('warehouse','nomenclature','batch');
delete from app.analytic_dimension where code in ('warehouse','nomenclature','batch');
delete from app.organization where id = 9001;
drop table if exists public.ledger_before;
drop table if exists public.ledger_after;
commit;
select 'left in journal: '||count(*)||' entries' from app.journal_entry;
