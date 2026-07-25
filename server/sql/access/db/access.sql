-- Функції підсистеми доступу.
--
-- Дві групи:
--   1. app.access_* — перевірка права. Це те, на що спирається і рантайм, і
--      застосунок; ім'я моделі збігається з тим, що приходить у
--      ModelRuntimeService.execute(model, command, ...).
--   2. app.user_* / app.user_group_* — звичайний модельний контракт
--      (list / get / save / delete / lookup), щоб застосунок міг зробити
--      будь-які екрани керування доступом, не вигадуючи запитів.
--
-- Паролів тут немає: хеш рахує TS (PBKDF2-SHA256). app.user_save створює
-- користувача з порожнім хешем — увійти під ним не можна, доки пароль не
-- встановлять через auth-модуль. Так схема хешування лишається в одному місці.

-- ── Службове ───────────────────────────────────────────────────────────────

/** Порожня частина `data` конверта — щоб відповіді-помилки мали ту саму форму. */
drop function if exists app.access_empty_data();
create function app.access_empty_data()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'item', null,
    'rows', '[]'::jsonb,
    'options', '{}'::jsonb,
    'totals', '{}'::jsonb
  );
$$;

-- ── Перевірка права ────────────────────────────────────────────────────────

/**
 * Чи дозволена дія над моделлю цьому користувачеві.
 * Право дає будь-яка активна група, у якій він складається; запис із model='*'
 * діє на всі моделі. Відсутність запису — заборона.
 */
drop function if exists app.access_can(bigint, text, text);
create function app.access_can(p_user_id bigint, p_model text, p_action text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from app.user_group_member m
    join app.user_group g on g.id = m.user_group_id and g.is_active
    join app.user_group_permission p on p.user_group_id = g.id
    where m.user_id = p_user_id
      and m.is_active
      and p.is_allowed
      and p.action = p_action
      and (p.model = '*' or p.model = p_model)
  );
$$;

/**
 * Відмова у праві — у тому самому конверті, що й будь-яка інша відповідь.
 *
 * Живе в SQL, бо саме звідси й повертається: рантайм не питає право окремим
 * запитом, а вкладає перевірку в той самий `select`, що викликає команду
 * (`case when access_can(...) then <команда>(...) else access_denied(...) end`).
 * Один round-trip, і команда при відмові навіть не виконується — CASE не
 * обчислює невибрану гілку.
 */
drop function if exists app.access_denied(text, text);
create function app.access_denied(p_model text, p_action text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'ok', false,
    'data', app.access_empty_data(),
    'messages', jsonb_build_array(
      format('Немає права «%s» на модель «%s»', p_action, p_model)
    )
  );
$$;

/**
 * Ефективні права користувача — плоский список (model, action).
 * Застосунку зручно отримати його один раз і вимикати кнопки локально,
 * не питаючи сервер на кожен елемент.
 */
drop function if exists app.access_effective(bigint, jsonb);
create function app.access_effective(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with target as (
    select coalesce(nullif(payload->>'userId', '')::bigint, user_id) as uid
  ),
  granted as (
    select distinct p.model, p.action
    from app.user_group_member m
    join app.user_group g on g.id = m.user_group_id and g.is_active
    join app.user_group_permission p on p.user_group_id = g.id
    cross join target t
    where m.user_id = t.uid
      and m.is_active
      and p.is_allowed
    order by p.model, p.action
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((select jsonb_agg(jsonb_build_object('model', model, 'action', action)) from granted), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', jsonb_build_object('count', (select count(*) from granted))
    ),
    'messages', '[]'::jsonb
  );
$$;

-- ── Користувачі ────────────────────────────────────────────────────────────

drop function if exists app.user_list(bigint, jsonb);
create function app.user_list(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      coalesce(payload->>'search', '')                              as search,
      greatest(coalesce((payload->>'page')::int, 1), 1)             as page,
      least(greatest(coalesce((payload->>'pageSize')::int, 20), 1), 200) as page_size,
      coalesce(nullif(payload->>'sortBy', ''), 'login')             as sort_by,
      case lower(coalesce(payload->>'sortDir', 'asc')) when 'desc' then 'desc' else 'asc' end as sort_dir
  ),
  filtered as (
    select
      u.id::text                                     as id,
      u.login                                        as login,
      u.full_name                                    as "fullName",
      u.is_active                                    as "isActive",
      count(m.id) filter (where m.is_active)::int    as "groupCount"
    from app.users u
    left join app.user_group_member m on m.user_id = u.id
    cross join params p
    where p.search = ''
       or u.login ilike '%' || p.search || '%'
       or u.full_name ilike '%' || p.search || '%'
    group by u.id, u.login, u.full_name, u.is_active
  ),
  paged as (
    select f.*
    from filtered f
    cross join params p
    order by
      case when p.sort_by = 'login'     and p.sort_dir = 'asc'  then f.login end asc,
      case when p.sort_by = 'login'     and p.sort_dir = 'desc' then f.login end desc,
      case when p.sort_by = 'fullName'  and p.sort_dir = 'asc'  then f."fullName" end asc,
      case when p.sort_by = 'fullName'  and p.sort_dir = 'desc' then f."fullName" end desc,
      case when p.sort_by = 'isActive'  and p.sort_dir = 'asc'  then f."isActive" end asc,
      case when p.sort_by = 'isActive'  and p.sort_dir = 'desc' then f."isActive" end desc,
      f.login asc
    limit (select page_size from params)
    offset ((select page from params) - 1) * (select page_size from params)
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((select jsonb_agg(row_to_json(paged)) from paged), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', jsonb_build_object(
        'count', (select count(*) from filtered),
        'page', (select page from params),
        'pageSize', (select page_size from params)
      )
    ),
    'messages', '[]'::jsonb
  );
