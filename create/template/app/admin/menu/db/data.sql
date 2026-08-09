-- Склад меню — дані ЦЬОГО застосунку, тому лежить тут, а не в ядрі.
--
-- Пункт мусить указувати на реальний маршрут в'ю (`family/model/view`), інакше
-- користувач упреться в мертве посилання. Нижче — пункт демо-довідника; коли
-- видалятимеш демо, прибери і його.
--
-- `on conflict do nothing` скрізь: сід створює меню на порожній базі й більше
-- не втручається — публікація SQL не має відкочувати те, що адміністратор
-- переставив чи перейменував.
--
-- У `name` лежить МАРКЕР перекладу `@[ключ]`, а не готовий текст: інакше меню
-- лишалося б мовою сіду, скільки б мов застосунок не знав. Те саме домовлення,
-- що для повідомлень сервера: сервер тексту не перекладає — він його називає.
-- Назва без маркера показується як є, тож адміністратор вільний вписати свою.
-- Ключ листа — це `<model>.titleMany` самої моделі: пункт меню й заголовок
-- списку — те саме слово, і два ключі на нього розійшлися б мовчки. Свої ключі
-- (`menu.group.*`) мають лише вузли дерева, бо за ними моделі немає.

insert into app.menu (code, name, is_active)
values ('default', 'Основне меню', true)
on conflict (code) do nothing;

-- Меню бачать усі групи, які мають на нього зв'язку.
insert into app.user_group_menu (user_group_id, menu_id, sort_order, is_active)
select g.id, m.id, 0, true
from app.user_group g
cross join app.menu m
where m.code = 'default'
on conflict (user_group_id, menu_id) do nothing;

-- Група «Довідники» — пункт без маршруту, лише вузол дерева.
insert into app.menu_item (menu_id, parent_id, code, name, route_path, sort_order, is_active)
select m.id, null, 'catalog', '@[menu.group.catalog]', null, 10, true
from app.menu m
where m.code = 'default'
on conflict do nothing;

-- ДЕМО: список контрагентів. Маршрут — це `family/model/view` з manifest.json.
insert into app.menu_item (menu_id, parent_id, code, name, route_path, sort_order, is_active)
select m.id, parent.id, 'catalog.counterparty', '@[counterparty.titleMany]', 'catalog/counterparty/list', 10, true
from app.menu m
join app.menu_item parent on parent.menu_id = m.id and parent.code = 'catalog'
where m.code = 'default'
on conflict do nothing;
