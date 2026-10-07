-- Валютний облік у рядку операції — колонки додаються до наявної таблиці.
alter table if exists app.manual_entry_line
  add column if not exists currency_id bigint references app.currency (id);
alter table if exists app.manual_entry_line
  add column if not exists currency_amount numeric(18,2);

-- Документ-підстава («Створити на підставі»).
alter table if exists app.manual_entry
  add column if not exists base_document_id bigint references app.document (id);
create index if not exists ix_manual_entry_base_document on app.manual_entry (base_document_id);
