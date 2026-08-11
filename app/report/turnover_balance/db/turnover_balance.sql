-- ═══════════════════════════════════════════════════════════════════════════
-- Оборотно-сальдова відомість: по кожному рахунку — сальдо на початок,
-- обороти за період і сальдо на кінець.
--
-- Рахується тим самим скануванням регістру, що й картка рахунку: підсумків
-- ніде не зберігаємо. Один прохід по app.journal_entry дає обидві сторони —
-- дебетову й кредитову — через union all, далі все згортається по рахунку.
--
-- У відомість потрапляють лише рахунки, де є рух або ненульове сальдо:
-- показувати всі 87 рядків плану рахунків, з яких 80 порожні, — марно.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists app.turnover_balance_index(bigint, jsonb);
create function app.turnover_balance_index(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  with params as (
    -- Фільтри приходять вкладеним об'єктом `filters` — той самий контракт, що
    -- в списків: ім'я фільтра рано чи пізно збіглося б із полем запиту, якби
    -- вони лежали врозсип. Генератора для звітів немає, домовленість та сама.
    select
      -- Ссылочний фільтр — ОДИН ключ з об'єктом `{id, name}`; тут потрібен id.
      nullif(f->'organization'->>'id', '')::bigint as org_id,
      nullif(f->>'dateFrom', '')::date            as date_from,
      nullif(f->>'dateTo', '')::date              as date_to
    from (select coalesce(payload->'filters', '{}'::jsonb) as f) src
  ),
  -- Назад той самий ключ їде з підписом із бази: id міг прийти сам, без назви
  -- (перехід із іншого звіту), і тоді пікер стояв би порожнім при діючому фільтрі.
  filters_out as (
    select coalesce(payload->'filters', '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
           'organization',
           (select jsonb_build_object('id', o.id::text, 'name', o.name)
            from app.organization o cross join params p where o.id = p.org_id)
         )) as value
  ),
  -- Рухи по рахунку з обох сторін проводки, зведені в один потік.
  moves as (
    select je.debit_account as account, d.doc_date, je.amount as debit, 0::numeric as credit
    from params p
    join app.document d
      on d.organization_id = p.org_id and d.is_posted and not d.is_deleted
    join app.journal_entry je on je.document_id = d.id
    where p.org_id is not null

    union all

    select je.credit_account, d.doc_date, 0::numeric, je.amount
    from params p
    join app.document d
      on d.organization_id = p.org_id and d.is_posted and not d.is_deleted
    join app.journal_entry je on je.document_id = d.id
    where p.org_id is not null
  ),
  agg as (
    select
      m.account,
      -- Вхідне сальдо: усе, що було ДО початку періоду. Немає початку — немає
      -- і «до»: сальдо нульове, а весь рух іде в оборот.
      --
      -- Доти умова читалася навпаки (`date_from is null or …`), і при виклику
      -- БЕЗ періоду кожен рух потрапляв одночасно і у вхідне сальдо, і в
      -- оборот — кінцеве виходило вдвічі більшим за факт. З екрана цього не
      -- видно ніколи: <ui-period> завжди підставляє період. Видно лише тому,
      -- хто покличе звіт напряму — з API, агентом або з іншого звіту.
      --
      -- Те саме правило продубльоване в app.account_card_index: поки
      -- методологія живе в кожному звіті окремо, воно мусить бути записане в
      -- обох місцях (див. docs/gaps-wishes/FRAMEWORK-WISHES.md — шар обчислень).
      coalesce(sum(m.debit - m.credit) filter (
        where p.date_from is not null and m.doc_date::date < p.date_from
      ), 0::numeric) as opening_net,
      coalesce(sum(m.debit) filter (where in_period), 0::numeric)  as turnover_debit,
      coalesce(sum(m.credit) filter (where in_period), 0::numeric) as turnover_credit
    from (
      select m.*, (
        (select date_from from params) is null or m.doc_date::date >= (select date_from from params)
      ) and (
        (select date_to from params) is null or m.doc_date::date <= (select date_to from params)
      ) as in_period
      from moves m
    ) m
    cross join params p
    group by m.account
  ),
  rows as (
    select
      a.account                                   as "accountCode",
      coalesce(coa.name, '')                      as "accountName",
      greatest(a.opening_net, 0::numeric)         as "openingDebit",
      greatest(-a.opening_net, 0::numeric)        as "openingCredit",
      a.turnover_debit                            as "turnoverDebit",
      a.turnover_credit                           as "turnoverCredit",
      greatest(a.opening_net + a.turnover_debit - a.turnover_credit, 0::numeric)  as "closingDebit",
      greatest(-(a.opening_net + a.turnover_debit - a.turnover_credit), 0::numeric) as "closingCredit"
    from agg a
    left join app.chart_of_account coa on coa.code = a.account
    where a.opening_net <> 0 or a.turnover_debit <> 0 or a.turnover_credit <> 0
    order by a.account
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((select jsonb_agg(to_jsonb(rows)) from rows), '[]'::jsonb),
      'options', '{}'::jsonb,
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
      ),
      '$filters', (select value from filters_out),
      'extra', '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
$$;
