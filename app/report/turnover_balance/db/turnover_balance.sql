-- ═══════════════════════════════════════════════════════════════════════════
-- Оборотно-сальдова відомість: по кожному рахунку — сальдо на початок,
-- обороти за період і сальдо на кінець.
--
-- Власної арифметики тут БІЛЬШЕ НЕМАЄ: сальдо й обороти рахує шар ядра
-- (`@core/ledger`, `app.acc_balance_turnover`) — один прохід по регістру на всі
-- три величини. Доти ця методологія жила ще й у картці рахунку, і одного разу
-- вони розійшлися: при виклику без періоду кожен рух ставав одночасно вхідним
-- сальдо й оборотом. Тепер джерело одне, а звіту лишається подання.
--
-- Подання — це саме те, чого шар не робить: він віддає ЧИСТЕ сальдо
-- (`net` = дебет − кредит), а розкласти його на дебетову й кредитову колонки —
-- справа звіту.
--
-- У відомість потрапляють лише рахунки з рухом або ненульовим сальдо (порожні
-- рядки плану відсіює сам шар).
-- ═══════════════════════════════════════════════════════════════════════════

-- Тіло звіту. Обгортку `app.turnover_balance_index` генерує sql:gen зі схеми
-- фільтрів: розбір `payload.filters`, перевірку обов'язкових, эхо `$filters` і
-- конверт. Сюди фільтри приходять уже РОЗІБРАНИМИ — ссылка згорнута до id, —
-- а назад іде лише вміст `data`.
drop function if exists app.turnover_balance_data(bigint, jsonb);
create function app.turnover_balance_data(user_id bigint, filters jsonb)
returns jsonb
language sql
as $$
  with params as (
    select
      nullif(filters->>'organizationId', '')::bigint as org_id,
      nullif(filters->>'dateFrom', '')::date         as date_from,
      nullif(filters->>'dateTo', '')::date           as date_to
  ),
  -- Організація тут не перевіряється: обов'язковість фільтра оголошена в схемі,
  -- і відмовляє обгортка — до тіла звіт без організації не доходить.
  rows as (
    select
      bt.account                                     as "accountCode",
      bt.account_name                                as "accountName",
      -- Забалансовий рахунок у підсумок не входить (нижче): він однобічний за
      -- визначенням, тож дебет із кредитом на ньому не зводяться — і підсумок,
      -- який його враховує, перестає означати «баланс зійшовся». Рядок при
      -- цьому лишається: подивитися на забалансові залишки треба саме тут.
      coalesce(coa.is_off_balance, false)            as "isOffBalance",
      greatest(bt.opening_net, 0::numeric)           as "openingDebit",
      greatest(-bt.opening_net, 0::numeric)          as "openingCredit",
      bt.debit                                       as "turnoverDebit",
      bt.credit                                      as "turnoverCredit",
      greatest(bt.closing_net, 0::numeric)           as "closingDebit",
      greatest(-bt.closing_net, 0::numeric)          as "closingCredit"
    from params p
    cross join lateral app.acc_balance_turnover(p.org_id, p.date_from, p.date_to) bt
    left join app.chart_of_account coa on coa.code = bt.account
    order by bt.account
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(rows)) from rows), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'openingDebit',   coalesce(sum("openingDebit"), 0),
        'openingCredit',  coalesce(sum("openingCredit"), 0),
        'turnoverDebit',  coalesce(sum("turnoverDebit"), 0),
        'turnoverCredit', coalesce(sum("turnoverCredit"), 0),
        'closingDebit',   coalesce(sum("closingDebit"), 0),
        'closingCredit',  coalesce(sum("closingCredit"), 0)
      )
      from rows
      where not "isOffBalance"
    )
  );
$$;
