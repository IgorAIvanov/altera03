-- Синтетичний обсяг для заміру шару обчислень (@core/ledger).
--
-- Джерело — стенд прикладників із запису зворотного зв'язку
-- 2026-08-16-acc-entries-dims-filter-not-indexed: ~80 тис. проводок за 2 роки,
-- 500 номенклатур, 2 склади, партія (субконто-документ) у слоті 3 рахунку 281.
-- Гаряча номенклатура 200001 — ~6 000 рухів, холодні — ~90. Метод і числа —
-- docs/ledger-performance.md.
--
-- ТІЛЬКИ ЛОКАЛЬНА ДЕВ-БАЗА. Скрипт вимикає тригери, пише в app.document і
-- app.journal_entry сотнями тисяч рядків і лишає по собі організацію 9001;
-- прибирає це ledger-purge.sql. Автоматичного захисту тут немає — psql його
-- і не має, тож дивись, до чого підключений.
--
--   docker exec -i altera-pg-03 psql -U altera -d altera -q < scripts/bench/ledger-dataset.sql
--
-- ВИМІРИ ТУТ СИНТЕТИЧНІ, і це законно: шар читає ЗНІМКИ аналітики з
-- app.journal_entry_analytic (код, назва, подання лежать у самому рядку) і
-- приєднує лише app.analytic_dimension — по назву виміру. До target_table він
-- не ходить узагалі, тому значення 200001 не мусить існувати в жодному
-- довіднику. Саме тому стенд працює в цьому репозиторії, де номенклатури
-- немає: демо-застосунок фреймворку її не оголошує.

insert into app.analytic_dimension (code, name, entity_kind, model_key, target_table, id_column, code_column, name_column)
values
  ('warehouse',    'Склад (стенд)',        'catalog',  'bench_wh',  'app.organization', 'id', 'code', 'name'),
  ('nomenclature', 'Номенклатура (стенд)', 'catalog',  'bench_nom', 'app.organization', 'id', 'code', 'name'),
  ('batch',        'Партія (стенд)',       'document', 'bench_bat', 'app.document',     'id', 'number', 'presentation')
on conflict (code) do nothing;

insert into app.chart_of_account_analytic (account_code, slot_no, dimension_code)
values ('281', 1, 'warehouse'), ('281', 2, 'nomenclature'), ('281', 3, 'batch')
on conflict do nothing;

insert into app.organization (id, code, name, legal_person_kind)
select 9001, 'BENCH', 'Стендова організація', o.legal_person_kind
from app.organization o limit 1
on conflict (id) do nothing;

alter table app.document disable trigger all;
alter table app.journal_entry disable trigger all;
alter table app.journal_entry_analytic disable trigger all;

insert into app.document (id, document_type_id, organization_id, number, doc_date, total, presentation, is_posted, is_deleted)
select 500000+j, (select min(id) from app.document_type), 9001, 'BR-'||j,
       timestamp '2024-09-01' + ((j*37) % 730) * interval '1 day' + (j % 86399) * interval '1 second',
       1000, 'bench receipt '||j, true, false
from generate_series(1,20000) j;

insert into app.document (id, document_type_id, organization_id, number, doc_date, total, presentation, is_posted, is_deleted)
select 600000+s, (select min(id) from app.document_type), 9001, 'BS-'||s,
       timestamp '2024-09-02' + ((s*53) % 729) * interval '1 day' + (s % 86399) * interval '1 second',
       900, 'bench sale '||s, true, false
from generate_series(1,30000) s;

insert into app.journal_entry (id, document_id, line_no, debit_account, credit_account, amount, quantity_debit, quantity_credit)
select 900000+j, 500000+j, 1, '281','631', 1000, 10, null from generate_series(1,20000) j;
insert into app.journal_entry (id, document_id, line_no, debit_account, credit_account, amount, quantity_debit, quantity_credit)
select 950000+s, 600000+s, 1, '902','281', 600, null, 5 from generate_series(1,30000) s;
insert into app.journal_entry (id, document_id, line_no, debit_account, credit_account, amount)
select 1000000+s, 600000+s, 2, '361','702', 900 from generate_series(1,30000) s;

insert into app.journal_entry_analytic (journal_entry_id, side, slot_no, dimension_code, value_id, value_presentation)
select 900000+j, 'debit', 1, 'warehouse', 9001+(j%2), 'wh' from generate_series(1,20000) j
union all
select 900000+j, 'debit', 2, 'nomenclature',
       case when j<=2000 then 200001 else 200002+(j%499) end, 'nom' from generate_series(1,20000) j
union all
select 900000+j, 'debit', 3, 'batch', 500000+j, 'b' from generate_series(1,20000) j;

insert into app.journal_entry_analytic (journal_entry_id, side, slot_no, dimension_code, value_id, value_presentation)
select 950000+s, 'credit', 1, 'warehouse', 9001+(s%2), 'wh' from generate_series(1,30000) s
union all
select 950000+s, 'credit', 2, 'nomenclature',
       case when s<=4000 then 200001 else 200002+(s%499) end, 'nom' from generate_series(1,30000) s
union all
select 950000+s, 'credit', 3, 'batch', 500001+((s*7)%20000), 'b' from generate_series(1,30000) s;

alter table app.document enable trigger all;
alter table app.journal_entry enable trigger all;
alter table app.journal_entry_analytic enable trigger all;
analyze app.document; analyze app.journal_entry; analyze app.journal_entry_analytic;

select 'bench dataset ready: '||count(*)||' entries' from app.journal_entry where id >= 900000;
