-- Види аналітики (субконто), доступні проводкам.
-- Тут лише ті довідники, що реально є в репозиторії; новий вимір додається
-- рядком нижче одночасно з появою моделі.
--
-- app.document_type НЕ наповнюється тут: типи документів генеруються з
-- manifest.json моделей-документів у _generated/document-types.data.sql.

insert into app.analytic_dimension (
  code, name, entity_kind, model_key, target_table, id_column, code_column, name_column, is_active
)
values
  -- Організації тут немає свідомо: вона реквізит шапки документа, а не субконто.
  ('counterparty', 'Контрагент', 'catalog', 'counterparty', 'app.counterparty', 'id', 'code', 'name', true),
  ('bank',         'Банк',       'catalog', 'bank',         'app.bank',         'id', 'code', 'name', true)
on conflict (code) do update
set
  name         = excluded.name,
  entity_kind  = excluded.entity_kind,
  model_key    = excluded.model_key,
  target_table = excluded.target_table,
  id_column    = excluded.id_column,
  code_column  = excluded.code_column,
  name_column  = excluded.name_column,
  is_active    = excluded.is_active;

-- Які субконто веде рахунок. Тільки конкретні рахунки: на групи проводок
-- не буває, тому рядок для групи був би обманом.
-- Решта рахунків отримає аналітику разом із появою відповідних довідників.

insert into app.chart_of_account_analytic (account_code, slot_no, dimension_code, is_required)
values
  ('311', 1, 'bank',         true),
  ('312', 1, 'bank',         true),
  ('313', 1, 'bank',         true),
  ('314', 1, 'bank',         true),
  ('333', 1, 'counterparty', true),
  ('361', 1, 'counterparty', true),
  ('362', 1, 'counterparty', true),
  ('371', 1, 'counterparty', true),
  ('377', 1, 'counterparty', true),
  ('631', 1, 'counterparty', true),
  ('632', 1, 'counterparty', true),
  ('681', 1, 'counterparty', true),
  ('685', 1, 'counterparty', true)
on conflict (account_code, slot_no) do update
set
  dimension_code = excluded.dimension_code,
  is_required    = excluded.is_required;
