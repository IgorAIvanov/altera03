drop function if exists app.menu_index(jsonb);
create or replace function app.menu_index(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
	with params as (
		select
			greatest(coalesce((payload->>'page')::int, 1), 1) as page,
			greatest(coalesce((payload->>'pageSize')::int, 20), 1) as page_size,
			case coalesce(payload->>'sortBy', 'code')
				when 'code' then 'code'
				when 'name' then 'name'
				when 'isActive' then 'is_active'
				when 'itemCount' then 'item_count'
				else 'code'
			end as sort_by,
			case lower(coalesce(payload->>'sortDirection', 'asc'))
				when 'desc' then 'desc'
				else 'asc'
			end as sort_direction
	),
	filtered as (
		select
			m.id::text as id,
			m.code,
			m.name,
			m.is_active as "isActive",
			count(mi.id)::int as "itemCount"
		from app.menu m
		left join app.menu_item mi on mi.menu_id = m.id
		where (
			coalesce(payload->>'search', '') = ''
			or m.code ilike '%' || (payload->>'search') || '%'
			or m.name ilike '%' || (payload->>'search') || '%'
		)
		and (
			not (payload ? 'isActive')
			or (payload->>'isActive') is null
			or m.is_active = (payload->>'isActive')::boolean
		)
		group by m.id, m.code, m.name, m.is_active
	),
	counted as (
		select count(*)::int as total from filtered
	),
	paged as (
		select filtered.*
		from filtered
		cross join params
		order by
			case when params.sort_by = 'code' and params.sort_direction = 'asc' then filtered.code end asc nulls last,
			case when params.sort_by = 'code' and params.sort_direction = 'desc' then filtered.code end desc nulls last,
			case when params.sort_by = 'name' and params.sort_direction = 'asc' then filtered.name end asc nulls last,
			case when params.sort_by = 'name' and params.sort_direction = 'desc' then filtered.name end desc nulls last,
			case when params.sort_by = 'is_active' and params.sort_direction = 'asc' then filtered."isActive" end asc nulls last,
			case when params.sort_by = 'is_active' and params.sort_direction = 'desc' then filtered."isActive" end desc nulls last,
			case when params.sort_by = 'item_count' and params.sort_direction = 'asc' then filtered."itemCount" end asc nulls last,
			case when params.sort_by = 'item_count' and params.sort_direction = 'desc' then filtered."itemCount" end desc nulls last,
			filtered.code asc,
			filtered.id asc
		limit (select page_size from params)
		offset ((select page from params) - 1) * (select page_size from params)
	)
	select jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'rows', coalesce((select jsonb_agg(row_to_json(paged)) from paged), '[]'::jsonb),
			'lookups', jsonb_build_object(
				'activeStates', jsonb_build_array(
					jsonb_build_object('value', 'true', 'label', 'Активні'),
					jsonb_build_object('value', 'false', 'label', 'Неактивні')
				)
			),
			'totals', jsonb_build_object(
				'count', (select total from counted),
				'page', (select page from params),
				'pageSize', (select page_size from params)
			),
			'extra', '{}'::jsonb
		),
		'messages', '[]'::jsonb,
		'meta', '{}'::jsonb
	);
$$;

drop function if exists app.menu_load(jsonb);
create or replace function app.menu_load(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
	with selected_menu as (
		select
			m.id,
			m.code,
			m.name,
			m.is_active
		from app.menu m
		where m.id = (payload->>'id')::bigint
	),
	menu_item_rows as (
		select
			mi.id::text as id,
			mi.menu_id::text as "menuId",
			mi.parent_id::text as "parentId",
			mi.name,
			mi.icon_key as "iconKey",
			mi.sort_order as "sortOrder",
			mi.route_path as "routePath",
			mi.is_active as "isActive"
		from app.menu_item mi
		where mi.menu_id = (select id from selected_menu)
		order by
			coalesce(mi.parent_id, 0),
			mi.sort_order,
			mi.id
	)
	select jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'item', (
				select jsonb_build_object(
					'id', sm.id::text,
					'code', sm.code,
					'name', sm.name,
					'isActive', sm.is_active
				)
				from selected_menu sm
			),
			'rows', coalesce((select jsonb_agg(row_to_json(menu_item_rows)) from menu_item_rows), '[]'::jsonb),
			'lookups', '{}'::jsonb,
			'totals', jsonb_build_object(
				'count', (select count(*) from menu_item_rows)
			),
			'extra', '{}'::jsonb
		),
		'messages', '[]'::jsonb,
		'meta', '{}'::jsonb
	);
