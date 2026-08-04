-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.
-- Джерело: organization.schema.ts + manifest.json. Override — db/organization.custom.sql


drop function if exists app.organization_list(bigint, jsonb);
create function app.organization_list(user_id bigint, payload jsonb)
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
  if v_sort_by not in ('code', 'name', 'edrpou') then
    v_sort_by := 'code';
  end if;

  select count(*)::int into v_total
  from app.organization t
  where (
    coalesce(payload->>'search', '') = ''
    or t.code ilike '%' || (payload->>'search') || '%'
    or t.name ilike '%' || (payload->>'search') || '%'
    or t.edrpou ilike '%' || (payload->>'search') || '%'
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id::text,
      'code', t.code,
      'name', t.name,
      'edrpou', t.edrpou,
      'isActive', t.is_active
    ) as r
    from app.organization t
    where (
      coalesce(payload->>'search', '') = ''
      or t.code ilike '%' || (payload->>'search') || '%'
      or t.name ilike '%' || (payload->>'search') || '%'
      or t.edrpou ilike '%' || (payload->>'search') || '%'
    )
    order by
      case when v_sort_by = 'code' and v_sort_dir = 'asc'  then t.code end asc,
      case when v_sort_by = 'code' and v_sort_dir = 'desc' then t.code end desc,
      case when v_sort_by = 'name' and v_sort_dir = 'asc'  then t.name end asc,
      case when v_sort_by = 'name' and v_sort_dir = 'desc' then t.name end desc,
      case when v_sort_by = 'edrpou' and v_sort_dir = 'asc'  then t.edrpou end asc,
      case when v_sort_by = 'edrpou' and v_sort_dir = 'desc' then t.edrpou end desc
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

drop function if exists app.organization_get(bigint, jsonb);
create function app.organization_get(user_id bigint, payload jsonb)
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
        'fullName', t.full_name,
        'edrpou', t.edrpou,
        'prefix', t.prefix,
        'legalPersonKind', t.legal_person_kind,
        'logoId', t.logo_id::text,
        'logoToken', (select b.access_key from app.attachment b where b.id = t.logo_id),
        'isActive', t.is_active
      )
          from app.organization t
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

drop function if exists app.organization_save(bigint, jsonb);
create function app.organization_save(user_id bigint, payload jsonb)
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

  merge into app.organization t
  using (
    select
      nullif(v_item->>'id', '')::bigint as id,
      nullif(trim(coalesce(v_item->>'code', '')), '') as code,
      nullif(trim(coalesce(v_item->>'name', '')), '') as name,
      nullif(trim(coalesce(v_item->>'fullName', '')), '') as full_name,
      nullif(trim(coalesce(v_item->>'edrpou', '')), '') as edrpou,
      nullif(trim(coalesce(v_item->>'prefix', '')), '') as prefix,
      nullif(trim(coalesce(v_item->>'legalPersonKind', '')), '') as legal_person_kind,
      nullif(v_item->>'logoId', '')::bigint as logo_id,
      (v_item->>'isActive')::boolean as is_active
  ) s
    on t.id = s.id
  when matched then update set
    code = s.code,
    name = s.name,
    full_name = s.full_name,
    edrpou = s.edrpou,
    prefix = s.prefix,
    legal_person_kind = coalesce(s.legal_person_kind, t.legal_person_kind),
    logo_id = s.logo_id,
    is_active = coalesce(s.is_active, t.is_active),
    updated_at = now()
  when not matched then insert (code, name, full_name, edrpou, prefix, legal_person_kind, logo_id, is_active)
    values (s.code, s.name, s.full_name, s.edrpou, s.prefix, coalesce(s.legal_person_kind, 'legal_entity'), s.logo_id, coalesce(s.is_active, true))
  returning t.id into v_id;

  select jsonb_build_object(
        'id', t.id::text,
        'code', t.code,
        'name', t.name,
        'fullName', t.full_name,
        'edrpou', t.edrpou,
        'prefix', t.prefix,
        'legalPersonKind', t.legal_person_kind,
        'logoId', t.logo_id::text,
        'logoToken', (select b.access_key from app.attachment b where b.id = t.logo_id),
        'isActive', t.is_active
      ) into v_result
  from app.organization t
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

drop function if exists app.organization_delete(bigint, jsonb);
create function app.organization_delete(user_id bigint, payload jsonb)
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

  delete from app.organization where id = v_id;

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

drop function if exists app.organization_lookup(bigint, jsonb);
create function app.organization_lookup(user_id bigint, payload jsonb)
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
  if v_sort_by not in ('name', 'edrpou') then
    v_sort_by := 'name';
  end if;

  select count(*)::int into v_total
  from app.organization t
  where t.is_active = true
    and (
    coalesce(payload->>'search', '') = ''
    or t.code ilike '%' || (payload->>'search') || '%'
    or t.name ilike '%' || (payload->>'search') || '%'
    or t.edrpou ilike '%' || (payload->>'search') || '%'
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id::text,
      'name', t.name,
      'edrpou', t.edrpou
    ) as r
    from app.organization t
    where t.is_active = true
      and (
      coalesce(payload->>'search', '') = ''
      or t.code ilike '%' || (payload->>'search') || '%'
      or t.name ilike '%' || (payload->>'search') || '%'
      or t.edrpou ilike '%' || (payload->>'search') || '%'
    )
    order by
      case when v_sort_by = 'name' and v_sort_dir = 'asc'  then t.name end asc,
      case when v_sort_by = 'name' and v_sort_dir = 'desc' then t.name end desc,
      case when v_sort_by = 'edrpou' and v_sort_dir = 'asc'  then t.edrpou end asc,
      case when v_sort_by = 'edrpou' and v_sort_dir = 'desc' then t.edrpou end desc
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

