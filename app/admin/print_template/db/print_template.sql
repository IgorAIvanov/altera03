-- CRUD моделі print_template — потрібен лише формам редагування шаблонів.
--
-- Ядру для друку цих функцій не треба: воно бере шаблон через
-- app.print_template_resolve (див. _sqlinit/print_template).
--
-- Стандартна п'ятірка написана вручну (а не генератором), бо `template_schema`
-- — довільний jsonb-документ, який codegen не описує.

drop function if exists app.print_template_list(bigint, jsonb);
create function app.print_template_list(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page         int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size    int  := least(greatest(coalesce((payload->>'pageSize')::int, 20), 1), 200);
  v_sort_by      text := coalesce(payload->>'sortBy', 'code');
  v_sort_dir     text := case when lower(coalesce(payload->>'sortDir', 'asc')) = 'desc' then 'desc' else 'asc' end;
  v_search       text := nullif(trim(coalesce(payload->>'search', '')), '');
  v_target_model text := nullif(trim(coalesce(payload->>'targetModel', '')), '');
  v_rows         jsonb;
  v_total        int;
begin
  if v_sort_by not in ('code', 'name', 'targetModel', 'isDefault', 'isActive') then
    v_sort_by := 'code';
  end if;

  select count(*)::int into v_total
  from app.print_template t
  where (v_search is null or t.code ilike '%' || v_search || '%' or t.name ilike '%' || v_search || '%')
    and (v_target_model is null or t.target_model = v_target_model);

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id',          t.id::text,
      'code',        t.code,
      'name',        t.name,
      'targetModel', t.target_model,
      'dataCommand', t.data_command,
      'paperSize',   t.paper_size,
      'orientation', t.orientation,
      'isDefault',   t.is_default,
      'isActive',    t.is_active
    ) as r
    from app.print_template t
    where (v_search is null or t.code ilike '%' || v_search || '%' or t.name ilike '%' || v_search || '%')
      and (v_target_model is null or t.target_model = v_target_model)
    order by
      case when v_sort_by = 'code'        and v_sort_dir = 'asc'  then t.code end asc,
      case when v_sort_by = 'code'        and v_sort_dir = 'desc' then t.code end desc,
      case when v_sort_by = 'name'        and v_sort_dir = 'asc'  then t.name end asc,
      case when v_sort_by = 'name'        and v_sort_dir = 'desc' then t.name end desc,
      case when v_sort_by = 'targetModel' and v_sort_dir = 'asc'  then t.target_model end asc,
      case when v_sort_by = 'targetModel' and v_sort_dir = 'desc' then t.target_model end desc,
      case when v_sort_by = 'isDefault'   and v_sort_dir = 'asc'  then t.is_default end asc,
      case when v_sort_by = 'isDefault'   and v_sort_dir = 'desc' then t.is_default end desc,
      case when v_sort_by = 'isActive'    and v_sort_dir = 'asc'  then t.is_active end asc,
      case when v_sort_by = 'isActive'    and v_sort_dir = 'desc' then t.is_active end desc,
      t.code asc
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

drop function if exists app.print_template_get(bigint, jsonb);
create function app.print_template_get(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', (
        select jsonb_build_object(
          'id',          t.id::text,
          'code',        t.code,
          'name',        t.name,
          'targetModel', t.target_model,
          'dataCommand', t.data_command,
          'paperSize',   t.paper_size,
          'orientation', t.orientation,
          'isDefault',   t.is_default,
          'isActive',    t.is_active,
          'schema',      t.template_schema
        )
        from app.print_template t
        where t.id = nullif(payload->>'id', '')::bigint
      ),
      'rows',    '[]'::jsonb,
      'options', jsonb_build_object(
        'targetModels', (
          select coalesce(jsonb_agg(jsonb_build_object('value', target_model, 'label', target_model) order by target_model), '[]'::jsonb)
          from (
            select distinct t.target_model
            from app.print_template t
            where coalesce(t.target_model, '') <> ''
          ) models
        )
      ),
      'totals',  '{}'::jsonb,
      'extra',   '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
