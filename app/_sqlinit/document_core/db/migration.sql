-- Міграції ядра документообігу.

-- Валютний облік: колонки додаються до вже наповненого регістру, тому окремою
-- міграцією, а не тільки в struc.sql (нові БД отримають їх звідти).
alter table if exists app.journal_entry
  add column if not exists currency_id bigint references app.currency (id);
alter table if exists app.journal_entry
  add column if not exists currency_amount numeric(18,2);
