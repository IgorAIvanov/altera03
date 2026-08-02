-- Початкове меню.
--
-- Скрізь `on conflict do nothing`: сід створює меню на порожній базі й більше
-- ніколи не втручається. Публікація SQL не має відкочувати те, що
-- адміністратор переставив або перейменував.
--
-- Склад перенесено з колишнього app/menu/menu-mock.ts. Два пункти мока сюди
-- не потрапили — `catalog/nomenclature/list` і `admin/settings/main`: таких
-- в'ю немає у view-manifest, тобто це були мертві пункти. Додано
-- `report/document_movements/list`, який існує, але в моці був відсутній.

insert into app.menu (code, name, is_active)
values ('default', 'Основне меню', true)
on conflict (code) do nothing;

-- ── Корені ─────────────────────────────────────────────────────────────────
insert into app.menu_item (menu_id, parent_id, code, name, icon_key, route_path, sort_order)
select m.id, null, v.code, v.name, v.icon_key, v.route_path, v.sort_order
from app.menu m
cross join (values
  ('catalog',        'Довідники',       'catalog',  null::varchar(500), 10),
  ('document',       'Документи',       'document', null,               20),
  ('report',         'Звіти',           'report',   null,               30),
  ('administration', 'Адміністрування', 'settings', null,               40)
) as v(code, name, icon_key, route_path, sort_order)
where m.code = 'default'
on conflict do nothing;

-- ── Листя ──────────────────────────────────────────────────────────────────
insert into app.menu_item (menu_id, parent_id, code, name, icon_key, route_path, sort_order)
select p.menu_id, p.id, v.code, v.name, v.icon_key, v.route_path, v.sort_order
from (values
  ('catalog',        'organization',       'Організації',                    'organization', 'catalog/organization/list',       10),
  ('catalog',        'chart_of_account',   'План рахунків',                  'account',      'catalog/chart_of_account/list',   20),
  ('catalog',        'currency',           'Валюти',                         'catalog',      'catalog/currency/list',           30),
  ('catalog',        'bank',               'Банки',                          'bank',         'catalog/bank/list',               40),
  ('catalog',        'counterparty',       'Контрагенти',                    'counterparty', 'catalog/counterparty/list',       50),
  ('catalog',        'nomenclature',       'Номенклатура',                   'catalog',      'catalog/nomenclature/list',       60),
  ('document',       'manual_entry',       'Операції (бухгалтерські)',       'document',     'operation/manual_entry/list',     10),
  ('document',       'invoice',            'Рахунки',                        'invoice',      'document/invoice/list',           20),
  ('report',         'turnover_balance',   'Оборотно-сальдова',              'balance',      'report/turnover_balance/list',    10),
  ('report',         'account_card',       'Картка рахунку',                 'report',       'report/account_card/list',        20),
  ('report',         'document_movements', 'Рухи документа',                 'report',       'report/document_movements/list',  30),
  ('administration', 'print_template',     'Шаблони друку',                  'print',        'admin/print_template/list',       10),
  ('administration', 'menu',               'Меню',                           'settings',     'admin/menu/list',                 20),
  ('administration', 'user',               'Користувачі',                    'counterparty', 'admin/user/list',                 30),
  ('administration', 'user_group',         'Групи користувачів',             'counterparty', 'admin/user_group/list',           40),
  ('administration', 'audit_log',          'Журнал аудиту',                  'settings',     'admin/audit_log/list',            50)
) as v(parent_code, code, name, icon_key, route_path, sort_order)
join app.menu m      on m.code = 'default'
join app.menu_item p on p.menu_id = m.id and p.parent_id is null and p.code = v.parent_code
on conflict do nothing;

-- ── Призначення групам ─────────────────────────────────────────────────────
-- Обом групам «з коробки» — одне й те саме меню. Розійдуться вони не складом
-- меню, а правами: viewer бачить ті самі пункти, але лише на перегляд.
insert into app.user_group_menu (user_group_id, menu_id, sort_order, is_active)
select g.id, m.id, 0, true
from app.user_group g
join app.menu m on m.code = 'default'
where g.code in ('admin', 'viewer')
on conflict do nothing;
