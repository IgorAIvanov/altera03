-- CRUD моделі numerator — потрібен лише admin-екрану налаштування нумерації.
--
-- Сам механізм (numerator_next, bump, пересів) живе в ядрі (@core/numerator);
-- тут тільки читання й правка правила. Стандартна трійка написана вручну, бо
-- первинний ключ — ключ моделі (varchar), а codegen працює з bigint id.
--
-- Команд delete/lookup немає навмисно: нумератори заводить деплой із
-- манифестів, і видалення рядка зламало б видачу номерів моделі («нумератор не
-- налаштовано» на першому ж записі). Екран лише редагує наявні.

drop function if exists app.numerator_list(bigint, jsonb);
create function app.numerator_list(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := least(greatest(coalesce((payload->>'pageSize')::int, 20), 1), 200);
  v_sort_by   text := coalesce(payload->>'sortBy', 'id');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir', 'asc')) = 'desc' then 'desc' else 'asc' end;
  v_search    text := nullif(trim(coalesce(payload->>'search', '')), '');
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('id', 'name', 'template') then
    v_sort_by := 'id';
  end if;

  select count(*)::int into v_total
  from app.numerator n
  where (v_search is null
     or n.model ilike '%' || v_search || '%'
     or n.name ilike '%' || v_search || '%'
     or n.template ilike '%' || v_search || '%');

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id',       n.model,
      'name',     n.name,
      'template', n.template,
      'period',   n.period,
      'strategy', n.strategy
    ) as r
    from app.numerator n
    where (v_search is null
       or n.model ilike '%' || v_search || '%'
       or n.name ilike '%' || v_search || '%'
       or n.template ilike '%' || v_search || '%')
    order by
      case when v_sort_by = 'id'       and v_sort_dir = 'asc'  then n.model end asc,
      case when v_sort_by = 'id'       and v_sort_dir = 'desc' then n.model end desc,
      case when v_sort_by = 'name'     and v_sort_dir = 'asc'  then n.name end asc,
      case when v_sort_by = 'name'     and v_sort_dir = 'desc' then n.name end desc,
      case when v_sort_by = 'template' and v_sort_dir = 'asc'  then n.template end asc,
      case when v_sort_by = 'template' and v_sort_dir = 'desc' then n.template end desc,
      n.model asc
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

drop function if exists app.numerator_get(bigint, jsonb);
create function app.numerator_get(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_model varchar := nullif(trim(coalesce(payload->>'id', '')), '');
  v_item  jsonb;
  v_rows  jsonb := '[]'::jsonb;
  v_warn  text;
begin
  select jsonb_build_object(
    'id',         n.model,
    'name',       n.name,
    'template',   n.template,
    'period',     n.period,
    'strategy',   n.strategy,
    'isEditable', n.is_editable,
    -- Період прив'язаний до дати документа, тож форма вмикає його вибір лише
    -- документам. Тип моделі живе в манифесті, але документи зареєстровані в
    -- app.document_type — цього досить.
    'isDocument', exists (select 1 from app.document_type dt where dt.code = n.model)
  ) into v_item
  from app.numerator n
  where n.model = v_model;

  if v_item is not null then
    -- Стан лічильників по областях. Для strategy = sequence рядок стану — лише
    -- точка засіву і на кожній видачі не оновлюється, тож ФАКТИЧНЕ значення
    -- береться з самої послідовності, коли вона вже існує.
    select coalesce(jsonb_agg(jsonb_build_object(
      'scopeKey',  s.scope_key,
      'lastValue', greatest(
        s.last_value,
        case when to_regclass(app.numerator_sequence_name(s.model, s.scope_key)) is not null
          then coalesce(pg_sequence_last_value(app.numerator_sequence_name(s.model, s.scope_key)::regclass), 0)
          else 0
        end
      )::text
    ) order by s.scope_key), '[]'::jsonb) into v_rows
    from app.numerator_state s
    where s.model = v_model;

    -- Порожній префікс при {ORG} у шаблоні: індекс унікальності такі номери
    -- пропустить (організація в його ключі окремо), але ЛЮДИНА їх не
    -- розрізнить. Тому не відмова, а попередження.
    if v_item->>'template' ~ '\{ORG\}' then
      select string_agg(o.name, ', ' order by o.name) into v_warn
      from app.organization o
      where not o.is_deleted
        and nullif(trim(coalesce(o.prefix, '')), '') is null;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item',    v_item,
      'rows',    v_rows,
      'options', '{}'::jsonb,
      'totals',  '{}'::jsonb,
      'extra',   '{}'::jsonb
    ),
    'messages', case when v_warn is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
      'type', 'warning',
      'text', '@[numerator.orgPrefixMissing]' || jsonb_build_object('orgs', v_warn)::text
    )) end,
    'meta', '{}'::jsonb
  );
end;
$$;

drop function if exists app.numerator_save(bigint, jsonb);
create function app.numerator_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item     jsonb   := payload->'item';
  v_model    varchar := nullif(trim(coalesce(v_item->>'id', '')), '');
  v_period   varchar := coalesce(nullif(trim(coalesce(v_item->>'period', '')), ''), 'none');
  v_strategy varchar := coalesce(nullif(trim(coalesce(v_item->>'strategy', '')), ''), 'counter');
begin
  -- Створення нового рядка з екрана неможливе свідомо: нумератор без моделі,
  -- що ним користується, — сміття, а модель оголошує нумерацію в manifest.json
  -- і сіється деплоєм.
  if v_model is null or not exists (select 1 from app.numerator n where n.model = v_model) then
    raise exception 'Нумератори заводить деплой із манифестів; редагувати можна лише наявний';
  end if;

  if nullif(trim(coalesce(v_item->>'name', '')), '') is null then
    raise exception '@[common.fieldRequired]' using column = 'name';
  end if;
  if nullif(trim(coalesce(v_item->>'template', '')), '') is null then
    raise exception '@[common.fieldRequired]' using column = 'template';
  end if;
  if v_strategy not in ('counter', 'sequence') then
    raise exception '@[numerator.unknownStrategy]%', jsonb_build_object('strategy', v_strategy)::text
      using hint = 'Доступні: counter, sequence', column = 'strategy';
  end if;

  -- Усі правила шаблона й періоду — в одній функції з сідом (numerator_validate),
  -- тип моделі виводиться з реєстру типів документів.
  perform app.numerator_validate(
    v_item->>'template',
    v_period,
    exists (select 1 from app.document_type dt where dt.code = v_model)
  );

  update app.numerator n set
    name        = v_item->>'name',
    template    = v_item->>'template',
    period      = v_period,
    strategy    = v_strategy,
    is_editable = coalesce((v_item->>'isEditable')::boolean, true),
    updated_at  = now()
  where n.model = v_model;

  -- Пересів ЗАВЖДИ, а не лише при зміні стратегії: шаблон і період входять у
  -- ключ області, тож будь-яка правка може лишити лічильник під старим ключем
  -- — і перший же запис узяв би номер 1 та впав на унікальності. Пересів
  -- ідемпотентний (читає фактично видані номери, лічильник лише підіймається),
  -- тому зайвий виклик безпечний.
  perform app.numerator_reseed(v_model);

  -- Відповідь = get: форма одразу бачить пересіяні лічильники й попередження
  -- про порожні префікси, якщо правка його породила.
  return app.numerator_get(user_id, jsonb_build_object('id', v_model));
end;
$$;
