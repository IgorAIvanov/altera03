-- Ядро підсистеми вкладень.
--
-- Дві групи функцій, і вони навмисно різні:
--
-- 1. Бінарні (attachment_load / attachment_update) — приймають і повертають
--    звичайні колонки, зокрема bytea. Контракт `(user_id, payload jsonb) →
--    jsonb` тут не діє свідомо: байти в jsonb довелося б возити base64 (+33%
--    трафіку й зайве кодування на кожен бік). Їх кличе не ModelRuntimeService,
--    а server/modules/blob.
--
-- 2. Модельні (attachment_list / get / save / delete) — звичайний контракт
--    моделі, їх кличе ModelRuntimeService як команди моделі `attachment`.
--    Байтів не торкаються: тільки метадані та прив'язка до власника.
--
-- Поле `token` у відповідях модельних функцій містить access_key (uuid).
-- Підписаний токен доступу підставляє рантайм — див. server/modules/blob.

-- ── 1. Бінарні функції ──────────────────────────────────────────────────────

-- Читання вкладення разом із потоком даних. Аналог процедури `.Load`.
drop function if exists app.attachment_load(bigint, bigint);
create function app.attachment_load(user_id bigint, attachment_id bigint)
returns table (
  id         bigint,
  name       varchar(255),
  mime       varchar(255),
  size       bigint,
  sha256     varchar(64),
  access_key uuid,
  stream     bytea
)
language sql
as $$
  select a.id, a.name, a.mime, a.size, a.sha256, a.access_key, a.stream
  from app.attachment a
  where a.id = attachment_id;
$$;

-- Запис нового вкладення. Аналог процедури `.Update`: повертає id та ключ
-- доступу, з яких клієнт складає посилання і кладе id у свою модель.
-- Власник (p_owner_model/p_owner_id) необов'язковий: форма нового запису ще
-- не має id, тому спершу створюється «сирота», а прив'язку робить
-- attachment_save після збереження самої моделі.
drop function if exists app.attachment_update(bigint, varchar, varchar, bytea, varchar, bigint, varchar);
create function app.attachment_update(
  p_user_id     bigint,
  p_name        varchar(255),
  p_mime        varchar(255),
  p_stream      bytea,
  p_owner_model varchar(80) default null,
  p_owner_id    bigint      default null,
  p_sha256      varchar(64) default null
)
returns table (id bigint, access_key uuid)
language sql
as $$
  insert into app.attachment as a (name, mime, size, sha256, stream, owner_model, owner_id, created_by)
  values (
    nullif(trim(coalesce(p_name, '')), ''),
    coalesce(nullif(trim(coalesce(p_mime, '')), ''), 'application/octet-stream'),
    coalesce(length(p_stream), 0),
    p_sha256,
    p_stream,
    nullif(trim(coalesce(p_owner_model, '')), ''),
    p_owner_id,
    p_user_id
  )
  returning a.id, a.access_key;
$$;

-- Прибирання «сиріт»: завантажили файл, але форму не зберегли.
-- Викликається планово (cron/адмін-командою), не рантаймом.
drop function if exists app.attachment_gc(int);
create function app.attachment_gc(p_older_than_hours int default 24)
returns bigint
language sql
as $$
  with removed as (
    delete from app.attachment
    where owner_model is null
      and created_at < now() - make_interval(hours => greatest(p_older_than_hours, 1))
    returning 1
  )
  select count(*)::bigint from removed;
$$;

-- ── 2. Модельні функції (команди моделі `attachment`) ───────────────────────

-- Список вкладень запису: payload = { ownerModel, ownerId }.
drop function if exists app.attachment_list(bigint, jsonb);
create function app.attachment_list(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  with src as (
    select a.*
    from app.attachment a
    where a.owner_model = nullif(trim(coalesce(payload->>'ownerModel', '')), '')
      and a.owner_id    = nullif(payload->>'ownerId', '')::bigint
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',        s.id::text,
          'name',      s.name,
          'mime',      s.mime,
          'size',      s.size,
          'createdAt', s.created_at,
          -- access_key; підписаний токен підставить рантайм
          'token',     s.access_key
        ) order by s.id)
        from src s
      ), '[]'::jsonb),
      'item',    null,
      'options', '{}'::jsonb,
      'totals',  jsonb_build_object('count', (select count(*)::int from src)),
      'extra',   '{}'::jsonb
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
$$;

-- Одне вкладення (метадані + токен): payload = { id }.
drop function if exists app.attachment_get(bigint, jsonb);
create function app.attachment_get(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', (
        select jsonb_build_object(
          'id',        a.id::text,
          'name',      a.name,
          'mime',      a.mime,
          'size',      a.size,
          'createdAt', a.created_at,
          'token',     a.access_key
        )
        from app.attachment a
        where a.id = nullif(payload->>'id', '')::bigint
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

-- Прив'язка вкладення до власника і перейменування:
-- payload = { item: { id, ownerModel?, ownerId?, name? } }.
-- Саме цим форма «усиновлює» файли, завантажені до першого збереження запису.
drop function if exists app.attachment_save(bigint, jsonb);
create function app.attachment_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_item jsonb := coalesce(payload->'item', '{}'::jsonb);
  v_id   bigint := nullif(v_item->>'id', '')::bigint;
  v_row  jsonb;
begin
  if v_id is null then
    raise exception 'attachment_save: id обов''язковий (байти завантажуються через /api/blob/upload)';
  end if;

  update app.attachment a
  set owner_model = coalesce(nullif(trim(coalesce(v_item->>'ownerModel', '')), ''), a.owner_model),
      owner_id    = coalesce(nullif(v_item->>'ownerId', '')::bigint, a.owner_id),
      name        = coalesce(nullif(trim(coalesce(v_item->>'name', '')), ''), a.name)
  where a.id = v_id
  returning jsonb_build_object(
    'id',        a.id::text,
    'name',      a.name,
    'mime',      a.mime,
    'size',      a.size,
    'createdAt', a.created_at,
    'token',     a.access_key
  ) into v_row;

  if v_row is null then
    raise exception 'attachment_save: вкладення % не знайдено', v_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item',    v_row,
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

-- Видалення вкладення: payload = { id }.
drop function if exists app.attachment_delete(bigint, jsonb);
create function app.attachment_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id bigint := nullif(payload->>'id', '')::bigint;
begin
  delete from app.attachment where id = v_id;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item',    null,
      'rows',    '[]'::jsonb,
      'options', '{}'::jsonb,
      'totals',  '{}'::jsonb,
      'extra',   jsonb_build_object('id', v_id::text)
    ),
    'messages', '[]'::jsonb,
    'meta', '{}'::jsonb
  );
end;
$$;
