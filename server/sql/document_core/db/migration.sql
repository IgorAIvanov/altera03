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

-- ── Кількість по боках проводки ─────────────────────────────────────────────
-- Кількість — небалансовий вимір, і одна колонка на обидва боки не виражала
-- складної проводки: комплектація (Дт комплект ← Кт компоненти) давала
-- комплекту СУМУ кількостей компонентів. Тепер кількість зберігається окремо
-- по Дт і Кт — модель джерела (регістр бухгалтерії 1С, ресурс balance=false).
--
-- Наповнення — тим самим правилом, яким доти кількість роздавав по боках
-- `acc_entries`: значення дістає бік, чий рахунок його веде (is_quantitative).
-- Стару колонку після перенесення прибираємо: дві правди гірші за міграцію.
alter table if exists app.journal_entry
  add column if not exists quantity_debit numeric(18,3);
alter table if exists app.journal_entry
  add column if not exists quantity_credit numeric(18,3);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'journal_entry' and column_name = 'quantity'
  ) then
    update app.journal_entry je
    set quantity_debit = case when exists (
          select 1 from app.chart_of_account c
          where c.code = je.debit_account and c.is_quantitative
        ) then je.quantity end,
        quantity_credit = case when exists (
          select 1 from app.chart_of_account c
          where c.code = je.credit_account and c.is_quantitative
        ) then je.quantity end
    where je.quantity is not null;

    alter table app.journal_entry drop column quantity;
  end if;
end $$;
