-- ═══════════════════════════════════════════════════════════════════════════
-- Картка рахунку: усі проводки по рахунку за період із сальдо, що наростає.
--
-- Підсумки ніде не зберігаються — вхідне сальдо рахується скануванням регістру
-- за індексами ix_journal_entry_debit / ix_journal_entry_credit. Це свідоме
-- рішення: немає ні перерахунку при скасуванні проведення, ні розсинхрону.
--
-- Кожен рядок несе document_type_code і model_key субконто — ключі моделей,
-- за якими клієнт сам знаходить маршрут форми у view-manifest. Родину моделі
-- («catalog», «operation») БД не зберігає: джерело правди про маршрути одне.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists app.account_card_index(bigint, jsonb);
create function app.account_card_index(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  with params as (
    select
      nullif(payload->>'organizationId', '')::bigint                as org_id,
      nullif(trim(coalesce(payload->>'accountCode', '')), '')       as account,
      nullif(payload->>'dateFrom', '')::date                        as date_from,
      nullif(payload->>'dateTo', '')::date                          as date_to
  ),
  -- Аналітика проводки, згорнута в масив по сторонах.
  analytics as (
    select
      jea.journal_entry_id,
      jea.side,
      jsonb_agg(jsonb_build_object(
        'dimensionCode', jea.dimension_code,
        'dimensionName', d.name,
        'modelKey',      d.model_key,
        'valueId',       jea.value_id::text,
        'presentation',  jea.value_presentation
      ) order by jea.slot_no) as items
    from app.journal_entry_analytic jea
    join app.analytic_dimension d on d.code = jea.dimension_code
    group by jea.journal_entry_id, jea.side
  ),
  -- Усі рухи по рахунку від початку обліку: з них беремо і вхідне сальдо,
  -- і рядки періоду — щоб не сканувати регістр двічі.
  moves as (
    select
      je.id            as entry_id,
      d.id             as document_id,
      d.doc_date,
      d.number         as doc_number,
      dt.code          as document_type_code,
      coalesce(dt.short_name, dt.name) as document_type_name,
      je.line_no,
      case when je.debit_account  = p.account then je.amount else 0::numeric end as debit,
      case when je.credit_account = p.account then je.amount else 0::numeric end as credit,
      case when je.debit_account  = p.account then je.credit_account else je.debit_account end as corr_account,
      je.description,
      -- Сторона, з якої дивиться картка: її аналітика цікавить у першу чергу.
      case when je.debit_account = p.account then 'debit' else 'credit' end as own_side
    from params p
    join app.document d
      on d.organization_id = p.org_id
     and d.is_posted
     and not d.is_deleted
    join app.journal_entry je
      on je.document_id = d.id
     and (je.debit_account = p.account or je.credit_account = p.account)
    join app.document_type dt on dt.id = d.document_type_id
    where p.org_id is not null and p.account is not null
  ),
  opening as (
    select coalesce(sum(m.debit - m.credit), 0::numeric) as net
    from moves m, params p
    where p.date_from is null or m.doc_date::date < p.date_from
  ),
  period as (
    select m.*
    from moves m, params p
    where (p.date_from is null or m.doc_date::date >= p.date_from)
      and (p.date_to   is null or m.doc_date::date <= p.date_to)
  ),
  numbered as (
    select
      p.*,
      (select net from opening) + sum(p.debit - p.credit)
        over (order by p.doc_date, p.document_id, p.line_no, p.entry_id
              rows between unbounded preceding and current row) as running
    from period p
  ),
  rows as (
    select
      n.entry_id::text    as "entryId",
      n.document_id::text as "documentId",
      n.document_type_code as "documentTypeCode",
      n.document_type_name as "documentTypeName",
      n.doc_date::text     as "docDate",
      n.doc_number         as "docNumber",
      n.corr_account       as "corrAccount",
      coalesce(ca.name, '') as "corrAccountName",
      n.debit, n.credit,
      greatest(n.running, 0::numeric)  as "balanceDebit",
      greatest(-n.running, 0::numeric) as "balanceCredit",
      n.description,
      coalesce(own.items, '[]'::jsonb)  as "analytics",
      coalesce(corr.items, '[]'::jsonb) as "corrAnalytics"
    from numbered n
    left join app.chart_of_account ca on ca.code = n.corr_account
    left join analytics own  on own.journal_entry_id  = n.entry_id and own.side  = n.own_side
    left join analytics corr on corr.journal_entry_id = n.entry_id
                            and corr.side = case when n.own_side = 'debit' then 'credit' else 'debit' end
    order by n.doc_date, n.document_id, n.line_no, n.entry_id
  ),
  turnover as (
    select
      coalesce(sum(debit), 0::numeric)  as debit,
      coalesce(sum(credit), 0::numeric) as credit
    from period
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((select jsonb_agg(to_jsonb(rows)) from rows), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', jsonb_build_object(
        'account',        (select account from params),
        'accountName',    (select coalesce(name, '') from app.chart_of_account, params where code = params.account),
        'openingDebit',   greatest((select net from opening), 0::numeric),
        'openingCredit',  greatest(-(select net from opening), 0::numeric),
        'turnoverDebit',  (select debit from turnover),
        'turnoverCredit', (select credit from turnover),
        'closingDebit',   greatest((select net from opening) + (select debit from turnover) - (select credit from turnover), 0::numeric),
        'closingCredit',  greatest(-((select net from opening) + (select debit from turnover) - (select credit from turnover)), 0::numeric)
      ),
      'extra', '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
$$;
