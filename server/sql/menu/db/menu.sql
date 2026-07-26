-- Функції меню.
--
-- Дві групи: menu_current — завантаження меню поточного користувача (злиття +
-- фільтр правами), решта — модельний контракт для адмін-екранів
-- (list / get / save / delete / lookup) плюс copy.

-- Прототип: A2v10-іменування (index/load/update) і функції інтерфейсів, чиї
-- таблиці знято в struc.sql. Знімаються тут, бо в живій базі вони могли
-- лишитися від ручної публікації і посилалися б на неіснуючі таблиці.
drop function if exists app.menu_index(bigint, jsonb);
drop function if exists app.menu_load(bigint, jsonb);
drop function if exists app.menu_update(bigint, jsonb);
drop function if exists app.menu_fetch(bigint, jsonb);
drop function if exists app.interface_index(bigint, jsonb);
drop function if exists app.interface_load(bigint, jsonb);
drop function if exists app.interface_update(bigint, jsonb);
drop function if exists app.interface_fetch(bigint, jsonb);

/**
 * Меню поточного користувача: злиття меню всіх його активних груп, уже
 * відфільтроване правами.
 *
 * Чому фільтр саме тут, а не на клієнті: клієнт і так не відкриє пункт, на
 * який немає права, — але побачить його і сприйме відмову як поломку. Плюс
 * склад чужих екранів назовні не їде.
 *
 * Ідентичність пункту при злитті — ланцюжок `code` від кореня, а не id
 * (у різних меню вони різні) і не маршрут (у тек його немає). Цей самий шлях
 * іде назовні як `id`, тож клієнтові нема чого доклеювати.
 *
 * Порядок і переможець при дублі — мінімальний кортеж
 * (user_group_menu.sort_order, menu_item.sort_order). Той самий кортеж дає і
 * позицію, і те, чиї name/icon показати: інакше результат залежав би від плану
 * запиту.
 *
 * Повертає плоский список — дерево збирає клієнт за parentId.
 */
drop function if exists app.menu_current(bigint, jsonb);
create function app.menu_current(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with recursive target as (
    select user_id as uid
  ),
  assigned as (
    select
      mi.menu_id                                     as menu_id,
      mi.id                                          as id,
      mi.parent_id                                   as parent_id,
      mi.code                                        as code,
      mi.name                                        as name,
      mi.icon_key                                    as icon_key,
      nullif(btrim(coalesce(mi.route_path, '')), '') as route_path,
      array[ugm.sort_order, mi.sort_order]           as sort_key
    from app.user_group_member gm
    join app.user_group g        on g.id = gm.user_group_id and g.is_active
    join app.user_group_menu ugm on ugm.user_group_id = g.id and ugm.is_active
    join app.menu mn             on mn.id = ugm.menu_id and mn.is_active
    join app.menu_item mi        on mi.menu_id = mn.id and mi.is_active
    cross join target t
    where gm.user_id = t.uid and gm.is_active
  ),
  -- Жодна група користувача не має меню — беремо меню 'default'. Порожній
  -- екран читається як поломка, а не як «вам нічого не призначили».
  fallback as (
    select
      mi.menu_id, mi.id, mi.parent_id, mi.code, mi.name, mi.icon_key,
      nullif(btrim(coalesce(mi.route_path, '')), ''),
      array[0, mi.sort_order]
    from app.menu mn
    join app.menu_item mi on mi.menu_id = mn.id and mi.is_active
    where mn.code = 'default'
      and mn.is_active
      and not exists (select 1 from assigned)
  ),
  source as (
    select * from assigned
    union all
    select * from fallback
  ),
  tree as (
    select
      s.menu_id, s.id,
      s.code::text as path,
      null::text   as parent_path,
      s.name, s.icon_key, s.route_path, s.sort_key
    from source s
    where s.parent_id is null

    union all

    select
      s.menu_id, s.id,
      p.path || '/' || s.code,
      p.path,
      s.name, s.icon_key, s.route_path, s.sort_key
    from source s
    join tree p on p.menu_id = s.menu_id and p.id = s.parent_id
  ),
  -- Модель — другий сегмент маршруту (`catalog/bank/list` → `bank`), тобто те
  -- саме ім'я, що приходить у ModelRuntimeService.execute().
  visible as (
    select t.*
    from tree t
    cross join target tg
    where t.route_path is null
       or app.access_can(tg.uid, split_part(ltrim(t.route_path, '/'), '/', 2), 'view')
  ),
  -- Тека лишається, лише якщо під нею вцілів хоч один лист — на будь-якій
  -- глибині. Порожня тека гірша за відсутню: у неї клікають.
  kept as (
    select v.*
    from visible v
    where v.route_path is not null
       or exists (
         select 1
         from visible leaf
         where leaf.route_path is not null
           and starts_with(leaf.path, v.path || '/')
       )
  ),
  merged as (
    select distinct on (k.path)
      k.path, k.parent_path, k.name, k.icon_key, k.route_path, k.sort_key
    from kept k
    order by k.path, k.sort_key, k.name
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',       m.path,
            'parentId', m.parent_path,
            'name',     m.name,
            'icon',     m.icon_key,
            'route',    m.route_path
          )
          order by m.sort_key, m.path
        )
        from merged m
      ), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', jsonb_build_object('count', (select count(*) from merged))
    ),
    'messages', '[]'::jsonb
  );
