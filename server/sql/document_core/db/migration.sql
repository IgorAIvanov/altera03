-- Міграції ядра документообігу.

-- Валютний облік: колонки додаються до вже наповненого регістру, тому окремою
-- міграцією, а не тільки в struc.sql (нові БД отримають їх звідти).
alter table if exists app.journal_entry
  add column if not exists currency_id bigint references app.currency (id);
alter table if exists app.journal_entry
  add column if not exists currency_amount numeric(18,2);

-- Унікальність номера стала річною: у ключ додався рік дати документа.
--
-- Через `if not exists` у struc.sql сам індекс не оновиться — ім'я вже зайняте,
-- і крок структури мовчки його пропустить. Тому перебудова тут, і саме за
-- ВИЗНАЧЕННЯМ, а не за наявністю: інакше на чистій базі індекс перестворювався б
-- при кожній публікації.
--
-- Розширення ключа робить унікальність слабшою, а не суворішою, тож на наявних
-- даних перебудова безпечна: те, що проходило раніше, пройде й тепер.
do $$
begin
  if exists (
    select 1 from pg_indexes
    where schemaname = 'app'
      and indexname = 'uq_document_number'
      and indexdef not like '%date_trunc%'
  ) then
    execute 'drop index app.uq_document_number';
    execute 'create unique index uq_document_number on app.document '
         || '(document_type_id, organization_id, number, date_trunc(''year'', doc_date))';
  end if;
end
$$;

-- Виправлення опису виміру «Банк» жило тут і переїхало в застосунок
-- (`app/catalog/bank/db/migration.sql`): воно лікує рядок про ЙОГО довідник, а в
-- пакеті ядра імені прикладної таблиці бути не має. Установка без банківського
-- довідника не мусить навіть читати цей рядок.

-- ── Однобічна проводка: забалансовий облік ──────────────────────────────────
-- `create table if not exists` наявну таблицю не змінює, тож послаблення
-- обов'язковості робиться тут. Послаблення, а не звуження: усе, що проходило
-- раніше, проходить і тепер, і на наявних даних міграція безпечна.
alter table if exists app.journal_entry alter column debit_account  drop not null;
alter table if exists app.journal_entry alter column credit_account drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.journal_entry'::regclass and conname = 'ck_journal_entry_sides'
  ) then
    alter table app.journal_entry
      add constraint ck_journal_entry_sides check (num_nonnulls(debit_account, credit_account) >= 1);
  end if;
end $$;
