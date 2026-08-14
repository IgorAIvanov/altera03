-- Команди моделі `remark`.
--
-- Головне тут — не набір команд, а те, ЯК розділені поля. Зауваження заповнюють
-- три сторони: людина пише тип і текст, машина підставляє контекст, виконавець
-- відповідає, і закриває запис знову людина. Розділ тримається не домовленістю,
-- а тим, що кожна сторона має СВОЮ команду: `save` не вміє писати відповідь,
-- `answer` не вміє переписати текст зауваження, `verify` не вміє нічого, крім
-- закриття. Спільний `save` на всіх виглядав би простішим рівно доти, доки
-- перший же виклик агента не затер би те, на що він відповідає.
--
-- `answer`, `verify` і `unread` — команди нестандартні, тож застосунок мусить
-- оголосити їхнє право в `manifest.json` (`commands.access`), інакше рантайм
-- відмовить: 501 краще за мовчазний дозвіл.

/**
 * Конверт відмови.
 *
 * Текст НЕ позначений маркером перекладу навмисно: сюди потрапляє лише те, що
 * читає розробник або агент — «зауваження не знайдено» після того, як запис
 * прибрали з-під ніг. Людина в цю гілку не заходить: вона тисне кнопку на
 * записі, який щойно бачила.
 */
drop function if exists app.remark_fail(text);
create function app.remark_fail(p_text text)
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
 * Розбір id з тексту.
 *
 * Команда досяжна не лише з форми — її кличе агент і `deno task api`, тобто
 * прийти може будь-що. Невірний id мусить дати порожній результат, а не помилку
 * PostgreSQL: конверт зобов'язаний лишитися конвертом.
 */
drop function if exists app.remark_id(text);
create function app.remark_id(p_value text)
returns bigint
language sql
immutable
as $$
  select case when p_value ~ '^[0-9]+$' then p_value::bigint end;
$$;