$$;

drop function if exists app.user_get(bigint, jsonb);
create function app.user_get(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with target as (
    select nullif(payload->>'id', '')::bigint as id
  ),
  found as (
    select u.* from app.users u cross join target t where u.id = t.id
  ),
  member_groups as (
    select g.id::text as id, g.code, g.name, m.is_active as "isActive"
    from app.user_group_member m
    join app.user_group g on g.id = m.user_group_id
    cross join target t
    where m.user_id = t.id
    order by g.code
  ),
  all_groups as (
    select g.id::text as id, g.name from app.user_group g where g.is_active order by g.code
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', (
        select jsonb_build_object(
          'id', f.id::text,
          'login', f.login,
          'fullName', f.full_name,
          'isActive', f.is_active,
          'groupIds', coalesce((select jsonb_agg(id) from member_groups where "isActive"), '[]'::jsonb)
        )
        from found f
      ),
      'rows', coalesce((select jsonb_agg(row_to_json(member_groups)) from member_groups), '[]'::jsonb),
      'options', jsonb_build_object(
        'groups', coalesce((select jsonb_agg(row_to_json(all_groups)) from all_groups), '[]'::jsonb)
      ),
      'totals', '{}'::jsonb
    ),
    'messages', case when exists (select 1 from found)
      then '[]'::jsonb
      else jsonb_build_array('Користувача не знайдено') end
  );
$$;

/**
 * Створення/зміна користувача. payload = { item: { id, login, fullName, isActive, groupIds } }.
 * Пароль не приймається: новий користувач створюється з порожнім хешем і не
 * може увійти, доки пароль не встановлять через auth-модуль.
 */
drop function if exists app.user_save(bigint, jsonb);
create function app.user_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
-- Параметр контракту зветься user_id і збігається з іменем колонки
-- app.user_group_member.user_id — в ON CONFLICT це неоднозначність. Вирішуємо
-- на користь колонки, а сам параметр далі беремо через v_actor.
#variable_conflict use_column
declare
  v_actor  bigint := user_id;
  v_item   jsonb := coalesce(payload->'item', '{}'::jsonb);
  v_id     bigint := nullif(v_item->>'id', '')::bigint;
  v_login  text := trim(coalesce(v_item->>'login', ''));
  v_name   text := trim(coalesce(v_item->>'fullName', ''));
  v_active boolean := coalesce((v_item->>'isActive')::boolean, true);
  v_groups bigint[] := coalesce(
    (select array_agg(value::bigint) from jsonb_array_elements_text(coalesce(v_item->'groupIds', '[]'::jsonb))),
    '{}'::bigint[]
  );
