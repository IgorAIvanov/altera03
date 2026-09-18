-- ── Журнал МОЇХ токенів ──────────────────────────────────────────────────────
--
-- Що агенти зробили від імені того, хто питає. Відповідає за дії токена його
-- власник, тож і бачити їх мусить він, а не лише адміністратор із правом на
-- `audit_log`. Звідси ж і межа: `user_id` приходить від рантайму (сесія,
-- `/api/auth/tokens/log`), а не з payload, і рядки чужих токенів сюди не
-- потрапляють навіть за відомим id — та сама властивість запиту, що в
-- `access_token_list`, а не перевірка права.
--
-- Тут, а не в `@core/access` поряд з іншими функціями токенів: SQL-функція
-- перевіряє тіло при створенні, а `app.audit_log` з'являється лише в цьому
-- пакеті, який іде ПІСЛЯ access.
--
-- payload: `id` — один токен (порожньо — усі мої), `limit` — скільки
-- останніх рядків (умовчання 100, не більше 500).
drop function if exists app.access_token_log(bigint, jsonb);
create function app.access_token_log(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      nullif(payload->>'id', '')::bigint                                   as token_id,
      least(greatest(coalesce((payload->>'limit')::int, 100), 1), 500)     as row_limit
  ),
  rows_ as (
    select
      l.id::text                                                   as id,
      to_char(l.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS')            as "occurredAt",
      l.access_token_id::text                                      as "tokenId",
      t.name                                                       as token,
      l.model,
      l.command,
      l.record_id::text                                            as "recordId",
      l.is_success                                                 as "isSuccess"
    from app.audit_log l
    join app.access_token t on t.id = l.access_token_id
    cross join params p
    where t.user_id = access_token_log.user_id
      and (p.token_id is null or t.id = p.token_id)
    order by l.occurred_at desc, l.id desc
    limit (select row_limit from params)
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((select jsonb_agg(row_to_json(rows_)) from rows_), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', jsonb_build_object('count', (select count(*) from rows_))
    ),
    'messages', '[]'::jsonb
  );
$$;
