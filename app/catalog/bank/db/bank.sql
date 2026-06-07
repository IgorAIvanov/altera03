drop function if exists app.bank_list(bigint, jsonb);
create or replace function app.bank_list(user_id bigint, payload jsonb)
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
  if v_sort_by not in ('code','name','mfo') then
    v_sort_by := 'code';
  end if;

  select count(*)::int into v_total
  from app.bank b
  where (
    coalesce(payload->>'search', '') = ''
    or b.code ilike '%' || (payload->>'search') || '%'
    or b.name ilike '%' || (payload->>'search') || '%'
    or coalesce(b.mfo, '') ilike '%' || (payload->>'search') || '%'
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select
      b.id::text  as id,
      b.code,
      b.name,
      b.mfo,
      b.is_active as "isActive"
    from app.bank b
    where (
      coalesce(payload->>'search', '') = ''
      or b.code ilike '%' || (payload->>'search') || '%'
      or b.name ilike '%' || (payload->>'search') || '%'
      or coalesce(b.mfo, '') ilike '%' || (payload->>'search') || '%'
    )
    order by
      case when v_sort_by = 'code' and v_sort_dir = 'asc'  then b.code end asc,
      case when v_sort_by = 'code' and v_sort_dir = 'desc' then b.code end desc,
      case when v_sort_by = 'name' and v_sort_dir = 'asc'  then b.name end asc,
      case when v_sort_by = 'name' and v_sort_dir = 'desc' then b.name end desc,
      case when v_sort_by = 'mfo'  and v_sort_dir = 'asc'  then b.mfo  end asc,
      case when v_sort_by = 'mfo'  and v_sort_dir = 'desc' then b.mfo  end desc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  ) r;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'rows',   v_rows,
      'totals', jsonb_build_object(
        'count',    v_total,
        'page',     v_page,
        'pageSize', v_page_size
      ),
      'item',    null,
      'options', '{}'::jsonb,
      'extra',   '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
end;
$$;

drop function if exists app.bank_get(bigint, jsonb);
create or replace function app.bank_get(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', (
        select jsonb_build_object(
          'id',       b.id::text,
          'code',     b.code,
          'name',     b.name,
          'mfo',      b.mfo,
          'isActive', b.is_active
        )
        from app.bank b
        where b.id = (payload->>'id')::bigint
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

drop function if exists app.bank_save(bigint, jsonb);
create or replace function app.bank_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item   jsonb;
  v_id     bigint;
  v_code   text;
  v_name   text;
  v_mfo    text;
  v_result jsonb;
begin
  v_item := payload->'item';
  v_id   := nullif(v_item->>'id', '')::bigint;
  v_code := nullif(trim(coalesce(v_item->>'code', '')), '');
  v_name := nullif(trim(coalesce(v_item->>'name', '')), '');
  v_mfo  := nullif(trim(coalesce(v_item->>'mfo',  '')), '');

  if v_code is null then
    raise exception 'Код банку обов''язковий';
  end if;
  if v_name is null then
    raise exception 'Назва банку обов''язкова';
  end if;

  if v_id is null then
    insert into app.bank (code, name, mfo, is_active)
    values (v_code, v_name, v_mfo, coalesce((v_item->>'isActive')::boolean, true))
    returning jsonb_build_object(
      'id', id::text, 'code', code, 'name', name, 'mfo', mfo, 'isActive', is_active
    ) into v_result;
  else
    update app.bank
    set
      code       = v_code,
      name       = v_name,
      mfo        = v_mfo,
      is_active  = coalesce((v_item->>'isActive')::boolean, is_active),
      updated_at = now()
    where id = v_id
    returning jsonb_build_object(
      'id', id::text, 'code', code, 'name', name, 'mfo', mfo, 'isActive', is_active
    ) into v_result;
  end if;

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

drop function if exists app.bank_delete(bigint, jsonb);
create or replace function app.bank_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint;
begin
  v_id := nullif(payload->>'id', '')::bigint;

  if v_id is null then
    raise exception 'id банку обов''язковий';
  end if;

  delete from app.bank where id = v_id;

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

drop function if exists app.bank_lookup(bigint, jsonb);
create or replace function app.bank_lookup(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  with rows_data as (
    select
      b.id::text as id,
      b.name,
      b.mfo
    from app.bank b
    where b.is_active = true
      and (
        coalesce(payload->>'search', '') = ''
        or b.code ilike '%' || (payload->>'search') || '%'
        or b.name ilike '%' || (payload->>'search') || '%'
        or coalesce(b.mfo, '') ilike '%' || (payload->>'search') || '%'
      )
    order by b.name asc
    limit coalesce((payload->>'limit')::int, 50)
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'rows',    coalesce((select jsonb_agg(row_to_json(rows_data)) from rows_data), '[]'::jsonb),
      'item',    null,
      'options', '{}'::jsonb,
      'totals',  '{}'::jsonb,
      'extra',   '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
$$;