begin
  if v_login = '' then
    return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('Логін обов''язковий'));
  end if;

  if v_name = '' then
    return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('Повне ім''я обов''язкове'));
  end if;

  if exists (select 1 from app.users u where lower(u.login) = lower(v_login) and (v_id is null or u.id <> v_id)) then
    return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('Логін уже зайнятий'));
  end if;

  if v_id is null then
    insert into app.users (login, password_hash, full_name, is_active)
    values (v_login, '', v_name, v_active)
    returning id into v_id;
  else
    update app.users
       set login = v_login, full_name = v_name, is_active = v_active, updated_at = now()
     where id = v_id;

    if not found then
      return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('Користувача не знайдено'));
    end if;
  end if;

  -- Членство переписуємо цілком: список груп у формі — повний стан, а не дельта.
  delete from app.user_group_member m where m.user_id = v_id and not (m.user_group_id = any(v_groups));

  insert into app.user_group_member (user_group_id, user_id, is_active)
  select g, v_id, true from unnest(v_groups) as g
  on conflict (user_group_id, user_id) do update set is_active = true, updated_at = now();

  return app.user_get(v_actor, jsonb_build_object('id', v_id::text));
end;
$$;

drop function if exists app.user_delete(bigint, jsonb);
create function app.user_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('id обов''язковий'));
  end if;

  if v_id = user_id then
    return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('Не можна видалити самого себе'));
  end if;

  -- На користувача посилаються документи й вкладення (created_by та інші),
  -- тому видалення можливе лише коли слідів немає. Інакше — деактивація.
  if exists (select 1 from app.document d where v_id in (d.created_by, d.updated_by, d.posted_by))
     or exists (select 1 from app.attachment a where a.created_by = v_id) then
    update app.users set is_active = false, updated_at = now() where id = v_id;
    return jsonb_build_object(
      'ok', true,
      'data', app.access_empty_data(),
      'messages', jsonb_build_array('Користувач має пов''язані документи — його деактивовано, а не видалено')
    );
  end if;

  delete from app.users where id = v_id;
  return jsonb_build_object('ok', true, 'data', app.access_empty_data(), 'messages', '[]'::jsonb);
end;
$$;

drop function if exists app.user_lookup(bigint, jsonb);
create function app.user_lookup(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      coalesce(payload->>'search', '') as search,
      least(coalesce((payload->>'limit')::int, 50), 200) as lim
  ),
  rows as (
    select u.id::text as id, coalesce(nullif(trim(u.full_name), ''), u.login) as name
    from app.users u
    cross join params p
    where u.is_active
      and (p.search = '' or u.login ilike '%' || p.search || '%' or u.full_name ilike '%' || p.search || '%')
    order by u.login
    limit (select lim from params)
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((select jsonb_agg(row_to_json(rows)) from rows), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
$$;

-- ── Групи користувачів ─────────────────────────────────────────────────────

drop function if exists app.user_group_list(bigint, jsonb);
create function app.user_group_list(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      coalesce(payload->>'search', '') as search,
      greatest(coalesce((payload->>'page')::int, 1), 1) as page,
      least(greatest(coalesce((payload->>'pageSize')::int, 20), 1), 200) as page_size,
      coalesce(nullif(payload->>'sortBy', ''), 'code') as sort_by,
      case lower(coalesce(payload->>'sortDir', 'asc')) when 'desc' then 'desc' else 'asc' end as sort_dir
  ),
  filtered as (
    select
      g.id::text as id,
      g.code,
      g.name,
      g.is_active as "isActive",
      count(distinct m.user_id) filter (where m.is_active)::int as "memberCount",
      count(distinct p.id) filter (where p.is_allowed)::int      as "permissionCount"
    from app.user_group g
    left join app.user_group_member m on m.user_group_id = g.id
    left join app.user_group_permission p on p.user_group_id = g.id
    cross join params prm
    where prm.search = '' or g.code ilike '%' || prm.search || '%' or g.name ilike '%' || prm.search || '%'
    group by g.id, g.code, g.name, g.is_active
  ),
  paged as (
    select f.* from filtered f cross join params p
    order by
      case when p.sort_by = 'code' and p.sort_dir = 'asc'  then f.code end asc,
      case when p.sort_by = 'code' and p.sort_dir = 'desc' then f.code end desc,
      case when p.sort_by = 'name' and p.sort_dir = 'asc'  then f.name end asc,
      case when p.sort_by = 'name' and p.sort_dir = 'desc' then f.name end desc,
      f.code asc
    limit (select page_size from params)
    offset ((select page from params) - 1) * (select page_size from params)
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((select jsonb_agg(row_to_json(paged)) from paged), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', jsonb_build_object(
        'count', (select count(*) from filtered),
        'page', (select page from params),
        'pageSize', (select page_size from params)
      )
    ),
    'messages', '[]'::jsonb
  );
$$;

drop function if exists app.user_group_get(bigint, jsonb);
create function app.user_group_get(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with target as (
    select nullif(payload->>'id', '')::bigint as id
  ),
  found as (
    select g.* from app.user_group g cross join target t where g.id = t.id
  ),
  permissions as (
    select p.id::text as id, p.model, p.action, p.is_allowed as "isAllowed"
    from app.user_group_permission p
    cross join target t
    where p.user_group_id = t.id
    order by p.model, p.action
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', (
        select jsonb_build_object(
          'id', f.id::text,
          'code', f.code,
          'name', f.name,
          'isActive', f.is_active
        )
        from found f
      ),
      'rows', coalesce((select jsonb_agg(row_to_json(permissions)) from permissions), '[]'::jsonb),
      'options', jsonb_build_object(
        'actions', jsonb_build_array(
          jsonb_build_object('id', 'view',   'name', 'Перегляд'),
          jsonb_build_object('id', 'create', 'name', 'Введення нового'),
          jsonb_build_object('id', 'edit',   'name', 'Редагування'),
          jsonb_build_object('id', 'delete', 'name', 'Видалення'),
          jsonb_build_object('id', 'post',   'name', 'Проведення'),
          jsonb_build_object('id', 'unpost', 'name', 'Скасування проведення')
        )
      ),
      'totals', '{}'::jsonb
    ),
    'messages', case when exists (select 1 from found)
      then '[]'::jsonb
      else jsonb_build_array('Групу не знайдено') end
  );
