drop function if exists app.user_index(jsonb);
create or replace function app.user_index(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
	with params as (
		select
			greatest(coalesce((payload->>'page')::int, 1), 1) as page,
			greatest(coalesce((payload->>'pageSize')::int, 20), 1) as page_size,
			case coalesce(payload->>'sortBy', 'login')
				when 'login' then 'login'
				when 'fullName' then 'full_name'
				when 'isActive' then 'is_active'
				when 'groupCount' then 'group_count'
				else 'login'
			end as sort_by,
			case lower(coalesce(payload->>'sortDirection', 'asc'))
				when 'desc' then 'desc'
				else 'asc'
			end as sort_direction
	),
	filtered as (
		select
			u.id::text as id,
			u.login,
			u.full_name as "fullName",
			u.is_active as "isActive",
			count(case when ugm.is_active then 1 end)::int as "groupCount"
		from app.users u
		left join app.user_group_member ugm
			on ugm.user_id = u.id
		where (
			coalesce(payload->>'search', '') = ''
			or u.login ilike '%' || (payload->>'search') || '%'
			or u.full_name ilike '%' || (payload->>'search') || '%'
		)
		and (
			not (payload ? 'isActive')
			or (payload->>'isActive') is null
			or u.is_active = (payload->>'isActive')::boolean
		)
		group by u.id, u.login, u.full_name, u.is_active
	),
	counted as (
		select count(*)::int as total from filtered
	),
	paged as (
		select filtered.*
		from filtered
		cross join params
		order by
			case when params.sort_by = 'login' and params.sort_direction = 'asc' then filtered.login end asc nulls last,
			case when params.sort_by = 'login' and params.sort_direction = 'desc' then filtered.login end desc nulls last,
			case when params.sort_by = 'full_name' and params.sort_direction = 'asc' then filtered."fullName" end asc nulls last,
			case when params.sort_by = 'full_name' and params.sort_direction = 'desc' then filtered."fullName" end desc nulls last,
			case when params.sort_by = 'is_active' and params.sort_direction = 'asc' then filtered."isActive" end asc nulls last,
			case when params.sort_by = 'is_active' and params.sort_direction = 'desc' then filtered."isActive" end desc nulls last,
			case when params.sort_by = 'group_count' and params.sort_direction = 'asc' then filtered."groupCount" end asc nulls last,
			case when params.sort_by = 'group_count' and params.sort_direction = 'desc' then filtered."groupCount" end desc nulls last,
			filtered.login asc,
			filtered.id asc
		limit (select page_size from params)
		offset ((select page from params) - 1) * (select page_size from params)
	),
	active_states as (
		select jsonb_build_array(
			jsonb_build_object('value', 'true', 'label', 'Активні'),
			jsonb_build_object('value', 'false', 'label', 'Неактивні')
		) as rows
	)
	select jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'rows', coalesce((select jsonb_agg(row_to_json(paged)) from paged), '[]'::jsonb),
			'lookups', jsonb_build_object(
				'activeStates', (select rows from active_states)
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

drop function if exists app.user_load(jsonb);
create or replace function app.user_load(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
	with params as (
		select nullif(payload->>'id', '')::bigint as selected_user_id
	),
	selected_user as (
		select
			u.id,
			u.login,
			u.full_name,
			u.is_active
		from app.users u
		where u.id = (select selected_user_id from params)
	),
	group_rows as (
		select
			ugm.id::text as id,
			ug.id::text as "groupId",
			ug.code as "groupCode",
			ug.name as "groupName",
			ugm.is_active as "isActive"
		from app.user_group_member ugm
		join app.user_group ug on ug.id = ugm.user_group_id
		where ugm.user_id = (select id from selected_user)
		order by ug.code, ug.id
	),
	available_groups as (
		select jsonb_build_object(
			'value', ug.id::text,
			'label', ug.name
		) as row_data
		from app.user_group ug
		where ug.is_active = true
		order by ug.code, ug.id
	)
	select jsonb_build_object(
		'ok', true,
		'data', jsonb_build_object(
			'item', (
				select jsonb_build_object(
					'id', su.id::text,
					'login', su.login,
					'fullName', su.full_name,
					'password', '',
					'isActive', su.is_active,
					'groupIds', coalesce((
						select jsonb_agg(gr."groupId")
						from group_rows gr
						where gr."isActive" = true
					), '[]'::jsonb)
				)
				from selected_user su
			),
			'rows', coalesce((select jsonb_agg(row_to_json(group_rows)) from group_rows), '[]'::jsonb),
			'lookups', jsonb_build_object(
				'groups', coalesce((select jsonb_agg(row_data) from available_groups), '[]'::jsonb),
				'activeStates', jsonb_build_array(
					jsonb_build_object('value', 'true', 'label', 'Так'),
					jsonb_build_object('value', 'false', 'label', 'Ні')
				)
			),
			'totals', jsonb_build_object(
				'count', (select count(*) from group_rows)
			),
			'extra', '{}'::jsonb
		),
		'messages', '[]'::jsonb,
		'meta', '{}'::jsonb
	);
$$;

drop function if exists app.user_fetch(jsonb);
create or replace function app.user_fetch(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
	with options as (
		select jsonb_build_object(
			'value', u.id::text,
			'label', coalesce(nullif(trim(u.full_name), ''), u.login)
		) as row_data
		from app.users u
		where u.is_active = true
			and (
				coalesce(payload->>'search', '') = ''
				or u.login ilike '%' || (payload->>'search') || '%'
				or u.full_name ilike '%' || (payload->>'search') || '%'
			)
		order by u.login, u.id
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