do $$
declare
	seed jsonb := $seed$
	{
	  "menus": [
	    { "code": "default", "name": "Основне меню", "isActive": true }
	  ],
	  "interfaces": [
	    { "code": "default", "name": "Інтерфейс за замовчуванням", "isActive": true }
	  ],
	  "userGroups": [
	    { "code": "default", "name": "Користувачі за замовчуванням", "isActive": true }
	  ],
	  "menuItems": [
	    { "menuCode": "default", "code": "directories", "parentCode": null, "name": "menu.directories", "iconKey": "book", "sortOrder": 10, "routePath": null, "isActive": true },
	    { "menuCode": "default", "code": "banks", "parentCode": "directories", "name": "menu.banks", "iconKey": "book", "sortOrder": 15, "routePath": "/catalog/bank/list", "isActive": true },
	    { "menuCode": "default", "code": "chart_of_accounts", "parentCode": "directories", "name": "menu.chartOfAccounts", "iconKey": "book", "sortOrder": 20, "routePath": "/catalog/chart_of_account/list", "isActive": true },
	    { "menuCode": "default", "code": "counterparties", "parentCode": "directories", "name": "menu.counterparties", "iconKey": "team", "sortOrder": 30, "routePath": "/catalog/counterparty/list", "isActive": true },
	    { "menuCode": "default", "code": "counterparty_contracts", "parentCode": "directories", "name": "menu.counterpartyContracts", "iconKey": "file-text", "sortOrder": 31, "routePath": "/catalog/counterparty_contract/list", "isActive": true },
	    { "menuCode": "default", "code": "bank_accounts", "parentCode": "directories", "name": "menu.bankAccounts", "iconKey": "credit-card", "sortOrder": 32, "routePath": "/catalog/bank_account/list", "isActive": true },
	    { "menuCode": "default", "code": "physical_persons", "parentCode": "directories", "name": "menu.physicalPersons", "iconKey": "team", "sortOrder": 33, "routePath": "/catalog/physical_person/list", "isActive": true },
	    { "menuCode": "default", "code": "currencies", "parentCode": "directories", "name": "menu.currencies", "iconKey": "book", "sortOrder": 35, "routePath": "/catalog/currency/list", "isActive": true },
	    { "menuCode": "default", "code": "unit_classifier", "parentCode": "directories", "name": "menu.unitClassifier", "iconKey": "book", "sortOrder": 37, "routePath": "/catalog/unit_classifier/list", "isActive": true },
	    { "menuCode": "default", "code": "organizations", "parentCode": "directories", "name": "menu.organizations", "iconKey": "apartment", "sortOrder": 38, "routePath": "/catalog/organization/list", "isActive": true },
	    { "menuCode": "default", "code": "organization_departments", "parentCode": "directories", "name": "menu.organizationDepartments", "iconKey": "cluster", "sortOrder": 39, "routePath": "/catalog/organization_department/list", "isActive": true },
	    { "menuCode": "default", "code": "currency_rates", "parentCode": null, "name": "menu.currencyRates", "iconKey": "line-chart", "sortOrder": 36, "routePath": "/register/currency_rate/list", "isActive": true },
	    { "menuCode": "default", "code": "warehouses", "parentCode": "directories", "name": "menu.warehouses", "iconKey": "inbox", "sortOrder": 40, "routePath": "/catalog/warehouse/list", "isActive": true },
	    { "menuCode": "default", "code": "nomenclature", "parentCode": "directories", "name": "menu.nomenclature", "iconKey": "inbox", "sortOrder": 45, "routePath": "/catalog/nomenclature/list", "isActive": true },
	    { "menuCode": "default", "code": "nomenclature_groups", "parentCode": "directories", "name": "menu.nomenclatureGroups", "iconKey": "folder-open", "sortOrder": 46, "routePath": "/catalog/nomenclature_group/list", "isActive": true },
	    { "menuCode": "default", "code": "expense_items", "parentCode": "directories", "name": "menu.expenseItems", "iconKey": "profile", "sortOrder": 47, "routePath": "/catalog/expense_item/list", "isActive": true },
	    { "menuCode": "default", "code": "income_items", "parentCode": "directories", "name": "menu.incomeItems", "iconKey": "rise", "sortOrder": 48, "routePath": "/catalog/income_item/list", "isActive": true },
	    { "menuCode": "default", "code": "cash_flow_items", "parentCode": "directories", "name": "menu.cashFlowItems", "iconKey": "wallet", "sortOrder": 49, "routePath": "/catalog/cash_flow_item/list", "isActive": true },
	    { "menuCode": "default", "code": "price_types", "parentCode": "directories", "name": "menu.priceTypes", "iconKey": "tags", "sortOrder": 50, "routePath": "/catalog/price_type/list", "isActive": true },
	    { "menuCode": "default", "code": "taxes", "parentCode": "directories", "name": "menu.taxes", "iconKey": "book", "sortOrder": 50, "routePath": "/catalog/tax/list", "isActive": true },
	    { "menuCode": "default", "code": "tax_declaration_items", "parentCode": "directories", "name": "menu.taxDeclarationItems", "iconKey": "profile", "sortOrder": 50, "routePath": "/catalog/tax_declaration_item/list", "isActive": true },
	    { "menuCode": "default", "code": "reserves", "parentCode": "directories", "name": "menu.reserves", "iconKey": "safety-certificate", "sortOrder": 50, "routePath": "/catalog/reserve/list", "isActive": true },
	    { "menuCode": "default", "code": "tax_purposes", "parentCode": "directories", "name": "menu.taxPurposes", "iconKey": "book", "sortOrder": 51, "routePath": "/catalog/tax_purpose/list", "isActive": true },
	    { "menuCode": "default", "code": "construction_objects", "parentCode": "directories", "name": "menu.constructionObjects", "iconKey": "apartment", "sortOrder": 52, "routePath": "/catalog/construction_object/list", "isActive": true },
	    { "menuCode": "default", "code": "intangible_assets", "parentCode": "directories", "name": "menu.intangibleAssets", "iconKey": "deployment-unit", "sortOrder": 53, "routePath": "/catalog/intangible_asset/list", "isActive": true },
	    { "menuCode": "default", "code": "vat_rates", "parentCode": "directories", "name": "menu.vatRates", "iconKey": "percentage", "sortOrder": 54, "routePath": "/register/vat_rate/list", "isActive": true },
	    { "menuCode": "default", "code": "tax_rate_scales", "parentCode": "directories", "name": "menu.taxRateScales", "iconKey": "line-chart", "sortOrder": 55, "routePath": "/register/tax_rate_scale/list", "isActive": true },
	    { "menuCode": "default", "code": "documents", "parentCode": null, "name": "menu.documents", "iconKey": "file-text", "sortOrder": 50, "routePath": "/operation/document/list", "isActive": true },
	    { "menuCode": "default", "code": "manual_entry", "parentCode": "documents", "name": "menu.manualEntry", "iconKey": "form", "sortOrder": 5, "routePath": "/operation/manual_entry/list", "isActive": true },
	    { "menuCode": "default", "code": "supplier_invoice", "parentCode": "documents", "name": "menu.supplierInvoice", "iconKey": "file-text", "sortOrder": 10, "routePath": "/operation/supplier_invoice/list", "isActive": true },
	    { "menuCode": "default", "code": "invoice", "parentCode": "documents", "name": "menu.invoice", "iconKey": "file-text", "sortOrder": 15, "routePath": "/document/invoice/list", "isActive": true },
	    { "menuCode": "default", "code": "administration", "parentCode": null, "name": "menu.administration", "iconKey": "setting", "sortOrder": 90, "routePath": null, "isActive": true },
	    { "menuCode": "default", "code": "interfaces", "parentCode": "administration", "name": "menu.interfaces", "iconKey": "appstore", "sortOrder": 10, "routePath": "/admin/interface/list", "isActive": true },
	    { "menuCode": "default", "code": "print_templates", "parentCode": "administration", "name": "menu.printTemplates", "iconKey": "file-text", "sortOrder": 15, "routePath": "/admin/print_template/list", "isActive": true },
	    { "menuCode": "default", "code": "user_groups", "parentCode": "administration", "name": "menu.userGroups", "iconKey": "team", "sortOrder": 20, "routePath": "/admin/user_group/list", "isActive": true },
	    { "menuCode": "default", "code": "users", "parentCode": "administration", "name": "menu.users", "iconKey": "user", "sortOrder": 30, "routePath": "/admin/user/list", "isActive": true },
	    { "menuCode": "default", "code": "develope", "parentCode": null, "name": "menu.develope", "iconKey": "file-text", "sortOrder": 95, "routePath": null, "isActive": true },
	    { "menuCode": "default", "code": "bas_import_process", "parentCode": "develope", "name": "menu.basImportProcess", "iconKey": "deployment-unit", "sortOrder": 5, "routePath": "/develope/basImportProcess/list", "isActive": true },
	    { "menuCode": "default", "code": "bas_model_spec_template", "parentCode": "develope", "name": "menu.basModelSpecTemplate", "iconKey": "profile", "sortOrder": 6, "routePath": "/develope/basModelSpecTemplate/list", "isActive": true },
	    { "menuCode": "default", "code": "not_implemented", "parentCode": "develope", "name": "menu.notImplement", "iconKey": "file-text", "sortOrder": 10, "routePath": "/develope/notImplement/list", "isActive": true },
	    { "menuCode": "default", "code": "reports", "parentCode": null, "name": "menu.reports", "iconKey": "bar-chart", "sortOrder": 100, "routePath": null, "isActive": true },
	    { "menuCode": "default", "code": "balance", "parentCode": "reports", "name": "menu.balance", "iconKey": "unordered-list", "sortOrder": 10, "routePath": "/report/balance/list", "isActive": true },
	    { "menuCode": "default", "code": "account_balance", "parentCode": "reports", "name": "menu.accountBalance", "iconKey": "bars", "sortOrder": 20, "routePath": "/report/account_balance/list", "isActive": true },
	    { "menuCode": "default", "code": "account_card", "parentCode": "reports", "name": "menu.accountCard", "iconKey": "file-text", "sortOrder": 30, "routePath": "/report/account_card/list", "isActive": true },
	    { "menuCode": "default", "code": "journal_report", "parentCode": "reports", "name": "menu.journal", "iconKey": "file-text", "sortOrder": 40, "routePath": "/report/journal_report/list", "isActive": true }
	  ],
	  "interfaceMenus": [
	    { "interfaceCode": "default", "menuCode": "default", "sortOrder": 10, "isActive": true }
	  ],
	  "groupInterfaces": [
	    { "userGroupCode": "default", "interfaceCode": "default", "sortOrder": 10, "isActive": true }
	  ]
	}
	$seed$::jsonb;