$$;

/**
 * Створення/зміна групи разом із правами.
 * payload = { item: { id, code, name, isActive }, rows: [ { model, action, isAllowed } ] }
 * rows — повний стан прав групи, а не дельта.
 */
drop function if exists app.user_group_save(bigint, jsonb);
create function app.user_group_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item   jsonb := coalesce(payload->'item', '{}'::jsonb);
  v_rows   jsonb := coalesce(payload->'rows', '[]'::jsonb);
  v_id     bigint := nullif(v_item->>'id', '')::bigint;
  v_code   text := trim(coalesce(v_item->>'code', ''));
  v_name   text := trim(coalesce(v_item->>'name', ''));
  v_active boolean := coalesce((v_item->>'isActive')::boolean, true);
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('Код групи обов''язковий'));
  end if;

  if v_name = '' then
    return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('Назва групи обов''язкова'));
  end if;

  if exists (select 1 from app.user_group g where lower(g.code) = lower(v_code) and (v_id is null or g.id <> v_id)) then
    return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('Група з таким кодом уже є'));
  end if;

  if v_id is null then
    insert into app.user_group (code, name, is_active) values (v_code, v_name, v_active) returning id into v_id;
  else
    update app.user_group set code = v_code, name = v_name, is_active = v_active, updated_at = now() where id = v_id;
    if not found then
      return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('Групу не знайдено'));
    end if;
  end if;

  delete from app.user_group_permission where user_group_id = v_id;

  insert into app.user_group_permission (user_group_id, model, action, is_allowed)
  select
    v_id,
    trim(r->>'model'),
    trim(r->>'action'),
    coalesce((r->>'isAllowed')::boolean, true)
  from jsonb_array_elements(v_rows) as r
  where coalesce(trim(r->>'model'), '') <> '' and coalesce(trim(r->>'action'), '') <> ''
  on conflict (user_group_id, model, action) do update
    set is_allowed = excluded.is_allowed, updated_at = now();

  return app.user_group_get(user_id, jsonb_build_object('id', v_id::text));
end;
$$;

drop function if exists app.user_group_delete(bigint, jsonb);
create function app.user_group_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('id обов''язковий'));
  end if;

  delete from app.user_group where id = v_id;
  if not found then
    return jsonb_build_object('ok', false, 'data', app.access_empty_data(), 'messages', jsonb_build_array('Групу не знайдено'));
  end if;

  return jsonb_build_object('ok', true, 'data', app.access_empty_data(), 'messages', '[]'::jsonb);
end;
$$;

drop function if exists app.user_group_lookup(bigint, jsonb);
create function app.user_group_lookup(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      coalesce(payload->>'search', '') as search,
      least(coalesce((payload->>'limit')::int, 50), 200) as lim
  ),
  rows as (
    select g.id::text as id, g.name
    from app.user_group g
    cross join params p
    where g.is_active
      and (p.search = '' or g.code ilike '%' || p.search || '%' or g.name ilike '%' || p.search || '%')
    order by g.code
    limit (select lim from params)
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((select jsonb_agg(row_to_json(rows)) from rows), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
$$;
