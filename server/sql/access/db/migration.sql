do $$
begin
	if to_regclass('public.users') is not null then
		insert into app.users (
			id,
			login,
			password_hash,
			full_name,
			is_active,
			created_at,
			updated_at
		)
		select
			u.id,
			u.login,
			u.password_hash,
			u.full_name,
			u.is_active,
			u.created_at,
			u.updated_at
		from public.users u
		on conflict (id) do update
		set
			login = excluded.login,
			password_hash = excluded.password_hash,
			full_name = excluded.full_name,
			is_active = excluded.is_active,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at;

		perform setval(
			pg_get_serial_sequence('app.users', 'id'),
			greatest(coalesce((select max(id) from app.users), 1), 1),
			true
		);
	end if;

	if to_regclass('public.auth_session') is not null then
		insert into app.auth_session (
			id,
			user_id,
			auth_method,
			token_hash,
			expires_at,
			last_seen_at,
			revoked_at,
			created_at,
			updated_at
		)
		select
			s.id,
			s.user_id,
			s.auth_method,
			s.token_hash,
			s.expires_at,
			s.last_seen_at,
			s.revoked_at,
			s.created_at,
			s.updated_at
		from public.auth_session s
		where exists (
			select 1
			from app.users u
			where u.id = s.user_id
		)
		on conflict (id) do update
		set
			user_id = excluded.user_id,
			auth_method = excluded.auth_method,
			token_hash = excluded.token_hash,
			expires_at = excluded.expires_at,
			last_seen_at = excluded.last_seen_at,
			revoked_at = excluded.revoked_at,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at;
	end if;
end
$$;
