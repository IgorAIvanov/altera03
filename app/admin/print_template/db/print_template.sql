drop function if exists app.print_template_index(jsonb);
create or replace function app.print_template_index(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page integer := greatest(coalesce((payload->>'page')::integer, 1), 1);
  v_page_size integer := least(greatest(coalesce((payload->>'pageSize')::integer, 20), 1), 200);
  v_offset integer := (v_page - 1) * v_page_size;
  v_sort_by text := coalesce(payload->>'sortBy', 'code');
  v_sort_direction text := lower(coalesce(payload->>'sortDirection', 'asc'));
  v_search text := nullif(trim(coalesce(payload->>'search', '')), '');
  v_target_model text := nullif(trim(coalesce(payload->>'targetModel', '')), '');
  v_is_active boolean := case
    when payload ? 'isActive' and payload->>'isActive' <> '' then (payload->>'isActive')::boolean
    else null
  end;
begin
  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', (
        select coalesce(jsonb_agg(row_to_json(row_data)), '[]'::jsonb)
        from (
          select
            pt.id::text as id,
            pt.code,
            pt.name,
            pt.target_model as "targetModel",
            pt.data_command as "dataCommand",
            pt.paper_size as "paperSize",
            pt.orientation,
            pt.is_default as "isDefault",
            pt.is_active as "isActive"
          from app.print_template pt
          where (v_search is null or pt.code ilike '%' || v_search || '%' or pt.name ilike '%' || v_search || '%')
            and (v_target_model is null or pt.target_model = v_target_model)
            and (v_is_active is null or pt.is_active = v_is_active)
          order by
            case when v_sort_by = 'name' and v_sort_direction = 'asc' then pt.name end asc,
            case when v_sort_by = 'name' and v_sort_direction = 'desc' then pt.name end desc,
            case when v_sort_by = 'targetModel' and v_sort_direction = 'asc' then pt.target_model end asc,
            case when v_sort_by = 'targetModel' and v_sort_direction = 'desc' then pt.target_model end desc,
            case when v_sort_by = 'isDefault' and v_sort_direction = 'asc' then pt.is_default end asc,
            case when v_sort_by = 'isDefault' and v_sort_direction = 'desc' then pt.is_default end desc,
            case when v_sort_by = 'isActive' and v_sort_direction = 'asc' then pt.is_active end asc,
            case when v_sort_by = 'isActive' and v_sort_direction = 'desc' then pt.is_active end desc,
            case when v_sort_by = 'code' and v_sort_direction = 'desc' then pt.code end desc,
            case when v_sort_by = 'code' and v_sort_direction = 'asc' then pt.code end asc,
            pt.code asc
          offset v_offset
          limit v_page_size
        ) row_data
      ),
      'lookups', jsonb_build_object(
        'targetModels', (
          select coalesce(jsonb_agg(jsonb_build_object('value', target_model, 'label', target_model) order by target_model), '[]'::jsonb)
          from (
            select distinct pt.target_model
            from app.print_template pt
            where pt.target_model is not null
              and pt.target_model <> ''
          ) target_models
        ),
        'orientations', jsonb_build_array(
          jsonb_build_object('value', 'portrait', 'label', 'Книжкова'),
          jsonb_build_object('value', 'landscape', 'label', 'Альбомна')
        )
      ),
      'totals', jsonb_build_object(
        'count', (
          select count(*)
          from app.print_template pt
          where (v_search is null or pt.code ilike '%' || v_search || '%' or pt.name ilike '%' || v_search || '%')
            and (v_target_model is null or pt.target_model = v_target_model)
            and (v_is_active is null or pt.is_active = v_is_active)
        ),
        'page', v_page,
        'pageSize', v_page_size
      ),
      'extra', '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
end;
$$;

drop function if exists app.print_template_load(jsonb);
create or replace function app.print_template_load(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id uuid := nullif(trim(coalesce(payload->>'id', '')), '')::uuid;
begin
  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', (
        select jsonb_build_object(
          'id', pt.id::text,
          'code', pt.code,
          'name', pt.name,
          'targetModel', pt.target_model,
          'dataCommand', pt.data_command,
          'paperSize', pt.paper_size,
          'orientation', pt.orientation,
          'isDefault', pt.is_default,
          'isActive', pt.is_active,
          'schema', pt.template_schema
        )
        from app.print_template pt
        where pt.id = v_id
      ),
      'lookups', jsonb_build_object(
        'targetModels', (
          select coalesce(jsonb_agg(jsonb_build_object('value', target_model, 'label', target_model) order by target_model), '[]'::jsonb)
          from (
            select distinct pt.target_model
            from app.print_template pt
            where pt.target_model is not null
              and pt.target_model <> ''
          ) target_models
        ),
        'orientations', jsonb_build_array(
          jsonb_build_object('value', 'portrait', 'label', 'Книжкова'),
          jsonb_build_object('value', 'landscape', 'label', 'Альбомна')
        ),
        'columnFields', jsonb_build_array(
          jsonb_build_object('value', 'index', 'label', '№'),
          jsonb_build_object('value', 'name', 'label', 'Найменування'),
          jsonb_build_object('value', 'unit', 'label', 'Од.'),
          jsonb_build_object('value', 'quantity', 'label', 'Кількість'),
          jsonb_build_object('value', 'price', 'label', 'Ціна'),
          jsonb_build_object('value', 'amount', 'label', 'Сума')
        ),
        'columnAlignments', jsonb_build_array(
          jsonb_build_object('value', 'left', 'label', 'Ліворуч'),
          jsonb_build_object('value', 'center', 'label', 'По центру'),
          jsonb_build_object('value', 'right', 'label', 'Праворуч')
        )
      ),
      'totals', '{}'::jsonb,
      'extra', '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