$$;

drop function if exists app.menu_update(jsonb);
create or replace function app.menu_update(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
	item jsonb;
	item_rows jsonb;
	input_row record;
	result_item jsonb;
	v_menu_id bigint;
	v_menu_item_id bigint;
	v_parent_menu_item_id bigint;
	inserted_count int;
begin
	item := payload->'item';
	item_rows := coalesce(payload->'rows', '[]'::jsonb);
	v_menu_id := nullif(item->>'id', '')::bigint;

	if item is null or jsonb_typeof(item) <> 'object' then
		raise exception 'Menu item payload is required';
	end if;

	if coalesce(nullif(trim(item->>'code'), ''), '') = '' then
		raise exception 'Menu code is required';
	end if;

	if coalesce(nullif(trim(item->>'name'), ''), '') = '' then
		raise exception 'Menu name is required';
	end if;

	if jsonb_typeof(item_rows) <> 'array' then
		raise exception 'Menu rows must be an array';
	end if;

	if v_menu_id is null then
		insert into app.menu (
			code,
			name,
			is_active
		)
		values (
			trim(item->>'code'),
			trim(item->>'name'),
			coalesce((item->>'isActive')::boolean, true)
		)
		returning id into v_menu_id;
	else
		update app.menu
		set
			code = trim(item->>'code'),
			name = trim(item->>'name'),
			is_active = coalesce((item->>'isActive')::boolean, is_active),
			updated_at = now()
		where id = v_menu_id;

		if not found then
			raise exception 'Menu % was not found', v_menu_id;
		end if;
	end if;

	create temporary table if not exists pg_temp.tmp_menu_item_input (
		client_id text primary key,
		parent_client_id text,
		name varchar(255) not null,
		icon_key varchar(100),
		sort_order int not null,
		route_path varchar(500),
		is_active boolean not null,
		row_order int not null
	) on commit drop;

	create temporary table if not exists pg_temp.tmp_menu_item_saved (
		client_id text primary key,
		menu_item_id bigint not null
	) on commit drop;

	truncate table pg_temp.tmp_menu_item_input;
	truncate table pg_temp.tmp_menu_item_saved;

	insert into pg_temp.tmp_menu_item_input (
		client_id,
		parent_client_id,
		name,
		icon_key,
		sort_order,
		route_path,
		is_active,
		row_order
	)
	select
		case
			when coalesce(nullif(trim(row_data.value->>'id'), ''), '') <> '' then trim(row_data.value->>'id')
			else '__row_' || row_data.ordinality::text
		end as client_id,
		nullif(trim(coalesce(row_data.value->>'parentId', '')), '') as parent_client_id,
		trim(coalesce(row_data.value->>'name', '')) as name,
		nullif(trim(coalesce(row_data.value->>'iconKey', '')), '') as icon_key,
		coalesce((row_data.value->>'sortOrder')::int, 0) as sort_order,
		nullif(trim(coalesce(row_data.value->>'routePath', '')), '') as route_path,
		coalesce((row_data.value->>'isActive')::boolean, true) as is_active,
		row_data.ordinality::int as row_order
	from jsonb_array_elements(item_rows) with ordinality as row_data(value, ordinality);

	if exists (
		select 1
		from pg_temp.tmp_menu_item_input i
		where i.name = ''
	) then
		raise exception 'Menu item name is required';
	end if;

	if exists (
		select 1
		from pg_temp.tmp_menu_item_input i
		where i.parent_client_id is not null
			and not exists (
				select 1
				from pg_temp.tmp_menu_item_input parent_item
				where parent_item.client_id = i.parent_client_id
			)
	) then
		raise exception 'Parent menu item was not found in payload';
	end if;

	delete from app.menu_item where menu_id = v_menu_id;

	loop
		inserted_count := 0;

		for input_row in
			select *
			from pg_temp.tmp_menu_item_input input_item
			where not exists (
				select 1
				from pg_temp.tmp_menu_item_saved saved_item
				where saved_item.client_id = input_item.client_id
			)
			order by input_item.row_order
		loop
			v_parent_menu_item_id := null;

			if input_row.parent_client_id is not null then
				select saved_item.menu_item_id
				into v_parent_menu_item_id
				from pg_temp.tmp_menu_item_saved saved_item
				where saved_item.client_id = input_row.parent_client_id;

				if v_parent_menu_item_id is null then
					continue;
				end if;
			end if;

			insert into app.menu_item (
				menu_id,
				parent_id,
				name,
				icon_key,
				sort_order,
				route_path,
				is_active
			)
			values (
				v_menu_id,
				v_parent_menu_item_id,
				input_row.name,
				input_row.icon_key,
				input_row.sort_order,
				input_row.route_path,
				input_row.is_active
			)
			returning id into v_menu_item_id;

			insert into pg_temp.tmp_menu_item_saved (client_id, menu_item_id)
			values (input_row.client_id, v_menu_item_id);

			inserted_count := inserted_count + 1;
		end loop;

		exit when inserted_count = 0;
	end loop;

	if exists (
		select 1
		from pg_temp.tmp_menu_item_input input_item
		left join pg_temp.tmp_menu_item_saved saved_item
			on saved_item.client_id = input_item.client_id
		where saved_item.client_id is null
	) then
		raise exception 'Menu items hierarchy contains unresolved parent references';
	end if;

	select jsonb_build_object(
		'id', m.id::text,
		'code', m.code,
		'name', m.name,
		'isActive', m.is_active
	)
	into result_item
	from app.menu m
	where m.id = v_menu_id;

	return jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'item', result_item,
			'rows', coalesce((
				select jsonb_agg(row_to_json(saved_rows))
				from (
					select
						mi.id::text as id,
						mi.menu_id::text as "menuId",
						mi.parent_id::text as "parentId",
						mi.name,
						mi.icon_key as "iconKey",
						mi.sort_order as "sortOrder",
						mi.route_path as "routePath",
						mi.is_active as "isActive"
					from app.menu_item mi
					where mi.menu_id = v_menu_id
					order by coalesce(mi.parent_id, 0), mi.sort_order, mi.id
				) as saved_rows
			), '[]'::jsonb),
			'lookups', '{}'::jsonb,
			'totals', jsonb_build_object(
				'count', (select count(*) from app.menu_item where menu_id = v_menu_id)
			),
			'extra', '{}'::jsonb
		),
		'messages', jsonb_build_array('Menu updated successfully'),
		'meta', '{}'::jsonb
	);
