alter table if exists app.print_template
  add column if not exists paper_size varchar(20) not null default 'A4';

alter table if exists app.print_template
  add column if not exists orientation varchar(20) not null default 'portrait';

alter table if exists app.print_template
  add column if not exists is_default boolean not null default false;

alter table if exists app.print_template
  add column if not exists is_active boolean not null default true;

alter table if exists app.print_template
  add column if not exists template_schema jsonb not null default '{}'::jsonb;

alter table if exists app.print_template
  add column if not exists data_command varchar(80) not null default 'load';

alter table if exists app.print_template
  drop constraint if exists print_template_target_model_check;

update app.print_template
set template_schema = jsonb_build_object(
  'schemaVersion', 2,
  'blocks', jsonb_build_array(
    jsonb_build_object(
      'key', 'title',
      'type', 'text',
      'style', 'title',
      'value', 'Рахунок на оплату постачальника'
    ),
    jsonb_build_object(
      'key', 'document_fields',
      'type', 'field-list',
      'items', jsonb_build_array(
        jsonb_build_object('key', 'counterparty', 'label', 'Постачальник', 'path', 'document.counterpartyName'),
        jsonb_build_object('key', 'organization', 'label', 'Покупець', 'path', 'document.organizationName'),
        jsonb_build_object('key', 'contract', 'label', 'Договір', 'path', 'document.counterpartyContractName'),
        jsonb_build_object('key', 'incoming', 'label', 'Вхідний документ', 'path', 'document.incomingDocument')
      )
    ),
    jsonb_build_object(
      'key', 'lines',
      'type', 'table',
      'title', 'Склад рахунку',
      'source', 'document.lines',
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'index', 'title', '№', 'path', 'index', 'widthPercent', '6', 'align', 'center'),
        jsonb_build_object('key', 'name', 'title', 'Найменування', 'path', 'name', 'widthPercent', '42', 'align', 'left'),
        jsonb_build_object('key', 'unit', 'title', 'Од.', 'path', 'unit', 'widthPercent', '10', 'align', 'center'),
        jsonb_build_object('key', 'quantity', 'title', 'Кількість', 'path', 'quantity', 'widthPercent', '12', 'align', 'right'),
        jsonb_build_object('key', 'price', 'title', 'Ціна', 'path', 'price', 'widthPercent', '15', 'align', 'right'),
        jsonb_build_object('key', 'amount', 'title', 'Сума', 'path', 'amount', 'widthPercent', '15', 'align', 'right')
      )
    )
  )
),
updated_at = now()
where code = 'supplier_invoice_default'
  and coalesce(template_schema->>'schemaVersion', '') <> '2';

create unique index if not exists idx_print_template_one_default_per_model
  on app.print_template(target_model)
  where is_default;