insert into app.document_types (code, name, short_name, sort_order)
values
  ('manual_entry', 'Операція (бухгалтерська)', 'Операція', 10),
  ('supplier_invoice', 'Рахунок на оплату постачальника', 'Рах.пост.', 65)
on conflict (code) do update
set
  name = excluded.name,
  short_name = excluded.short_name,
  sort_order = excluded.sort_order;

insert into app.analytic_dimensions (
  code,
  name,
  entity_kind,
  model_key,
  default_view,
  target_table,
  document_type_code,
  id_column,
  code_column,
  name_column,
  presentation_column,
  is_active
)
values
  ('organization', 'Організація', 'catalog', 'organization', 'edit', 'app.organization', null, 'id', null, 'name', 'name', true),
  ('counterparty', 'Контрагент', 'catalog', 'counterparty', 'edit', 'app.counterparties', null, 'id', 'code', 'name', 'name', true),
  ('currency', 'Валюта', 'catalog', 'currency', 'edit', 'app.currency', null, 'id', 'code', 'name', 'name', true),
  ('bank', 'Банк', 'catalog', 'bank', 'edit', 'app.bank', null, 'id', 'code', 'name', 'name', true),
  ('bank_account', 'Банківський рахунок', 'catalog', 'bank_account', 'edit', 'app.bank_accounts', null, 'id', 'code', 'name', 'name', true),
  ('counterparty_contract', 'Договір контрагента', 'catalog', 'counterparty_contract', 'edit', 'app.counterparty_contracts', null, 'id', 'code', 'name', 'name', true),
  ('physical_person', 'Фізична особа', 'catalog', 'physical_person', 'edit', 'app.physical_person', null, 'id', 'code', 'name', 'name', true),
  ('unit_classifier', 'Одиниця виміру', 'catalog', 'unit_classifier', 'edit', 'app.unit_classifier', null, 'id', 'code', 'name', 'name', true),
  ('nomenclature', 'Номенклатура', 'catalog', 'nomenclature', 'edit', 'app.nomenclature', null, 'id', 'code', 'name', 'name', true),
  ('nomenclature_group', 'Номенклатурна група', 'catalog', 'nomenclature_group', 'edit', 'app.nomenclature_group', null, 'id', 'code', 'name', 'name', true),
  ('expense_item', 'Стаття витрат', 'catalog', 'expense_item', 'edit', 'app.expense_item', null, 'id', 'code', 'name', 'name', true),
  ('income_item', 'Стаття доходів', 'catalog', 'income_item', 'edit', 'app.income_item', null, 'id', 'code', 'name', 'name', true),
  ('cash_flow_item', 'Стаття руху коштів', 'catalog', 'cash_flow_item', 'edit', 'app.cash_flow_item', null, 'id', 'code', 'name', 'name', true),
  ('price_type', 'Тип цін', 'catalog', 'price_type', 'edit', 'app.price_type', null, 'id', 'code', 'name', 'name', true),
  ('tax_activity_kind', 'Вид податкової діяльності', 'catalog', 'tax_activity_kind', 'edit', 'app.tax_activity_kind', null, 'id', 'code', 'name', 'name', true),
  ('tax', 'Податок', 'catalog', 'tax', 'edit', 'app.tax', null, 'id', 'code', 'name', 'name', true),
  ('tax_declaration_item', 'Стаття декларації', 'catalog', 'tax_declaration_item', 'edit', 'app.tax_declaration_item', null, 'id', 'code', 'name', 'name', true),
  ('reserve', 'Резерв', 'catalog', 'reserve', 'edit', 'app.reserve', null, 'id', 'code', 'name', 'name', true),
  ('tax_purpose', 'Призначення оподаткування', 'catalog', 'tax_purpose', 'edit', 'app.tax_purpose', null, 'id', 'code', 'name', 'name', true),
  ('construction_object', 'Об''єкт будівництва', 'catalog', 'construction_object', 'edit', 'app.construction_object', null, 'id', 'code', 'name', 'name', true),
  ('intangible_asset', 'Нематеріальний актив', 'catalog', 'intangible_asset', 'edit', 'app.intangible_asset', null, 'id', 'code', 'name', 'name', true),
  ('organization_department', 'Підрозділ організації', 'catalog', 'organization_department', 'edit', 'app.organization_department', null, 'id', 'code', 'name', 'name', true),
  ('warehouse', 'Склад', 'catalog', 'warehouse', 'edit', 'app.warehouse', null, 'id', 'code', 'name', 'name', true),
  ('manual_entry', 'Операція (бухгалтерська)', 'document', 'manual_entry', 'edit', 'app.documents', 'manual_entry', 'id', 'number', 'description', 'number', true),
  ('supplier_invoice', 'Рахунок постачальника', 'document', 'supplier_invoice', 'edit', 'app.documents', 'supplier_invoice', 'id', 'number', 'description', 'number', true)
on conflict (code) do update
set
  name = excluded.name,
  entity_kind = excluded.entity_kind,
  model_key = excluded.model_key,
  default_view = excluded.default_view,
  target_table = excluded.target_table,
  document_type_code = excluded.document_type_code,
  id_column = excluded.id_column,
  code_column = excluded.code_column,
  name_column = excluded.name_column,
  presentation_column = excluded.presentation_column,
  is_active = excluded.is_active;
