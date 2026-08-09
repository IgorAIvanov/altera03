-- Назви пунктів меню → маркери перекладу `@[ключ]`.
--
-- Сід (`data.sql`) іде `on conflict do nothing`, тобто на вже налаштованій базі
-- не міняє нічого: пункти там створені попередньою версією й несуть готовий
-- український текст. Тому переклад меню на існуючій установці робить саме ця
-- міграція, а не сід.
--
-- Оновлюється рядок ЛИШЕ тоді, коли назва досі дослівно та, яку поклав сід
-- (або проміжна — голий ключ без маркера, з версії, де маркера ще не було).
-- Адміністратор, який пункт перейменував, свою назву зберігає — і вона й далі
-- працює: без маркера клієнт текст не чіпає взагалі.
--
-- Ідемпотентність звідси ж і береться, і вона обов'язкова: журналу
-- застосованого немає, `migration.sql` виконується при КОЖНІЙ публікації. Після
-- першого проходу `name` дорівнює маркеру й із жодним із двох джерел не
-- збігається.
update app.menu_item mi
set name = '@[' || v.key || ']'
from (values
  ('catalog',           'Довідники',                 'menu.group.catalog'),
  ('document',          'Документи',                 'menu.group.document'),
  ('report',            'Звіти',                     'menu.group.report'),
  ('administration',    'Адміністрування',           'menu.group.administration'),
  ('organization',      'Організації',               'organization.titleMany'),
  ('chart_of_account',  'План рахунків',             'chartOfAccount.titleMany'),
  ('currency',          'Валюти',                    'currency.titleMany'),
  ('bank',              'Банки',                     'bank.titleMany'),
  ('counterparty',      'Контрагенти',               'counterparty.titleMany'),
  ('nomenclature',      'Номенклатура',              'nomenclature.titleMany'),
  ('manual_entry',      'Операції (бухгалтерські)',  'manualEntry.titleMany'),
  ('invoice',           'Рахунки',                   'invoice.titleMany'),
  ('turnover_balance',  'Оборотно-сальдова',         'turnoverBalance.title'),
  ('account_card',      'Картка рахунку',            'accountCard.title'),
  ('document_movements','Рухи документа',            'documentMovements.title'),
  ('print_template',    'Шаблони друку',             'printTemplate.titleMany'),
  ('numerator',         'Нумератори',                'numerator.titleMany'),
  ('menu',              'Меню',                      'menu.titleMany'),
  ('user',              'Користувачі',               'user.titleMany'),
  ('user_group',        'Групи користувачів',        'userGroup.titleMany'),
  ('audit_log',         'Журнал аудиту',             'auditLog.titleMany')
) as v(code, seeded_name, key)
where mi.code = v.code
  and mi.name in (v.seeded_name, v.key);
