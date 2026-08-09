-- ⚠ ЗГЕНЕРОВАНО deno task sql:gen — НЕ РЕДАГУВАТИ.
-- Джерело: manual_entry.schema.ts + manifest.json. Override — db/manual_entry.custom.sql


drop function if exists app.manual_entry_list(bigint, jsonb);
create function app.manual_entry_list(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 20), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', 'number');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
  v_filters   jsonb := coalesce(payload->'filters', '{}'::jsonb);
  v_f_date_from date := nullif(v_filters->>'dateFrom', '')::date;
  v_f_date_to date := nullif(v_filters->>'dateTo', '')::date;
  v_f_is_posted boolean := (v_filters->>'isPosted')::boolean;
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('number', 'docDate') then
    v_sort_by := 'number';
  end if;

  select count(*)::int into v_total
  from app.document h
    join app.manual_entry t on t.document_id = h.id
  left join app.organization r_organization on r_organization.id = h.organization_id
  where (
    coalesce(payload->>'search', '') = ''
    or r_organization.name ilike '%' || (payload->>'search') || '%'
    or h.number ilike '%' || (payload->>'search') || '%'
    or h.presentation ilike '%' || (payload->>'search') || '%'
  )
  and (v_f_date_from is null or h.doc_date >= v_f_date_from)
  and (v_f_date_to is null or h.doc_date < v_f_date_to + interval '1 day')
  and (v_f_is_posted is null or h.is_posted = v_f_is_posted);

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', h.id::text,
      'number', h.number,
      'docDate', h.doc_date,
      'total', h.total,
      'description', h.description,
      'isPosted', h.is_posted,
      'isDeleted', h.is_deleted
    ) as r
    from app.document h
    join app.manual_entry t on t.document_id = h.id
    left join app.organization r_organization on r_organization.id = h.organization_id
    where (
      coalesce(payload->>'search', '') = ''
      or r_organization.name ilike '%' || (payload->>'search') || '%'
      or h.number ilike '%' || (payload->>'search') || '%'
      or h.presentation ilike '%' || (payload->>'search') || '%'
    )
    and (v_f_date_from is null or h.doc_date >= v_f_date_from)
    and (v_f_date_to is null or h.doc_date < v_f_date_to + interval '1 day')
    and (v_f_is_posted is null or h.is_posted = v_f_is_posted)
    order by
      case when v_sort_by = 'number' and v_sort_dir = 'asc'  then h.number end asc,
      case when v_sort_by = 'number' and v_sort_dir = 'desc' then h.number end desc,
      case when v_sort_by = 'docDate' and v_sort_dir = 'asc'  then h.doc_date end asc,
      case when v_sort_by = 'docDate' and v_sort_dir = 'desc' then h.doc_date end desc
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
        '$filters', v_filters,
        'extra',  '{}'::jsonb
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

drop function if exists app.manual_entry_get(bigint, jsonb);
create function app.manual_entry_get(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item', (
          select jsonb_build_object(
        'id', h.id::text,
        'organizationId', h.organization_id::text,
        'organization', case when r_organization.id is null then null else jsonb_build_object('id', r_organization.id::text, 'name', r_organization.name) end,
        'number', h.number,
        'docDate', h.doc_date,
        'total', h.total,
        'presentation', h.presentation,
        'description', h.description,
        'isPosted', h.is_posted,
        'isDeleted', h.is_deleted,
        'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id::text,
          'lineNo', l.line_no,
          'debitAccount', l.debit_account,
          'debitAnalytics', l.debit_analytics,
          'creditAccount', l.credit_account,
          'creditAnalytics', l.credit_analytics,
          'amount', l.amount,
          'currencyId', l.currency_id::text,
          'currencyAmount', l.currency_amount,
          'quantity', l.quantity,
          'description', l.description
        ) order by l.line_no)
        from app.manual_entry_line l
        where l.document_id = h.id
      ), '[]'::jsonb)
      )
          from app.document h
    join app.manual_entry t on t.document_id = h.id
          left join app.organization r_organization on r_organization.id = h.organization_id
          where h.id = (payload->>'id')::bigint
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

