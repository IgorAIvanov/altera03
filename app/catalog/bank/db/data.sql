insert into app.bank (mfo, name, is_deleted) values
  ('300346', 'НБУ (Національний банк України)',             false),
  ('300007', 'АТ "Ощадбанк"',                               false),
  ('300023', 'АТ "Укрексімбанк"',                           false),
  ('305299', 'АТ КБ "ПриватБанк"',                          false),
  ('300730', 'АТ "Райффайзен Банк"',                        false),
  ('380805', 'АТ "ПУМБ"',                                   false),
  ('320649', 'АТ "Укрсиббанк"',                             false),
  ('351774', 'АТ "Банк Кредит Дніпро"',                     false),
  ('322001', 'АТ "А-Банк"',                                 false),
  ('335784', 'АТ "Мегабанк"',                               false)
on conflict (mfo) do nothing;

-- Банк як субконто: вимір оголошує САМА модель — це її довідник, і опис його
-- колонок належить їй, а не ядру. Кодом банку є МФО: окремої колонки `code` в
-- app.bank немає (див. struc.sql поруч).
--
-- `do nothing`, а не `do update`: сід дає умовчання, далі опис належить
-- установці — та сама межа, що в нумераторах і шаблонах друку. Виправлення в
-- цьому рядку на вже налаштовану базу не поїде; такі правки робить
-- migration.sql, і робить адресно.
insert into app.analytic_dimension (
  code, name, entity_kind, model_key, target_table, id_column, code_column, name_column, is_active
) values
  ('bank', 'Банк', 'catalog', 'bank', 'app.bank', 'id', 'mfo', 'name', true)
on conflict (code) do nothing;
