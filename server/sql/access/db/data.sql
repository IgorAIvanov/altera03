-- Початкові дані підсистеми доступу.
--
-- Дві групи «з коробки»: повний доступ і лише перегляд. Обидві описані через
-- model='*', тому не залежать від складу моделей конкретного застосунку.
-- Застосунок може їх перейменувати, доповнити або видалити — це лише старт.

insert into app.user_group (code, name, is_active) values
  ('admin',  'Повний доступ', true),
  ('viewer', 'Тільки перегляд', true)
on conflict (code) do update
  set name = excluded.name, updated_at = now();

-- Повний доступ: усі дії над усіма моделями.
insert into app.user_group_permission (user_group_id, model, action, is_allowed)
select g.id, '*', a.action, true
from app.user_group g
cross join (values ('view'), ('create'), ('edit'), ('delete'), ('post'), ('unpost')) as a(action)
where g.code = 'admin'
on conflict (user_group_id, model, action) do update
  set is_allowed = true, updated_at = now();

-- Тільки перегляд.
insert into app.user_group_permission (user_group_id, model, action, is_allowed)
select g.id, '*', 'view', true
from app.user_group g
where g.code = 'viewer'
on conflict (user_group_id, model, action) do update
  set is_allowed = true, updated_at = now();

-- Якщо в системі є рівно один користувач і він поза групами — це той, кого
-- створив bootstrap. Без цього першого входу після переїзду на права не буде.
insert into app.user_group_member (user_group_id, user_id, is_active)
select g.id, u.id, true
from app.user_group g
cross join (select id from app.users order by id limit 1) u
where g.code = 'admin'
  and (select count(*) from app.users) = 1
  and not exists (select 1 from app.user_group_member m where m.user_id = u.id)
on conflict (user_group_id, user_id) do nothing;
