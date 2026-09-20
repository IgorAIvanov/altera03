-- Команди моделі `import_session` — те, що робить ЛЮДИНА: подивитися сесії,
-- закрити канал, дізнатися обсяг сировини, знести її.
--
-- Машинерії каналу (спарювання, приймання частин, підсумок партії) тут поки
-- немає свідомо: вона потребує видачі токена, а токен народжується в TS —
-- випадкові байти не мають ставати параметром запиту, інакше вони лягають у
-- будь-який журнал, що пише параметри. Тому канал іде окремим кроком, а тут —
-- схема й те, що над нею робить людина.

/** Конверт відмови. Текст читає людина на екрані — маркер перекладу. */
drop function if exists app.import_fail(text);
create function app.import_fail(p_text text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'ok', false,
    'data', jsonb_build_object(
      'item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', jsonb_build_array(jsonb_build_object('type', 'error', 'text', p_text))
  );
$$;

/**
 * Сесія так, як її бачить клієнт.
 *
 * Хеша коду спарювання тут немає й бути не може: це облікові дані. Назовні
 * виходить лише те, що код Є і доки він живий, — рівно стільки, скільки треба
 * екрану, щоб сказати «код протермінувався, почніть заново».
 */
drop function if exists app.import_session_item(app.import_session);
create function app.import_session_item(p_row app.import_session)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id',        p_row.id::text,
    'source',    p_row.source,
    'params',    p_row.params,
    'passport',  p_row.passport,
    'state',     p_row.state,
    'hasPairingCode', p_row.pairing_code_hash is not null
      and coalesce(p_row.pairing_expires_at, now()) > now(),
    'pairingExpiresAt', p_row.pairing_expires_at,
    'isPaired',  p_row.paired_at is not null,
    'pairedAt',  p_row.paired_at,
    'createdBy', p_row.created_by::text,
    'createdAt', p_row.created_at,
    'closedAt',  p_row.closed_at,
    -- Скільки партій і в якому вони стані — головне, на що дивляться на екрані
    -- сесії. Три лічильники дешевші за окрему команду й за похід списком.
    'batches', (
      select jsonb_build_object(
        'total',  count(*),
        'open',   count(*) filter (where b.state = 'open'),
        'ready',  count(*) filter (where b.state = 'ready'),
        'broken', count(*) filter (where b.state = 'broken')
      )
      from app.source_batch b where b.session_id = p_row.id
    )
  );
$$;

drop function if exists app.import_session_list(bigint, jsonb);
create function app.import_session_list(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      nullif(payload->'filters'->>'source', '')                          as source,
      nullif(payload->'filters'->>'state', '')                           as state,
      greatest(coalesce((payload->>'page')::int, 1), 1)                  as page,
      least(greatest(coalesce((payload->>'pageSize')::int, 20), 1), 200) as page_size
  ),
  filtered as (
    select s.created_at, s as session_row
    from app.import_session s, params p
    where (p.source is null or s.source = p.source)
      and (p.state is null or s.state = p.state)
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((
        select jsonb_agg(app.import_session_item(f.session_row) order by f.created_at desc)
        from (
          select * from filtered
          order by created_at desc
          limit (select page_size from params)
          offset ((select page from params) - 1) * (select page_size from params)
        ) f
      ), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', jsonb_build_object(
        'count',    (select count(*) from filtered),
        'page',     (select page from params),
        'pageSize', (select page_size from params)
      )
    ),
    'messages', '[]'::jsonb
  );
$$;

