-- Кілька рядків, щоб список не був порожнім при першому відкритті.
-- `on conflict do nothing`: сід не втручається в те, що вже завели руками.

insert into app.counterparty (code, name, edrpou, is_active) values
  ('00001', 'ТОВ «Перший контрагент»', '12345678', true),
  ('00002', 'ФОП Іваненко І. І.',      null,       true),
  ('00003', 'ПАТ «Старий партнер»',    '87654321', false)
on conflict (code) do nothing;
