-- Команди моделі `source_decision` — рішення людини про об'єкти джерела.
--
-- Таблиця жила в ядрі без жодної команди: схему взяли наперед, щоб прототип
-- рушія не завів своїх таблиць. Наслідок вилізло на першій же розкладці —
-- агент пропонував рішення в чаті, а зберегти їх не було куди.
--
-- Поділ ролей той самий, що в пам'ятці бази: агент ПРОПОНУЄ (`propose`), людина
-- ПІДТВЕРДЖУЄ (`confirm`). Друге токену недоступне взагалі — це тримає рантайм
-- (`HUMAN_ONLY_COMMANDS`), а не ця функція: SQL не знає, хто його покликав.
--
-- Зміст рішення (`decision`) ядро не тлумачить — його форма належить
-- застосунку разом із правилами конвертації. Ядро возить, фільтрує за
-- входженням і стежить, щоб підтверджене не переписали мимохідь.

drop function if exists app.source_decision_item(app.source_decision);
create function app.source_decision_item(p_row app.source_decision)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id',          p_row.id::text,
    'source',      p_row.source,
    'kind',        p_row.kind,
    'ref',         p_row.ref,
    'decision',    p_row.decision,
    'state',       p_row.state,
    'reason',      p_row.reason,
    'createdBy',   p_row.created_by::text,
    'createdAt',   p_row.created_at,
    'confirmedBy', p_row.confirmed_by::text,
    'confirmedAt', p_row.confirmed_at
  );
$$;

/**
 * Перелік рішень.
 *
 * Фільтр `decision` — ВХОДЖЕННЯ (`@>`): `{"bucket": "skip"}` знаходить усі
 * рішення, що кладуть об'єкт у цей кошик, хоч би що ще в них лежало. Форму
 * рішення задає застосунок, тож іншого способу відібрати «ось цю розкладку»
 * ядро дати не може — і цього досить.
 */
drop function if exists app.source_decision_list(bigint, jsonb);
create function app.source_decision_list(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  with params as (
    select
      nullif(payload->'filters'->>'source', '')                          as source,
      nullif(payload->'filters'->>'kind', '')                            as kind,
      nullif(payload->'filters'->>'state', '')                           as state,
      nullif(payload->'filters'->>'ref', '')                             as ref,
      case when jsonb_typeof(payload->'filters'->'decision') = 'object'
           then payload->'filters'->'decision' end                       as decision,
      greatest(coalesce((payload->>'page')::int, 1), 1)                  as page,
      least(greatest(coalesce((payload->>'pageSize')::int, 50), 1), 500) as page_size
  ),
  filtered as (
    select d
    from app.source_decision d, params p
    where (p.source is null or d.source = p.source)
      and (p.kind is null or d.kind = p.kind)
      and (p.state is null or d.state = p.state)
      and (p.ref is null or d.ref = p.ref)
      and (p.decision is null or d.decision @> p.decision)
  )
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', null,
      'rows', coalesce((
        select jsonb_agg(app.source_decision_item(f.d) order by (f.d).kind, (f.d).ref)
        from (
          select * from filtered
          order by (d).kind, (d).ref
          limit (select page_size from params)
          offset ((select page from params) - 1) * (select page_size from params)
        ) f
      ), '[]'::jsonb),
      'options', '{}'::jsonb,
      'totals', jsonb_build_object(
        'count',     (select count(*) from filtered),
        'proposed',  (select count(*) from filtered where (d).state = 'proposed'),
        'confirmed', (select count(*) from filtered where (d).state = 'confirmed'),
        'page',      (select page from params),
        'pageSize',  (select page_size from params)
      )
    ),
    'messages', '[]'::jsonb
  );
$$;

