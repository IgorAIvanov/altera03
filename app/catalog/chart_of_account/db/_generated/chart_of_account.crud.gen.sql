-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.
-- Джерело: chart_of_account.schema.ts + manifest.json. Override — db/chart_of_account.custom.sql


drop function if exists app.chart_of_account_list(bigint, jsonb);
create function app.chart_of_account_list(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 20), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', 'code');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('code', 'name') then
    v_sort_by := 'code';
  end if;

  select count(*)::int into v_total
  from app.chart_of_account t
  where (
    coalesce(payload->>'search', '') = ''
    or t.code ilike '%' || (payload->>'search') || '%'
    or t.name ilike '%' || (payload->>'search') || '%'
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id::text,
      'code', t.code,
      'name', t.name,
      'accountType', t.account_type,
      'parentCode', t.parent_code,
      'isGroup', t.is_group,
      'isCurrency', t.is_currency,
      'isActive', t.is_active
    ) as r
    from app.chart_of_account t
    where (
      coalesce(payload->>'search', '') = ''
      or t.code ilike '%' || (payload->>'search') || '%'
      or t.name ilike '%' || (payload->>'search') || '%'
    )
    order by
      case when v_sort_by = 'code' and v_sort_dir = 'asc'  then t.code end asc,
      case when v_sort_by = 'code' and v_sort_dir = 'desc' then t.code end desc,
      case when v_sort_by = 'name' and v_sort_dir = 'asc'  then t.name end asc,
      case when v_sort_by = 'name' and v_sort_dir = 'desc' then t.name end desc
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
        'extra',  '{}'::jsonb
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

drop function if exists app.chart_of_account_get(bigint, jsonb);
create function app.chart_of_account_get(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item', (
          select jsonb_build_object(
        'id', t.id::text,
        'code', t.code,
        'name', t.name,
        'accountType', t.account_type,
        'parentCode', t.parent_code,
        'isGroup', t.is_group,
        'isOffBalance', t.is_off_balance,
        'isCurrency', t.is_currency,
        'isQuantitative', t.is_quantitative,
        'isActive', t.is_active,
        'sortOrder', t.sort_order
      )
          from app.chart_of_account t
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

drop function if exists app.chart_of_account_save(bigint, jsonb);
create function app.chart_of_account_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item   jsonb := payload->'item';
  v_id     bigint;
  v_result jsonb;
begin
  if nullif(trim(coalesce(v_item->>'code', '')), '') is null then
    raise exception 'code обов''язковий' using column = 'code';
  end if;
  if nullif(trim(coalesce(v_item->>'name', '')), '') is null then
    raise exception 'name обов''язковий' using column = 'name';
  end if;
  if nullif(trim(coalesce(v_item->>'accountType', '')), '') is null then
    raise exception 'accountType обов''язковий' using column = 'account_type';
  end if;

  merge into app.chart_of_account t
  using (
    select
      nullif(v_item->>'id', '')::bigint as id,
      nullif(trim(coalesce(v_item->>'code', '')), '') as code,
      nullif(trim(coalesce(v_item->>'name', '')), '') as name,
      nullif(trim(coalesce(v_item->>'accountType', '')), '') as account_type,
      nullif(trim(coalesce(v_item->>'parentCode', '')), '') as parent_code,
      (v_item->>'isGroup')::boolean as is_group,
      (v_item->>'isOffBalance')::boolean as is_off_balance,
      (v_item->>'isCurrency')::boolean as is_currency,
      (v_item->>'isQuantitative')::boolean as is_quantitative,
      (v_item->>'isActive')::boolean as is_active,
      nullif(v_item->>'sortOrder', '')::int as sort_order
  ) s
    on t.id = s.id
  when matched then update set
    code = s.code,
    name = s.name,
    account_type = coalesce(s.account_type, t.account_type),
    parent_code = s.parent_code,
    is_group = coalesce(s.is_group, t.is_group),
    is_off_balance = coalesce(s.is_off_balance, t.is_off_balance),
    is_currency = coalesce(s.is_currency, t.is_currency),
    is_quantitative = coalesce(s.is_quantitative, t.is_quantitative),
    is_active = coalesce(s.is_active, t.is_active),
    sort_order = coalesce(s.sort_order, t.sort_order),
    updated_at = now()
  when not matched then insert (code, name, account_type, parent_code, is_group, is_off_balance, is_currency, is_quantitative, is_active, sort_order)
    values (s.code, s.name, coalesce(s.account_type, 'active'), s.parent_code, coalesce(s.is_group, false), coalesce(s.is_off_balance, false), coalesce(s.is_currency, false), coalesce(s.is_quantitative, false), coalesce(s.is_active, true), coalesce(s.sort_order, 0))
  returning t.id into v_id;

  select jsonb_build_object(
        'id', t.id::text,
        'code', t.code,
        'name', t.name,
        'accountType', t.account_type,
        'parentCode', t.parent_code,
        'isGroup', t.is_group,
        'isOffBalance', t.is_off_balance,
        'isCurrency', t.is_currency,
        'isQuantitative', t.is_quantitative,
        'isActive', t.is_active,
        'sortOrder', t.sort_order
      ) into v_result
  from app.chart_of_account t
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

drop function if exists app.chart_of_account_delete(bigint, jsonb);
create function app.chart_of_account_delete(user_id bigint, payload jsonb)
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

  delete from app.chart_of_account where id = v_id;

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

drop function if exists app.chart_of_account_lookup(bigint, jsonb);
create function app.chart_of_account_lookup(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 10), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', 'code');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('code', 'name') then
    v_sort_by := 'code';
  end if;

  select count(*)::int into v_total
  from app.chart_of_account t
  where t.is_active = true
    and (
    coalesce(payload->>'search', '') = ''
    or t.code ilike '%' || (payload->>'search') || '%'
    or t.name ilike '%' || (payload->>'search') || '%'
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id::text,
      'code', t.code,
      'name', t.name
    ) as r
    from app.chart_of_account t
    where t.is_active = true
      and (
      coalesce(payload->>'search', '') = ''
      or t.code ilike '%' || (payload->>'search') || '%'
      or t.name ilike '%' || (payload->>'search') || '%'
    )
    order by
      case when v_sort_by = 'code' and v_sort_dir = 'asc'  then t.code end asc,
      case when v_sort_by = 'code' and v_sort_dir = 'desc' then t.code end desc,
      case when v_sort_by = 'name' and v_sort_dir = 'asc'  then t.name end asc,
      case when v_sort_by = 'name' and v_sort_dir = 'desc' then t.name end desc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  ) sub;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'rows',    v_rows,
        'item',    null,
        'options', '{}'::jsonb,
        'totals',  jsonb_build_object('count', v_total, 'page', v_page, 'pageSize', v_page_size),
        'extra',   '{}'::jsonb
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

