-- Міграції ядра документообігу.

-- Валютний облік колись додавався сюди парою колонок currency_id /
-- currency_amount. Той блок ВИТІСНЕНИЙ міграцією «валюта по боках» нижче:
-- лишившись, він повертав би зняті колонки на кожній публікації (`add column
-- if not exists` після `drop column`). База, яка жодної з валютних колонок не
-- бачила, отримує одразу бічні — зі struc.sql.

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

-- Індекс аналітики дістав journal_entry_id і side у ключ: індексний вхід шару
-- обчислень (`acc_entries` з `p_dims`) читає рівно ці колонки, і з двоколонковим
-- визначенням ходив у купу за кожним рухом. Перебудова — за ВИЗНАЧЕННЯМ, як у
-- uq_document_number вище: на чистій базі struc.sql одразу створює
-- чотириколонковий, і чіпати його на кожній публікації не можна.
do $$
begin
  if exists (
    select 1 from pg_indexes
    where schemaname = 'app'
      and indexname = 'ix_journal_entry_analytic_value'
      and indexdef not like '%journal_entry_id%'
  ) then
    execute 'drop index app.ix_journal_entry_analytic_value';
    execute 'create index ix_journal_entry_analytic_value on app.journal_entry_analytic '
         || '(dimension_code, value_id, journal_entry_id, side)';
  end if;
end $$;

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

-- ── Валюта по боках проводки ────────────────────────────────────────────────
-- Той самий клас, що й кількість, лише в парі з валютою: конвертація
-- «Дт 312 USD Кт 314 EUR» має дві валюти й дві суми, а колонка була одна на
-- проводку. Наповнення — за ознакою рахунку (is_currency): значення дістає
-- бік, що веде валюту; обидва ведуть — обидва дістають те саме (переказ
-- усередині однієї валюти саме такий).
alter table if exists app.journal_entry
  add column if not exists currency_id_debit bigint references app.currency (id);
alter table if exists app.journal_entry
  add column if not exists currency_amount_debit numeric(18,2);
alter table if exists app.journal_entry
  add column if not exists currency_id_credit bigint references app.currency (id);
alter table if exists app.journal_entry
  add column if not exists currency_amount_credit numeric(18,2);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'journal_entry' and column_name = 'currency_id'
  ) then
    update app.journal_entry je
    set currency_id_debit = case when exists (
          select 1 from app.chart_of_account c
          where c.code = je.debit_account and c.is_currency
        ) then je.currency_id end,
        currency_amount_debit = case when exists (
          select 1 from app.chart_of_account c
          where c.code = je.debit_account and c.is_currency
        ) then je.currency_amount end,
        currency_id_credit = case when exists (
          select 1 from app.chart_of_account c
          where c.code = je.credit_account and c.is_currency
        ) then je.currency_id end,
        currency_amount_credit = case when exists (
          select 1 from app.chart_of_account c
          where c.code = je.credit_account and c.is_currency
        ) then je.currency_amount end
    where je.currency_id is not null;

    alter table app.journal_entry drop column currency_amount;
    alter table app.journal_entry drop column currency_id;
  end if;
end $$;

-- ── Позначений документ не тримає проводок ──────────────────────────────────
-- Позначка на видалення = скасування проведення (зняв позначку — проводь
-- заново). Доти позначений проведений документ тримав проводки, а «правду»
-- виражав фільтр читання: рядки лежали, звіти їх не бачили, і зняття позначки
-- мовчки повертало рухи. Наявні такі документи приводяться до інваріанта.
--
-- Гард (tr_document_guard) на час чистки вимкнено свідомо: хук застосунку
-- (заборона закритого періоду) відмовив би старим документам і завалив би всю
-- публікацію схеми — а видимих чисел чистка не міняє: рухи позначених і так
-- виключені з кожного звіту умовою «що вважається рухом».
do $$
declare
  r      record;
  v_hook regprocedure;
begin
  if not exists (
    select 1 from app.document where is_deleted and is_posted
  ) then
    return;
  end if;

  alter table app.document disable trigger tr_document_guard;

  for r in
    select d.id, dt.code
    from app.document d
    join app.document_type dt on dt.id = d.document_type_id
    where d.is_deleted and d.is_posted
  loop
    delete from app.journal_entry where document_id = r.id;

    -- Оголошені рухи моделі (чужі таблиці) знімає її власний гак, якщо він є.
    v_hook := to_regprocedure(format('app.%I_unpost_records(bigint, bigint)', r.code));
    if v_hook is not null then
      execute format('select app.%I_unpost_records($1, $2)', r.code)
        using null::bigint, r.id;
    end if;

    update app.document
    set is_posted = false, posted_at = null, posted_by = null
    where id = r.id;
  end loop;

  alter table app.document enable trigger tr_document_guard;
exception when others then
  -- Гард не має лишитися вимкненим ні за яких умов.
  alter table app.document enable trigger tr_document_guard;
  raise;
end $$;
