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

-- ── Вимір «Банк»: код банку лежить у mfo, а не в code ───────────────────────
-- Сід виміру обіцяв колонку `code`, якої в app.bank немає й ніколи не було
-- (кодом банку є МФО — див. app/catalog/bank/db/struc.sql). Запит на субконто
-- app.doc_analytic_set будує ДИНАМІЧНО, тому розходження не видно ні при
-- публікації схеми, ні при записі документа — воно вилазить аж при проведенні
-- проводки по рахунках 311–314:
--   ERROR: column "code" does not exist
--
-- Міняємо адресно, і не лише за значенням, яке поклав сід, а за ФАКТОМ: колонки
-- `code` в таблиці немає, а `mfo` є. Без цієї перевірки правка ламала б рівно ті
-- установки, де вона не потрібна, — застосунок зі своїм `app.bank`, у якого
-- колонка `code` справжня, дістав би опис на неіснуючу `mfo`, і публікація впала б
-- на тригері. Установка, яка вже описала свій довідник по-своєму, теж лишається як є.
update app.analytic_dimension
set code_column = 'mfo'
where code = 'bank'
  and target_table = 'app.bank'
  and code_column = 'code'
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'bank' and column_name = 'code'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'bank' and column_name = 'mfo'
  );
