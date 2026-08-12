-- Екран «Налаштування» — читання й правка значень УСТАНОВКИ (рядки з user_id is null).
--
-- Сама таблиця й порядок накладання живуть у ядрі (@core/setting): на них
-- спирається і SQL застосунку (`app.setting_read`), і доставка значень
-- клієнтові. Тут — лише те, що належить інтерфейсу.
--
-- Команд create/delete немає навмисно, як і в налаштуваннях журналу: перелік
-- ключів сіє деплой, і рядок, заведений руками, означав би налаштування, якого
-- ніхто не читає, а видалений — параметр, який більше не виставити з екрана.

drop function if exists app.setting_get(bigint, jsonb);
create function app.setting_get(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', jsonb_build_object(
        'id', 'app',
        'values', coalesce((
          select jsonb_object_agg(s.key, s.value)
          from app.setting_value s
          where s.user_id is null
        ), '{}'::jsonb)
      )
    ),
    'messages', '[]'::jsonb
  );
$$;

-- Пише лише ОГОЛОШЕНІ ключі — ті, що вже є рядком установки. Невідомий ключ
-- ВІДХИЛЯЄ, а не заводить: рядок, якого немає в каталозі, ніхто не прочитає, і
-- помилка в імені лишилася б без жодного сліду — та сама причина, з якої підбір
-- відхиляє невідомий фільтр.
drop function if exists app.setting_save(bigint, jsonb);
create function app.setting_save(user_id bigint, payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_values  jsonb := coalesce(payload->'item'->'values', '{}'::jsonb);
  v_unknown text;
begin
  select string_agg(e.key, ', ' order by e.key) into v_unknown
  from jsonb_each(v_values) e
  where not exists (
    select 1 from app.setting_value s where s.key = e.key and s.user_id is null
  );

  if v_unknown is not null then
    return jsonb_build_object(
      'ok', false,
      'data', jsonb_build_object('item', null),
      'messages', jsonb_build_array(jsonb_build_object(
        'type', 'error',
        -- Ключ застосунку, а не `core.*`: маркер стоїть у SQL застосунку, і
        -- словник, у якому його шукає проба, теж його — app/admin/setting/_locales.
        'text', '@[setting.unknownKey]{"keys":"' || v_unknown || '"}'
      ))
    );
  end if;

  update app.setting_value s
     set value      = e.value,
         updated_at = now(),
         updated_by = setting_save.user_id
    from jsonb_each(v_values) e
   where s.key = e.key
     and s.user_id is null
     and s.value is distinct from e.value;

  return app.setting_get(setting_save.user_id, '{}'::jsonb);
end;
$$;