$$;

-- ── Адміністрування меню ───────────────────────────────────────────────────

/** Порожня частина `data` конверта — щоб відповіді-помилки мали ту саму форму. */
drop function if exists app.menu_empty_data();
create function app.menu_empty_data()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb);
$$;

drop function if exists app.menu_fail(text);
create function app.menu_fail(p_message text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('ok', false, 'data', app.menu_empty_data(), 'messages', jsonb_build_array(p_message));
$$;

drop function if exists app.menu_list(bigint, jsonb);
create function app.menu_list(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      coalesce(payload->>'search', '')                                   as search,
      greatest(coalesce((payload->>'page')::int, 1), 1)                  as page,
      least(greatest(coalesce((payload->>'pageSize')::int, 20), 1), 200) as page_size,
      coalesce(nullif(payload->>'sortBy', ''), 'code')                   as sort_by,
      case lower(coalesce(payload->>'sortDir', 'asc')) when 'desc' then 'desc' else 'asc' end as sort_dir
  ),
  filtered as (
    select
      m.id::text                                              as id,
      m.code                                                  as code,
      m.name                                                  as name,
      m.is_active                                             as "isActive",
      count(distinct mi.id) filter (where mi.is_active)::int   as "itemCount",
      count(distinct ugm.id) filter (where ugm.is_active)::int as "groupCount"
    from app.menu m
    left join app.menu_item mi        on mi.menu_id = m.id
    left join app.user_group_menu ugm on ugm.menu_id = m.id
    cross join params p
    where p.search = ''
       or m.code ilike '%' || p.search || '%'
       or m.name ilike '%' || p.search || '%'
    group by m.id, m.code, m.name, m.is_active
  ),
  paged as (
    select f.* from filtered f cross join params p
    order by
      case when p.sort_by = 'code'       and p.sort_dir = 'asc'  then f.code end asc,
      case when p.sort_by = 'code'       and p.sort_dir = 'desc' then f.code end desc,
      case when p.sort_by = 'name'       and p.sort_dir = 'asc'  then f.name end asc,
      case when p.sort_by = 'name'       and p.sort_dir = 'desc' then f.name end desc,
      case when p.sort_by = 'itemCount'  and p.sort_dir = 'asc'  then f."itemCount" end asc,
      case when p.sort_by = 'itemCount'  and p.sort_dir = 'desc' then f."itemCount" end desc,
      case when p.sort_by = 'groupCount' and p.sort_dir = 'asc'  then f."groupCount" end asc,
      case when p.sort_by = 'groupCount' and p.sort_dir = 'desc' then f."groupCount" end desc,
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

/**
 * Меню з пунктами й призначеними групами.
 *
 * Пункти йдуть у порядку дерева (шлях із code), а не за id: у формі це плоска
 * таблиця, і без такого порядку діти опиняються далеко від батьків.
 */
drop function if exists app.menu_get(bigint, jsonb);
create function app.menu_get(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with recursive target as (
    select nullif(payload->>'id', '')::bigint as id
  ),
  found as (
    select m.* from app.menu m cross join target t where m.id = t.id
  ),
  -- `sort_path` — ключ обходу дерева: на кожному рівні спершу sort_order, потім
  -- code як розв'язувач нічиїх. Зсув на 2^31 робить число завжди додатним, бо
  -- порівнюються рядки: без нього «-20» опинилося б не там, де −20.
  tree as (
    select
      mi.*, mi.code::text as path, null::varchar(100) as parent_code,
      array[lpad((mi.sort_order::bigint + 2147483648)::text, 11, '0') || ':' || mi.code] as sort_path
    from app.menu_item mi cross join target t
    where mi.menu_id = t.id and mi.parent_id is null

    union all

    select
      mi.*, p.path || '/' || mi.code, p.code,
      p.sort_path || (lpad((mi.sort_order::bigint + 2147483648)::text, 11, '0') || ':' || mi.code)
    from app.menu_item mi
    join tree p on p.menu_id = mi.menu_id and p.id = mi.parent_id
  ),
  entries as (
    select
      t.id::text    as id,
      t.parent_code as "parentCode",
      t.code        as code,
      t.name        as name,
      t.icon_key    as "iconKey",
      t.route_path  as "routePath",
      t.sort_order  as "sortOrder",
      t.is_active   as "isActive"
    from tree t
    order by t.sort_path
  ),
  assigned as (
    select g.id::text as id
    from app.user_group_menu ugm
    join app.user_group g on g.id = ugm.user_group_id
    cross join target t
    where ugm.menu_id = t.id and ugm.is_active
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
          'code', f.code,
          'name', f.name,
          'isActive', f.is_active,
          'groupIds', coalesce((select jsonb_agg(id) from assigned), '[]'::jsonb),
          'entries', coalesce((select jsonb_agg(row_to_json(entries)) from entries), '[]'::jsonb)
        )
        from found f
      ),
      'rows', '[]'::jsonb,
      'options', jsonb_build_object(
        'groups', coalesce((select jsonb_agg(row_to_json(all_groups)) from all_groups), '[]'::jsonb)
      ),
      'totals', '{}'::jsonb
    ),
    'messages', case when exists (select 1 from found)
      then '[]'::jsonb
      else jsonb_build_array('Меню не знайдено') end
  );
