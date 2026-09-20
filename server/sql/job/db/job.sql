-- Команди моделі `job` і службові функції, якими користується рантайм.
--
-- Розділені вони навмисно й розділені не за складністю. `job_get`, `job_list`
-- і `job_cancel` — звичайні команди моделі: їх кличе людина, вони перевіряють
-- право й віддають конверт. `job_enqueue`, `job_claim`, `job_progress`,
-- `job_finish`, `job_heartbeat`, `job_reap` — машинерія одного споживача,
-- рантайму; вони не беруть `user_id` першим аргументом, не віддають конверта й
-- через `/api/model/job/...` недосяжні. Те саме розділення, що в
-- `app.doc_entry_add`: контракт «(user_id, payload) → конверт» описує те, що
-- викликає КОРИСТУВАЧ, і натягувати його на внутрішній виклик означало б
-- пообіцяти, що цю функцію можна кликати ззовні.

/** Конверт відмови. Текст читає людина на екрані, тому маркер перекладу. */
drop function if exists app.job_fail(text);
create function app.job_fail(p_text text)
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
 * Завдання як його бачить клієнт.
 *
 * `result` віддається як є — це конверт відповіді команди, і той, хто чекав
 * результату, дістає рівно те, що дістав би від звичайного виклику.
 */
drop function if exists app.job_item(app.job);
create function app.job_item(p_row app.job)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id',          p_row.id::text,
    'model',       p_row.model,
    'command',     p_row.command,
    'state',       p_row.state,
    'params',      p_row.params,
    'progress',    p_row.progress,
    'result',      p_row.result,
    'error',       p_row.error,
    'startedBy',   p_row.started_by::text,
    'createdAt',   p_row.created_at,
    'startedAt',   p_row.started_at,
    'finishedAt',  p_row.finished_at,
    'cancelRequested', p_row.cancel_requested
  );
$$;

/**
 * Чи видно це завдання цьому користувачеві.
 *
 * Своє — завжди: завдання запускає людина, і не показати їй, чим скінчився її
 * власний запуск, було б безглуздям. Чуже — за правом `job:view`, яке видають
 * адміністраторові: «хто зараз щось довге ганяє на цій базі» — питання
 * експлуатаційне, і відповідь на нього має бути в кого одного.
 */
drop function if exists app.job_may_see(bigint, bigint);
create function app.job_may_see(p_user_id bigint, p_started_by bigint)
returns boolean
language sql
stable
as $$
  select p_started_by = p_user_id or app.access_can(p_user_id, 'job', 'view');
$$;

-- ── Команди моделі ──────────────────────────────────────────────────────────

drop function if exists app.job_get(bigint, jsonb);
create function app.job_get(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_id  bigint;
  v_row app.job;
begin
  -- Команда досяжна не лише з екрана — її кличе агент і `deno task api`, тож
  -- прийти може будь-що. Невірний id дає порожній `item`, а не помилку бази.
  v_id := case when payload->>'id' ~ '^[0-9]+$' then (payload->>'id')::bigint end;

  select * into v_row from app.job where id = v_id;

  if v_row.id is null or not app.job_may_see(user_id, v_row.started_by) then
    -- «Немає» і «не твоє» відповідають однаково: інакше перебором id можна
    -- дізнатися, що саме ганяють інші.
    return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
      ),
      'messages', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', app.job_item(v_row), 'rows', '[]'::jsonb,
      'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
end $$;

