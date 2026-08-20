-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.
-- Джерело: currency_rate.schema.ts + manifest.json. Override — db/currency_rate.custom.sql


drop function if exists app.currency_rate_list(bigint, jsonb);
create function app.currency_rate_list(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 20), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', 'currency');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
  v_filters   jsonb := coalesce(payload->'filters', '{}'::jsonb);
  v_f_currency_id bigint := nullif(v_filters->'currency'->>'id', '')::bigint;
  v_f_period_from date := nullif(v_filters->>'periodFrom', '')::date;
  v_f_period_to date := nullif(v_filters->>'periodTo', '')::date;
  v_filters_out jsonb;
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('currency', 'period') then
    v_sort_by := 'currency';
  end if;

  v_filters_out := v_filters;
  v_filters_out := v_filters_out || jsonb_strip_nulls(jsonb_build_object(
    'currency',
    (select jsonb_build_object('id', x.id::text, 'name', x.name)
     from app.currency x where x.id = v_f_currency_id)
  ));

  select count(*)::int into v_total
  from app.currency_rate t
  left join app.currency r_currency on r_currency.id = t.currency_id
  where (
    coalesce(payload->>'search', '') = ''
    or r_currency.name ilike '%' || (payload->>'search') || '%'
  )
  and (v_f_currency_id is null or t.currency_id = v_f_currency_id)
  and (v_f_period_from is null or t.period >= v_f_period_from)
  and (v_f_period_to is null or t.period <= v_f_period_to);

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id::text,
      'currencyId', t.currency_id::text,
      'currency', case when r_currency.id is null then null else jsonb_build_object('id', r_currency.id::text, 'name', r_currency.name) end,
      'period', t.period,
      'rate', t.rate,
      'multiplicity', t.multiplicity
    ) as r
    from app.currency_rate t
    left join app.currency r_currency on r_currency.id = t.currency_id
    where (
      coalesce(payload->>'search', '') = ''
      or r_currency.name ilike '%' || (payload->>'search') || '%'
    )
    and (v_f_currency_id is null or t.currency_id = v_f_currency_id)
    and (v_f_period_from is null or t.period >= v_f_period_from)
    and (v_f_period_to is null or t.period <= v_f_period_to)
    order by
      case when v_sort_by = 'currency' and v_sort_dir = 'asc'  then r_currency.name end asc,
      case when v_sort_by = 'currency' and v_sort_dir = 'desc' then r_currency.name end desc,
      case when v_sort_by = 'period' and v_sort_dir = 'asc'  then t.period end asc,
      case when v_sort_by = 'period' and v_sort_dir = 'desc' then t.period end desc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  ) sub;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'rows',   v_rows,
        'item',   null,
        'options', '{}'::jsonb,
        'totals', jsonb_build_object('count', v_total, 'page', v_page, 'pageSize', v_page_size),
        '$filters', v_filters_out,
        'extra',  '{}'::jsonb
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

drop function if exists app.currency_rate_get(bigint, jsonb);
create function app.currency_rate_get(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item', (
          select jsonb_build_object(
        'id', t.id::text,
        'currencyId', t.currency_id::text,
        'currency', case when r_currency.id is null then null else jsonb_build_object('id', r_currency.id::text, 'name', r_currency.name) end,
        'period', t.period,
        'rate', t.rate,
        'multiplicity', t.multiplicity
      )
          from app.currency_rate t
          left join app.currency r_currency on r_currency.id = t.currency_id
          where t.id = (payload->>'id')::bigint
        ),
        'rows',    '[]'::jsonb,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   '{}'::jsonb
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
$$;

drop function if exists app.currency_rate_save(bigint, jsonb);
create function app.currency_rate_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item   jsonb := payload->'item';
  v_id     bigint;
  v_result jsonb;
begin


  merge into app.currency_rate t
  using (
    select
      nullif(v_item->>'id', '')::bigint as id,
      nullif(coalesce(v_item->>'currencyId', v_item->'currency'->>'id'), '')::bigint as currency_id,
      nullif(v_item->>'period', '')::date as period,
      nullif(v_item->>'rate', '')::numeric as rate,
      nullif(v_item->>'multiplicity', '')::int as multiplicity
  ) s
    on t.id = s.id
  when matched then update set
    currency_id = s.currency_id,
    period = s.period,
    rate = s.rate,
    multiplicity = coalesce(s.multiplicity, t.multiplicity),
    updated_at = now()
  when not matched then insert (currency_id, period, rate, multiplicity)
    values (s.currency_id, s.period, s.rate, coalesce(s.multiplicity, 1))
  returning t.id into v_id;

  select jsonb_build_object(
        'id', t.id::text,
        'currencyId', t.currency_id::text,
        'currency', case when r_currency.id is null then null else jsonb_build_object('id', r_currency.id::text, 'name', r_currency.name) end,
        'period', t.period,
        'rate', t.rate,
        'multiplicity', t.multiplicity
      ) into v_result
  from app.currency_rate t
  left join app.currency r_currency on r_currency.id = t.currency_id
  where t.id = v_id;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item',    v_result,
        'rows',    '[]'::jsonb,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   '{}'::jsonb
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

