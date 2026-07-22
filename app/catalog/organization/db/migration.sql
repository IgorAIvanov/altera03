-- Логотип організації. Для баз, створених до появи підсистеми вкладень:
-- create table … if not exists у struc.sql існуючу таблицю не змінює.
alter table app.organization
  add column if not exists logo_id bigint references app.attachment(id) on delete set null;
