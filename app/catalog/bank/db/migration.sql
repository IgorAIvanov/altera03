alter table if exists app.bank
  add column if not exists mfo varchar(6);
-- Позначка на видалення замість ознаки активності.
-- Сенс ІНВЕРТУЄТЬСЯ: is_active = true (видимий) → is_deleted = false.
-- Просте перейменування колонки оголосило б усі активні записи позначеними.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'app' and table_name = 'bank' and column_name = 'is_active')
  then
    alter table app.bank add column if not exists is_deleted boolean not null default false;
    update app.bank set is_deleted = not is_active;
    drop index if exists app.ix_bank_is_active;
    alter table app.bank drop column is_active;
  end if;
end $$;

-- Індекс створюємо ТУТ, а не в struc.sql, і це не примха: секція структури
-- виконується РАНІШЕ за міграції, а на наявній базі колонка `is_deleted`
-- з'являється саме міграцією. `create index` у struc.sql падав би на колонці,
-- якої ще немає («column "is_deleted" does not exist»), і публікація зупинялася б
-- на першій же таблиці. Тут колонка є в обох випадках — і на новій базі
-- (створена struc.sql), і на наявній (додана вище).
create index if not exists ix_bank_is_deleted on app.bank (is_deleted);