drop function if exists app.manual_entry_save(bigint, jsonb);
create function app.manual_entry_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item    jsonb  := payload->'item';
  v_id      bigint := nullif(v_item->>'id', '')::bigint;
  v_org     bigint := nullif(v_item->>'organizationId', '')::bigint;
  v_number  varchar(20);
  v_type_id bigint;
  v_result  jsonb;
begin
  if v_org is null then
    raise exception 'organizationId обов''язковий' using column = 'organization_id';
  end if;

  select id into v_type_id from app.document_type where code = 'manual_entry';
  if v_type_id is null then
    raise exception 'Тип документа «manual_entry» не зареєстровано в app.document_type';
  end if;

  -- Номер підставляємо лише новому документу. Для збереженого відсутній у
  -- payload номер означає «не чіпати», а не «перенумерувати».
  v_number := nullif(trim(coalesce(v_item->>'number', '')), '');
  if v_number is null then
    if v_id is null then
      v_number := app.doc_next_number('manual_entry', v_org);
    else
      select h.number into v_number from app.document h where h.id = v_id;
    end if;
  end if;

  merge into app.document h
  using (
    select
      v_id as id,
      v_number as number,
      nullif(v_item->>'organizationId', '')::bigint as organization_id,
      nullif(v_item->>'docDate', '')::timestamp as doc_date,
      nullif(v_item->>'total', '')::numeric as total,
      nullif(trim(coalesce(v_item->>'presentation', '')), '') as presentation,
      nullif(trim(coalesce(v_item->>'description', '')), '') as description
  ) s
    on h.id = s.id
  when matched then update set
    number = s.number,
    organization_id = s.organization_id,
    doc_date = s.doc_date,
    total = coalesce(s.total, h.total),
    presentation = coalesce(s.presentation, h.presentation),
    description = s.description,
    updated_at = now(),
    updated_by = user_id
  when not matched then insert (document_type_id, number, organization_id, doc_date, total, presentation, description, created_by, updated_by)
    values (v_type_id, s.number, s.organization_id, s.doc_date, coalesce(s.total, 0), coalesce(s.presentation, ''), s.description, user_id, user_id)
  returning h.id into v_id;

  insert into app.manual_entry (document_id) values (v_id)
  on conflict (document_id) do nothing;

  merge into app.manual_entry_line lt
  using (
    select
      nullif(e->>'id', '')::bigint as id,
      v_id as document_id,
      nullif(e->>'lineNo', '')::int as line_no,
      nullif(trim(coalesce(e->>'debitAccount', '')), '') as debit_account,
      e->'debitAnalytics' as debit_analytics,
      nullif(trim(coalesce(e->>'creditAccount', '')), '') as credit_account,
      e->'creditAnalytics' as credit_analytics,
      nullif(e->>'amount', '')::numeric as amount,
      nullif(e->>'currencyId', '')::bigint as currency_id,
      nullif(e->>'currencyAmount', '')::numeric as currency_amount,
      nullif(e->>'quantity', '')::numeric as quantity,
      nullif(trim(coalesce(e->>'description', '')), '') as description
    from jsonb_array_elements(coalesce(v_item->'entries', '[]'::jsonb)) e
  ) s
    on lt.id = s.id
  when matched then update set
    line_no = s.line_no,
    debit_account = s.debit_account,
    debit_analytics = coalesce(s.debit_analytics, lt.debit_analytics),
    credit_account = s.credit_account,
    credit_analytics = coalesce(s.credit_analytics, lt.credit_analytics),
    amount = s.amount,
    currency_id = s.currency_id,
    currency_amount = s.currency_amount,
    quantity = s.quantity,
    description = s.description
  when not matched then insert (document_id, line_no, debit_account, debit_analytics, credit_account, credit_analytics, amount, currency_id, currency_amount, quantity, description)
    values (v_id, s.line_no, s.debit_account, coalesce(s.debit_analytics, '{}'::jsonb), s.credit_account, coalesce(s.credit_analytics, '{}'::jsonb), s.amount, s.currency_id, s.currency_amount, s.quantity, s.description)
  when not matched by source and lt.document_id = v_id then delete;

  -- Денормалізація шапки (total, presentation) — необов'язковий хук документа
  -- у db/manual_entry.custom.sql. Рахувати підсумок у генераторі не можна:
  -- у кожного документа він свій.
  if to_regprocedure('app.manual_entry_denormalize(bigint, bigint)') is not null then
    perform app.manual_entry_denormalize(user_id, v_id);
  end if;

  select jsonb_build_object(
        'id', h.id::text,
        'organizationId', h.organization_id::text,
        'organization', case when r_organization.id is null then null else jsonb_build_object('id', r_organization.id::text, 'name', r_organization.name) end,
        'number', h.number,
        'docDate', h.doc_date,
        'total', h.total,
        'presentation', h.presentation,
        'description', h.description,
        'isPosted', h.is_posted,
        'isDeleted', h.is_deleted,
        'entries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id::text,
          'lineNo', l.line_no,
          'debitAccount', l.debit_account,
          'debitAnalytics', l.debit_analytics,
          'creditAccount', l.credit_account,
          'creditAnalytics', l.credit_analytics,
          'amount', l.amount,
          'currencyId', l.currency_id::text,
          'currencyAmount', l.currency_amount,
          'quantity', l.quantity,
          'description', l.description
        ) order by l.line_no)
        from app.manual_entry_line l
        where l.document_id = v_id
      ), '[]'::jsonb)
      ) into v_result
  from app.document h
    join app.manual_entry t on t.document_id = h.id
  left join app.organization r_organization on r_organization.id = h.organization_id
  where h.id = v_id;

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

