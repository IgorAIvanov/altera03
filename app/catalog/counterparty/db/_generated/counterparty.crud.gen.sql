-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.
-- Джерело: counterparty.schema.ts + manifest.json. Override — db/counterparty.custom.sql


drop function if exists app.counterparty_list(bigint, jsonb);
create function app.counterparty_list(user_id bigint, payload jsonb)
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
  from app.counterparty t
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
      'isDeleted', t.is_deleted
    ) as r
    from app.counterparty t
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

drop function if exists app.counterparty_get(bigint, jsonb);
create function app.counterparty_get(user_id bigint, payload jsonb)
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
        'isDeleted', t.is_deleted
      )
          from app.counterparty t
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

drop function if exists app.counterparty_save(bigint, jsonb);
create function app.counterparty_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item   jsonb := payload->'item';
  v_id     bigint;
  v_prev   bigint := nullif(v_item->>'id', '')::bigint;
  v_number varchar;
  v_result jsonb;
begin
  if nullif(trim(coalesce(v_item->>'name', '')), '') is null then
    raise exception 'name обов''язковий' using column = 'name';
  end if;

  v_number := nullif(trim(coalesce(v_item->>'code', '')), '');
  if v_number is null then
    if v_prev is null then
      v_number := app.numerator_next('counterparty', '{}'::jsonb);
    else
      select t.code into v_number from app.counterparty t where t.id = v_prev;
    end if;
  elsif v_prev is null
     or v_number is distinct from (select t.code from app.counterparty t where t.id = v_prev) then
    if exists (select 1 from app.numerator n where n.model = 'counterparty' and not n.is_editable) then
      raise exception 'Номер призначає нумератор — ручна зміна вимкнена' using column = 'code';
    end if;
    perform app.numerator_bump_to('counterparty', '{}'::jsonb, v_number);
  end if;

  merge into app.counterparty t
  using (
    select
      nullif(v_item->>'id', '')::bigint as id,
      v_number as code,
      nullif(trim(coalesce(v_item->>'name', '')), '') as name,
      (v_item->>'isDeleted')::boolean as is_deleted
  ) s
    on t.id = s.id
  when matched then update set
    code = s.code,
    name = s.name,
    is_deleted = coalesce(s.is_deleted, t.is_deleted),
    updated_at = now()
  when not matched then insert (code, name, is_deleted)
    values (s.code, s.name, coalesce(s.is_deleted, false))
  returning t.id into v_id;

  select jsonb_build_object(
        'id', t.id::text,
        'code', t.code,
        'name', t.name,
        'isDeleted', t.is_deleted
      ) into v_result
  from app.counterparty t
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

drop function if exists app.counterparty_delete(bigint, jsonb);
create function app.counterparty_delete(user_id bigint, payload jsonb)
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

  update app.counterparty set is_deleted = true where id = v_id;

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

drop function if exists app.counterparty_undelete(bigint, jsonb);
create function app.counterparty_undelete(user_id bigint, payload jsonb)
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

  update app.counterparty set is_deleted = false where id = v_id;

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

drop function if exists app.counterparty_lookup(bigint, jsonb);
create function app.counterparty_lookup(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 10), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', 'name');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('name') then
    v_sort_by := 'name';
  end if;

  select count(*)::int into v_total
  from app.counterparty t
  where not t.is_deleted
    and (
    coalesce(payload->>'search', '') = ''
    or t.code ilike '%' || (payload->>'search') || '%'
    or t.name ilike '%' || (payload->>'search') || '%'
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id::text,
      'name', t.name
    ) as r
    from app.counterparty t
    where not t.is_deleted
      and (
      coalesce(payload->>'search', '') = ''
      or t.code ilike '%' || (payload->>'search') || '%'
      or t.name ilike '%' || (payload->>'search') || '%'
    )
    order by
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

