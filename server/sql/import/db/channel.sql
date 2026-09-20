-- Машинерія каналу приймання.
--
-- Це вже не команди моделі: їх кличе не людина, а контролер каналу, від імені
-- чужого процесу з чужої машини. Тому й підпис інший — жодного `user_id` і
-- жодного конверта там, де відповідь читає адаптер, а не форма.
--
-- Спільне для всіх: ПЕРШИМ аргументом іде сесія, і кожна функція звіряє, що
-- партія належить саме їй. Токен каналу називає сесію — усе, на що він дає
-- право, обмежене цим числом, і перевіряється це тут, у базі, а не лише в
-- контролері.

/**
 * Обміняти код спарювання на сесію.
 *
 * Код одноразовий: успішне спарювання ГАСИТЬ його тим самим запитом. Тобто
 * другий адаптер із тим самим кодом уже не ввійде, навіть якщо підгледів його
 * через плече — а підглянути шість знаків з екрана якраз найлегше.
 *
 * Повертає id сесії або null. Причину відмови не розрізняє навмисно: «код не
 * той», «код протермінувався» і «сесію закрито» для того, хто стукає ззовні,
 * мають виглядати однаково.
 */
drop function if exists app.import_pair_claim(text, jsonb);
create function app.import_pair_claim(p_code_hash text, p_passport jsonb)
returns bigint
language sql
as $$
  update app.import_session
     set paired_at = now(),
         passport = coalesce(p_passport, passport),
         pairing_code_hash = null,
         pairing_expires_at = null
   where pairing_code_hash = p_code_hash
     and state = 'open'
     and coalesce(pairing_expires_at, now() - interval '1 second') > now()
  returning id;
$$;

/** Прив'язати виданий токен до сесії — щоб закриттю було що відкликати. */
drop function if exists app.import_session_attach_token(bigint, bigint);
create function app.import_session_attach_token(p_session bigint, p_token bigint)
returns void
language sql
as $$
  update app.import_session set access_token_id = p_token where id = p_session;
$$;

/**
 * Відкрити партію під один пункт плану.
 *
 * Повертає id або null, якщо сесії немає чи її закрито: закритий канал не
 * приймає нічого, і перевіряється це тут, а не покладається на відкликаний
 * токен (відкликання й закриття — дві дії, і між ними є мить).
 */
drop function if exists app.import_batch_open(bigint, text, jsonb, text);
create function app.import_batch_open(
  p_session bigint, p_query text, p_passport jsonb, p_version text
)
returns bigint
language sql
as $$
  insert into app.source_batch (session_id, source, query, passport, solution_version)
  select s.id, s.source, p_query, coalesce(p_passport, s.passport), p_version
    from app.import_session s
   where s.id = p_session and s.state = 'open'
  returning id;
$$;

/**
 * Прийняти частину пакета.
 *
 * ПОВТОР БЕЗПЕЧНИЙ, і заради цього тут окрема таблиця частин. З'єднання з
 * сервером джерела рветься посеред вивантаження — це не збій, а звичайний хід
 * подій на сотні тисяч рядків. Адаптер повторює частину, і:
 *
 *   - той самий номер із тим самим sha256 — не робимо нічого, кажемо `repeat`.
 *     Рядки вже лежать, повторний запис переписав би їх тим самим;
 *   - той самий номер з ІНШИМ sha256 — відмова. Це не повтор, а розбіжність:
 *     або адаптер перерахував пакет, або ми говоримо з іншою базою. Мовчки
 *     прийняти друге означало б зшити половину одного знімка з половиною
 *     іншого, а помітили б це по сальдо, яке не сходиться.
 *
 * Рядки кладуться двома шляхами за ФОРМОЮ елемента, а не за оголошенням
 * партії: є `ref` — об'єкт із власним ключем, є `line` — рядок результату
 * запиту. Елемент без обох — відмова на всю частину: прийняти «те, що
 * розпізналося» означало б втратити решту без жодного сліду.
 */