drop function if exists app.manual_entry_delete(bigint, jsonb);
create function app.manual_entry_delete(user_id bigint, payload jsonb)
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

  update app.document set is_deleted = true where id = v_id;

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

drop function if exists app.manual_entry_undelete(bigint, jsonb);
create function app.manual_entry_undelete(user_id bigint, payload jsonb)
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

  update app.document set is_deleted = false where id = v_id;

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item',    null,
        'rows',    '[]'::jsonb,
        'options', '{}'::jsonb,
        'totals',  '{}'::jsonb,
        'extra',   jsonb_build_object('undeletedId', v_id::text)
      ),
      'messages', '[]'::jsonb,
      'meta', '{}'::jsonb
    );
end;
$$;

drop function if exists app.manual_entry_lookup(bigint, jsonb);
create function app.manual_entry_lookup(user_id bigint, payload jsonb)
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
  if v_sort_by not in ('number', 'docDate') then
    v_sort_by := 'number';
  end if;

  select count(*)::int into v_total
  from app.document h
    join app.manual_entry t on t.document_id = h.id
  where not h.is_deleted
    and (
    coalesce(payload->>'search', '') = ''
    or h.number ilike '%' || (payload->>'search') || '%'
    or h.presentation ilike '%' || (payload->>'search') || '%'
  );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', h.id::text,
      'number', h.number,
      'docDate', h.doc_date
    ) as r
    from app.document h
    join app.manual_entry t on t.document_id = h.id
    where not h.is_deleted
      and (
      coalesce(payload->>'search', '') = ''
      or h.number ilike '%' || (payload->>'search') || '%'
      or h.presentation ilike '%' || (payload->>'search') || '%'
    )
    order by
      case when v_sort_by = 'number' and v_sort_dir = 'asc'  then h.number end asc,
      case when v_sort_by = 'number' and v_sort_dir = 'desc' then h.number end desc,
      case when v_sort_by = 'docDate' and v_sort_dir = 'asc'  then h.doc_date end asc,
      case when v_sort_by = 'docDate' and v_sort_dir = 'desc' then h.doc_date end desc
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

drop function if exists app.manual_entry_post(bigint, jsonb);
create function app.manual_entry_post(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  perform app.doc_post_begin(user_id, v_id);
  perform app.manual_entry_post_entries(user_id, v_id);
  perform app.doc_post_finish(user_id, v_id);

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item',    (select app.manual_entry_get(user_id, jsonb_build_object('id', v_id::text)) -> 'data' -> 'item'),
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

drop function if exists app.manual_entry_unpost(bigint, jsonb);
create function app.manual_entry_unpost(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  if v_id is null then
    raise exception 'id обов''язковий';
  end if;

  perform app.doc_unpost(user_id, v_id);

  return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item',    (select app.manual_entry_get(user_id, jsonb_build_object('id', v_id::text)) -> 'data' -> 'item'),
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

