-- Демонстраційний сід: пара коренів, підгрупа і по позиції в кожній — щоб
-- дерево і фільтр було видно одразу. Групи впізнаються за (ім'я, батько),
-- позиції — за кодом; повторна публікація нічого не дублює й не відкочує.

insert into app.nomenclature_group (name)
select v.name
from (values ('Товари'), ('Послуги')) v(name)
where not exists (
  select 1 from app.nomenclature_group g
  where g.name = v.name and g.parent_id is null
);

insert into app.nomenclature_group (parent_id, name)
select g.id, 'Матеріали'
from app.nomenclature_group g
where g.name = 'Товари' and g.parent_id is null
  and not exists (
    select 1 from app.nomenclature_group c
    where c.name = 'Матеріали' and c.parent_id = g.id
  );

insert into app.nomenclature (code, name, unit, group_id)
select v.code, v.name, v.unit,
       (select g.id from app.nomenclature_group g where g.name = v.grp and g.parent_id is null)
from (values
  ('ТОВ-0001', 'Папір офісний A4',       'пач', 'Товари'),
  ('ПОС-0001', 'Консультаційні послуги', 'год', 'Послуги')
) v(code, name, unit, grp)
on conflict (code) do nothing;

insert into app.nomenclature (code, name, unit, group_id)
select 'ТОВ-0002', 'Тонер для принтера', 'шт', c.id
from app.nomenclature_group c
join app.nomenclature_group p on p.id = c.parent_id and p.name = 'Товари'
where c.name = 'Матеріали'
on conflict (code) do nothing;
