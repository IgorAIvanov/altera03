do $$
begin
	alter table if exists app.journal_entries
		add column if not exists currency_amount numeric(15, 2);

	alter table if exists app.analytic_dimensions
		add column if not exists model_key varchar(100);

	alter table if exists app.analytic_dimensions
		add column if not exists default_view varchar(50);

	alter table if exists app.analytic_dimensions
		add column if not exists document_type_code varchar(50);

	create index if not exists idx_analytic_dimensions_document_type
		on app.analytic_dimensions(document_type_code);

	update app.analytic_dimensions
	set
		model_key = coalesce(model_key, case code when 'counterparty' then 'counterparty' else code end),
		default_view = coalesce(default_view, 'edit')
	where model_key is null
		or default_view is null;

	alter table if exists app.analytic_dimensions
		alter column model_key set not null;

	alter table if exists app.analytic_dimensions
		alter column default_view set default 'edit';

	alter table if exists app.analytic_dimensions
		alter column default_view set not null;

	insert into app.analytic_dimensions (
		code,
		name,
		entity_kind,
		model_key,
		default_view,
		target_table,
		document_type_code,
		id_column,
		code_column,
		name_column,
		presentation_column,
		is_active
	)
	values (
		'counterparty',
		'Контрагент',
		'catalog',
		'counterparty',
		'edit',
		'app.counterparties',
		null,
		'id',
		'code',
		'name',
		'name',
		true
	)
	on conflict (code) do update
	set
		name = excluded.name,
		entity_kind = excluded.entity_kind,
		model_key = excluded.model_key,
		default_view = excluded.default_view,
		target_table = excluded.target_table,
		document_type_code = excluded.document_type_code,
		id_column = excluded.id_column,
		code_column = excluded.code_column,
		name_column = excluded.name_column,
		presentation_column = excluded.presentation_column,
		is_active = excluded.is_active;

	if to_regclass('public.document_types') is not null then
		update app.documents d
		set document_type_id = public_dt.id
		from app.document_types app_dt
		join public.document_types public_dt on public_dt.code = app_dt.code
		where d.document_type_id = app_dt.id
			and app_dt.id <> public_dt.id;

		update app.document_types app_dt
		set
			id = public_dt.id,
			name = public_dt.name,
			short_name = public_dt.short_name,
			sort_order = public_dt.sort_order
		from public.document_types public_dt
		where app_dt.code = public_dt.code
			and app_dt.id <> public_dt.id
			and not exists (
				select 1
				from app.document_types existing_dt
				where existing_dt.id = public_dt.id
			);

		insert into app.document_types (id, code, name, short_name, sort_order)
		select dt.id, dt.code, dt.name, dt.short_name, dt.sort_order
		from public.document_types dt
		where not exists (
			select 1
			from app.document_types existing_dt
			where existing_dt.id = dt.id
				or existing_dt.code = dt.code
		);

		perform setval(
			pg_get_serial_sequence('app.document_types', 'id'),
			greatest(coalesce((select max(id) from app.document_types), 1), 1),
			true
		);
	end if;

	if to_regclass('public.documents') is not null then
		insert into app.documents (
			id,
			document_type_id,
			organization_id,
			number,
			date,
			counterparty_id,
			currency_id,
			amount,
			description,
			is_posted,
			posted_at,
			posted_by,
			created_by,
			created_at,
			updated_at
		)
		select
			d.id,
			d.document_type_id,
			d.organization_id,
			d.number,
			d.date,
			d.counterparty_id,
			d.currency_id,
			d.amount,
			d.description,
			d.is_posted,
			d.posted_at,
			d.posted_by,
			d.created_by,
			d.created_at,
			d.updated_at
		from public.documents d
		where exists (select 1 from app.document_types dt where dt.id = d.document_type_id)
			and exists (select 1 from app.organization o where o.id = d.organization_id)
			and (d.counterparty_id is null or exists (select 1 from app.counterparties c where c.id = d.counterparty_id))
			and (d.posted_by is null or exists (select 1 from app.users u where u.id = d.posted_by))
			and exists (select 1 from app.users u where u.id = d.created_by)
		on conflict (id) do update
		set
			document_type_id = excluded.document_type_id,
			organization_id = excluded.organization_id,
			number = excluded.number,
			date = excluded.date,
			counterparty_id = excluded.counterparty_id,
			currency_id = excluded.currency_id,
			amount = excluded.amount,
			description = excluded.description,
			is_posted = excluded.is_posted,
			posted_at = excluded.posted_at,
			posted_by = excluded.posted_by,
			created_by = excluded.created_by,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at;

		perform setval(
			pg_get_serial_sequence('app.documents', 'id'),
			greatest(coalesce((select max(id) from app.documents), 1), 1),
			true
		);
	end if;

	if to_regclass('public.journal_entries') is not null then
		if exists (
			select 1
			from information_schema.columns c
			where c.table_schema = 'public'
				and c.table_name = 'journal_entries'
				and c.column_name = 'currency_amount'
		) then
			insert into app.journal_entries (
				id,
				document_id,
				line_number,
				debit_account,
				credit_account,
				amount,
				currency_id,
				currency_amount,
				quantity,
				description,
				debit_counterparty_id,
				credit_counterparty_id,
				created_at
			)
			select
				je.id,
				je.document_id,
				je.line_number,
				je.debit_account,
				je.credit_account,
				je.amount,
				je.currency_id,
				je.currency_amount,
				je.quantity,
				je.description,
				je.debit_counterparty_id,
				je.credit_counterparty_id,
				je.created_at
			from public.journal_entries je
			where exists (select 1 from app.documents d where d.id = je.document_id)
				and (je.debit_counterparty_id is null or exists (select 1 from app.counterparties c where c.id = je.debit_counterparty_id))
				and (je.credit_counterparty_id is null or exists (select 1 from app.counterparties c where c.id = je.credit_counterparty_id))
			on conflict (id) do update
			set
				document_id = excluded.document_id,
				line_number = excluded.line_number,
				debit_account = excluded.debit_account,
				credit_account = excluded.credit_account,
				amount = excluded.amount,
				currency_id = excluded.currency_id,
				currency_amount = excluded.currency_amount,
				quantity = excluded.quantity,
				description = excluded.description,
				debit_counterparty_id = excluded.debit_counterparty_id,
				credit_counterparty_id = excluded.credit_counterparty_id,
				created_at = excluded.created_at;
		else
			insert into app.journal_entries (
				id,
				document_id,
				line_number,
				debit_account,
				credit_account,
				amount,
				currency_id,
				quantity,
				description,
				debit_counterparty_id,
				credit_counterparty_id,
				created_at
			)
			select
				je.id,
				je.document_id,
				je.line_number,
				je.debit_account,
				je.credit_account,
				je.amount,
				je.currency_id,
				je.quantity,
				je.description,
				je.debit_counterparty_id,
				je.credit_counterparty_id,
				je.created_at
			from public.journal_entries je
			where exists (select 1 from app.documents d where d.id = je.document_id)
				and (je.debit_counterparty_id is null or exists (select 1 from app.counterparties c where c.id = je.debit_counterparty_id))
				and (je.credit_counterparty_id is null or exists (select 1 from app.counterparties c where c.id = je.credit_counterparty_id))
			on conflict (id) do update
			set
				document_id = excluded.document_id,
				line_number = excluded.line_number,
				debit_account = excluded.debit_account,
				credit_account = excluded.credit_account,
				amount = excluded.amount,
				currency_id = excluded.currency_id,
				quantity = excluded.quantity,
				description = excluded.description,
				debit_counterparty_id = excluded.debit_counterparty_id,
				credit_counterparty_id = excluded.credit_counterparty_id,
				created_at = excluded.created_at;
		end if;

		perform setval(
			pg_get_serial_sequence('app.journal_entries', 'id'),
			greatest(coalesce((select max(id) from app.journal_entries), 1), 1),
			true
		);
	end if;

	insert into app.journal_entry_analytics (
		journal_entry_id,
		side,
		slot_no,
		dimension_code,
		value_id,
		value_code_snapshot,
		value_name_snapshot,
		value_presentation_snapshot
	)
	select
		je.id,
		analytics.side,
		1,
		'counterparty',
		analytics.counterparty_id,
		cp.code,
		cp.name,
		cp.name
	from app.journal_entries je
	join lateral (
		select
			'debit'::varchar(10) as side,
			je.debit_counterparty_id as counterparty_id
		where je.debit_counterparty_id is not null
		union all
		select
			'credit'::varchar(10) as side,
			je.credit_counterparty_id as counterparty_id
		where je.credit_counterparty_id is not null
	) analytics on true
	join app.counterparties cp on cp.id = analytics.counterparty_id
	on conflict (journal_entry_id, side, slot_no) do update
	set
		dimension_code = excluded.dimension_code,
		value_id = excluded.value_id,
		value_code_snapshot = excluded.value_code_snapshot,
		value_name_snapshot = excluded.value_name_snapshot,
		value_presentation_snapshot = excluded.value_presentation_snapshot;
end
$$;