end;
$$;

drop function if exists app.interface_index(jsonb);
create or replace function app.interface_index(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
	with params as (
		select
			greatest(coalesce((payload->>'page')::int, 1), 1) as page,
			greatest(coalesce((payload->>'pageSize')::int, 20), 1) as page_size,
			case coalesce(payload->>'sortBy', 'code')
				when 'code' then 'code'
				when 'name' then 'name'
				when 'isActive' then 'is_active'
				when 'menuCount' then 'menu_count'
				else 'code'
			end as sort_by,
			case lower(coalesce(payload->>'sortDirection', 'asc'))
				when 'desc' then 'desc'
				else 'asc'
			end as sort_direction
	),
	filtered as (
		select
			i.id::text as id,
			i.code,
			i.name,
			i.is_active as "isActive",
			count(im.id)::int as "menuCount"
		from app.interface i
		left join app.interface_menu im
			on im.interface_id = i.id
			and im.is_active = true
		where (
			coalesce(payload->>'search', '') = ''
			or i.code ilike '%' || (payload->>'search') || '%'
			or i.name ilike '%' || (payload->>'search') || '%'
		)
		and (
			not (payload ? 'isActive')
			or (payload->>'isActive') is null
			or i.is_active = (payload->>'isActive')::boolean
		)
		group by i.id, i.code, i.name, i.is_active
	),
	counted as (
		select count(*)::int as total from filtered
	),
	paged as (
		select filtered.*
		from filtered
		cross join params
		order by
			case when params.sort_by = 'code' and params.sort_direction = 'asc' then filtered.code end asc nulls last,
			case when params.sort_by = 'code' and params.sort_direction = 'desc' then filtered.code end desc nulls last,
			case when params.sort_by = 'name' and params.sort_direction = 'asc' then filtered.name end asc nulls last,
			case when params.sort_by = 'name' and params.sort_direction = 'desc' then filtered.name end desc nulls last,
			case when params.sort_by = 'is_active' and params.sort_direction = 'asc' then filtered."isActive" end asc nulls last,
			case when params.sort_by = 'is_active' and params.sort_direction = 'desc' then filtered."isActive" end desc nulls last,
			case when params.sort_by = 'menu_count' and params.sort_direction = 'asc' then filtered."menuCount" end asc nulls last,
			case when params.sort_by = 'menu_count' and params.sort_direction = 'desc' then filtered."menuCount" end desc nulls last,
			filtered.code asc,
			filtered.id asc
		limit (select page_size from params)
		offset ((select page from params) - 1) * (select page_size from params)
	)
	select jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'rows', coalesce((select jsonb_agg(row_to_json(paged)) from paged), '[]'::jsonb),
			'lookups', jsonb_build_object(
				'activeStates', jsonb_build_array(
					jsonb_build_object('value', 'true', 'label', 'Активні'),
					jsonb_build_object('value', 'false', 'label', 'Неактивні')
				)
			),
			'totals', jsonb_build_object(
				'count', (select total from counted),
				'page', (select page from params),
				'pageSize', (select page_size from params)
			),
			'extra', '{}'::jsonb
		),
		'messages', '[]'::jsonb,
		'meta', '{}'::jsonb
	);