$$;

/**
 * Запис меню разом із пунктами й призначенням групам.
 * payload = { item: { id, code, name, isActive, groupIds[], entries[] } }
 * `entries` і `groupIds` — повний стан, а не дельта.
 *
 * Батько пункту задається `parentCode`, тому код унікальний у межах меню
 * (індекс у БД дозволяє більше — однакові коди під різними батьками, — але
 * форма цим не користується, а прив'язка за кодом вимагає однозначності).
 *
 * Усі перевірки — ДО першого запису. Функція виконується в одній транзакції з
 * викликом, тож вихід із конвертом-помилкою після часткового запису цей запис
 * би зафіксував; єдиний спосіб відкотити — raise, а це вже не конверт.
 */
drop function if exists app.menu_save(bigint, jsonb);
create function app.menu_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item    jsonb    := coalesce(payload->'item', '{}'::jsonb);
  v_id      bigint   := nullif(v_item->>'id', '')::bigint;
  v_code    text     := trim(coalesce(v_item->>'code', ''));
  v_name    text     := trim(coalesce(v_item->>'name', ''));
  v_active  boolean  := coalesce((v_item->>'isActive')::boolean, true);
  v_entries jsonb    := coalesce(v_item->'entries', '[]'::jsonb);
  v_groups  bigint[] := coalesce(
    (select array_agg(value::bigint) from jsonb_array_elements_text(coalesce(v_item->'groupIds', '[]'::jsonb))),
    '{}'::bigint[]
  );
  v_total   int := jsonb_array_length(v_entries);
  v_reached int;
  v_added   int;
  v_bad     text;