end;
$$;

drop function if exists app.print_template_update(jsonb);
create or replace function app.print_template_update(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item jsonb := coalesce(payload->'item', '{}'::jsonb);
  v_id uuid := nullif(trim(coalesce(v_item->>'id', '')), '')::uuid;
  v_code text := nullif(trim(coalesce(v_item->>'code', '')), '');
  v_name text := nullif(trim(coalesce(v_item->>'name', '')), '');
  v_target_model text := nullif(trim(coalesce(v_item->>'targetModel', '')), '');
  v_data_command text := nullif(trim(coalesce(v_item->>'dataCommand', '')), '');
  v_paper_size text := coalesce(v_item->>'paperSize', 'A4');
  v_orientation text := coalesce(v_item->>'orientation', 'portrait');
  v_is_default boolean := coalesce((v_item->>'isDefault')::boolean, false);
  v_is_active boolean := coalesce((v_item->>'isActive')::boolean, true);
  v_schema jsonb := coalesce(v_item->'schema', '{}'::jsonb);
  v_saved_id uuid;
begin
  if v_code is null then
    raise exception 'code is required';
  end if;

  if v_name is null then
    raise exception 'name is required';
  end if;

  if v_target_model is null then
    raise exception 'targetModel is required';
  end if;

  if v_is_default then
    update app.print_template
      set is_default = false,
          updated_at = now()
    where target_model = v_target_model
      and (v_id is null or id <> v_id);
  end if;

  if v_id is null then
    insert into app.print_template (
      code,
      name,
      target_model,
      data_command,
      paper_size,
      orientation,
      is_default,
      is_active,
      template_schema,
      updated_at
    ) values (
      v_code,
      v_name,
      v_target_model,
      coalesce(v_data_command, 'load'),
      v_paper_size,
      v_orientation,
      v_is_default,
      v_is_active,
      v_schema,
      now()
    )
    returning id into v_saved_id;
  else
    update app.print_template
      set code = v_code,
          name = v_name,
          target_model = v_target_model,
          data_command = coalesce(v_data_command, data_command),
          paper_size = v_paper_size,
          orientation = v_orientation,
          is_default = v_is_default,
          is_active = v_is_active,
          template_schema = v_schema,
          updated_at = now()
    where id = v_id
    returning id into v_saved_id;
  end if;

  return app.print_template_load(user_id, jsonb_build_object('id', v_saved_id::text));
end;
$$;

drop function if exists app.print_template_delete(jsonb);
create or replace function app.print_template_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id uuid := nullif(trim(coalesce(payload->>'id', '')), '')::uuid;
begin
  delete from app.print_template where id = v_id;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', '[]'::jsonb,
      'lookups', '{}'::jsonb,
      'totals', '{}'::jsonb,
      'extra', jsonb_build_object('deletedId', v_id::text)
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
end;
$$;

drop function if exists app.print_template_fetch(jsonb);
create or replace function app.print_template_fetch(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_search text := nullif(trim(coalesce(payload->>'search', '')), '');
  v_target_model text := nullif(trim(coalesce(payload->>'targetModel', '')), '');
  v_limit integer := least(greatest(coalesce((payload->>'limit')::integer, 50), 1), 100);
begin
  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object('value', pt.id::text, 'label', pt.name)), '[]'::jsonb)
        from (
          select id, name
          from app.print_template
          where is_active
            and (v_target_model is null or target_model = v_target_model)
            and (v_search is null or code ilike '%' || v_search || '%' or name ilike '%' || v_search || '%')
          order by is_default desc, code asc
          limit v_limit
        ) pt
      ),
      'lookups', '{}'::jsonb,
      'totals', '{}'::jsonb,
      'extra', '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
end;
$$;

drop function if exists app.print_template_resolve(jsonb);
create or replace function app.print_template_resolve(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_target_model text := nullif(trim(coalesce(payload->>'targetModel', '')), '');
begin
  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', (
        select jsonb_build_object(
          'id', pt.id::text,
          'code', pt.code,
          'name', pt.name,
          'targetModel', pt.target_model,
          'dataCommand', pt.data_command,
          'paperSize', pt.paper_size,
          'orientation', pt.orientation,
          'isDefault', pt.is_default,
          'isActive', pt.is_active,
          'schema', pt.template_schema
        )
        from app.print_template pt
        where pt.target_model = v_target_model
          and pt.is_active
        order by pt.is_default desc, pt.updated_at desc, pt.code asc
        limit 1
      ),
      'rows', '[]'::jsonb,
      'lookups', '{}'::jsonb,
      'totals', '{}'::jsonb,
      'extra', '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
end;
$$;