drop function if exists app.import_part_put(bigint, bigint, integer, text, jsonb);
create function app.import_part_put(
  p_session bigint, p_batch bigint, p_part_no integer, p_sha256 text, p_items jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_batch   app.source_batch;
  v_known   app.source_part;
  v_bad     integer;
  v_objects integer := 0;
  v_rows    integer := 0;
begin
  select * into v_batch from app.source_batch
   where id = p_batch and session_id = p_session;

  if v_batch.id is null then
    return jsonb_build_object('ok', false, 'error', 'batch_not_found');
  end if;
  if v_batch.state <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'batch_closed');
  end if;

  select * into v_known from app.source_part
   where batch_id = p_batch and part_no = p_part_no;

  if v_known.batch_id is not null then
    if v_known.sha256 = p_sha256 then
      return jsonb_build_object('ok', true, 'repeat', true, 'rows', v_known.row_count);
    end if;
    return jsonb_build_object('ok', false, 'error', 'part_mismatch');
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
   where not (item ? 'ref') and not (item ? 'line');

  if v_bad > 0 then
    return jsonb_build_object('ok', false, 'error', 'item_without_key');
  end if;

  -- Той самий ключ двічі в одній партії — аномалія самого джерела (запит
  -- повернув дублі). Останнє значення виграє: відмовити означало б викинути
  -- всю частину через один рядок, а лишити перше — мовчки віддати перевагу
  -- порядку, якого ніхто не обіцяв.
  with inserted as (
    insert into app.source_object (batch_id, source, kind, ref, payload)
    select p_batch, v_batch.source,
           coalesce(item->>'kind', v_batch.query),
           item->>'ref',
           coalesce(item->'payload', '{}'::jsonb)
      from jsonb_array_elements(p_items) item
     where item ? 'ref'
    on conflict (batch_id, kind, ref) do update
      set payload = excluded.payload, state = 'received', error = null
    returning 1
  )
  select count(*) into v_objects from inserted;

  with inserted as (
    insert into app.source_row (batch_id, query, line_no, payload)
    select p_batch, v_batch.query, (item->>'line')::integer,
           coalesce(item->'payload', '{}'::jsonb)
      from jsonb_array_elements(p_items) item
     where item ? 'line'
    on conflict (batch_id, query, line_no) do update
      set payload = excluded.payload
    returning 1
  )
  select count(*) into v_rows from inserted;

  insert into app.source_part (batch_id, part_no, sha256, row_count)
  values (p_batch, p_part_no, p_sha256, v_objects + v_rows);

  return jsonb_build_object('ok', true, 'repeat', false, 'rows', v_objects + v_rows);
end $$;

/**
 * Підсумок партії: «прийшло все» або «не прийшло».
 *
 * Готовою партія стає ЛИШЕ тоді, коли зійшлися обидва числа — скільки частин
 * обіцяв адаптер і скільки рядків. Інакше `broken`, і це принципово: партія,
 * прийнята наполовину, дає неправильне сальдо, яке шукатимуть у правилах
 * конвертації, тобто не там, де воно зламалося.
 *
 * `p_error` — адаптер сам каже, що в нього не вийшло. Тоді ні з чим і звіряти.
 */
drop function if exists app.import_batch_done(bigint, bigint, integer, integer, text);
create function app.import_batch_done(
  p_session bigint, p_batch bigint, p_parts integer, p_rows integer, p_error text
)
returns jsonb
language plpgsql
as $$
declare
  v_batch app.source_batch;
  v_parts integer;
  v_rows  integer;
  v_state text;
  v_error text := p_error;
begin
  select * into v_batch from app.source_batch
   where id = p_batch and session_id = p_session;

  if v_batch.id is null then
    return jsonb_build_object('ok', false, 'error', 'batch_not_found');
  end if;

  select count(*), coalesce(sum(row_count), 0) into v_parts, v_rows
    from app.source_part where batch_id = p_batch;

  if v_error is not null then
    v_state := 'broken';
  elsif p_parts is not null and p_parts <> v_parts then
    v_state := 'broken';
    v_error := format('очікувалося частин: %s, прийнято: %s', p_parts, v_parts);
  elsif p_rows is not null and p_rows <> v_rows then
    v_state := 'broken';
    v_error := format('очікувалося рядків: %s, прийнято: %s', p_rows, v_rows);
  else
    v_state := 'ready';
  end if;

  update app.source_batch
     set state = v_state, part_count = v_parts, row_count = v_rows,
         error = v_error, finished_at = now()
   where id = p_batch;

  return jsonb_build_object(
    'ok', v_state = 'ready', 'state', v_state,
    'parts', v_parts, 'rows', v_rows, 'error', v_error
  );
