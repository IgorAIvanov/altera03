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
  -- Ключі моделей, чия НАЗВА збіглася з пошуком. Рахує їх клієнт: назва живе в
  -- його локалях (той самий довід, що з маркерами `@[…]`), а тут лежить ключ.
  v_keys      jsonb := coalesce(payload->'modelKeys', '[]'::jsonb);
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('kind', 'modelKey', 'status', 'content') then
    v_sort_by := 'modelKey';
  end if;

  select count(*)::int into v_total
  from app.agent_note n
  where v_search is null
     or n.content ilike '%' || v_search || '%'
     or n.model_key ilike '%' || v_search || '%'
     or n.model_key in (select jsonb_array_elements_text(v_keys));

  select coalesce(jsonb_agg(r order by ord), '[]'::jsonb) into v_rows
  from (
    select
      jsonb_build_object(
        'id',       n.id::text,
        'kind',     n.kind,
        'modelKey', n.model_key,
        'title',    coalesce(n.title, ''),
        'summary',  coalesce(n.summary, ''),
        'content',  n.content,
        'status',   n.status,
        'source',   n.source
      ) as r,
      row_number() over (
        order by
          case when v_sort_by = 'kind'     and v_sort_dir = 'asc'  then n.kind      end asc,
          case when v_sort_by = 'kind'     and v_sort_dir = 'desc' then n.kind      end desc,
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
       or n.model_key in (select jsonb_array_elements_text(v_keys))
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
    'kind',     n.kind,
    'modelKey', n.model_key,
    'slug',     coalesce(n.slug, ''),
    'title',    coalesce(n.title, ''),
    'summary',  coalesce(n.summary, ''),
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
  v_kind    text  := case when v_item->>'kind' = 'topic' then 'topic' else 'note' end;
  v_slug    text  := nullif(btrim(coalesce(v_item->>'slug', '')), '');
  v_title   text  := nullif(btrim(coalesce(v_item->>'title', '')), '');
  v_summary text  := nullif(btrim(coalesce(v_item->>'summary', '')), '');
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

  -- Тема без покажчика не доїде до агента ніколи: у переліку стоятиме порожній
  -- рядок, і відкривати її ніхто не піде. Три поля разом або жодного.
  if v_kind = 'topic' and (v_slug is null or v_title is null or v_summary is null) then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object('item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb),
      'messages', jsonb_build_array(
        jsonb_build_object('type', 'error', 'text', '@[core.agentNoteTopicIncomplete]', 'field', 'summary')
      )
    );
  end if;

  -- У записки полів теми немає — інакше вони лишалися б від виду, який
  -- перемкнули, і `slug` мовчки тримав би зайняте ім'я.
  if v_kind = 'note' then
    v_slug := null;
    v_title := null;
    v_summary := null;
  end if;

  if v_id is null then
    insert into app.agent_note (model_key, kind, slug, title, summary, content, status, source, updated_by)
    values (v_model, v_kind, v_slug, v_title, v_summary, v_content, v_status, 'admin', user_id)
    returning id into v_id;
  else
    update app.agent_note
       set model_key  = v_model,
           kind       = v_kind,
           slug       = v_slug,
           title      = v_title,
           summary    = v_summary,
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
