-- CRUD пам'ятки бази — admin-екран «Пам'ятка бази».
--
-- Сама таблиця живе в ядрі (@core/agent_note): доставку записок агенту робить
-- фреймворк, і без таблиці не працює вона, а не екран. Тут — лише перелік,
-- правка й підтвердження, тобто те, що належить інтерфейсу застосунку. Та сама
-- межа, що в налаштуваннях журналу.
--
-- Написано руками (`"sql": { "generate": false }`), бо генератор не потрібен:
-- полів чотири, позначки на видалення немає, а `delete` тут ФІЗИЧНИЙ і це
-- свідомо — записка не облікові дані, слід від неї лишається в `audit_log`, а
-- позначена на видалення записка означала б рядок, який видно в переліку й не
-- видно агенту, тобто третій стан поруч із чернеткою.

drop function if exists app.agent_note_list(bigint, jsonb);
create function app.agent_note_list(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := least(greatest(coalesce((payload->>'pageSize')::int, 20), 1), 200);
  v_sort_by   text := coalesce(payload->>'sortBy', 'modelKey');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir', 'asc')) = 'desc' then 'desc' else 'asc' end;
  v_search    text := nullif(trim(coalesce(payload->>'search', '')), '');
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('modelKey', 'status', 'content') then
    v_sort_by := 'modelKey';
  end if;

  select count(*)::int into v_total
  from app.agent_note n
  where v_search is null
     or n.content ilike '%' || v_search || '%'
     or n.model_key ilike '%' || v_search || '%';

  select coalesce(jsonb_agg(r order by ord), '[]'::jsonb) into v_rows
  from (
    select
      jsonb_build_object(
        'id',       n.id::text,
        'modelKey', n.model_key,
        'content',  n.content,
        'status',   n.status,
        'source',   n.source
      ) as r,
      row_number() over (
        order by
          case when v_sort_by = 'modelKey' and v_sort_dir = 'asc'  then n.model_key end asc,
          case when v_sort_by = 'modelKey' and v_sort_dir = 'desc' then n.model_key end desc,
          case when v_sort_by = 'status'   and v_sort_dir = 'asc'  then n.status    end asc,
          case when v_sort_by = 'status'   and v_sort_dir = 'desc' then n.status    end desc,
          case when v_sort_by = 'content'  and v_sort_dir = 'asc'  then n.content   end asc,
          case when v_sort_by = 'content'  and v_sort_dir = 'desc' then n.content   end desc,
          n.id
      ) as ord
    from app.agent_note n
    where v_search is null
       or n.content ilike '%' || v_search || '%'
       or n.model_key ilike '%' || v_search || '%'
    order by ord
    limit v_page_size offset (v_page - 1) * v_page_size
  ) t;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', v_rows,
      'options', '{}'::jsonb,
      'totals', jsonb_build_object('count', v_total, 'page', v_page, 'pageSize', v_page_size)
    ),
    'messages', '[]'::jsonb
  );
end;
$$;

drop function if exists app.agent_note_get(bigint, jsonb);
create function app.agent_note_get(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_id   bigint := nullif(payload->>'id', '')::bigint;
  v_item jsonb;
begin
  select jsonb_build_object(
    'id',       n.id::text,
    'modelKey', n.model_key,
    'content',  n.content,
    'status',   n.status,
    'source',   n.source
  ) into v_item
  from app.agent_note n
  where n.id = v_id;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object('item', v_item, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb),
    'messages', '[]'::jsonb
  );
end;
$$;

drop function if exists app.agent_note_save(bigint, jsonb);
create function app.agent_note_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item    jsonb := coalesce(payload->'item', '{}'::jsonb);
  v_id      bigint := nullif(v_item->>'id', '')::bigint;
  v_model   text  := coalesce(nullif(trim(v_item->>'modelKey'), ''), '*');
  v_content text  := nullif(btrim(coalesce(v_item->>'content', '')), '');
  v_status  text  := coalesce(nullif(v_item->>'status', ''), 'draft');
begin
  if v_content is null then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object('item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb),
      'messages', jsonb_build_array(
        jsonb_build_object('type', 'error', 'text', '@[core.agentNoteEmpty]', 'field', 'content')
      )
    );
  end if;

  if v_status not in ('draft', 'confirmed') then
    v_status := 'draft';
  end if;

  if v_id is null then
    insert into app.agent_note (model_key, content, status, source, updated_by)
    values (v_model, v_content, v_status, 'admin', user_id)
    returning id into v_id;
  else
    update app.agent_note
       set model_key  = v_model,
           content    = v_content,
           status     = v_status,
           updated_at = now(),
           updated_by = user_id
     where id = v_id;
  end if;

  return app.agent_note_get(user_id, jsonb_build_object('id', v_id::text));
end;
$$;

drop function if exists app.agent_note_delete(bigint, jsonb);
create function app.agent_note_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  delete from app.agent_note where id = v_id;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', jsonb_build_object('id', v_id::text),
      'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
end;
$$;