end $$;

/**
 * Стан партії — для екрана і для самого адаптера після обриву.
 *
 * `received` віддає НОМЕРИ прийнятих частин, а не лише їх кількість: після
 * обриву адаптер має знати, що дослати, і слати все заново на сотнях тисяч
 * рядків — не варіант.
 */
drop function if exists app.import_batch_state(bigint, bigint);
create function app.import_batch_state(p_session bigint, p_batch bigint)
returns jsonb
language sql
stable
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'ok', true,
        'id', b.id::text,
        'query', b.query,
        'state', b.state,
        'parts', (select count(*) from app.source_part p where p.batch_id = b.id),
        'received', coalesce((
          select jsonb_agg(p.part_no order by p.part_no)
          from app.source_part p where p.batch_id = b.id
        ), '[]'::jsonb),
        'rows', coalesce(
          (select sum(p.row_count) from app.source_part p where p.batch_id = b.id), 0
        ),
        'error', b.error
      )
      from app.source_batch b
      where b.id = p_batch and b.session_id = p_session
    ),
    jsonb_build_object('ok', false, 'error', 'batch_not_found')
  );
$$;

/**
 * Завести сесію разом із кодом спарювання.
 *
 * Хеш коду приходить ГОТОВИМ, з TS. Причина та сама, з якої там же
 * народжується значення звичайного токена: сирі випадкові байти не мають
 * ставати параметром запиту, інакше вони лягають у будь-який журнал, що пише
 * параметри, — і одноразовий код перестає бути одноразовим.
 */
drop function if exists app.import_session_create(bigint, text, jsonb, text, timestamptz);
create function app.import_session_create(
  p_user bigint, p_source text, p_params jsonb, p_code_hash text, p_expires timestamptz
)
returns bigint
language sql
as $$
  insert into app.import_session (source, params, created_by, pairing_code_hash, pairing_expires_at)
  values (p_source, coalesce(p_params, '{}'::jsonb), p_user, p_code_hash, p_expires)
  returning id;
$$;

/**
 * Видати токен каналу.
 *
 * Окремо від `app.access_token_add`, і не заради зручності: той видає токен
 * ЛЮДИНІ на її прохання й перевіряє відповідні правила (ім'я, ліміти). Тут
 * інша дія — канал видає токен сам собі за пред'явленим кодом, і єдине, що в
 * ньому значуще, це область дії. Змішати їх означало б, що зміна правил для
 * людських токенів мовчки міняє поведінку каналу.
 *
 * Власником лишається той, хто сесію завів: від його імені й працюватиме
 * адаптер, а отже й відповідальність за принесене — його.
 */
drop function if exists app.import_token_issue(bigint, text, text, timestamptz);
create function app.import_token_issue(
  p_session bigint, p_name text, p_hash text, p_expires timestamptz
)
returns bigint
language sql
as $$
  insert into app.access_token (user_id, name, token_hash, scope, expires_at)
  select s.created_by, p_name, p_hash, 'import:' || s.id::text, p_expires
    from app.import_session s
   where s.id = p_session
  returning id;
$$;

/**
 * Які пункти плану вже прийняті.
 *
 * Потрібне дозапиту: адаптер питає «що ще», а ядро має сказати, що вже є. Саме
 * ГОТОВІ партії: зіпсована (`broken`) прийнятою не вважається, інакше пункт
 * зник би з плану, не принісши даних.
 */
drop function if exists app.import_plan_done(bigint);
create function app.import_plan_done(p_session bigint)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(distinct b.query), '[]'::jsonb)
    from app.source_batch b
   where b.session_id = p_session and b.state = 'ready';
$$;

/** Сесія для каналу: мінімум, потрібний гаку плану, і нічого зайвого. */
drop function if exists app.import_session_channel(bigint);
create function app.import_session_channel(p_session bigint)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', s.id::text,
    'source', s.source,
    'params', s.params,
    'passport', s.passport,
    'state', s.state
  )
  from app.import_session s where s.id = p_session;
$$;
