-- Види аналітики (субконто), доступні проводкам.
-- Тут лише ті довідники, що реально є в репозиторії; новий вимір додається
-- рядком нижче одночасно з появою моделі.
--
-- app.document_type НЕ наповнюється тут: типи документів генеруються з
-- manifest.json моделей-документів у _generated/document-types.data.sql.

-- Сіємо лише ті виміри, чия таблиця в цій установці справді є.
--
-- Перелік тут прикладний (це довідники застосунку, а не ядра), і застосунок без
-- банку чи контрагента — цілком законний. Доти зайвий рядок просто лежав мертвим,
-- але відколи опис виміру перевіряє тригер, він валив би публікацію схеми: вимір
-- посилався б на таблицю, якої немає. Тобто перевірка не послаблена — просто не
-- оголошуємо того, чого в установці нема.
insert into app.analytic_dimension (
  code, name, entity_kind, model_key, target_table, id_column, code_column, name_column, is_active
)
select v.*
from (values
  -- Організації тут немає свідомо: вона реквізит шапки документа, а не субконто.
  ('counterparty', 'Контрагент', 'catalog', 'counterparty', 'app.counterparty', 'id', 'code', 'name', true),
  -- Кодом банку є МФО: окремої колонки code в app.bank немає (див. її struc.sql).
  ('bank',         'Банк',       'catalog', 'bank',         'app.bank',         'id', 'mfo',  'name', true)
) as v(code, name, entity_kind, model_key, target_table, id_column, code_column, name_column, is_active)
where to_regclass(v.target_table) is not null
on conflict (code) do update
set
  name      = excluded.name,
  is_active = excluded.is_active;
-- ОПИС ДОВІДНИКА ПРИ ПОВТОРНІЙ ПУБЛІКАЦІЇ НЕ ПЕРЕПИСУЄТЬСЯ.
--
-- `target_table`, `id_column`, `code_column`, `name_column` оновлюються лише
-- первинною вставкою: сід дає УМОВЧАННЯ, а далі опис належить установці — той
-- самий поділ, що в нумераторах і шаблонах друку. Доти рядок переписувався
-- цілком, і застосунок не міг уточнити опис власного довідника: правка жила до
-- наступної публікації, після чого проведення знову падало.
--
-- Ціна зворотна й теж реальна: виправлення опису в цьому файлі на вже
-- налаштовану базу не поїде. Такі виправлення робить migration.sql — і робить
-- адресно, лише коли значення досі те, яке поклав сід.

-- Які субконто веде рахунок. Тільки конкретні рахунки: на групи проводок
-- не буває, тому рядок для групи був би обманом.
-- Решта рахунків отримає аналітику разом із появою відповідних довідників.

-- Так само за фактом: рядок ставиться лише тоді, коли в цій установці є і рахунок,
-- і вимір. Обидва — зовнішні ключі, тож без перевірки установка без банківського
-- довідника (або зі своїм планом рахунків) падала б на публікації схеми.
insert into app.chart_of_account_analytic (account_code, slot_no, dimension_code, is_required)
select v.*
from (values
  ('311', 1, 'bank',         true),
  ('312', 1, 'bank',         true),
  ('313', 1, 'bank',         true),
  ('314', 1, 'bank',         true),
  ('333', 1, 'counterparty', true),
  ('361', 1, 'counterparty', true),
  ('362', 1, 'counterparty', true),
  ('371', 1, 'counterparty', true),
  ('377', 1, 'counterparty', true),
  ('631', 1, 'counterparty', true),
  ('632', 1, 'counterparty', true),
  ('681', 1, 'counterparty', true),
  ('685', 1, 'counterparty', true)
) as v(account_code, slot_no, dimension_code, is_required)
where exists (select 1 from app.chart_of_account a where a.code = v.account_code)
  and exists (select 1 from app.analytic_dimension d where d.code = v.dimension_code)
on conflict (account_code, slot_no) do update
set
  dimension_code = excluded.dimension_code,
  is_required    = excluded.is_required;
