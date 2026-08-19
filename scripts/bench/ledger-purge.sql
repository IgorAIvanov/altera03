-- Прибирання стенду: свої документи (каскадом заберуть проводки й аналітику),
-- свої виміри, свою організацію і знімки рівності.
--
--   docker exec -i altera-pg-03 psql -U altera -d altera -q < scripts/bench/ledger-purge.sql
--
-- Межі прибирання — це межі того, що насіяли ledger-dataset.sql (документи
-- 500000–630000, організація 9001, три коди вимірів) і ledger-absence.sql
-- (документи 640000–660000, організація 9002, коди bench_counterparty/bench_contract). Нічого поза ними не
-- чіпається, тож живі дані дев-бази лишаються на місці.
begin;
delete from app.document where id between 500000 and 630000;
-- Зріз відсутності прибирається поіменно: його сіяли з вимкненими тригерами,
-- тож покладатися на каскад по зовнішньому ключу тут не можна.
delete from app.journal_entry_analytic where journal_entry_id between 1100000 and 1120000;
delete from app.journal_entry where id between 1100000 and 1120000;
delete from app.document where id between 640000 and 660000;
delete from app.chart_of_account_analytic where dimension_code in ('warehouse','nomenclature','batch','bench_counterparty','bench_contract');
delete from app.analytic_dimension where code in ('warehouse','nomenclature','batch','bench_counterparty','bench_contract');
delete from app.organization where id in (9001, 9002);
drop table if exists public.ledger_before;
drop table if exists public.ledger_after;
-- Обгортки живого виклику (ledger-live-call.sql, ledger-absence.sql): вони в
-- public і своїх даних не мають, але лишати їх після стенду ні до чого.
drop function if exists public.bench_live_balance(bigint, varchar, bigint, bigint);
drop function if exists public.bench_settlement_balance(bigint, bigint, bigint);
drop function if exists public.bench_settlement_workaround(bigint, bigint, bigint);
commit;
select 'left in journal: '||count(*)||' entries' from app.journal_entry;