drop function if exists app.currency_rate_delete(bigint, jsonb);
create function app.currency_rate_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint;
begin
  v_id := nullif(payload->>'id', '')::bigint;
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  delete from app.currency_rate where id = v_id;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item',    null,
        'rows',    '[]'::jsonb,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   jsonb_build_object('deletedId', v_id::text)
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

create unique index if not exists uq_currency_rate_period
  on app.currency_rate (currency_id, period desc);

drop function if exists app.currency_rate_at(bigint, jsonb);
create function app.currency_rate_at(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_on_date date := coalesce(nullif(payload->>'onDate', '')::date, current_date);
  v_rows    jsonb;
begin
  -- Зріз останнього: по одному рядку на ключ — найсвіжіший із тих, що не пізніші
  -- за дату. Саме тут потрібен індекс (ключ…, період desc), інакше це скан.
  select coalesce(jsonb_agg(sub.r), '[]'::jsonb) into v_rows
  from (
    select distinct on (t.currency_id)
      jsonb_build_object(
        'id', t.id::text,
        'currencyId', t.currency_id::text,
        'currency', case when r_currency.id is null then null else jsonb_build_object('id', r_currency.id::text, 'name', r_currency.name) end,
        'period', t.period,
        'rate', t.rate,
        'multiplicity', t.multiplicity
      ) as r
    from app.currency_rate t
      left join app.currency r_currency on r_currency.id = t.currency_id
    where t.period <= v_on_date
      and (payload->>'currencyId' is null or t.currency_id = nullif(coalesce(payload->>'currencyId', payload->'currency'->>'id'), '')::bigint)
    order by t.currency_id, t.period desc
  ) sub;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'rows',    v_rows,
        'item',    case when jsonb_array_length(v_rows) = 1 then v_rows->0 else null end,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   jsonb_build_object('onDate', v_on_date)
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

drop function if exists app.currency_rate_history(bigint, jsonb);
create function app.currency_rate_history(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_from date := nullif(payload->>'dateFrom', '')::date;
  v_to   date := nullif(payload->>'dateTo', '')::date;
  v_rows jsonb;
begin
  -- Як значення мінялося: усі рядки ключа, свіжі зверху. Пагінації немає
  -- навмисно — історія одного ключа коротка, а «остання сторінка» тут нічого
  -- не означає.
  select coalesce(jsonb_agg(sub.r order by sub.period desc), '[]'::jsonb) into v_rows
  from (
    select
      t.period as period,
      jsonb_build_object(
      'id', t.id::text,
      'currencyId', t.currency_id::text,
      'currency', case when r_currency.id is null then null else jsonb_build_object('id', r_currency.id::text, 'name', r_currency.name) end,
      'period', t.period,
      'rate', t.rate,
      'multiplicity', t.multiplicity
      ) as r
    from app.currency_rate t
    left join app.currency r_currency on r_currency.id = t.currency_id
    where (v_from is null or t.period >= v_from)
      and (v_to   is null or t.period <= v_to)
      and (payload->>'currencyId' is null or t.currency_id = nullif(coalesce(payload->>'currencyId', payload->'currency'->>'id'), '')::bigint)
  ) sub;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'rows',    v_rows,
        'item',    null,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   '{}'::jsonb
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

drop function if exists app.currency_rate_set(bigint, jsonb);
create function app.currency_rate_set(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item jsonb := coalesce(payload->'item', payload);
  v_id   bigint;
begin
  -- Перезапис значення НА ДАТУ: ключ тут природний (ключ + період), а не id.
  -- Саме цим set відрізняється від save: імпорт курсів за датою не знає
  -- ідентифікаторів рядків і не мусить їх шукати.
  merge into app.currency_rate t
  using (
    select
      nullif(coalesce(v_item->>'currencyId', v_item->'currency'->>'id'), '')::bigint as currency_id,
      nullif(v_item->>'period', '')::date as period,
      nullif(v_item->>'rate', '')::numeric as rate,
      nullif(v_item->>'multiplicity', '')::int as multiplicity
  ) s
    on t.currency_id = s.currency_id
     and t.period = s.period
  when matched then update set
    rate = s.rate,
    multiplicity = coalesce(s.multiplicity, t.multiplicity),
    updated_at = now()
  when not matched then insert (currency_id, period, rate, multiplicity)
    values (s.currency_id, s.period, s.rate, coalesce(s.multiplicity, 1))
  returning t.id into v_id;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item',    (select app.currency_rate_get(user_id, jsonb_build_object('id', v_id::text)) -> 'data' -> 'item'),
        'rows',    '[]'::jsonb,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   jsonb_build_object('id', v_id::text)
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

