-- Нестандартні команди моделі invoice (доповнюють згенеровану п'ятірку).

-- ── Денормалізація шапки ──────────────────────────────────────────────────────
-- Викликається згенерованою app.invoice_save після запису рядків (хук за
-- іменем: app.<model>_denormalize). Заповнює службові поля шапки, які потрібні
-- журналу документів і спискам посилань, але джерелом правди не є.
drop function if exists app.invoice_denormalize(bigint, bigint);
create function app.invoice_denormalize(user_id bigint, document_id bigint)
returns void
language sql
as $$
  update app.document h
  set total = coalesce(lines.total, 0),
      presentation = concat_ws(' ',
        'Накладна №' || coalesce(h.number, '?'),
        'від ' || to_char(h.doc_date, 'DD.MM.YYYY'),
        nullif(c.name, '')
      )
  from app.invoice t
  left join app.counterparty c on c.id = t.counterparty_id
  left join lateral (
    select round(sum(l.qty * l.price), 2) as total
    from app.invoice_line l
    where l.document_id = t.document_id
  ) lines on true
  where t.document_id = h.id
    and h.id = invoice_denormalize.document_id;
$$;

-- ── Проведення ────────────────────────────────────────────────────────────────
-- Проводки документа. Викликається згенерованою app.invoice_post між
-- doc_post_begin і doc_post_finish, тому старі рухи вже знесені, а прапорець
-- проведення ще не виставлений.
--
-- Господарська операція: реалізація покупцю.
--   Дт 361 «Розрахунки з вітчизняними покупцями» (субконто — контрагент)
--   Кт 701 «Дохід від реалізації готової продукції»
-- Сума — підсумок табличної частини, а не поле шапки: шапковий total є
-- денормалізацією для журналу, джерело правди — рядки.
drop function if exists app.invoice_post_entries(bigint, bigint);
create function app.invoice_post_entries(user_id bigint, document_id bigint)
returns void
language plpgsql
as $$
declare
  v_counterparty bigint;
  v_amount       numeric(18,2);
begin
  select t.counterparty_id into v_counterparty
  from app.invoice t
  where t.document_id = invoice_post_entries.document_id;

  select round(coalesce(sum(l.qty * l.price), 0), 2) into v_amount
  from app.invoice_line l
  where l.document_id = invoice_post_entries.document_id;

  if v_amount = 0 then
    raise exception 'Накладна без суми — проведення неможливе';
  end if;

  perform app.doc_entry_add(
    invoice_post_entries.document_id,
    1,
    '361',
    '701',
    v_amount,
    null,
    'Реалізація за накладною',
    jsonb_build_object('counterparty', v_counterparty),
    '{}'::jsonb
  );
end;
$$;

-- ── Дані друкованої форми ─────────────────────────────────────────────────────
-- Це НЕ payload форми редагування: тут уже денормалізовані назви, порахована
-- сума рядка й підсумок, дати й гроші — рядками, готовими до підстановки в
-- шаблон. Шаблон прив'язується саме до цієї структури, тому вона має
-- лишатися стабільною.
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
            'id',               h.id::text,
            'number',           coalesce(h.number, ''),
            'date',             to_char(h.doc_date, 'DD.MM.YYYY'),
            'counterpartyName', coalesce(c.name, ''),
            'total',            to_char(coalesce(sum_lines.total, 0), 'FM9999999990.00'),
            'lines',            coalesce(lines.items, '[]'::jsonb)
          )
        )
        from app.document h
        join app.invoice t on t.document_id = h.id
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
          where l.document_id = h.id
        ) lines on true
        left join lateral (
          select sum(l.qty * l.price) as total
          from app.invoice_line l
          where l.document_id = h.id
        ) sum_lines on true
        where h.id = nullif(payload->>'id', '')::bigint
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
