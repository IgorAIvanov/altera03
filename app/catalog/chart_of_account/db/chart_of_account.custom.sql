-- Override згенерованого lookup: у вибір рахунку не потрапляють групи.
-- Проводка на групу неможлива (app.doc_entry_add кине помилку), тому
-- показувати її в пікері — це запрошення до помилки.
-- Решта — копія згенерованої функції; підключається ПІСЛЯ неї при sql:assemble.

drop function if exists app.chart_of_account_lookup(bigint, jsonb);
create function app.chart_of_account_lookup(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_page      int  := greatest(coalesce((payload->>'page')::int, 1), 1);
  v_page_size int  := greatest(coalesce((payload->>'pageSize')::int, 10), 1);
  v_sort_by   text := coalesce(payload->>'sortBy', 'code');
  v_sort_dir  text := case when lower(coalesce(payload->>'sortDir','asc')) = 'desc' then 'desc' else 'asc' end;
  v_rows      jsonb;
  v_total     int;
begin
  if v_sort_by not in ('code', 'name') then
    v_sort_by := 'code';
  end if;

  select count(*)::int into v_total
  from app.chart_of_account t
  where not t.is_deleted
    and t.is_group = false
    and (
      coalesce(payload->>'search', '') = ''
      or t.code ilike '%' || (payload->>'search') || '%'
      or t.name ilike '%' || (payload->>'search') || '%'
    );

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id',   t.id::text,
      'code', t.code,
      'name', t.name
    ) as r
    from app.chart_of_account t
    where not t.is_deleted
      and t.is_group = false
      and (
        coalesce(payload->>'search', '') = ''
        or t.code ilike '%' || (payload->>'search') || '%'
        or t.name ilike '%' || (payload->>'search') || '%'
      )
    order by
      case when v_sort_by = 'code' and v_sort_dir = 'asc'  then t.code end asc,
      case when v_sort_by = 'code' and v_sort_dir = 'desc' then t.code end desc,
      case when v_sort_by = 'name' and v_sort_dir = 'asc'  then t.name end asc,
      case when v_sort_by = 'name' and v_sort_dir = 'desc' then t.name end desc
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

-- ── Аналітика рахунку ─────────────────────────────────────────────────────────
-- Конфігурація рахунку для рядка проводки: які субконто веде (rows) і чи веде
-- валютний / кількісний облік (extra). Форма ручної операції запитує це після
-- вибору рахунку — набір полів у рядку залежить від рахунку.
--
-- model_key віддаємо як є — маршрут форми клієнт збирає сам із view-manifest.
drop function if exists app.chart_of_account_analytics(bigint, jsonb);
create function app.chart_of_account_analytics(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  with acc as (
    select * from app.chart_of_account
    where code = nullif(trim(coalesce(payload->>'code', '')), '')
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'slotNo',        a.slot_no,
          'dimensionCode', a.dimension_code,
          'dimensionName', d.name,
          'modelKey',      d.model_key,
          'entityKind',    d.entity_kind,
          'isRequired',    a.is_required
        ) order by a.slot_no)
        from app.chart_of_account_analytic a
        join app.analytic_dimension d on d.code = a.dimension_code
        where a.account_code = (select code from acc)
          and d.is_active
      ), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals',  '{}'::jsonb,
      'extra', jsonb_build_object(
        'isCurrency',     coalesce((select is_currency from acc), false),
        'isQuantitative', coalesce((select is_quantitative from acc), false)
      )
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
$$;