$$;

drop function if exists app.interface_load(jsonb);
create or replace function app.interface_load(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
	with selected_interface as (
		select
			i.id,
			i.code,
			i.name,
			i.is_active
		from app.interface i
		where i.id = (payload->>'id')::bigint
	),
	interface_menu_rows as (
		select
			im.id::text as id,
			im.interface_id::text as "interfaceId",
			im.menu_id::text as "menuId",
			m.code as "menuCode",
			m.name as "menuName",
			im.sort_order as "sortOrder",
			im.is_active as "isActive"
		from app.interface_menu im
		join app.menu m on m.id = im.menu_id
		where im.interface_id = (select id from selected_interface)
		order by im.sort_order, im.id
	),
	available_menus as (
		select jsonb_build_object(
			'value', m.id::text,
			'label', m.name
		) as row_data
		from app.menu m
		where m.is_active = true
		order by m.code, m.id
	)
	select jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'item', (
				select jsonb_build_object(
					'id', si.id::text,
					'code', si.code,
					'name', si.name,
					'isActive', si.is_active
				)
				from selected_interface si
			),
			'rows', coalesce((select jsonb_agg(row_to_json(interface_menu_rows)) from interface_menu_rows), '[]'::jsonb),
			'lookups', jsonb_build_object(
				'activeStates', jsonb_build_array(
					jsonb_build_object('value', 'true', 'label', 'Так'),
					jsonb_build_object('value', 'false', 'label', 'Ні')
				),
				'menus', coalesce((select jsonb_agg(row_data) from available_menus), '[]'::jsonb)
			),
			'totals', jsonb_build_object(
				'count', (select count(*) from interface_menu_rows)
			),
			'extra', '{}'::jsonb
		),
		'messages', '[]'::jsonb,
		'meta', '{}'::jsonb
	);
$$;

drop function if exists app.interface_update(jsonb);
create or replace function app.interface_update(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
	item jsonb;
	assignment_rows jsonb;
	result_item jsonb;
	v_interface_id bigint;
begin
	item := payload->'item';
	assignment_rows := coalesce(payload->'rows', '[]'::jsonb);
	v_interface_id := nullif(item->>'id', '')::bigint;

	if item is null or jsonb_typeof(item) <> 'object' then
		raise exception 'Interface item payload is required';
	end if;

	if coalesce(nullif(trim(item->>'code'), ''), '') = '' then
		raise exception 'Interface code is required';
	end if;

	if coalesce(nullif(trim(item->>'name'), ''), '') = '' then
		raise exception 'Interface name is required';
	end if;

	if jsonb_typeof(assignment_rows) <> 'array' then
		raise exception 'Interface rows must be an array';
	end if;

	if exists (
		select 1
		from jsonb_array_elements(assignment_rows) as row_data(value)
		where coalesce(nullif(trim(coalesce(row_data.value->>'menuId', '')), ''), '') = ''
	) then
		raise exception 'menuId is required for each interface menu row';
	end if;

	if exists (
		select 1
		from (
			select (row_data.value->>'menuId')::bigint as menu_id
			from jsonb_array_elements(assignment_rows) as row_data(value)
		) resolved_rows
		where not exists (
			select 1
			from app.menu m
			where m.id = resolved_rows.menu_id
		)
	) then
		raise exception 'One or more menus were not found for interface assignment';
	end if;

	if v_interface_id is null then
		insert into app.interface (
			code,
			name,
			is_active
		)
		values (
			trim(item->>'code'),
			trim(item->>'name'),
			coalesce((item->>'isActive')::boolean, true)
		)
		returning id into v_interface_id;
	else
		update app.interface
		set
			code = trim(item->>'code'),
			name = trim(item->>'name'),
			is_active = coalesce((item->>'isActive')::boolean, is_active),
			updated_at = now()
		where id = v_interface_id;

		if not found then
			raise exception 'Interface % was not found', v_interface_id;
		end if;
	end if;

	delete from app.interface_menu where interface_id = v_interface_id;

	insert into app.interface_menu (
		interface_id,
		menu_id,
		sort_order,
		is_active
	)
	select
		v_interface_id,
		(row_data.value->>'menuId')::bigint,
		coalesce((row_data.value->>'sortOrder')::int, 0),
		coalesce((row_data.value->>'isActive')::boolean, true)
	from jsonb_array_elements(assignment_rows) as row_data(value);

	select jsonb_build_object(
		'id', i.id::text,
		'code', i.code,
		'name', i.name,
		'isActive', i.is_active
	)
	into result_item
	from app.interface i
	where i.id = v_interface_id;

	return jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'item', result_item,
			'rows', coalesce((
				select jsonb_agg(row_to_json(saved_rows))
				from (
					select
						im.id::text as id,
						im.interface_id::text as "interfaceId",
						im.menu_id::text as "menuId",
						m.code as "menuCode",
						m.name as "menuName",
						im.sort_order as "sortOrder",
						im.is_active as "isActive"
					from app.interface_menu im
					join app.menu m on m.id = im.menu_id
					where im.interface_id = v_interface_id
					order by im.sort_order, im.id
				) as saved_rows
			), '[]'::jsonb),
			'lookups', '{}'::jsonb,
			'totals', jsonb_build_object(
				'count', (select count(*) from app.interface_menu where interface_id = v_interface_id)
			),
			'extra', '{}'::jsonb
		),
		'messages', jsonb_build_array('Interface updated successfully'),
		'meta', '{}'::jsonb
	);
