-- Синхронізація лічильників identity.
--
-- Рядки могли потрапити в таблиці з явними id — перенесенням зі старої схеми
-- або seed-даними. Тоді лічильник лишається на початку, і перший же insert без
-- id падає з "duplicate key value violates unique constraint". Виявляється це
-- не при публікації, а при створенні першого справжнього користувача.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['users', 'user_group', 'user_group_member', 'user_group_permission', 'user_identity']
  loop
    execute format(
      'select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(id) from app.%I), 0) + 1, false)',
      'app.' || v_table, 'id', v_table
    );
  end loop;
end $$;

-- Прибирання груп, що лишилися від доступу «через інтерфейси»: там група була
-- лише контейнером для набору екранів і власних прав не мала. Тепер група без
-- жодного права не значить нічого, крім того, що вона з тієї епохи —
-- видаляємо, щоб її учасники дісталися групам із реальними правами.
-- Разові state redirect-потоку живуть хвилини. Основне прибирання робить TS при
-- кожному новому вході; це — на випадок, коли потік довго не запускали взагалі.
delete from app.auth_login_state where expires_at < now();

delete from app.user_group g
where not exists (
	select 1 from app.user_group_permission p where p.user_group_id = g.id
)
and g.code not in ('admin', 'viewer');

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

-- Прапорець тимчасового пароля (див. struc.sql). Для вже наявних користувачів
-- false: їхні паролі задавала людина, а не оточення.
alter table app.users
  add column if not exists must_change_password boolean not null default false;
