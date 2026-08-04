-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.
-- Джерело: nomenclature.schema.ts + manifest.json. Override — db/nomenclature.custom.sql


drop function if exists app.nomenclature_list(bigint, jsonb);
create function app.nomenclature_list(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 20), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', 'code');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
  v_group_ids bigint[] := (
    select array_agg(nullif(x, '')::bigint)
    from jsonb_array_elements_text(coalesce(payload->'groupIds', '[]'::jsonb)) x
  );
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('code', 'name') then
    v_sort_by := 'code';
  end if;

  select count(*)::int into v_total
  from app.nomenclature t
  where (
    coalesce(payload->>'search', '') = ''
    or t.code ilike '%' || (payload->>'search') || '%'
    or t.name ilike '%' || (payload->>'search') || '%'
  )
  and (v_group_ids is null or t.group_id in (
    with recursive grp as (
      select id from app.nomenclature_group where id = any(v_group_ids)
      union all
      select c.id from app.nomenclature_group c join grp on c.parent_id = grp.id
    )
    select id from grp
  ));

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id::text,
      'code', t.code,
      'name', t.name,
      'unit', t.unit,
      'isActive', t.is_active,
      'groupName', gr.name
    ) as r
    from app.nomenclature t
    left join app.nomenclature_group gr on gr.id = t.group_id
    where (
      coalesce(payload->>'search', '') = ''
      or t.code ilike '%' || (payload->>'search') || '%'
      or t.name ilike '%' || (payload->>'search') || '%'
    )
    and (v_group_ids is null or t.group_id in (
      with recursive grp as (
        select id from app.nomenclature_group where id = any(v_group_ids)
        union all
        select c.id from app.nomenclature_group c join grp on c.parent_id = grp.id
      )
      select id from grp
    ))
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

drop function if exists app.nomenclature_get(bigint, jsonb);
create function app.nomenclature_get(user_id bigint, payload jsonb)
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
        'unit', t.unit,
        'groupId', t.group_id::text,
        'isActive', t.is_active
      )
          from app.nomenclature t
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

drop function if exists app.nomenclature_save(bigint, jsonb);
create function app.nomenclature_save(user_id bigint, payload jsonb)
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

  merge into app.nomenclature t
  using (
    select
      nullif(v_item->>'id', '')::bigint as id,
      nullif(trim(coalesce(v_item->>'code', '')), '') as code,
      nullif(trim(coalesce(v_item->>'name', '')), '') as name,
      nullif(trim(coalesce(v_item->>'unit', '')), '') as unit,
      nullif(v_item->>'groupId', '')::bigint as group_id,
      (v_item->>'isActive')::boolean as is_active
  ) s
    on t.id = s.id
  when matched then update set
    code = s.code,
    name = s.name,
    unit = s.unit,
    group_id = s.group_id,
    is_active = coalesce(s.is_active, t.is_active),
    updated_at = now()
  when not matched then insert (code, name, unit, group_id, is_active)
    values (s.code, s.name, s.unit, s.group_id, coalesce(s.is_active, true))
  returning t.id into v_id;

  select jsonb_build_object(
        'id', t.id::text,
        'code', t.code,
        'name', t.name,
        'unit', t.unit,
        'groupId', t.group_id::text,
        'isActive', t.is_active
      ) into v_result
  from app.nomenclature t
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

drop function if exists app.nomenclature_delete(bigint, jsonb);
create function app.nomenclature_delete(user_id bigint, payload jsonb)
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

  delete from app.nomenclature where id = v_id;

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

drop function if exists app.nomenclature_lookup(bigint, jsonb);
create function app.nomenclature_lookup(user_id bigint, payload jsonb)
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
  from app.nomenclature t
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
      'name', t.name
    ) as r
    from app.nomenclature t
    where t.is_active = true
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

drop function if exists app.nomenclature_group_tree(bigint, jsonb);
create function app.nomenclature_group_tree(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', g.id::text,
            'parentId', g.parent_id::text,
            'name', g.name
          ) order by g.name)
          from app.nomenclature_group g
        ), '[]'::jsonb),
        'item',    null,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   '{}'::jsonb
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
$$;

drop function if exists app.nomenclature_group_save(bigint, jsonb);
create function app.nomenclature_group_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item   jsonb  := payload->'item';
  v_id     bigint := nullif(v_item->>'id', '')::bigint;
  v_parent bigint := nullif(v_item->>'parentId', '')::bigint;
  v_name   text   := nullif(trim(coalesce(v_item->>'name', '')), '');
  v_result jsonb;
begin
  if v_name is null then
    raise exception 'name обов''язковий';
  end if;

  if v_parent is not null and not exists (select 1 from app.nomenclature_group where id = v_parent) then
    raise exception 'Батьківської групи не існує';
  end if;

  -- Цикл: групу не можна переносити під саму себе чи власного нащадка.
  if v_id is not null and v_parent is not null then
    if exists (
      with recursive d as (
        select id from app.nomenclature_group where id = v_id
        union all
        select c.id from app.nomenclature_group c join d on c.parent_id = d.id
      )
      select 1 from d where id = v_parent
    ) then
      raise exception 'Група не може бути підгрупою власного нащадка';
    end if;
  end if;

  if v_id is null then
    insert into app.nomenclature_group (parent_id, name)
    values (v_parent, v_name)
    returning id into v_id;
  else
    update app.nomenclature_group
    set parent_id = v_parent, name = v_name, updated_at = now()
    where id = v_id;
    if not found then
      raise exception 'Групу не знайдено';
    end if;
  end if;

  select jsonb_build_object('id', g.id::text, 'parentId', g.parent_id::text, 'name', g.name)
  into v_result
  from app.nomenclature_group g
  where g.id = v_id;

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

drop function if exists app.nomenclature_group_delete(bigint, jsonb);
create function app.nomenclature_group_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  -- Fail-closed: непорожня група не видаляється — ні каскаду на підгрупи,
  -- ні тихого переносу елементів у корінь.
  if exists (select 1 from app.nomenclature_group where parent_id = v_id) then
    raise exception 'У групі є підгрупи — спочатку приберіть їх';
  end if;
  if exists (select 1 from app.nomenclature where group_id = v_id) then
    raise exception 'У групі є елементи — спочатку перемістіть їх';
  end if;

  delete from app.nomenclature_group where id = v_id;
  if not found then
    raise exception 'Групу не знайдено';
  end if;

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

drop function if exists app.nomenclature_move_to_group(bigint, jsonb);
create function app.nomenclature_move_to_group(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id    bigint := nullif(payload->>'id', '')::bigint;
  -- null — перемістити в корінь: окремої команди «з групи» немає навмисно,
  -- корінь — це просто ще одна ціль у тому самому діалозі.
  v_group bigint := nullif(payload->>'groupId', '')::bigint;
begin
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  if v_group is not null and not exists (select 1 from app.nomenclature_group where id = v_group) then
    raise exception 'Групи не існує';
  end if;

  update app.nomenclature
  set group_id = v_group, updated_at = now()
  where id = v_id;
  if not found then
    raise exception 'Запис не знайдено';
  end if;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item',    null,
        'rows',    '[]'::jsonb,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   jsonb_build_object('movedId', v_id::text)
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

