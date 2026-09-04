-- Єдина функція пам'ятки, яка належить ЯДРУ: пропозиція від агента.
--
-- Решта (перелік, правка, підтвердження, видалення) — це екран, тобто
-- застосунок: `app/admin/agent_note/db/agent_note.sql`. Межа та сама, що в
-- налаштуваннях журналу: таблиця в ядрі, бо без неї не працює доставка, а
-- інтерфейс до неї належить рішенню.
--
-- Чому пропозиція все-таки тут. Вона мусить працювати у ВСТАНОВЛЕНОМУ
-- застосунку, у якого екрана пам'ятки може й не бути: канал агента — частина
-- фреймворку, і «агент запропонував, а записати нікуди» означало б, що єдиний
-- спосіб наповнити пам'ятку залежить від того, скопіювали в рішення екран чи
-- ні.
--
-- Пропозиція завжди чернетка й завжди позначена агентом — цих двох полів
-- payload не приймає взагалі. Інакше «підтверджено» не означало б нічого: той,
-- хто пише, ставив би позначку собі сам.
--
-- Імені моделі функція не звіряє ні з чим, і це не недогляд: переліку моделей
-- у базі немає — він живе в реєстрі рантайму. Помилку тут ловить не перевірка,
-- а сам порядок: чернетку однаково читає людина, перш ніж підтвердити, і
-- модель на екрані вибирається зі списку.

drop function if exists app.agent_note_propose(bigint, jsonb);
create function app.agent_note_propose(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_model   text := coalesce(nullif(trim(payload->>'model'), ''), '*');
  v_content text := nullif(btrim(coalesce(payload->>'content', '')), '');
  v_kind    text := case when coalesce(payload->>'kind', 'note') = 'topic' then 'topic' else 'note' end;
  v_slug    text := nullif(btrim(coalesce(payload->>'slug', '')), '');
  v_title   text := nullif(btrim(coalesce(payload->>'title', '')), '');
  v_summary text := nullif(btrim(coalesce(payload->>'summary', '')), '');
  v_id      bigint;
begin
  if v_content is null then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object('item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb),
      'messages', jsonb_build_array('@[core.agentNoteEmpty]')
    );
  end if;

  -- Тема без покажчика — тема, про яку агент ніколи не здогадається, що вона
  -- йому потрібна. Відмовляємо тут, а не констрейнтом: 500 із бази той, хто
  -- кличе, прочитати не зможе.
  if v_kind = 'topic' and (v_slug is null or v_title is null or v_summary is null) then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object('item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb),
      'messages', jsonb_build_array('@[core.agentNoteTopicIncomplete]')
    );
  end if;

  if v_kind = 'topic' and exists (select 1 from app.agent_note where slug = v_slug) then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object('item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb),
      'messages', jsonb_build_array('@[core.agentNoteSlugTaken]' || jsonb_build_object('slug', v_slug)::text)
    );
  end if;

  insert into app.agent_note (model_key, kind, slug, title, summary, content, status, source, updated_by)
  values (v_model, v_kind, v_slug, v_title, v_summary, v_content, 'draft', 'agent', user_id)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', jsonb_build_object('id', v_id::text, 'status', 'draft', 'kind', v_kind),
      'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', jsonb_build_array(
      jsonb_build_object('type', 'info', 'text', '@[core.agentNoteProposed]')
    )
  );
end;
$$;

-- Тіло теми за іменем.
--
-- Покажчик (`slug` + назва + «коли потрібно») лежить у контексті завжди — він
-- коштує рядок. Тіло це півтори-три сторінки, і їде воно лише тоді, коли
-- задача збіглася: те саме, що у скіла з його frontmatter і `SKILL.md`.
--
-- Непідтверджену тему не віддаємо так само, як не віддаємо непідтверджену
-- записку: чернетку міг написати агент, і прочитана вона стала б домовленістю
-- підприємства, якою ніхто не ставав.
drop function if exists app.agent_note_topic(bigint, jsonb);
create function app.agent_note_topic(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_slug text := nullif(btrim(coalesce(payload->>'slug', '')), '');
  v_item jsonb;
begin
  select jsonb_build_object(
    'slug',    n.slug,
    'title',   n.title,
    'summary', n.summary,
    'content', n.content
  ) into v_item
  from app.agent_note n
  where n.kind = 'topic' and n.status = 'confirmed' and n.slug = v_slug;

  if v_item is null then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object('item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb),
      'messages', jsonb_build_array('@[core.agentNoteTopicNotFound]' || jsonb_build_object('slug', coalesce(v_slug, ''))::text)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object('item', v_item, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb),
    'messages', '[]'::jsonb
  );
end;
$$;
