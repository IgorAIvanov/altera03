-- ═══════════════════════════════════════════════════════════════════════════
-- Рух документа: усі проводки, які документ зробив у регістрі.
--
-- Зворотний бік drill-down: картка рахунку веде сюди за documentId, а звідси
-- відкривається сама форма документа. Показує проводки як вони лежать у
-- app.journal_entry — зі знімками субконто, тобто такими, якими вони були на
-- момент проведення.
--
-- Читає регістр через шар ядра (`@core/ledger`, `app.acc_journal`): рядок =
-- ПРОВОДКА, дебет і кредит поруч — саме те, що потрібно рухам документа.
-- Складання субконто в масив (`journal_entry_analytic` → `jsonb_agg`) було
-- третім дублем тієї самої дрібниці в трьох звітах; тепер воно одне.
-- ═══════════════════════════════════════════════════════════════════════════

-- Тіло звіту. Обгортку `app.document_movements_index` генерує sql:gen зі схеми
-- фільтрів: розбір, перевірку обов'язкового documentId і конверт. Ссылочних
-- фільтрів тут немає, тож эхо порожнє — підпис документа звіт віддає сам,
-- в `extra.document`: заголовку потрібні номер, дата, сума й організація.
drop function if exists app.document_movements_data(bigint, jsonb);
create function app.document_movements_data(user_id bigint, filters jsonb)
returns jsonb
language sql
as $$
  with params as (
    select nullif(filters->>'documentId', '')::bigint as document_id
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
  -- Організація шару обов'язкова, тож беремо її з самого документа: звіт
  -- питає про КОНКРЕТНИЙ документ, а не про період чи рахунок.
  rows as (
    select
      j.line_no             as "lineNo",
      j.debit_account       as "debitAccount",
      j.debit_account_name  as "debitAccountName",
      j.debit_dims          as "debitAnalytics",
      j.credit_account      as "creditAccount",
      j.credit_account_name as "creditAccountName",
      j.credit_dims         as "creditAnalytics",
      j.amount              as "amount",
      j.currency_code_debit    as "currencyCodeDebit",
      j.currency_amount_debit  as "currencyAmountDebit",
      j.currency_code_credit   as "currencyCodeCredit",
      j.currency_amount_credit as "currencyAmountCredit",
      j.quantity_debit         as "quantityDebit",
      j.quantity_credit        as "quantityCredit",
      j.description            as "description"
    from params p
    join app.document d on d.id = p.document_id
    cross join lateral app.acc_journal(
      d.organization_id, null, null, null, null, p.document_id
    ) j
    order by j.line_no, j.entry_id
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(rows)) from rows), '[]'::jsonb),
    'totals', jsonb_build_object(
      'amount', coalesce((select sum("amount") from rows), 0)
    ),
    'extra', jsonb_build_object(
      'document', coalesce((select to_jsonb(doc) from doc), '{}'::jsonb)
    )
  );
$$;
