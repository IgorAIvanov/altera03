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
  v_id      bigint;
begin
  if v_content is null then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object('item', null, 'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb),
      'messages', jsonb_build_array('@[core.agentNoteEmpty]')
    );
  end if;

  insert into app.agent_note (model_key, content, status, source, updated_by)
  values (v_model, v_content, 'draft', 'agent', user_id)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', jsonb_build_object('id', v_id::text, 'status', 'draft'),
      'rows', '[]'::jsonb, 'options', '{}'::jsonb, 'totals', '{}'::jsonb
    ),
    'messages', jsonb_build_array(
      jsonb_build_object('type', 'info', 'text', '@[core.agentNoteProposed]')
    )
  );
end;
$$;