end;
$$;

drop function if exists app.interface_fetch(jsonb);
create or replace function app.interface_fetch(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
	with options as (
		select jsonb_build_object(
			'value', i.id::text,
			'label', i.name
		) as row_data
		from app.interface i
		where i.is_active = true
			and (
				coalesce(payload->>'search', '') = ''
				or i.code ilike '%' || (payload->>'search') || '%'
				or i.name ilike '%' || (payload->>'search') || '%'
			)
		order by i.code, i.id
		limit coalesce((payload->>'limit')::int, 50)
	)
	select jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'item', null,
			'rows', coalesce((select jsonb_agg(row_data) from options), '[]'::jsonb),
			'lookups', '{}'::jsonb,
			'totals', '{}'::jsonb,
			'extra', '{}'::jsonb
		),
		'messages', '[]'::jsonb,
		'meta', '{}'::jsonb
	);
$$;

drop function if exists app.menu_fetch(jsonb);
create or replace function app.menu_fetch(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
	with effective_interfaces as (
		select
			source.interface_id,
			min(source.sort_order)::int as sort_order
		from (
			select
				ui.interface_id,
				ui.sort_order
			from app.user_interface ui
			where ui.user_id = user_id
				and ui.is_active = true

			union all

			select
				ugi.interface_id,
				ugi.sort_order
			from app.user_group_member ugm
			join app.user_group_interface ugi
				on ugi.user_group_id = ugm.user_group_id
			where ugm.user_id = user_id
				and ugm.is_active = true
				and ugi.is_active = true
		) as source
		group by source.interface_id
	),
	effective_menus as (
		select
			im.menu_id,
			min((ei.sort_order * 1000) + im.sort_order)::int as menu_order
		from effective_interfaces ei
		join app.interface_menu im
			on im.interface_id = ei.interface_id
		join app.menu m
			on m.id = im.menu_id
		where im.is_active = true
			and m.is_active = true
		group by im.menu_id
	),
	menu_rows as (
		select
			mi.id::text as id,
			mi.menu_id::text as "menuId",
			mi.parent_id::text as "parentId",
			mi.name,
			mi.icon_key as "iconKey",
			mi.sort_order as "sortOrder",
			mi.route_path as "routePath",
			mi.is_active as "isActive",
			em.menu_order as "menuOrder"
		from effective_menus em
		join app.menu_item mi
			on mi.menu_id = em.menu_id
		where mi.is_active = true
		order by
			em.menu_order,
			coalesce(mi.parent_id, 0),
			mi.sort_order,
			mi.id
	)
	select jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'item', null,
			'rows', coalesce((select jsonb_agg(row_to_json(menu_rows)) from menu_rows), '[]'::jsonb),
			'lookups', '{}'::jsonb,
			'totals', jsonb_build_object(
				'count', (select count(*) from menu_rows)
			),
			'extra', '{}'::jsonb
		),
		'messages', '[]'::jsonb,
		'meta', '{}'::jsonb
	);
$$;