drop function if exists app.remark_list(bigint, jsonb);
create function app.remark_list(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      coalesce(payload->>'search', '')                                   as search,
      -- Відбори приходять вкладеним об'єктом `filters` — так їх шле панель
      -- фільтрів основи (`$root.$filters`). Верхній рівень лишається за
      -- запитом (`search`, сторінка, сортування); змішувати їх в одному рівні
      -- означало б, що ім'я поля моделі колись збіжиться з іменем параметра.
      nullif(payload->'filters'->>'kind', '')                            as kind,
      nullif(payload->'filters'->>'status', '')                          as status,
      coalesce((payload->'filters'->>'openOnly')::boolean, false)        as open_only,
      greatest(coalesce((payload->>'page')::int, 1), 1)                  as page,
      least(greatest(coalesce((payload->>'pageSize')::int, 20), 1), 200) as page_size,
      coalesce(nullif(payload->>'sortBy', ''), 'createdAt')              as sort_by,
      -- Умовчання `desc`, а не `asc`: у журналі зауважень потрібне останнє, а
      -- не перше. Списки довідників сортуються навпаки — і це різні задачі.
      case lower(coalesce(payload->>'sortDir', 'desc')) when 'asc' then 'asc' else 'desc' end as sort_dir
  ),
  filtered as (
    select
      r.id::text                     as id,
      r.created_at                   as "createdAt",
      coalesce(u.full_name, u.login) as author,
      r.kind                         as kind,
      r.title                        as title,
      r.status                       as status,
      r.area                         as area,
      r.ctx_route                    as "ctxRoute",
      (r.answer is not null)         as "hasAnswer",
      r.fixed_version                as "fixedVersion",
      r.verified_at                  as "verifiedAt",
      r.is_deleted                   as "isDeleted"
    from app.remark r
    left join app.users u on u.id = r.created_by
    cross join params p
    where (p.kind is null or r.kind = p.kind)
      and (p.status is null or r.status = p.status)
      -- «Відкриті» — це НЕ перелік станів, а порожній `verified_at`: доки
      -- людина не підтвердила, запис відкритий, хай навіть виконавець уже
      -- написав «виправлено».
      and (not p.open_only or r.verified_at is null)
      and (p.search = ''
           or r.title ilike '%' || p.search || '%'
           or r.body ilike '%' || p.search || '%')
  ),
  paged as (
    select f.*
    from filtered f
    cross join params p
    order by
      case when p.sort_by = 'createdAt' and p.sort_dir = 'asc'  then f."createdAt" end asc,
      case when p.sort_by = 'createdAt' and p.sort_dir = 'desc' then f."createdAt" end desc,
      case when p.sort_by = 'title'     and p.sort_dir = 'asc'  then f.title end asc,
      case when p.sort_by = 'title'     and p.sort_dir = 'desc' then f.title end desc,
      case when p.sort_by = 'status'    and p.sort_dir = 'asc'  then f.status end asc,
      case when p.sort_by = 'status'    and p.sort_dir = 'desc' then f.status end desc,
      case when p.sort_by = 'kind'      and p.sort_dir = 'asc'  then f.kind end asc,
      case when p.sort_by = 'kind'      and p.sort_dir = 'desc' then f.kind end desc,
      f."createdAt" desc
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

drop function if exists app.remark_get(bigint, jsonb);
create function app.remark_get(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      -- Порожнього запису тут не будують: умовчання нового зауваження живуть у
      -- TypeBox-схемі й накладаються на клієнті. Немає запису — `item: null`.
      'item', (
        select to_jsonb(x)
        from (
          select
            r.id::text                     as id,
            r.created_at                   as "createdAt",
            coalesce(u.full_name, u.login) as author,
            r.kind                         as kind,
            r.title                        as title,
            r.body                         as body,
            r.ctx_route                    as "ctxRoute",
            r.ctx_model                    as "ctxModel",
            r.ctx_record_id                as "ctxRecordId",
            r.ctx_org_id::text             as "ctxOrgId",
            r.ctx_solution                 as "ctxSolution",
            r.ctx_framework                as "ctxFramework",
            r.ctx_user_agent               as "ctxUserAgent",
            r.status                       as status,
            r.area                         as area,
            r.answer                       as answer,
            r.answered_at                  as "answeredAt",
            r.fixed_version                as "fixedVersion",
            r.feedback_ref                 as "feedbackRef",
            r.duplicate_of::text           as "duplicateOf",
            r.verified_at                  as "verifiedAt",
            coalesce(v.full_name, v.login) as "verifiedBy",
            r.is_deleted                   as "isDeleted"
          from app.remark r
          left join app.users u on u.id = r.created_by
          left join app.users v on v.id = r.verified_by
          where r.id = app.remark_id(payload->>'id')
        ) x
      ),
      'rows', '[]'::jsonb,
      'options', '{}'::jsonb,
      'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
$$;

/**
 * Створити або поправити зауваження — сторона ЛЮДИНИ.
 *
 * Полів виконавця (`status`, `area`, `answer`, `fixedVersion`) команда не
 * бачить узагалі, і це не забудькуватість: інакше форма, яка показує відповідь,
 * при звичайному збереженні відправляла б її назад — і затирала б свіжу.
 */
drop function if exists app.remark_save(bigint, jsonb);
create function app.remark_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item  jsonb  := coalesce(payload->'item', '{}'::jsonb);
  v_id    bigint := app.remark_id(v_item->>'id');
  v_title text   := btrim(coalesce(v_item->>'title', ''));
begin
  if v_title = '' then
    raise exception '@[common.fieldRequired]' using column = 'title';
  end if;

  if v_id is null then
    insert into app.remark (
      created_by, kind, title, body,
      ctx_route, ctx_model, ctx_record_id, ctx_org_id,
      ctx_solution, ctx_framework, ctx_user_agent
    ) values (
      user_id,
      coalesce(nullif(v_item->>'kind', ''), 'error'),
      v_title,
      coalesce(v_item->>'body', ''),
      nullif(v_item->>'ctxRoute', ''),
      nullif(v_item->>'ctxModel', ''),
      nullif(v_item->>'ctxRecordId', ''),
      app.remark_id(v_item->>'ctxOrgId'),
      nullif(v_item->>'ctxSolution', ''),
      nullif(v_item->>'ctxFramework', ''),
      nullif(v_item->>'ctxUserAgent', '')
    )
    returning id into v_id;
  else
    -- Контекст при оновленні не чіпаємо. Він знятий у мить, коли випадок був на
    -- екрані; переписати його пізнішим станом означало б втратити рівно те, чого
    -- людина сама не відтворить.
    update app.remark set
      kind       = coalesce(nullif(v_item->>'kind', ''), kind),
      title      = v_title,
      body       = coalesce(v_item->>'body', body),
      updated_at = now()
    where id = v_id;

    if not found then
      return app.remark_fail('remark_save: зауваження ' || v_id || ' не знайдено');
    end if;
  end if;

  return app.remark_get(user_id, jsonb_build_object('id', v_id::text));
end $$;

/**
 * Відповідь — сторона ВИКОНАВЦЯ.
 *
 * Заборона одна, і вона про замовлення: перевести `order` у роботу може лише
 * власник рішення. Дефект виконавець бере сам, бо задум уже погоджений; обсяг і
 * строк нової роботи — не його рішення й не того, хто її попросив.
 */
drop function if exists app.remark_answer(bigint, jsonb);
create function app.remark_answer(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id     bigint := app.remark_id(payload->>'id');
  v_status text   := nullif(payload->>'status', '');
  v_kind   text;
begin
  select kind into v_kind from app.remark where id = v_id;
  if not found then
    return app.remark_fail('remark_answer: зауваження ' || coalesce(v_id::text, '?') || ' не знайдено');
  end if;

  if v_kind = 'order' and v_status = 'in_work' then
    return app.remark_fail(
      'remark_answer: замовлення в роботу переводить власник рішення, а не виконавець. ' ||
      'Відповідай оцінкою й лишай статус answered.'
    );
  end if;

  update app.remark set
    status        = coalesce(v_status, status),
    area          = coalesce(nullif(payload->>'area', ''), area),
    answer        = coalesce(payload->>'answer', answer),
    -- Час відповіді ставиться лише тоді, коли відповідь справді прийшла: виклик,
    -- що міняє самий статус, не мусить виглядати як нова відповідь.
    answered_at   = case when payload ? 'answer' then now() else answered_at end,
    fixed_version = coalesce(nullif(payload->>'fixedVersion', ''), fixed_version),
    feedback_ref  = coalesce(nullif(payload->>'feedbackRef', ''), feedback_ref),
    duplicate_of  = coalesce(app.remark_id(payload->>'duplicateOf'), duplicate_of),
    updated_at    = now()
  where id = v_id;

  return app.remark_get(user_id, jsonb_build_object('id', v_id::text));
end $$;

/**
 * Закрити або повернути — сторона ЛЮДИНИ, і тільки вона.
 *
 * `confirmed: false` — це «не виправлено»: запис повертається в `new`, а текст
 * відповіді лишається. Прибирати його означало б стирати історію суперечки й
 * змушувати виконавця вигадувати ту саму відповідь удруге.
 */
drop function if exists app.remark_verify(bigint, jsonb);
create function app.remark_verify(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id        bigint  := app.remark_id(payload->>'id');
  v_confirmed boolean := coalesce((payload->>'confirmed')::boolean, true);
begin
  if not exists (select 1 from app.remark where id = v_id) then
    return app.remark_fail('remark_verify: зауваження ' || coalesce(v_id::text, '?') || ' не знайдено');
  end if;

  if v_confirmed then
    update app.remark set
      verified_at = now(),
      verified_by = user_id,
      updated_at  = now()
    where id = v_id;
  else
    update app.remark set
      status      = 'new',
      verified_at = null,
      verified_by = null,
      updated_at  = now()
    where id = v_id;
  end if;

  return app.remark_get(user_id, jsonb_build_object('id', v_id::text));
end $$;

/**
 * Скільки відповідей людина ще не прочитала — для значка біля кнопки в шапці.
 *
 * Рахуються ВЛАСНІ зауваження: значок означає «тобі відповіли», а не «у системі
 * є неопрацьоване». Без нього петля не замикається — відповідь приходить, а той,
 * хто питав, дізнається про неї, лише коли сам відкриє журнал.
 */
drop function if exists app.remark_unread(bigint, jsonb);
create function app.remark_unread(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', '[]'::jsonb,
      'options', '{}'::jsonb,
      'totals', jsonb_build_object(
        'count', (
          select count(*)
          from app.remark r
          where r.created_by = remark_unread.user_id
            and r.answer is not null
            and r.verified_at is null
            and not r.is_deleted
        )
      )
    ),
    'messages', '[]'::jsonb
  );
$$;

drop function if exists app.remark_delete(bigint, jsonb);
create function app.remark_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := app.remark_id(payload->>'id');
begin
  update app.remark set is_deleted = true, updated_at = now() where id = v_id;
  if not found then
    return app.remark_fail('remark_delete: зауваження ' || coalesce(v_id::text, '?') || ' не знайдено');
  end if;
  return app.remark_get(user_id, jsonb_build_object('id', v_id::text));
end $$;

drop function if exists app.remark_undelete(bigint, jsonb);
create function app.remark_undelete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := app.remark_id(payload->>'id');
begin
  update app.remark set is_deleted = false, updated_at = now() where id = v_id;
  if not found then
    return app.remark_fail('remark_undelete: зауваження ' || coalesce(v_id::text, '?') || ' не знайдено');
  end if;
  return app.remark_get(user_id, jsonb_build_object('id', v_id::text));
end $$;
