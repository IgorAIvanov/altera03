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
      case lower(coalesce(payload->>'sortDir', 'desc')) when 'asc' then 'asc' else 'desc' end as sort_dir
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
    where p.search is null
       or u.login ilike '%' || p.search || '%'
       or u.full_name ilike '%' || p.search || '%'
       or l.model ilike '%' || p.search || '%'
       or l.command ilike '%' || p.search || '%'
       or l.record_id::text ilike '%' || p.search || '%'
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
      )
    ),
    'messages', '[]'::jsonb
  );
$$;