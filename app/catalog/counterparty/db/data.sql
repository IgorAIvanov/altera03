-- Контрагент як субконто: вимір оголошує САМА модель — це її довідник, і опис
-- його колонок належить їй, а не ядру (доти рядок стояв у сіді
-- `@core/document_core` разом з іменем таблиці застосунку).
--
-- `do nothing`, а не `do update`: сід дає умовчання, далі опис належить
-- установці — та сама межа, що в нумераторах і шаблонах друку. Виправлення в
-- цьому рядку на вже налаштовану базу не поїде; такі правки робить
-- migration.sql, і робить адресно.
insert into app.analytic_dimension (
  code, name, entity_kind, model_key, target_table, id_column, code_column, name_column, is_active
) values
  ('counterparty', 'Контрагент', 'catalog', 'counterparty', 'app.counterparty', 'id', 'code', 'name', true)
on conflict (code) do nothing;