/** Одне рішення — за `id` або за ключем об'єкта джерела (`source` + `kind` + `ref`). */
drop function if exists app.source_decision_get(bigint, jsonb);
create function app.source_decision_get(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_row app.source_decision;
begin
  if payload->>'id' ~ '^[0-9]+$' then
    select * into v_row from app.source_decision where id = (payload->>'id')::bigint;
  else
    select * into v_row from app.source_decision
     where source = payload->>'source' and kind = payload->>'kind' and ref = payload->>'ref';
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', case when v_row.id is null then null else app.source_decision_item(v_row) end,
      'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
end $$;

/**
 * Пункти пачки, зведені до одного на об'єкт: той самий об'єкт двічі в пачці —
 * виграє останній. `on conflict` зачепити рядок двічі одним оператором не дає.
 */
drop function if exists app.source_decision_incoming(jsonb, text);
create function app.source_decision_incoming(p_items jsonb, p_reason text)
returns table (source text, kind text, ref text, decision jsonb, reason text)
language sql
immutable
as $$
  select distinct on (item->>'source', item->>'kind', item->>'ref')
         item->>'source', item->>'kind', item->>'ref', item->'decision',
         coalesce(nullif(btrim(coalesce(item->>'reason', '')), ''), p_reason)
    from jsonb_array_elements(p_items) with ordinality as e(item, n)
   order by item->>'source', item->>'kind', item->>'ref', n desc;
$$;

/**
 * Запропонувати рішення — пачкою.
 *
 * Пачкою, бо розкладка це сотні об'єктів за раз: по виклику на кожен агент
 * витратив би на неї годину, а людина — терпіння.
 *
 * Три правила, і кожне тримає поділ «пропонує агент — вирішує людина»:
 *
 *   - **стан завжди `proposed`**: поля `state` payload не приймає взагалі.
 *     Інакше «підтверджено» не означало б нічого — той, хто пише, ставив би
 *     позначку собі сам;
 *   - **підтверджене не переписується.** Пропозиція щодо об'єкта, про який
 *     людина вже вирішила, не помилка й не заміна — вона пропускається й
 *     повертається в `skipped`, щоб агент побачив, що тут уже є відповідь;
 *   - **без доводу не приймається.** `reason` — єдине, що через півроку
 *     пояснить, чому контрагента злили саме так. Загальний `reason` пачки діє
 *     на пункти без власного.
 *
 * Пачка атомарна: зіпсований пункт відбиває всю пачку з номером пункту.
 * Прийняти половину означало б залишити агента гадати, яка саме половина.
 */
drop function if exists app.source_decision_propose(bigint, jsonb);
create function app.source_decision_propose(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_items   jsonb := payload->'items';
  v_reason  text := nullif(btrim(coalesce(payload->>'reason', '')), '');
  v_bad     int;
  v_created int;
  v_updated int;
  v_skipped jsonb;
begin
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) = 0 then
    return app.import_fail('@[core.sourceDecisionNoItems]');
  end if;

  if jsonb_array_length(v_items) > 1000 then
    return app.import_fail('@[core.sourceDecisionTooMany]' || jsonb_build_object('max', 1000)::text);
  end if;

  -- Перший зіпсований пункт — з номером від одиниці, як його рахує людина.
  select min(n) into v_bad
    from jsonb_array_elements(v_items) with ordinality as e(item, n)
   where jsonb_typeof(item) is distinct from 'object'
      or nullif(btrim(coalesce(item->>'source', '')), '') is null
      or length(item->>'source') > 50
      or nullif(btrim(coalesce(item->>'kind', '')), '') is null
      or nullif(btrim(coalesce(item->>'ref', '')), '') is null
      or jsonb_typeof(item->'decision') is distinct from 'object'
      or coalesce(nullif(btrim(coalesce(item->>'reason', '')), ''), v_reason) is null;

  if v_bad is not null then
    return app.import_fail('@[core.sourceDecisionBadItem]' || jsonb_build_object('n', v_bad)::text);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id::text, 'source', d.source, 'kind', d.kind, 'ref', d.ref)
           order by d.kind, d.ref), '[]'::jsonb)
    into v_skipped
    from app.source_decision d
    join app.source_decision_incoming(v_items, v_reason) i using (source, kind, ref)
   where d.state = 'confirmed';

  with upserted as (
    insert into app.source_decision as d (source, kind, ref, decision, reason, created_by)
    select i.source, i.kind, i.ref, i.decision, i.reason, user_id
      from app.source_decision_incoming(v_items, v_reason) i
    on conflict (source, kind, ref) do update
      set decision   = excluded.decision,
          reason     = excluded.reason,
          created_by = excluded.created_by,
          created_at = now()
      where d.state = 'proposed'
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
    into v_created, v_updated
    from upserted;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', jsonb_build_object(
        'created', v_created,
        'updated', v_updated,
        'skipped', v_skipped
      ),
      'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', jsonb_build_array(jsonb_build_object(
      'type', 'info',
      'text', '@[core.sourceDecisionProposed]' || jsonb_build_object(
        'created', v_created, 'updated', v_updated, 'skipped', jsonb_array_length(v_skipped)
      )::text
    ))
  );
end $$;

/**
 * Підтвердити пропозиції. Лише людина: токену команда відмовляє в рантаймі.
 *
 * Перелік `ids`, а не одне: розкладку людина переглядає кошиком і
 * підтверджує кошиком. Уже підтверджене й чуже не чіпається й не рахується.
 */
drop function if exists app.source_decision_confirm(bigint, jsonb);
create function app.source_decision_confirm(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_count int;
begin
  if jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_array_length(payload->'ids') = 0 then
    return app.import_fail('@[core.sourceDecisionNoIds]');
  end if;

  update app.source_decision d
     set state = 'confirmed', confirmed_by = user_id, confirmed_at = now()
   where d.state = 'proposed'
     and d.id in (
       select (value)::bigint from jsonb_array_elements_text(payload->'ids') where value ~ '^[0-9]+$'
     );
  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', jsonb_build_object('confirmed', v_count),
      'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', jsonb_build_array(jsonb_build_object(
      'type', 'info',
      'text', '@[core.sourceDecisionConfirmed]' || jsonb_build_object('count', v_count)::text
    ))
  );
end $$;

/**
 * Видалити рішення — справжнім видаленням.
 *
 * Позначки на видалення тут немає свідомо: відкинута пропозиція чи скасоване
 * рішення не є записом обліку, і лишати їх означало б, що рушій мусить щоразу
 * відрізняти живе від мертвого. Слід застосованого лишається в карті
 * (`app.source_ref`, `method = 'decision'`) — видалення рішення карти не чіпає.
 */
drop function if exists app.source_decision_delete(bigint, jsonb);
create function app.source_decision_delete(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_count int;
begin
  if jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_array_length(payload->'ids') = 0 then
    return app.import_fail('@[core.sourceDecisionNoIds]');
  end if;

  delete from app.source_decision
   where id in (
     select (value)::bigint from jsonb_array_elements_text(payload->'ids') where value ~ '^[0-9]+$'
   );
  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', jsonb_build_object('deleted', v_count),
      'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
end $$;