begin
  if v_code = '' then
    return app.menu_fail('Код меню обов''язковий');
  end if;

  if v_name = '' then
    return app.menu_fail('Назва меню обов''язкова');
  end if;

  if exists (select 1 from app.menu m where lower(m.code) = lower(v_code) and (v_id is null or m.id <> v_id)) then
    return app.menu_fail('Меню з таким кодом уже є');
  end if;

  -- Розгорнутий payload пунктів. Тимчасова таблиця, а не повторення
  -- jsonb_array_elements у кожному операторі: перевірок над ним чотири.
  drop table if exists _menu_entries;
  create temp table _menu_entries on commit drop as
  select
    nullif(trim(coalesce(je->>'parentCode', '')), '') as parent_code,
    trim(coalesce(je->>'code', ''))                   as code,
    trim(coalesce(je->>'name', ''))                   as name,
    nullif(trim(coalesce(je->>'iconKey', '')), '')    as icon_key,
    nullif(trim(coalesce(je->>'routePath', '')), '')  as route_path,
    coalesce((je->>'sortOrder')::int, 0)              as sort_order,
    coalesce((je->>'isActive')::boolean, true)        as is_active
  from jsonb_array_elements(v_entries) as je;

  if exists (select 1 from _menu_entries where code = '') then
    return app.menu_fail('Код пункту обов''язковий');
  end if;

  if exists (select 1 from _menu_entries where name = '') then
    return app.menu_fail('Назва пункту обов''язкова');
  end if;

  select e.code into v_bad from _menu_entries e group by e.code having count(*) > 1 limit 1;
  if v_bad is not null then
    return app.menu_fail(format('Код пункту «%s» повторюється — коди мають бути унікальними в межах меню', v_bad));
  end if;

  select e.parent_code into v_bad
  from _menu_entries e
  where e.parent_code is not null
    and not exists (select 1 from _menu_entries p where p.code = e.parent_code)
  limit 1;
  if v_bad is not null then
    return app.menu_fail(format('Невідомий батьківський код «%s»', v_bad));
  end if;

  -- Обхід від коренів має покрити всі пункти. Не покрив — десь цикл.
  with recursive reach as (
    select e.code from _menu_entries e where e.parent_code is null
    union all
    select e.code from _menu_entries e join reach r on e.parent_code = r.code
  )
  select count(*) into v_reached from reach;

  if v_reached <> v_total then
    return app.menu_fail('Циклічна прив''язка пунктів: частина з них недосяжна від кореня');
  end if;

  if v_id is null then
    insert into app.menu (code, name, is_active) values (v_code, v_name, v_active) returning id into v_id;
  else
    update app.menu set code = v_code, name = v_name, is_active = v_active, updated_at = now() where id = v_id;
    if not found then
      return app.menu_fail('Меню не знайдено');
    end if;
  end if;

  -- Пункти переписуються цілком. На menu_item не посилається ніщо, крім нього
  -- самого (складений FK на батька), а зовні пункт адресується шляхом із code,
  -- не id, — тож перестворення нічого не рве.
  delete from app.menu_item where menu_id = v_id;

  -- Вставка хвилями: спершу корені, далі ті, чий батько вже вставлений.
  -- Ациклічність уже перевірено, тож цикл завершується, покривши всі пункти.
  loop
    insert into app.menu_item (menu_id, parent_id, code, name, icon_key, route_path, sort_order, is_active)
    select v_id, p.id, e.code, e.name, e.icon_key, e.route_path, e.sort_order, e.is_active
    from _menu_entries e
    left join app.menu_item p on p.menu_id = v_id and p.code = e.parent_code
    where not exists (select 1 from app.menu_item x where x.menu_id = v_id and x.code = e.code)
      and (e.parent_code is null or p.id is not null);

    get diagnostics v_added = row_count;
    exit when v_added = 0;
  end loop;

  -- Призначення групам — теж повний стан.
  delete from app.user_group_menu ugm where ugm.menu_id = v_id and not (ugm.user_group_id = any(v_groups));

  insert into app.user_group_menu (user_group_id, menu_id, is_active)
  select g, v_id, true from unnest(v_groups) as g
  on conflict (user_group_id, menu_id) do update set is_active = true, updated_at = now();

  return app.menu_get(user_id, jsonb_build_object('id', v_id::text));
