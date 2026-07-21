-- Нестандартні команди моделі invoice (доповнюють згенеровану п'ятірку).

-- Дані друкованої форми. Це НЕ payload форми редагування: тут уже
-- денормалізовані назви, порахована сума рядка й підсумок, дати й гроші —
-- рядками, готовими до підстановки в шаблон. Шаблон прив'язується саме до
-- цієї структури, тому вона має лишатися стабільною.
drop function if exists app.invoice_print_data(bigint, jsonb);
create function app.invoice_print_data(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', (
        select jsonb_build_object(
          'document', jsonb_build_object(
            'id',               t.id::text,
            'number',           t.number,
            'date',             to_char(t.invoice_date, 'DD.MM.YYYY'),
            'counterpartyName', coalesce(c.name, ''),
            'total',            to_char(coalesce(sum_lines.total, 0), 'FM9999999990.00'),
            'lines',            coalesce(lines.items, '[]'::jsonb)
          )
        )
        from app.invoice t
        left join app.counterparty c on c.id = t.counterparty_id
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'index',    l.line_no,
            'id',       coalesce(b.code, ''),
            'name',     coalesce(b.name, ''),
            'quantity', to_char(l.qty, 'FM9999999990.000'),
            'price',    to_char(l.price, 'FM9999999990.00'),
            'amount',   to_char(l.qty * l.price, 'FM9999999990.00')
          ) order by l.line_no) as items
          from app.invoice_line l
          left join app.bank b on b.id = l.bank_id
          where l.invoice_id = t.id
        ) lines on true
        left join lateral (
          select sum(l.qty * l.price) as total
          from app.invoice_line l
          where l.invoice_id = t.id
        ) sum_lines on true
        where t.id = nullif(payload->>'id', '')::bigint
      ),
      'rows',    '[]'::jsonb,
      'options', '{}'::jsonb,
      'totals',  '{}'::jsonb,
      'extra',   '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
$$;
