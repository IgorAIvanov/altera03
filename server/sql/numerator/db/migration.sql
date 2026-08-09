-- Міграції нумератора.

-- Період лічильника. Спершу він виводився з шаблона («є {YY} — значить щороку»),
-- і це виявилося хибним: нумерація в межах року потрібна майже всім, а рік у
-- самому номері друкують далеко не всі — виведення з шаблона змушувало б їх
-- вибирати між форматом номера й обліковим правилом. Тепер період оголошується
-- явно, а унікальність тримає індекс по даті документа (uq_document_number).
alter table if exists app.numerator
  add column if not exists period varchar(10) not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_numerator_period'
  ) then
    alter table app.numerator
      add constraint ck_numerator_period check (period in ('none', 'year', 'month'));
  end if;
end
$$;

-- Джерело пересіву (див. struc.sql): значення наповнить сід нумераторів цієї ж
-- публікації — він оновлює структурні поля при кожному деплої.
alter table if exists app.numerator
  add column if not exists source_table       varchar(100),
  add column if not exists source_column      varchar(100),
  add column if not exists source_org_column  varchar(100),
  add column if not exists source_date_column varchar(100),
  add column if not exists source_filter      text;