end;
$$;

drop function if exists app.menu_delete(bigint, jsonb);
create function app.menu_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  if v_id is null then
    return app.menu_fail('id обов''язковий');
  end if;

  -- Пункти й призначення групам зникають каскадом: посилатися на меню ззовні
  -- нема кому, історії воно не несе.
  delete from app.menu where id = v_id;
  if not found then
    return app.menu_fail('Меню не знайдено');
  end if;

  return jsonb_build_object('ok', true, 'data', app.menu_empty_data(), 'messages', '[]'::jsonb);
end;
$$;

drop function if exists app.menu_lookup(bigint, jsonb);
create function app.menu_lookup(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      coalesce(payload->>'search', '') as search,
      least(coalesce((payload->>'limit')::int, 50), 200) as lim
  ),
  found as (
    select m.id::text as id, m.name
    from app.menu m
    cross join params p
    where m.is_active
      and (p.search = '' or m.code ilike '%' || p.search || '%' or m.name ilike '%' || p.search || '%')
    order by m.code
    limit (select lim from params)
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((select jsonb_agg(row_to_json(found)) from found), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
$$;

/**
 * Копія меню разом з усіма пунктами. payload = { id }.
 *
 * Призначення групам НЕ копіюються свідомо. Меню всіх груп користувача
 * зливаються, тож копія в тих самих групах не дала б нічого нового — злилася б
 * із оригіналом назад у той самий список. Копію призначають уже після правки.
 *
 * Дерево переноситься хвилями (корені → діти вже скопійованих), а прив'язка
 * батька шукається за кодом: id у копії інші. Тому коди в межах меню мусять
 * бути унікальні — це перевіряється до першого запису.
 */
drop function if exists app.menu_copy(bigint, jsonb);
create function app.menu_copy(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id    bigint := nullif(payload->>'id', '')::bigint;
  v_src   app.menu%rowtype;
  v_new   bigint;
  v_code  text;
  v_n     int := 1;
  v_added int;
begin
  if v_id is null then
    return app.menu_fail('id обов''язковий');
  end if;

  select * into v_src from app.menu where id = v_id;
  if not found then
    return app.menu_fail('Меню не знайдено');
  end if;

  if exists (
    select 1 from app.menu_item where menu_id = v_id group by code having count(*) > 1
  ) then
    return app.menu_fail('У меню є пункти з однаковим кодом — копіювання потребує унікальних');
  end if;

  -- Вільний код: `_copy`, далі `_copy2`, `_copy3`… Обрізання до 90/88 символів
  -- лишає місце під суфікс — колонка має ліміт 100.
  v_code := left(v_src.code, 90) || '_copy';
  while exists (select 1 from app.menu m where lower(m.code) = lower(v_code)) loop
    v_n := v_n + 1;
    v_code := left(v_src.code, 88) || '_copy' || v_n;
  end loop;

  insert into app.menu (code, name, is_active)
  values (v_code, left(v_src.name || ' (копія)', 255), v_src.is_active)
  returning id into v_new;

  loop
    insert into app.menu_item (menu_id, parent_id, code, name, icon_key, route_path, sort_order, is_active)
    select v_new, np.id, s.code, s.name, s.icon_key, s.route_path, s.sort_order, s.is_active
    from app.menu_item s
    left join app.menu_item sp on sp.id = s.parent_id                       -- батько в оригіналі
    left join app.menu_item np on np.menu_id = v_new and np.code = sp.code  -- його копія
    where s.menu_id = v_id
      and not exists (select 1 from app.menu_item x where x.menu_id = v_new and x.code = s.code)
      and (s.parent_id is null or np.id is not null);

    get diagnostics v_added = row_count;
    exit when v_added = 0;
  end loop;

  return app.menu_get(user_id, jsonb_build_object('id', v_new::text));
end;
$$;
