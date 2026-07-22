-- Базовий набір валют. UAH — валюта обліку: у ній ведеться app.journal_entry.amount.

insert into app.currency (code, name, numeric_code, symbol)
values
  ('UAH', 'Гривня',       '980', '₴'),
  ('USD', 'Долар США',    '840', '$'),
  ('EUR', 'Євро',         '978', '€')
on conflict (code) do update
set name = excluded.name,
    numeric_code = excluded.numeric_code,
    symbol = excluded.symbol;
