drop function if exists app.user_group_index(jsonb);
create or replace function app.user_group_index(user_id bigint, payload jsonb)
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
				when 'userCount' then 'user_count'
				when 'interfaceCount' then 'interface_count'
				else 'code'
			end as sort_by,
			case lower(coalesce(payload->>'sortDirection', 'asc'))
				when 'desc' then 'desc'
				else 'asc'
			end as sort_direction
	),
	filtered as (
		select
			ug.id::text as id,
			ug.code,
			ug.name,
			ug.is_active as "isActive",
			count(distinct case when ugm.is_active then ugm.user_id end)::int as "userCount",
			count(distinct case when ugi.is_active then ugi.interface_id end)::int as "interfaceCount"
		from app.user_group ug
		left join app.user_group_member ugm on ugm.user_group_id = ug.id
		left join app.user_group_interface ugi on ugi.user_group_id = ug.id
		where (
			coalesce(payload->>'search', '') = ''
			or ug.code ilike '%' || (payload->>'search') || '%'
			or ug.name ilike '%' || (payload->>'search') || '%'
		)
		and (
			not (payload ? 'isActive')
			or (payload->>'isActive') is null
			or ug.is_active = (payload->>'isActive')::boolean
		)
		group by ug.id, ug.code, ug.name, ug.is_active
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
			case when params.sort_by = 'user_count' and params.sort_direction = 'asc' then filtered."userCount" end asc nulls last,
			case when params.sort_by = 'user_count' and params.sort_direction = 'desc' then filtered."userCount" end desc nulls last,
			case when params.sort_by = 'interface_count' and params.sort_direction = 'asc' then filtered."interfaceCount" end asc nulls last,
			case when params.sort_by = 'interface_count' and params.sort_direction = 'desc' then filtered."interfaceCount" end desc nulls last,
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

drop function if exists app.user_group_load(jsonb);
create or replace function app.user_group_load(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
	with selected_group as (
		select
			ug.id,
			ug.code,
			ug.name,
			ug.is_active
		from app.user_group ug
		where ug.id = (payload->>'id')::bigint
	),
	interface_rows as (
		select
			ugi.id::text as id,
			ugi.interface_id::text as "interfaceId",
			i.code as "interfaceCode",
			i.name as "interfaceName",
			ugi.sort_order as "sortOrder",
			ugi.is_active as "isActive"
		from app.user_group_interface ugi
		join app.interface i on i.id = ugi.interface_id
		where ugi.user_group_id = (select id from selected_group)
		order by ugi.sort_order, i.code, i.id
	),
	member_rows as (
		select
			ugm.id::text as id,
			ugm.user_id::text as "userId",
			u.login as "userLogin",
			u.full_name as "userFullName",
			ugm.is_active as "isActive"
		from app.user_group_member ugm
		join app.users u on u.id = ugm.user_id
		where ugm.user_group_id = (select id from selected_group)
		order by u.login, u.id
	),
	available_interfaces as (
		select jsonb_build_object(
			'value', i.id::text,
			'label', i.name
		) as row_data
		from app.interface i
		where i.is_active = true
		order by i.code, i.id
	),
	available_users as (
		select jsonb_build_object(
			'value', u.id::text,
			'label', coalesce(nullif(trim(u.full_name), ''), u.login)
		) as row_data
		from app.users u
		where u.is_active = true
		order by u.login, u.id
	)
	select jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'item', (
				select jsonb_build_object(
					'id', sg.id::text,
					'code', sg.code,
					'name', sg.name,
					'isActive', sg.is_active,
					'interfaceIds', coalesce((
						select jsonb_agg(ir."interfaceId")
						from interface_rows ir
						where ir."isActive" = true
					), '[]'::jsonb),
					'userIds', coalesce((
						select jsonb_agg(mr."userId")
						from member_rows mr
						where mr."isActive" = true
					), '[]'::jsonb)
				)
				from selected_group sg
			),
			'rows', jsonb_build_object(
				'interfaces', coalesce((select jsonb_agg(row_to_json(interface_rows)) from interface_rows), '[]'::jsonb),
				'users', coalesce((select jsonb_agg(row_to_json(member_rows)) from member_rows), '[]'::jsonb)
			),
			'lookups', jsonb_build_object(
				'interfaces', coalesce((select jsonb_agg(row_data) from available_interfaces), '[]'::jsonb),
				'users', coalesce((select jsonb_agg(row_data) from available_users), '[]'::jsonb),
				'activeStates', jsonb_build_array(
					jsonb_build_object('value', 'true', 'label', 'Так'),
					jsonb_build_object('value', 'false', 'label', 'Ні')
				)
			),
			'totals', jsonb_build_object(
				'interfaceCount', (select count(*) from interface_rows),
				'userCount', (select count(*) from member_rows)
			),
			'extra', '{}'::jsonb
		),
		'messages', '[]'::jsonb,
		'meta', '{}'::jsonb
	);
$$;