drop function if exists app.import_session_get(bigint, jsonb);
create function app.import_session_get(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_row app.import_session;
begin
  select * into v_row from app.import_session
   where id = case when payload->>'id' ~ '^[0-9]+$' then (payload->>'id')::bigint end;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', case when v_row.id is null then null else app.import_session_item(v_row) end,
      'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
end $$;

/**
 * Закрити канал.
 *
 * Закриття — це відкликання доступу, а не позначка стану: разом із сесією
 * помирає токен, яким ходив адаптер, і код спарювання, якщо ним ще не
 * скористалися. Інакше «сесію закрито» означало б лише напис на екрані, а
 * чужий процес ходив би в базу далі.
 *
 * Сировину закриття НЕ чіпає: її зносять окремою командою й тоді, коли
 * перенесення справді закінчилося. Канал і дані мають різні життя — у цьому
 * весь сенс стейджингу.
 */
drop function if exists app.import_session_close(bigint, jsonb);
create function app.import_session_close(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_row app.import_session;
begin
  select * into v_row from app.import_session
   where id = case when payload->>'id' ~ '^[0-9]+$' then (payload->>'id')::bigint end;

  if v_row.id is null then
    return app.import_fail('@[core.importSessionNotFound]');
  end if;

  if v_row.state = 'closed' then
    return app.import_fail('@[core.importSessionClosed]');
  end if;

  update app.access_token
     set revoked_at = now(), updated_at = now()
   where id = v_row.access_token_id and revoked_at is null;

  update app.import_session
     set state = 'closed',
         closed_at = now(),
         pairing_code_hash = null,
         pairing_expires_at = null
   where id = v_row.id
   returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', app.import_session_item(v_row), 'rows', '[]'::jsonb,
      'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
end $$;

/**
 * Скільки сировини лежить.
 *
 * Команда існує тому, що обсяг тут нелюдський: рік документів — це сотні тисяч
 * рядків jsonb, і кнопка «видалити сировину» без числа поруч із нею була б
 * пропозицією зробити щось незворотне наосліп.
 *
 * `id` — сесія; без нього рахується все джерело (`source`), а без обох — уся
 * база. Останнє теж потрібне: «чому база на 40 ГБ» — питання, на яке
 * відповідають саме тут.
 */
drop function if exists app.import_session_volume(bigint, jsonb);
create function app.import_session_volume(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with scope as (
    select
      case when payload->>'id' ~ '^[0-9]+$' then (payload->>'id')::bigint end as session_id,
      nullif(payload->>'source', '') as source
  ),
  batches as (
    select b.id
    from app.source_batch b, scope s
    where (s.session_id is null or b.session_id = s.session_id)
      and (s.source is null or b.source = s.source)
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', jsonb_build_object(
        'batches', (select count(*) from batches),
        'objects', (select count(*) from app.source_object o where o.batch_id in (select id from batches)),
        'rows',    (select count(*) from app.source_row r where r.batch_id in (select id from batches)),
        -- Розмір на диску — те, заради чого питання й ставлять. Рахується по
        -- таблицях цілком, тож це орієнтир для всієї бази, а не для відбору.
        'bytes',   pg_total_relation_size('app.source_object')
                 + pg_total_relation_size('app.source_row')
      ),
      'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
$$;

/**
 * Знести сировину.
 *
 * Зносяться РЯДКИ, а не партії: паспорт партії лишається слідом — коли знімали,
 * чим, якої версії була база джерела. Тобто після прибирання ще можна сказати,
 * звідки взялися дані, хоч самих даних уже немає.
 *
 * Карта ключів і рішення людини не чіпаються взагалі (див. struc.sql): вони
 * переживають сировину, бо відповідають на питання, яке ставлять і через рік.
 *
 * Автоочищення немає й не буде: команду кличе людина, коли вважає задачі
 * перенесення виконаними.
 */
drop function if exists app.import_session_purge(bigint, jsonb);
create function app.import_session_purge(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_session bigint := case when payload->>'id' ~ '^[0-9]+$' then (payload->>'id')::bigint end;
  v_source  varchar(50) := nullif(payload->>'source', '');
  v_objects bigint;
  v_rows    bigint;
begin
  if v_session is null and v_source is null then
    -- Відмова, а не «знести все»: команда незворотна, і промах у payload не
    -- має означати найширшу з можливих дій.
    return app.import_fail('@[core.importPurgeNeedsScope]');
  end if;

  with batches as (
    select b.id from app.source_batch b
     where (v_session is null or b.session_id = v_session)
       and (v_source is null or b.source = v_source)
  ),
  gone_objects as (
    delete from app.source_object o where o.batch_id in (select id from batches) returning 1
  ),
  gone_rows as (
    delete from app.source_row r where r.batch_id in (select id from batches) returning 1
  )
  select (select count(*) from gone_objects), (select count(*) from gone_rows)
    into v_objects, v_rows;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', jsonb_build_object('objects', v_objects, 'rows', v_rows),
      'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
end $$;
