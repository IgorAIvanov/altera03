-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.
-- Джерело: bank.schema.ts + manifest.json. Override — db/bank.custom.sql


drop function if exists app.bank_list(bigint, jsonb);
create function app.bank_list(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 20), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', 'mfo');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('mfo', 'name') then
    v_sort_by := 'mfo';
  end if;

  select count(*)::int into v_total
  from app.bank t
  where (
    coalesce(payload->>'search', '') = ''
    or t.mfo ilike '%' || (payload->>'search') || '%'
    or t.name ilike '%' || (payload->>'search') || '%'
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id::text,
      'mfo', t.mfo,
      'name', t.name,
      'isDeleted', t.is_deleted
    ) as r
    from app.bank t
    where (
      coalesce(payload->>'search', '') = ''
      or t.mfo ilike '%' || (payload->>'search') || '%'
      or t.name ilike '%' || (payload->>'search') || '%'
    )
    order by
      case when v_sort_by = 'mfo' and v_sort_dir = 'asc'  then t.mfo end asc,
      case when v_sort_by = 'mfo' and v_sort_dir = 'desc' then t.mfo end desc,
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

drop function if exists app.bank_get(bigint, jsonb);
create function app.bank_get(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item', (
          select jsonb_build_object(
        'id', t.id::text,
        'mfo', t.mfo,
        'name', t.name,
        'isDeleted', t.is_deleted
      )
          from app.bank t
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

drop function if exists app.bank_save(bigint, jsonb);
create function app.bank_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item   jsonb := payload->'item';
  v_id     bigint;
  v_result jsonb;
begin
  if nullif(trim(coalesce(v_item->>'mfo', '')), '') is null then
    raise exception 'mfo обов''язковий' using column = 'mfo';
  end if;
  if nullif(trim(coalesce(v_item->>'name', '')), '') is null then
    raise exception 'name обов''язковий' using column = 'name';
  end if;

  merge into app.bank t
  using (
    select
      nullif(v_item->>'id', '')::bigint as id,
      nullif(trim(coalesce(v_item->>'mfo', '')), '') as mfo,
      nullif(trim(coalesce(v_item->>'name', '')), '') as name,
      (v_item->>'isDeleted')::boolean as is_deleted
  ) s
    on t.id = s.id
  when matched then update set
    mfo = s.mfo,
    name = s.name,
    is_deleted = coalesce(s.is_deleted, t.is_deleted),
    updated_at = now()
  when not matched then insert (mfo, name, is_deleted)
    values (s.mfo, s.name, coalesce(s.is_deleted, false))
  returning t.id into v_id;

  select jsonb_build_object(
        'id', t.id::text,
        'mfo', t.mfo,
        'name', t.name,
        'isDeleted', t.is_deleted
      ) into v_result
  from app.bank t
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

drop function if exists app.bank_delete(bigint, jsonb);
create function app.bank_delete(user_id bigint, payload jsonb)
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

  update app.bank set is_deleted = true where id = v_id;

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

drop function if exists app.bank_undelete(bigint, jsonb);
create function app.bank_undelete(user_id bigint, payload jsonb)
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

  update app.bank set is_deleted = false where id = v_id;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item',    null,
        'rows',    '[]'::jsonb,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   jsonb_build_object('undeletedId', v_id::text)
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

drop function if exists app.bank_lookup(bigint, jsonb);
create function app.bank_lookup(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 10), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', 'mfo');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('mfo', 'name') then
    v_sort_by := 'mfo';
  end if;

  if payload ? 'filters' and payload->'filters' <> '{}'::jsonb then
    raise exception '@[core.lookupNoFilters]%',
      jsonb_build_object('model', 'bank')::text;
  end if;

  select count(*)::int into v_total
  from app.bank t
  where not t.is_deleted
    and (
    coalesce(payload->>'search', '') = ''
    or t.mfo ilike '%' || (payload->>'search') || '%'
    or t.name ilike '%' || (payload->>'search') || '%'
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id::text,
      'name', t.name,
      'mfo', t.mfo
    ) as r
    from app.bank t
    where not t.is_deleted
      and (
      coalesce(payload->>'search', '') = ''
      or t.mfo ilike '%' || (payload->>'search') || '%'
      or t.name ilike '%' || (payload->>'search') || '%'
    )
    order by
      case when v_sort_by = 'mfo' and v_sort_dir = 'asc'  then t.mfo end asc,
      case when v_sort_by = 'mfo' and v_sort_dir = 'desc' then t.mfo end desc,
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

