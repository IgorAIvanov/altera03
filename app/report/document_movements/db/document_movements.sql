-- ═══════════════════════════════════════════════════════════════════════════
-- Рух документа: усі проводки, які документ зробив у регістрі.
--
-- Зворотний бік drill-down: картка рахунку веде сюди за documentId, а звідси
-- відкривається сама форма документа. Показує проводки як вони лежать у
-- app.journal_entry — зі знімками субконто, тобто такими, якими вони були на
-- момент проведення.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists app.document_movements_index(bigint, jsonb);
create function app.document_movements_index(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  with params as (
    select nullif(payload->>'documentId', '')::bigint as document_id
  ),
  doc as (
    select
      d.id::text            as "documentId",
      dt.code               as "documentTypeCode",
      coalesce(dt.short_name, dt.name) as "documentTypeName",
      d.number              as "number",
      d.doc_date::text      as "docDate",
      d.total               as "total",
      d.presentation        as "presentation",
      d.is_posted           as "isPosted",
      o.name                as "organizationName"
    from params p
    join app.document d on d.id = p.document_id
    join app.document_type dt on dt.id = d.document_type_id
    join app.organization o on o.id = d.organization_id
  ),
  analytics as (
    select
      jea.journal_entry_id,
      jea.side,
      jsonb_agg(jsonb_build_object(
        'dimensionName', d.name,
        'modelKey',      d.model_key,
        'valueId',       jea.value_id::text,
        'presentation',  jea.value_presentation
      ) order by jea.slot_no) as items
    from app.journal_entry_analytic jea
    join app.analytic_dimension d on d.code = jea.dimension_code
    group by jea.journal_entry_id, jea.side
  ),
  rows as (
    select
      je.line_no            as "lineNo",
      je.debit_account      as "debitAccount",
      coalesce(da.name, '') as "debitAccountName",
      coalesce(dr.items, '[]'::jsonb) as "debitAnalytics",
      je.credit_account     as "creditAccount",
      coalesce(ca.name, '') as "creditAccountName",
      coalesce(cr.items, '[]'::jsonb) as "creditAnalytics",
      je.amount             as "amount",
      cur.code              as "currencyCode",
      je.currency_amount    as "currencyAmount",
      je.quantity           as "quantity",
      je.description        as "description"
    from params p
    join app.journal_entry je on je.document_id = p.document_id
    left join app.chart_of_account da on da.code = je.debit_account
    left join app.chart_of_account ca on ca.code = je.credit_account
    left join app.currency cur on cur.id = je.currency_id
    left join analytics dr on dr.journal_entry_id = je.id and dr.side = 'debit'
    left join analytics cr on cr.journal_entry_id = je.id and cr.side = 'credit'
    order by je.line_no, je.id
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((select jsonb_agg(to_jsonb(rows)) from rows), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', jsonb_build_object(
        'amount', coalesce((select sum("amount") from rows), 0)
      ),
      'extra', jsonb_build_object(
        'document', coalesce((select to_jsonb(doc) from doc), '{}'::jsonb)
      )
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
$$;