drop function if exists app.user_group_update(jsonb);
create or replace function app.user_group_update(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
	item jsonb;
	interface_ids jsonb;
	member_ids jsonb;
	result_item jsonb;
	v_group_id bigint;
begin
	item := payload->'item';
	interface_ids := coalesce(item->'interfaceIds', '[]'::jsonb);
	member_ids := coalesce(item->'userIds', '[]'::jsonb);
	v_group_id := nullif(item->>'id', '')::bigint;

	if item is null or jsonb_typeof(item) <> 'object' then
		raise exception 'User group item payload is required';
	end if;

	if coalesce(nullif(trim(item->>'code'), ''), '') = '' then
		raise exception 'User group code is required';
	end if;

	if coalesce(nullif(trim(item->>'name'), ''), '') = '' then
		raise exception 'User group name is required';
	end if;

	if jsonb_typeof(interface_ids) <> 'array' then
		raise exception 'interfaceIds must be an array';
	end if;

	if jsonb_typeof(member_ids) <> 'array' then
		raise exception 'userIds must be an array';
	end if;

	if exists (
		select 1
		from jsonb_array_elements_text(interface_ids) as row_data(value)
		where not exists (
			select 1
			from app.interface i
			where i.id = row_data.value::bigint
		)
	) then
		raise exception 'One or more interfaces were not found';
	end if;

	if exists (
		select 1
		from jsonb_array_elements_text(member_ids) as row_data(value)
		where not exists (
			select 1
			from app.users u
			where u.id = row_data.value::bigint
		)
	) then
		raise exception 'One or more users were not found';
	end if;

	if v_group_id is null then
		insert into app.user_group (
			code,
			name,
			is_active
		)
		values (
			trim(item->>'code'),
			trim(item->>'name'),
			coalesce((item->>'isActive')::boolean, true)
		)
		returning id into v_group_id;
	else
		update app.user_group
		set
			code = trim(item->>'code'),
			name = trim(item->>'name'),
			is_active = coalesce((item->>'isActive')::boolean, is_active),
			updated_at = now()
		where id = v_group_id;

		if not found then
			raise exception 'User group % was not found', v_group_id;
		end if;
	end if;

	delete from app.user_group_interface where user_group_id = v_group_id;
	insert into app.user_group_interface (
		user_group_id,
		interface_id,
		sort_order,
		is_active
	)
	select
		v_group_id,
		row_data.value::bigint,
		row_data.ordinality::int * 10,
		true
	from jsonb_array_elements_text(interface_ids) with ordinality as row_data(value, ordinality);

	delete from app.user_group_member where user_group_id = v_group_id;
	insert into app.user_group_member (
		user_group_id,
		user_id,
		is_active
	)
	select
		v_group_id,
		row_data.value::bigint,
		true
	from jsonb_array_elements_text(member_ids) as row_data(value);

	select jsonb_build_object(
		'id', ug.id::text,
		'code', ug.code,
		'name', ug.name,
		'isActive', ug.is_active,
		'interfaceIds', coalesce((
			select jsonb_agg(ugi.interface_id::text order by ugi.sort_order, ugi.id)
			from app.user_group_interface ugi
			where ugi.user_group_id = ug.id
		), '[]'::jsonb),
		'userIds', coalesce((
			select jsonb_agg(ugm.user_id::text order by ugm.user_id)
			from app.user_group_member ugm
			where ugm.user_group_id = ug.id
		), '[]'::jsonb)
	)
	into result_item
	from app.user_group ug
	where ug.id = v_group_id;

	return jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'item', result_item,
			'rows', jsonb_build_object(
				'interfaces', coalesce((
					select jsonb_agg(row_to_json(saved_interfaces))
					from (
						select
							ugi.id::text as id,
							ugi.interface_id::text as "interfaceId",
							i.code as "interfaceCode",
							i.name as "interfaceName",
							ugi.sort_order as "sortOrder",
							ugi.is_active as "isActive"
						from app.user_group_interface ugi
						join app.interface i on i.id = ugi.interface_id
						where ugi.user_group_id = v_group_id
						order by ugi.sort_order, i.code, i.id
					) as saved_interfaces
				), '[]'::jsonb),
				'users', coalesce((
					select jsonb_agg(row_to_json(saved_users))
					from (
						select
							ugm.id::text as id,
							ugm.user_id::text as "userId",
							u.login as "userLogin",
							u.full_name as "userFullName",
							ugm.is_active as "isActive"
						from app.user_group_member ugm
						join app.users u on u.id = ugm.user_id
						where ugm.user_group_id = v_group_id
						order by u.login, u.id
					) as saved_users
				), '[]'::jsonb)
			),
			'lookups', '{}'::jsonb,
			'totals', jsonb_build_object(
				'interfaceCount', (select count(*) from app.user_group_interface where user_group_id = v_group_id),
				'userCount', (select count(*) from app.user_group_member where user_group_id = v_group_id)
			),
			'extra', '{}'::jsonb
		),
		'messages', jsonb_build_array('User group updated successfully'),
		'meta', '{}'::jsonb
	);
end;
$$;

drop function if exists app.user_group_fetch(jsonb);
create or replace function app.user_group_fetch(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
	with options as (
		select jsonb_build_object(
			'value', ug.id::text,
			'label', ug.name
		) as row_data
		from app.user_group ug
		where ug.is_active = true
			and (
				coalesce(payload->>'search', '') = ''
				or ug.code ilike '%' || (payload->>'search') || '%'
				or ug.name ilike '%' || (payload->>'search') || '%'
			)
		order by ug.code, ug.id
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