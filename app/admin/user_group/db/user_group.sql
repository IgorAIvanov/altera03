-- Розширення групи користувачів на рівні застосунку.
--
-- Ядро (`@core/access`) знає про права й учасників, але не знає про меню —
-- `app.user_group_menu` живе в застосунку. Тому замість того щоб тягнути меню
-- у фреймворк, застосунок підміняє собі `get`/`save` цієї моделі через
-- `commands.sql` у manifest.json: обидві функції звертаються до ядрових і
-- дописують своє.
--
-- Так у формі групи з'являється те, чого бракувало: меню й склад учасників,
-- тобто другий кінець зв'язків, які досі редагувалися лише з протилежного боку
-- (меню знало про групи, користувач знав про групи, а група — ні про що).

/**
 * Група + права (з ядра) + меню й учасники (звідси).
 *
 * `options` теж доповнюється: список меню для чекбоксів. Список користувачів
 * не віддається навмисно — учасники додаються пікером, бо їх бувають сотні, і
 * вантажити всіх заради форми групи ні до чого.
 */
drop function if exists app.user_group_get_ext(bigint, jsonb);
create function app.user_group_get_ext(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with target as (
    select nullif(payload->>'id', '')::bigint as id
  ),
  core as (
    select app.user_group_get(user_id, payload) as envelope
  ),
  menus as (
    select m.id::text as id
    from app.user_group_menu ugm
    join app.menu m on m.id = ugm.menu_id
    cross join target t
    where ugm.user_group_id = t.id and ugm.is_active
    order by m.code
  ),
  members as (
    select u.id::text as id, coalesce(nullif(trim(u.full_name), ''), u.login) as name
    from app.user_group_member gm
    join app.users u on u.id = gm.user_id
    cross join target t
    where gm.user_group_id = t.id and gm.is_active
    order by u.login
  ),
  all_menus as (
    select m.id::text as id, m.name from app.menu m where m.is_active order by m.code
  )
  select
    case
      -- Ядро не знайшло групу — віддаємо його відповідь як є, разом із
      -- повідомленням. Дописувати меню до неіснуючої групи нема сенсу.
      when (c.envelope->'data'->'item') is null or (c.envelope->'data'->'item') = 'null'::jsonb
        then c.envelope
      else jsonb_set(
        jsonb_set(
          c.envelope,
          '{data,item}',
          (c.envelope->'data'->'item')
            || jsonb_build_object(
                 'menuIds', coalesce((select jsonb_agg(id) from menus), '[]'::jsonb),
                 'members', coalesce((select jsonb_agg(row_to_json(members)) from members), '[]'::jsonb)
               )
        ),
        '{data,options}',
        (c.envelope->'data'->'options')
          || jsonb_build_object(
               'menus', coalesce((select jsonb_agg(row_to_json(all_menus)) from all_menus), '[]'::jsonb)
             )
      )
    end
  from core c;
$$;

/**
 * Запис групи: права — ядром, меню й учасники — тут.
 * payload = { item: { …, menuIds[], members[] }, rows: [ права ] }
 *
 * `menuIds` і `members` — повний стан, як і `rows`.
 *
 * Ядрова функція викликається ПЕРШОЮ: вона робить перевірки (порожній код,
 * зайнятий код) і повертає відмову, не змінивши нічого. Тільки переконавшись,
 * що вона відпрацювала успішно, дописуємо своє — інакше при відмові ядра меню
 * й учасники вже були б переписані.
 */
drop function if exists app.user_group_save_ext(bigint, jsonb);
create function app.user_group_save_ext(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
-- Параметр контракту зветься user_id і збігається з іменем колонки
-- app.user_group_member.user_id — в ON CONFLICT це неоднозначність
-- («column reference user_id is ambiguous»). Вирішуємо на користь колонки, а
-- сам параметр далі беремо через v_actor. Так само зроблено в ядрі.
#variable_conflict use_column
declare
  v_actor    bigint := user_id;
  v_item     jsonb := coalesce(payload->'item', '{}'::jsonb);
  v_core     jsonb;
  v_id       bigint;
  v_menus    bigint[];
  v_members  bigint[];
begin
  v_core := app.user_group_save(v_actor, payload);

  if coalesce((v_core->>'ok')::boolean, false) is not true then
    return v_core;
  end if;

  v_id := nullif(v_core->'data'->'item'->>'id', '')::bigint;
  if v_id is null then
    return v_core;
  end if;

  v_menus := coalesce(
    (select array_agg(value::bigint) from jsonb_array_elements_text(coalesce(v_item->'menuIds', '[]'::jsonb))),
    '{}'::bigint[]
  );

  v_members := coalesce(
    (select array_agg((e->>'id')::bigint) from jsonb_array_elements(coalesce(v_item->'members', '[]'::jsonb)) as e
      where nullif(e->>'id', '') is not null),
    '{}'::bigint[]
  );

  delete from app.user_group_menu ugm
   where ugm.user_group_id = v_id and not (ugm.menu_id = any(v_menus));

  insert into app.user_group_menu (user_group_id, menu_id, is_active)
  select v_id, m, true from unnest(v_menus) as m
  on conflict (user_group_id, menu_id) do update set is_active = true, updated_at = now();

  delete from app.user_group_member gm
   where gm.user_group_id = v_id and not (gm.user_id = any(v_members));

  insert into app.user_group_member (user_group_id, user_id, is_active)
  select v_id, u, true from unnest(v_members) as u
  on conflict (user_group_id, user_id) do update set is_active = true, updated_at = now();

  return app.user_group_get_ext(v_actor, jsonb_build_object('id', v_id::text));
end;
$$;
