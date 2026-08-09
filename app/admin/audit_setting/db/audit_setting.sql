-- CRUD моделі audit_setting — admin-екран «Налаштування журналу».
--
-- Сама таблиця живе в ядрі (@core/audit): рівень читає рантайм на кожній
-- команді, тож без неї не працює жоден застосунок. Тут — лише читання й правка
-- рівня, тобто те, що належить інтерфейсу застосунку.
--
-- Стандартна трійка написана вручну (як у нумераторів): первинний ключ —
-- КЛЮЧ МОДЕЛІ (varchar), а codegen працює з bigint id.
--
-- Команд create/delete немає навмисно: перелік моделей сіє деплой
-- (_generated/audit-settings.data.sql), і рядок, заведений руками, означав би
-- налаштування для моделі, якої немає, а видалений — модель, для якої журнал
-- більше не ввімкнути з екрана.

drop function if exists app.audit_setting_list(bigint, jsonb);
create function app.audit_setting_list(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := least(greatest(coalesce((payload->>'pageSize')::int, 20), 1), 200);
  v_sort_by   text := coalesce(payload->>'sortBy', 'id');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir', 'asc')) = 'desc' then 'desc' else 'asc' end;
  v_search    text := nullif(trim(coalesce(payload->>'search', '')), '');
  -- Ключі моделей, чия НАЗВА збіглася з пошуком. Рахує їх клієнт: у базі лежить
  -- ключ (`bank`), а на екрані стоїть назва («Банки»), і переклад живе в
  -- локалях клієнта — той самий довід, що з маркерами `@[…]`. Без цього пошук
  -- по видимій колонці не знаходив би нічого.
  v_keys      jsonb := coalesce(payload->'modelKeys', '[]'::jsonb);
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('id', 'level') then
    v_sort_by := 'id';
  end if;

  select count(*)::int into v_total
  from app.audit_setting s
  where (v_search is null
     or s.model ilike '%' || v_search || '%'
     or s.model in (select jsonb_array_elements_text(v_keys)));

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id',    s.model,
      'level', s.level
    ) as r
    from app.audit_setting s
    where (v_search is null
       or s.model ilike '%' || v_search || '%'
       or s.model in (select jsonb_array_elements_text(v_keys)))
    order by
      case when v_sort_by = 'id'    and v_sort_dir = 'asc'  then s.model end asc,
      case when v_sort_by = 'id'    and v_sort_dir = 'desc' then s.model end desc,
      case when v_sort_by = 'level' and v_sort_dir = 'asc'  then s.level end asc,
      case when v_sort_by = 'level' and v_sort_dir = 'desc' then s.level end desc,
      s.model asc
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
    'messages', '[]'::jsonb
  );
end;
$$;

drop function if exists app.audit_setting_get(bigint, jsonb);
create function app.audit_setting_get(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_model varchar := nullif(trim(coalesce(payload->>'id', '')), '');
  v_item  jsonb;
begin
  select jsonb_build_object(
    'id',    s.model,
    'level', s.level,
    -- Скільки подій цієї моделі вже в журналі: єдина відповідь на питання
    -- «чи справді пишеться», яку видно на самому екрані налаштування.
    'eventCount', (select count(*) from app.audit_log l where l.model = s.model)::text
  ) into v_item
  from app.audit_setting s
  where s.model = v_model;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item',    v_item,
      'rows',    '[]'::jsonb,
      'options', '{}'::jsonb,
      'totals',  '{}'::jsonb,
      'extra',   '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
end;
$$;

drop function if exists app.audit_setting_save(bigint, jsonb);
create function app.audit_setting_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item  jsonb   := payload->'item';
  v_model varchar := nullif(trim(coalesce(v_item->>'id', '')), '');
  v_level varchar := coalesce(nullif(trim(coalesce(v_item->>'level', '')), ''), 'none');
begin
  if v_model is null or not exists (select 1 from app.audit_setting s where s.model = v_model) then
    raise exception '@[auditSetting.unknownModel]%', jsonb_build_object('model', coalesce(v_model, ''))::text;
  end if;

  if v_level not in ('none', 'changes', 'all') then
    raise exception '@[auditSetting.unknownLevel]%', jsonb_build_object('level', v_level)::text
      using column = 'level';
  end if;

  update app.audit_setting s
  set level = v_level,
      updated_at = now()
  where s.model = v_model;

  return app.audit_setting_get(user_id, jsonb_build_object('id', v_model));
end;
$$;
