-- Read-only admin list for the metadata-only audit log.
drop function if exists app.audit_log_list(bigint, jsonb);
create function app.audit_log_list(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      nullif(trim(coalesce(payload->>'search', '')), '')                  as search,
      greatest(coalesce((payload->>'page')::int, 1), 1)                    as page,
      least(greatest(coalesce((payload->>'pageSize')::int, 20), 1), 200)   as page_size,
      case when payload->>'sortBy' in ('occurredAt', 'user', 'model', 'command', 'recordId', 'isSuccess')
        then payload->>'sortBy' else 'occurredAt' end                      as sort_by,
      case lower(coalesce(payload->>'sortDir', 'desc')) when 'asc' then 'asc' else 'desc' end as sort_dir,
      -- Панель фільтрів екрана. Ключі — ті самі, що в `renderFilters()`
      -- (`auditLogList.ts`); розбіжність тиха, бо jsonb ігнорує зайве.
      nullif(f->>'dateFrom', '')::date                                     as date_from,
      nullif(f->>'dateTo', '')::date                                       as date_to,
      -- Ссылочний фільтр — ОДИН ключ з об'єктом `{id, name}`: id відбирає,
      -- підпис малює пікер у панелі. Тут береться сам лише id.
      nullif(f->'user'->>'id', '')::bigint                                 as f_user_id,
      nullif(f->>'model', '')                                              as f_model,
      nullif(trim(coalesce(f->>'command', '')), '')                        as f_command,
      nullif(trim(coalesce(f->>'recordId', '')), '')                       as f_record_id,
      -- Трійка «будь-який / успіх / помилка» їде рядком, а не boolean:
      -- `setFilters` видаляє `false` як порожнє значення, тож фільтр «лише
      -- помилки» не дійшов би до сервера взагалі.
      case f->>'result' when 'success' then true when 'failure' then false else null end as f_success
    from (select coalesce(payload->'filters', '{}'::jsonb) as f) src
  ),
  -- Назад той самий ключ їде вже з підписом із бази: id прислав клієнт, ім'я
  -- знає лише вона. strip_nulls — щоб зниклий користувач не затирав фільтр
  -- на null (лишиться те, що прислав клієнт).
  filters_out as (
    select (select f from (select coalesce(payload->'filters', '{}'::jsonb) as f) s)
      || jsonb_strip_nulls(jsonb_build_object(
           'user',
           (select jsonb_build_object('id', u.id::text, 'name',
                     coalesce(nullif(trim(u.full_name), ''), u.login))
            from app.users u cross join params p where u.id = p.f_user_id)
         )) as value
  ),
  filtered as (
    select
      l.id::text as id,
      l.occurred_at as "occurredAt",
      coalesce(nullif(trim(u.full_name), ''), u.login) as "user",
      l.model,
      l.command,
      l.record_id::text as "recordId",
      l.is_success as "isSuccess"
    from app.audit_log l
    join app.users u on u.id = l.user_id
    cross join params p
    -- Дужки навколо пошуку обов'язкові: без них перший же `and` нижче
    -- прив'язався б до останнього `or` і фільтри діяли б лише на нього.
    where (
        p.search is null
        or u.login ilike '%' || p.search || '%'
        or u.full_name ilike '%' || p.search || '%'
        or l.model ilike '%' || p.search || '%'
        or l.command ilike '%' || p.search || '%'
        or l.record_id::text ilike '%' || p.search || '%'
      )
      and (p.date_from is null or l.occurred_at >= p.date_from)
      -- Верхня межа періоду включна, а `occurred_at` — момент часу: порівняння
      -- з самою датою відрізало б усе, що сталося того дня після півночі.
      and (p.date_to is null or l.occurred_at < p.date_to + 1)
      and (p.f_user_id is null or l.user_id = p.f_user_id)
      and (p.f_model is null or l.model = p.f_model)
      -- Команда — входженням, а не рівністю: нестандартні імена екран не знає
      -- наперед, і «save» має знаходити і `saveMany`.
      and (p.f_command is null or l.command ilike '%' || p.f_command || '%')
      and (p.f_record_id is null or l.record_id::text = p.f_record_id)
      and (p.f_success is null or l.is_success = p.f_success)
  ),
  paged as (
    select f.* from filtered f cross join params p
    order by
      case when p.sort_by = 'occurredAt' and p.sort_dir = 'asc'  then f."occurredAt" end asc,
      case when p.sort_by = 'occurredAt' and p.sort_dir = 'desc' then f."occurredAt" end desc,
      case when p.sort_by = 'user'       and p.sort_dir = 'asc'  then f."user" end asc,
      case when p.sort_by = 'user'       and p.sort_dir = 'desc' then f."user" end desc,
      case when p.sort_by = 'model'      and p.sort_dir = 'asc'  then f.model end asc,
      case when p.sort_by = 'model'      and p.sort_dir = 'desc' then f.model end desc,
      case when p.sort_by = 'command'    and p.sort_dir = 'asc'  then f.command end asc,
      case when p.sort_by = 'command'    and p.sort_dir = 'desc' then f.command end desc,
      case when p.sort_by = 'recordId'   and p.sort_dir = 'asc'  then f."recordId" end asc,
      case when p.sort_by = 'recordId'   and p.sort_dir = 'desc' then f."recordId" end desc,
      case when p.sort_by = 'isSuccess'  and p.sort_dir = 'asc'  then f."isSuccess" end asc,
      case when p.sort_by = 'isSuccess'  and p.sort_dir = 'desc' then f."isSuccess" end desc,
      f."occurredAt" desc,
      f.id desc
    limit (select page_size from params)
    offset ((select page from params) - 1) * (select page_size from params)
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((select jsonb_agg(row_to_json(paged)) from paged), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', jsonb_build_object(
        'count', (select count(*) from filtered),
        'page', (select page from params),
        'pageSize', (select page_size from params)
      ),
      '$filters', (select value from filters_out)
    ),
    'messages', '[]'::jsonb
  );
$$;
