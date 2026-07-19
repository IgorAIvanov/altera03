-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.
-- Джерело: invoice.schema.ts + manifest.json. Override — db/invoice.custom.sql


drop function if exists app.invoice_list(bigint, jsonb);
create function app.invoice_list(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 20), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', 'number');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('number', 'invoiceDate', 'counterparty') then
    v_sort_by := 'number';
  end if;

  select count(*)::int into v_total
  from app.invoice t
  left join app.counterparty r_counterparty on r_counterparty.id = t.counterparty_id
  where (
    coalesce(payload->>'search', '') = ''
    or t.number ilike '%' || (payload->>'search') || '%'
    or r_counterparty.name ilike '%' || (payload->>'search') || '%'
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id::text,
      'number', t.number,
      'invoiceDate', t.invoice_date,
      'counterpartyId', t.counterparty_id::text,
      'counterparty', case when r_counterparty.id is null then null else jsonb_build_object('id', r_counterparty.id::text, 'name', r_counterparty.name) end
    ) as r
    from app.invoice t
    left join app.counterparty r_counterparty on r_counterparty.id = t.counterparty_id
    where (
      coalesce(payload->>'search', '') = ''
      or t.number ilike '%' || (payload->>'search') || '%'
      or r_counterparty.name ilike '%' || (payload->>'search') || '%'
    )
    order by
      case when v_sort_by = 'number' and v_sort_dir = 'asc'  then t.number end asc,
      case when v_sort_by = 'number' and v_sort_dir = 'desc' then t.number end desc,
      case when v_sort_by = 'invoiceDate' and v_sort_dir = 'asc'  then t.invoice_date end asc,
      case when v_sort_by = 'invoiceDate' and v_sort_dir = 'desc' then t.invoice_date end desc,
      case when v_sort_by = 'counterparty' and v_sort_dir = 'asc'  then r_counterparty.name end asc,
      case when v_sort_by = 'counterparty' and v_sort_dir = 'desc' then r_counterparty.name end desc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  ) sub;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'rows',   v_rows,
        'item',   null,
        'options', '{}'::jsonb,
        'totals', jsonb_build_object('count', v_total, 'page', v_page, 'pageSize', v_page_size),
        'extra',  '{}'::jsonb
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

drop function if exists app.invoice_get(bigint, jsonb);
create function app.invoice_get(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item', (
          select jsonb_build_object(
        'id', t.id::text,
        'number', t.number,
        'invoiceDate', t.invoice_date,
        'counterpartyId', t.counterparty_id::text,
        'counterparty', case when r_counterparty.id is null then null else jsonb_build_object('id', r_counterparty.id::text, 'name', r_counterparty.name) end,
        'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id::text,
          'lineNo', l.line_no,
          'bankId', l.bank_id::text,
          'bank', case when r_bank.id is null then null else jsonb_build_object('id', r_bank.id::text, 'name', r_bank.name) end,
          'qty', l.qty,
          'price', l.price
        ) order by l.line_no)
        from app.invoice_line l
        left join app.bank r_bank on r_bank.id = l.bank_id
        where l.invoice_id = t.id
      ), '[]'::jsonb)
      )
          from app.invoice t
          left join app.counterparty r_counterparty on r_counterparty.id = t.counterparty_id
          where t.id = (payload->>'id')::bigint
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

drop function if exists app.invoice_save(bigint, jsonb);
create function app.invoice_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item   jsonb := payload->'item';
  v_id     bigint;
  v_result jsonb;
begin
  if nullif(trim(coalesce(v_item->>'number', '')), '') is null then
    raise exception 'number обов''язковий';
  end if;

  merge into app.invoice t
  using (
    select
      nullif(v_item->>'id', '')::bigint as id,
      nullif(trim(coalesce(v_item->>'number', '')), '') as number,
      nullif(v_item->>'invoiceDate', '')::date as invoice_date,
      nullif(v_item->>'counterpartyId', '')::bigint as counterparty_id
  ) s
    on t.id = s.id
  when matched then update set
    number = s.number,
    invoice_date = s.invoice_date,
    counterparty_id = s.counterparty_id,
    updated_at = now()
  when not matched then insert (number, invoice_date, counterparty_id)
    values (s.number, s.invoice_date, s.counterparty_id)
  returning t.id into v_id;

  merge into app.invoice_line lt
  using (
    select
      nullif(e->>'id', '')::bigint as id,
      v_id as invoice_id,
      nullif(e->>'lineNo', '')::int as line_no,
      nullif(e->>'bankId', '')::bigint as bank_id,
      nullif(e->>'qty', '')::numeric as qty,
      nullif(e->>'price', '')::numeric as price
    from jsonb_array_elements(coalesce(v_item->'lines', '[]'::jsonb)) e
  ) s
    on lt.id = s.id
  when matched then update set
    line_no = s.line_no,
    bank_id = s.bank_id,
    qty = s.qty,
    price = s.price
  when not matched then insert (invoice_id, line_no, bank_id, qty, price)
    values (v_id, s.line_no, s.bank_id, s.qty, s.price)
  when not matched by source and lt.invoice_id = v_id then delete;

  select jsonb_build_object(
        'id', t.id::text,
        'number', t.number,
        'invoiceDate', t.invoice_date,
        'counterpartyId', t.counterparty_id::text,
        'counterparty', case when r_counterparty.id is null then null else jsonb_build_object('id', r_counterparty.id::text, 'name', r_counterparty.name) end,
        'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id::text,
          'lineNo', l.line_no,
          'bankId', l.bank_id::text,
          'bank', case when r_bank.id is null then null else jsonb_build_object('id', r_bank.id::text, 'name', r_bank.name) end,
          'qty', l.qty,
          'price', l.price
        ) order by l.line_no)
        from app.invoice_line l
        left join app.bank r_bank on r_bank.id = l.bank_id
        where l.invoice_id = v_id
      ), '[]'::jsonb)
      ) into v_result
  from app.invoice t
  left join app.counterparty r_counterparty on r_counterparty.id = t.counterparty_id
  where t.id = v_id;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item',    v_result,
        'rows',    '[]'::jsonb,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   '{}'::jsonb
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

drop function if exists app.invoice_delete(bigint, jsonb);
create function app.invoice_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint;
begin
  v_id := nullif(payload->>'id', '')::bigint;
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  delete from app.invoice where id = v_id;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item',    null,
        'rows',    '[]'::jsonb,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   jsonb_build_object('deletedId', v_id::text)
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

drop function if exists app.invoice_lookup(bigint, jsonb);
create function app.invoice_lookup(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 10), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', 'number');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('number') then
    v_sort_by := 'number';
  end if;

  select count(*)::int into v_total
  from app.invoice t
  where (
    coalesce(payload->>'search', '') = ''
    or t.number ilike '%' || (payload->>'search') || '%'
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id::text,
      'number', t.number
    ) as r
    from app.invoice t
    where (
      coalesce(payload->>'search', '') = ''
      or t.number ilike '%' || (payload->>'search') || '%'
    )
    order by
      case when v_sort_by = 'number' and v_sort_dir = 'asc'  then t.number end asc,
      case when v_sort_by = 'number' and v_sort_dir = 'desc' then t.number end desc
    limit v_page_size
    offset (v_page - 1) * v_page_size
  ) sub;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'rows',    v_rows,
        'item',    null,
        'options', '{}'::jsonb,
        'totals',  jsonb_build_object('count', v_total, 'page', v_page, 'pageSize', v_page_size),
        'extra',   '{}'::jsonb
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

