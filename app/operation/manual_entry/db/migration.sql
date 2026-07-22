-- Валютний облік у рядку операції — колонки додаються до наявної таблиці.
alter table if exists app.manual_entry_line
  add column if not exists currency_id bigint references app.currency (id);
alter table if exists app.manual_entry_line
  add column if not exists currency_amount numeric(18,2);