begin
	create temporary table if not exists pg_temp.seed_menu (
		code varchar(100) primary key,
		name varchar(255) not null,
		is_active boolean not null
	) on commit drop;

	create temporary table if not exists pg_temp.seed_interface (
		code varchar(100) primary key,
		name varchar(255) not null,
		is_active boolean not null
	) on commit drop;

	create temporary table if not exists pg_temp.seed_user_group (
		code varchar(100) primary key,
		name varchar(255) not null,
		is_active boolean not null
	) on commit drop;

	create temporary table if not exists pg_temp.seed_menu_item (
		menu_code varchar(100) not null,
		code varchar(100) not null,
		parent_code varchar(100),
		name varchar(255) not null,
		icon_key varchar(100),
		sort_order int not null,
		route_path varchar(500),
		is_active boolean not null,
		primary key (menu_code, code)
	) on commit drop;

	create temporary table if not exists pg_temp.seed_interface_menu (
		interface_code varchar(100) not null,
		menu_code varchar(100) not null,
		sort_order int not null,
		is_active boolean not null,
		primary key (interface_code, menu_code)
	) on commit drop;

	create temporary table if not exists pg_temp.seed_group_interface (
		user_group_code varchar(100) not null,
		interface_code varchar(100) not null,
		sort_order int not null,
		is_active boolean not null,
		primary key (user_group_code, interface_code)
	) on commit drop;

	truncate table pg_temp.seed_menu;
	truncate table pg_temp.seed_interface;
	truncate table pg_temp.seed_user_group;
	truncate table pg_temp.seed_menu_item;
	truncate table pg_temp.seed_interface_menu;
	truncate table pg_temp.seed_group_interface;

	insert into pg_temp.seed_menu (code, name, is_active)
	select x.code, x.name, x."isActive"
	from jsonb_to_recordset(seed->'menus') as x(
		code varchar(100),
		name varchar(255),
		"isActive" boolean
	);

	insert into pg_temp.seed_interface (code, name, is_active)
	select x.code, x.name, x."isActive"
	from jsonb_to_recordset(seed->'interfaces') as x(
		code varchar(100),
		name varchar(255),
		"isActive" boolean
	);

	insert into pg_temp.seed_user_group (code, name, is_active)
	select x.code, x.name, x."isActive"
	from jsonb_to_recordset(seed->'userGroups') as x(
		code varchar(100),
		name varchar(255),
		"isActive" boolean
	);

	insert into pg_temp.seed_menu_item (menu_code, code, parent_code, name, icon_key, sort_order, route_path, is_active)
	select
		x."menuCode",
		x.code,
		x."parentCode",
		x.name,
		x."iconKey",
		x."sortOrder",
		x."routePath",
		x."isActive"
	from jsonb_to_recordset(seed->'menuItems') as x(
		"menuCode" varchar(100),
		code varchar(100),
		"parentCode" varchar(100),
		name varchar(255),
		"iconKey" varchar(100),
		"sortOrder" int,
		"routePath" varchar(500),
		"isActive" boolean
	);

	insert into pg_temp.seed_interface_menu (interface_code, menu_code, sort_order, is_active)
	select x."interfaceCode", x."menuCode", x."sortOrder", x."isActive"
	from jsonb_to_recordset(seed->'interfaceMenus') as x(
		"interfaceCode" varchar(100),
		"menuCode" varchar(100),
		"sortOrder" int,
		"isActive" boolean
	);

	insert into pg_temp.seed_group_interface (user_group_code, interface_code, sort_order, is_active)
	select x."userGroupCode", x."interfaceCode", x."sortOrder", x."isActive"
	from jsonb_to_recordset(seed->'groupInterfaces') as x(
		"userGroupCode" varchar(100),
		"interfaceCode" varchar(100),
		"sortOrder" int,
		"isActive" boolean
	);

	merge into app.menu target
	using pg_temp.seed_menu source
		on target.code = source.code
	when matched then
		update set
			name = source.name,
			is_active = source.is_active,
			updated_at = now()
	when not matched then
		insert (code, name, is_active)
		values (source.code, source.name, source.is_active);

	merge into app.interface target
	using pg_temp.seed_interface source
		on target.code = source.code
	when matched then
		update set
			name = source.name,
			is_active = source.is_active,
			updated_at = now()
	when not matched then
		insert (code, name, is_active)
		values (source.code, source.name, source.is_active);

	merge into app.user_group target
	using pg_temp.seed_user_group source
		on target.code = source.code
	when matched then
		update set
			name = source.name,
			is_active = source.is_active,
			updated_at = now()
	when not matched then
		insert (code, name, is_active)
		values (source.code, source.name, source.is_active);

	update app.menu_item target
	set
		code = source.code,
		updated_at = now()
	from pg_temp.seed_menu_item source
	join app.menu seeded_menu on seeded_menu.code = source.menu_code
	left join app.menu_item seeded_parent
		on seeded_parent.menu_id = seeded_menu.id
		and seeded_parent.code = source.parent_code
	where target.menu_id = seeded_menu.id
		and target.code is null
		and (
			(source.route_path is not null and target.route_path = source.route_path)
			or (
				source.route_path is null
				and target.route_path is null
				and target.name = source.name
				and (
					(source.parent_code is null and target.parent_id is null)
					or target.parent_id = seeded_parent.id
				)
			)
		);

	merge into app.menu_item target
	using (
		select
			m.id as menu_id,
			s.code,
			s.name,
			s.icon_key,
			s.sort_order,
			s.route_path,
			s.is_active
		from pg_temp.seed_menu_item s
		join app.menu m on m.code = s.menu_code
	) source
		on target.menu_id = source.menu_id and target.code = source.code
	when matched then
		update set
			name = source.name,
			icon_key = source.icon_key,
			sort_order = source.sort_order,
			route_path = source.route_path,
			is_active = source.is_active,
			updated_at = now()
	when not matched then
		insert (menu_id, parent_id, code, name, icon_key, sort_order, route_path, is_active)
		values (source.menu_id, null, source.code, source.name, source.icon_key, source.sort_order, source.route_path, source.is_active);

	update app.menu_item target
	set
		parent_id = parent_item.id,
		updated_at = now()
	from pg_temp.seed_menu_item source
	join app.menu seeded_menu on seeded_menu.code = source.menu_code
	left join app.menu_item parent_item
		on parent_item.menu_id = seeded_menu.id
		and parent_item.code = source.parent_code
	where target.menu_id = seeded_menu.id
		and target.code = source.code
		and target.parent_id is distinct from parent_item.id;

	delete from app.menu_item target
	using app.menu seeded_menu
	where target.menu_id = seeded_menu.id
		and exists (
			select 1
			from pg_temp.seed_menu seeded
			where seeded.code = seeded_menu.code
		)
		and target.code is not null
		and not exists (
			select 1
			from pg_temp.seed_menu_item source
			where source.menu_code = seeded_menu.code
				and source.code = target.code
		);

	merge into app.interface_menu target
	using (
		select
			i.id as interface_id,
			m.id as menu_id,
			s.sort_order,
			s.is_active
		from pg_temp.seed_interface_menu s
		join app.interface i on i.code = s.interface_code
		join app.menu m on m.code = s.menu_code
	) source
		on target.interface_id = source.interface_id and target.menu_id = source.menu_id
	when matched then
		update set
			sort_order = source.sort_order,
			is_active = source.is_active,
			updated_at = now()
	when not matched then
		insert (interface_id, menu_id, sort_order, is_active)
		values (source.interface_id, source.menu_id, source.sort_order, source.is_active);

	delete from app.interface_menu target
	using app.interface seeded_interface
	where target.interface_id = seeded_interface.id
		and exists (
			select 1
			from pg_temp.seed_interface seeded
			where seeded.code = seeded_interface.code
		)
		and not exists (
			select 1
			from pg_temp.seed_interface_menu source
			join app.menu seeded_menu on seeded_menu.code = source.menu_code
			where source.interface_code = seeded_interface.code
				and seeded_menu.id = target.menu_id
		);

	merge into app.user_group_interface target
	using (
		select
			ug.id as user_group_id,
			i.id as interface_id,
			s.sort_order,
			s.is_active
		from pg_temp.seed_group_interface s
		join app.user_group ug on ug.code = s.user_group_code
		join app.interface i on i.code = s.interface_code
	) source
		on target.user_group_id = source.user_group_id and target.interface_id = source.interface_id
	when matched then
		update set
			sort_order = source.sort_order,
			is_active = source.is_active,
			updated_at = now()
	when not matched then
		insert (user_group_id, interface_id, sort_order, is_active)
		values (source.user_group_id, source.interface_id, source.sort_order, source.is_active);

	delete from app.user_group_interface target
	using app.user_group seeded_group
	where target.user_group_id = seeded_group.id
		and exists (
			select 1
			from pg_temp.seed_user_group seeded
			where seeded.code = seeded_group.code
		)
		and not exists (
			select 1
			from pg_temp.seed_group_interface source
			join app.interface seeded_interface on seeded_interface.code = source.interface_code
			where source.user_group_code = seeded_group.code
				and seeded_interface.id = target.interface_id
		);

	merge into app.user_group_member target
	using (
		select
			ug.id as user_group_id,
			u.id as user_id,
			true as is_active
		from app.user_group ug
		cross join app.users u
		where ug.code = 'default'
	) source
		on target.user_group_id = source.user_group_id and target.user_id = source.user_id
	when matched then
		update set
			is_active = source.is_active,
			updated_at = now()
	when not matched then
		insert (user_group_id, user_id, is_active)
		values (source.user_group_id, source.user_id, source.is_active);

	merge into app.user_interface target
	using (
		select
			u.id as user_id,
			i.id as interface_id,
			10 as sort_order,
			true as is_active
		from app.users u
		join app.interface i on i.code = 'default'
	) source
		on target.user_id = source.user_id and target.interface_id = source.interface_id
	when matched then
		update set
			sort_order = source.sort_order,
			is_active = source.is_active,
			updated_at = now()
	when not matched then
		insert (user_id, interface_id, sort_order, is_active)
		values (source.user_id, source.interface_id, source.sort_order, source.is_active);
end;
$$;