$$;

drop function if exists app.print_template_save(bigint, jsonb);
create function app.print_template_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item         jsonb   := coalesce(payload->'item', '{}'::jsonb);
  v_id           bigint  := nullif(v_item->>'id', '')::bigint;
  v_code         text    := nullif(trim(coalesce(v_item->>'code', '')), '');
  v_name         text    := nullif(trim(coalesce(v_item->>'name', '')), '');
  v_target_model text    := nullif(trim(coalesce(v_item->>'targetModel', '')), '');
  v_data_command text    := coalesce(nullif(trim(coalesce(v_item->>'dataCommand', '')), ''), 'get');
  v_paper_size   text    := coalesce(nullif(v_item->>'paperSize', ''), 'A4');
  v_orientation  text    := coalesce(nullif(v_item->>'orientation', ''), 'portrait');
  v_is_default   boolean := coalesce((v_item->>'isDefault')::boolean, false);
  v_is_active    boolean := coalesce((v_item->>'isActive')::boolean, true);
  v_schema       jsonb   := coalesce(v_item->'schema', '{}'::jsonb);
begin
  if v_code is null then
    raise exception '@[common.fieldRequired]' using column = 'code';
  end if;
  if v_name is null then
    raise exception '@[common.fieldRequired]' using column = 'name';
  end if;
  if v_target_model is null then
    raise exception '@[common.fieldRequired]' using column = 'target_model';
  end if;

  -- Шаблон за замовчуванням єдиний на модель: знімаємо прапорець з решти ДО
  -- запису, інакше частковий унікальний індекс відхилить insert/update.
  if v_is_default then
    update app.print_template
       set is_default = false,
           updated_at = now()
     where target_model = v_target_model
       and (v_id is null or id <> v_id)
       and is_default;
  end if;

  merge into app.print_template t
  using (
    select
      v_id           as id,
      v_code         as code,
      v_name         as name,
      v_target_model as target_model,
      v_data_command as data_command,
      v_paper_size   as paper_size,
      v_orientation  as orientation,
      v_is_default   as is_default,
      v_is_active    as is_active,
      v_schema       as template_schema
  ) s
    on t.id = s.id
  when matched then update set
    code            = s.code,
    name            = s.name,
    target_model    = s.target_model,
    data_command    = s.data_command,
    paper_size      = s.paper_size,
    orientation     = s.orientation,
    is_default      = s.is_default,
    is_active       = s.is_active,
    template_schema = s.template_schema,
    updated_at      = now()
  when not matched then insert (
    code, name, target_model, data_command, paper_size, orientation, is_default, is_active, template_schema
  ) values (
    s.code, s.name, s.target_model, s.data_command, s.paper_size, s.orientation, s.is_default, s.is_active, s.template_schema
  )
  returning t.id into v_id;

  return app.print_template_get(user_id, jsonb_build_object('id', v_id::text));
end;
$$;

drop function if exists app.print_template_delete(bigint, jsonb);
create function app.print_template_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  delete from app.print_template where id = v_id;

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

drop function if exists app.print_template_lookup(bigint, jsonb);
create function app.print_template_lookup(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_search       text := nullif(trim(coalesce(payload->>'search', '')), '');
  v_target_model text := nullif(trim(coalesce(payload->>'targetModel', '')), '');
  v_limit        int  := least(greatest(coalesce((payload->>'limit')::int, 20), 1), 100);
  v_rows         jsonb;
begin
  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id',   t.id::text,
      'name', t.name,
      'code', t.code
    ) as r
    from app.print_template t
    where t.is_active
      and (v_target_model is null or t.target_model = v_target_model)
      and (v_search is null or t.code ilike '%' || v_search || '%' or t.name ilike '%' || v_search || '%')
    order by t.is_default desc, t.code asc
    limit v_limit
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
