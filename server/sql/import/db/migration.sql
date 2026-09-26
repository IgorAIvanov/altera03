-- Міграції пакета import.

-- ── Імена й ключі джерела — без обмеження довжини ───────────────────────────
-- Перша версія схеми мала `ref varchar(100)`, `kind`/`query varchar(200)`. Ці
-- рядки складає джерело, а не ми: у ТИПОВІЙ BAS Бухгалтерії повне ім'я
-- табличної частини сягає 115 знаків, ім'я реквізиту 1С — до 80, а ключ
-- рішення про реквізит частини складається з обох. Відмова приходила на першій
-- же частині партії (`value too long for type character varying(100)`).
--
-- varchar → text у PostgreSQL двійково сумісні: таблиця не переписується, і
-- крок на наявних даних безпечний. Умова на тип — щоб повторна публікація
-- нічого не чіпала.
do $$
declare
  r record;
begin
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
     where c.table_schema = 'app'
       and (c.table_name, c.column_name) in (
             ('source_batch', 'query'),
             ('source_object', 'kind'), ('source_object', 'ref'),
             ('source_row', 'query'),
             ('source_decision', 'kind'), ('source_decision', 'ref'),
             ('source_ref', 'kind'), ('source_ref', 'ref'))
       and c.data_type = 'character varying'
  loop
    execute format('alter table app.%I alter column %I type text', r.table_name, r.column_name);
  end loop;
end
$$;
