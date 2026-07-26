-- Склад меню — дані ЦЬОГО застосунку, тому лежить тут, а не в ядрі.
--
-- Поки моделей немає, меню порожнє: пункт має вказувати на реальний маршрут
-- в'ю (`family/model/view`), інакше користувач упреться в мертве посилання.
-- Коли з'явиться перша модель, розкоментуй і заміни маршрут.
--
-- `on conflict do nothing` скрізь: сід створює меню на порожній базі й більше
-- не втручається — публікація SQL не має відкочувати те, що адміністратор
-- переставив чи перейменував.

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

-- insert into app.menu_item (menu_id, parent_id, code, name, route_path, sort_order)
-- select m.id, null, 'catalog', 'Довідники', null, 10 from app.menu m where m.code = 'default'
-- on conflict do nothing;
