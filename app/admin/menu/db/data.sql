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
--
-- У `name` лежить МАРКЕР перекладу `@[ключ]`, а не готовий текст: інакше меню
-- лишалося б мовою сіду, скільки б мов застосунок не знав. Це те саме
-- домовлення, що для повідомлень сервера, — сервер тексту не перекладає, він
-- його називає. Маркер, а не голий ключ: так намір оголошений, і назва,
-- вписана адміністратором («Наші контрагенти»), не може випадково збігтися з
-- ключем. Ціна одна й видима: у редакторі меню в полі «Назва» стоїть маркер;
-- що з нього вийде, показує підказка поля.
--
-- Ключ листа — це `<model>.titleMany` самої моделі, а не власний ключ меню:
-- пункт «Банки» і заголовок списку банків — те саме слово, і два ключі на
-- нього розійшлися б мовчки. Заразом ключ їде разом із моделлю: прибрали
-- модель — прибрався й переклад. Свої ключі (`menu.group.*`) мають лише корені,
-- бо за ними моделі немає.

insert into app.menu (code, name, is_active)
values ('default', 'Основне меню', true)
on conflict (code) do nothing;

-- ── Корені ─────────────────────────────────────────────────────────────────
insert into app.menu_item (menu_id, parent_id, code, name, icon_key, route_path, sort_order)
select m.id, null, v.code, v.name, v.icon_key, v.route_path, v.sort_order
from app.menu m
cross join (values
  ('catalog',        '@[menu.group.catalog]',        'catalog',  null::varchar(500), 10),
  ('document',       '@[menu.group.document]',       'document', null,               20),
  ('report',         '@[menu.group.report]',         'report',   null,               30),
  ('administration', '@[menu.group.administration]', 'settings', null,               40)
) as v(code, name, icon_key, route_path, sort_order)
where m.code = 'default'
on conflict do nothing;

-- ── Листя ──────────────────────────────────────────────────────────────────
insert into app.menu_item (menu_id, parent_id, code, name, icon_key, route_path, sort_order)
select p.menu_id, p.id, v.code, v.name, v.icon_key, v.route_path, v.sort_order
from (values
  ('catalog',        'organization',       '@[organization.titleMany]',         'organization', 'catalog/organization/list',       10),
  ('catalog',        'chart_of_account',   '@[chartOfAccount.titleMany]',       'account',      'catalog/chart_of_account/list',   20),
  ('catalog',        'currency',           '@[currency.titleMany]',             'catalog',      'catalog/currency/list',           30),
  ('catalog',        'bank',               '@[bank.titleMany]',                 'bank',         'catalog/bank/list',               40),
  ('catalog',        'counterparty',       '@[counterparty.titleMany]',         'counterparty', 'catalog/counterparty/list',       50),
  ('catalog',        'nomenclature',       '@[nomenclature.titleMany]',         'catalog',      'catalog/nomenclature/list',       60),
  ('document',       'manual_entry',       '@[manualEntry.titleMany]',          'document',     'operation/manual_entry/list',     10),
  ('document',       'invoice',            '@[invoice.titleMany]',              'invoice',      'document/invoice/list',           20),
  ('report',         'turnover_balance',   '@[turnoverBalance.title]',          'balance',      'report/turnover_balance/list',    10),
  ('report',         'account_card',       '@[accountCard.title]',              'report',       'report/account_card/list',        20),
  ('report',         'document_movements', '@[documentMovements.title]',        'report',       'report/document_movements/list',  30),
  ('administration', 'print_template',     '@[printTemplate.titleMany]',        'print',        'admin/print_template/list',       10),
  ('administration', 'numerator',          '@[numerator.titleMany]',            'settings',     'admin/numerator/list',            15),
  ('administration', 'menu',               '@[menu.titleMany]',                 'settings',     'admin/menu/list',                 20),
  ('administration', 'user',               '@[user.titleMany]',                 'counterparty', 'admin/user/list',                 30),
  ('administration', 'user_group',         '@[userGroup.titleMany]',            'counterparty', 'admin/user_group/list',           40),
  ('administration', 'audit_log',          '@[auditLog.titleMany]',             'settings',     'admin/audit_log/list',            50)
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