drop function if exists app.job_list(bigint, jsonb);
create function app.job_list(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      nullif(payload->'filters'->>'model', '')                          as model,
      nullif(payload->'filters'->>'state', '')                          as state,
      -- Умовчання — лише активні: список потрібен тому, хто чекає на свій
      -- запуск, а не тому, хто читає історію. Історія — окремий відбір.
      coalesce((payload->'filters'->>'activeOnly')::boolean, false)      as active_only,
      greatest(coalesce((payload->>'page')::int, 1), 1)                  as page,
      least(greatest(coalesce((payload->>'pageSize')::int, 20), 1), 200) as page_size
  ),
  filtered as (
    -- Рядок таблиці їде цілим значенням (`j as job_row`), а не розкладеним на
    -- колонки: `app.job_item` приймає `app.job`, і підзапит, що віддає окремі
    -- колонки, дає анонімний `record`, під який функції немає. Помилка була б
    -- рантаймова й тільки на непорожньому списку.
    select j.created_at, j as job_row
    from app.job j, params p
    where app.job_may_see(user_id, j.started_by)
      and (p.model is null or j.model = p.model)
      and (p.state is null or j.state = p.state)
      and (not p.active_only or j.state in ('queued', 'running'))
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((
        select jsonb_agg(app.job_item(f.job_row) order by f.created_at desc)
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

/**
 * Попросити зняти завдання.
 *
 * Саме попросити: рядок лише позначається, а зупиняється виконавець сам — між
 * кроками, там, де зупинка не лишає половини роботи. Тому відповідь тут
 * означає «прохання прийнято», а не «вже зупинено», і екран мусить дочекатися
 * стану `cancelled`.
 */
drop function if exists app.job_cancel(bigint, jsonb);
create function app.job_cancel(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id  bigint;
  v_row app.job;
begin
  v_id := case when payload->>'id' ~ '^[0-9]+$' then (payload->>'id')::bigint end;

  select * into v_row from app.job where id = v_id;

  if v_row.id is null or not app.job_may_see(user_id, v_row.started_by) then
    return app.job_fail('@[core.jobNotFound]');
  end if;

  if v_row.state not in ('queued', 'running') then
    return app.job_fail('@[core.jobNotRunning]');
  end if;

  -- Завдання, якого ще не взяв виконавець, знімається одразу: чекати нема на
  -- кого, а лишити його в черзі означало б, що воно запуститься вже після
  -- того, як людина його скасувала.
  if v_row.state = 'queued' then
    update app.job
       set state = 'cancelled', cancel_requested = true, finished_at = now()
     where id = v_row.id
     returning * into v_row;
  else
    update app.job set cancel_requested = true where id = v_row.id returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', app.job_item(v_row), 'rows', '[]'::jsonb,
      'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
end $$;

-- ── Машинерія рантайму ──────────────────────────────────────────────────────

/**
 * Поставити завдання в чергу.
 *
 * Відмову «вже виконується» тримає унікальний індекс `uq_job_active`, а не
 * перевірка перед вставкою: перевірити й вставити — це гонка, і програє вона
 * рівно там, де найдорожче (два однакові перенесення в одну базу). Тому
 * `on conflict do nothing` і порожній `returning` — це й є відповідь «зайнято».
 */
drop function if exists app.job_enqueue(bigint, text, text, jsonb);
create function app.job_enqueue(
  p_user_id bigint,
  p_model   text,
  p_command text,
  p_params  jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_row app.job;
begin
  insert into app.job (model, command, params, started_by)
  values (p_model, p_command, coalesce(p_params, '{}'::jsonb), p_user_id)
  on conflict do nothing
  returning * into v_row;

  if v_row.id is null then
    return app.job_fail('@[core.jobBusy]' || jsonb_build_object(
      'model', p_model, 'command', p_command
    )::text);
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', app.job_item(v_row), 'rows', '[]'::jsonb,
      'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
end $$;

/**
 * Узятися за завдання. `false` — узявся хтось інший або його вже зняли.
 *
 * Умова `state = 'queued'` в `update` — це і є захоплення: два екземпляри
 * застосунку, що побачили один рядок, розійдуться на рівні бази, а не на
 * домовленості.
 */
drop function if exists app.job_claim(bigint, text);
create function app.job_claim(p_id bigint, p_runner text)
returns boolean
language sql
as $$
  with claimed as (
    update app.job
       set state = 'running', runner_id = p_runner,
           started_at = now(), heartbeat_at = now()
     where id = p_id and state = 'queued'
     returning id
  )
  select exists (select 1 from claimed);
$$;

/**
 * Записати прогрес.
 *
 * Заразом підтверджує, що виконавець живий: хто пише прогрес, той працює, і
 * окремого стуку йому не потрібно.
 */
drop function if exists app.job_progress(bigint, jsonb);
create function app.job_progress(p_id bigint, p_progress jsonb)
returns void
language sql
as $$
  update app.job
     set progress = coalesce(p_progress, '{}'::jsonb), heartbeat_at = now()
   where id = p_id and state = 'running';
$$;

/** Підтвердити, що виконавець живий, — для довгих кроків без прогресу. */
drop function if exists app.job_heartbeat(text);
create function app.job_heartbeat(p_runner text)
returns void
language sql
as $$
  update app.job set heartbeat_at = now()
   where runner_id = p_runner and state = 'running';
$$;

/** Чи просили зняти. Виконавець дивиться сюди між кроками. */
drop function if exists app.job_cancel_requested(bigint);
create function app.job_cancel_requested(p_id bigint)
returns boolean
language sql
stable
as $$
  select coalesce((select cancel_requested from app.job where id = p_id), false);
$$;

/** Завершити завдання: `done`, `failed` або `cancelled`. */
drop function if exists app.job_finish(bigint, text, jsonb, text);
create function app.job_finish(p_id bigint, p_state text, p_result jsonb, p_error text)
returns void
language sql
as $$
  update app.job
     set state = p_state, result = p_result, error = p_error,
         finished_at = now(), heartbeat_at = null
   where id = p_id;
$$;

/**
 * Прибрати покинуті завдання: `running` без живого виконавця → `failed`.
 *
 * Сервер перезапустили посеред роботи — рядок лишився в `running` назавжди, а
 * разом із ним і заборона запустити ту саму команду ще раз. Тобто без цього
 * прибирання одне падіння робило б команду недоступною НАЗАВЖДИ, і вилікувати
 * це можна було б лише руками в базі.
 *
 * Живий виконавець упізнається по `heartbeat_at`, а не по тому, що процес
 * «наш»: на одній машині екземплярів буває кілька, і прибирати чужі завдання
 * при своєму старті — це рівно той самий збій, тільки навпаки.
 */
drop function if exists app.job_reap(interval);
create function app.job_reap(p_stale interval)
returns integer
language sql
as $$
  with reaped as (
    update app.job
       set state = 'failed',
           error = '@[core.jobRunnerLost]',
           finished_at = now(), heartbeat_at = null
     where state = 'running'
       and coalesce(heartbeat_at, started_at, created_at) < now() - p_stale
     returning id
  )
  select count(*)::int from reaped;
$$;
