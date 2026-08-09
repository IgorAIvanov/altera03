alter table if exists app.bank
  add column if not exists mfo varchar(6);

-- Кодом банку стає МФО (див. docs/numbering-plan.md, крок 6): колонка code
-- була дублем. Значення переносяться, code зникає разом зі своєю унікальністю.
-- Якщо на живій базі два банки ділили одне МФО, створення uq_bank_mfo впаде —
-- і це правильно: такий дубль треба розібрати руками, а не сховати.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'app' and table_name = 'bank' and column_name = 'code')
  then
    update app.bank set mfo = code where nullif(trim(coalesce(mfo, '')), '') is null;
    drop index if exists app.uq_bank_code;
    alter table app.bank drop column code;
  end if;
end $$;

alter table app.bank alter column mfo set not null;

-- Ім'я індексу — джерело поля форми при відмові: uq_bank_mfo → mfo.
create unique index if not exists uq_bank_mfo on app.bank (mfo);
drop index if exists app.ix_bank_mfo;
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
