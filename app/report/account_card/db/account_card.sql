-- ═══════════════════════════════════════════════════════════════════════════
-- Картка рахунку: усі проводки по рахунку за період із сальдо, що наростає.
--
-- Власної арифметики тут БІЛЬШЕ НЕМАЄ. Потік рухів дає `app.acc_entries`, а
-- вхідне сальдо й обороти — `app.acc_balance_turnover` (обидва з `@core/ledger`).
-- Доти та сама методологія жила ще й в оборотно-сальдовій, і двічі коштувала
-- подвоєного сальдо: спершу в обох звітах (рух ставав і залишком, і оборотом
-- при виклику без періоду), потім у наростаючому залишку картки, який брався з
-- `acc_balance(org, null)` — тобто «всі рухи» замість «до початку періоду».
--
-- Звіту лишається подання: розкласти чисте сальдо на дебетову й кредитову
-- колонки та накопичити його по рядках.
--
-- Кожен рядок несе document_type_code і model_key субконто — ключі моделей,
-- за якими клієнт сам знаходить маршрут форми у view-manifest. Родину моделі
-- («catalog», «operation») БД не зберігає: джерело правди про маршрути одне.
-- ═══════════════════════════════════════════════════════════════════════════

-- Тіло звіту. Обгортку `app.account_card_index` генерує sql:gen зі схеми
-- фільтрів: розбір, перевірку обов'язкових, эхо `$filters` і конверт.
drop function if exists app.account_card_data(bigint, jsonb);
create function app.account_card_data(user_id bigint, filters jsonb)
returns jsonb
language sql
as $$
  with params as (
    select
      nullif(filters->>'organizationId', '')::bigint          as org_id,
      nullif(trim(coalesce(filters->>'accountCode', '')), '') as account,
      nullif(filters->>'dateFrom', '')::date                  as date_from,
      nullif(filters->>'dateTo', '')::date                    as date_to
  ),
  -- Сальдо й обороти рахунку — одним викликом шару. Організація й рахунок тут
  -- не перевіряються: обов'язковість оголошена в схемі фільтрів, і відмовляє
  -- обгортка — сюди звіт без них не доходить.
  totals as (
    select bt.opening_net, bt.debit, bt.credit
    from params p
    cross join lateral app.acc_balance_turnover(
      p.org_id, p.date_from, p.date_to, array[p.account]::varchar[]
    ) bt
  ),
  -- Рядки періоду. Бік рахунку («свій») шар уже вибрав сам: у `acc_entries`
  -- рядок — це БІК проводки, тож дебет, кредит, кореспондуючий рахунок і
  -- аналітика приходять уже з погляду цього рахунку.
  period as (
    select e.*
    from params p
    cross join lateral app.acc_entries(
      p.org_id, p.date_from, p.date_to, array[p.account]::varchar[]
    ) e
  ),
  numbered as (
    select
      e.*,
      coalesce((select opening_net from totals), 0::numeric)
        + sum(e.debit - e.credit) over (
            order by e.doc_date, e.document_id, e.line_no, e.entry_id
            rows between unbounded preceding and current row
          ) as running
    from period e
  ),
  rows as (
    select
      n.entry_id::text     as "entryId",
      n.document_id::text  as "documentId",
      n.doc_type_code      as "documentTypeCode",
      n.doc_type_name      as "documentTypeName",
      n.doc_date::text     as "docDate",
      n.doc_number         as "docNumber",
      n.corr_account       as "corrAccount",
      n.corr_account_name  as "corrAccountName",
      n.debit, n.credit,
      greatest(n.running, 0::numeric)  as "balanceDebit",
      greatest(-n.running, 0::numeric) as "balanceCredit",
      n.currency_code   as "currencyCode",
      coalesce(n.currency_debit, n.currency_credit) as "currencyAmount",
      coalesce(n.quantity_debit, n.quantity_credit) as "quantity",
      n.description,
      n.dims      as "analytics",
      n.corr_dims as "corrAnalytics"
    from numbered n
    order by n.doc_date, n.document_id, n.line_no, n.entry_id
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(rows)) from rows), '[]'::jsonb),
    'totals', jsonb_build_object(
      'account',        (select account from params),
      'accountName',    (select coalesce(name, '') from app.chart_of_account, params where code = params.account),
      'openingDebit',   greatest(coalesce((select opening_net from totals), 0), 0::numeric),
      'openingCredit',  greatest(-coalesce((select opening_net from totals), 0), 0::numeric),
      'turnoverDebit',  coalesce((select debit from totals), 0::numeric),
      'turnoverCredit', coalesce((select credit from totals), 0::numeric),
      'closingDebit',   greatest(coalesce((select opening_net + debit - credit from totals), 0), 0::numeric),
      'closingCredit',  greatest(-coalesce((select opening_net + debit - credit from totals), 0), 0::numeric)
    )
  );
$$;
