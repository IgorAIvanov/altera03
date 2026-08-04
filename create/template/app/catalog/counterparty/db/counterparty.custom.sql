-- Доробки поверх згенерованого CRUD. Генератор сюди не заглядає, тож усе, що
-- тут написано, переживає `deno task sql:gen`.
--
-- Дані для друку — це ПРОЄКЦІЯ, а не payload форми: назви замість id, дати й
-- числа вже рядками (рендерер не форматує — він друкує що дали), coalesce на
-- кожному текстовому полі. Структуру тримати стабільною: прив'язки шаблонів —
-- крапкові шляхи в неї, а самі шаблони після публікації живуть у базі.

drop function if exists app.counterparty_print_data(bigint, jsonb);
create function app.counterparty_print_data(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', (
        select jsonb_build_object(
          'counterparty', jsonb_build_object(
            'code',      coalesce(c.code, ''),
            'name',      coalesce(c.name, ''),
            'edrpou',    coalesce(c.edrpou, '—'),
            'state',     case when c.is_active then 'Активний' else 'Неактивний' end,
            'printedAt', to_char(now(), 'DD.MM.YYYY HH24:MI')
          )
        )
        from app.counterparty c
        where c.id = nullif(payload->>'id', '')::bigint
      ),
      'rows',    '[]'::jsonb,
      'options', '{}'::jsonb,
      'totals',  '{}'::jsonb,
      'extra',   '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
$$;
