-- Читання налаштувань. Правка — справа застосунку (екран admin/setting),
-- бо перелік того, що можна налаштувати, теж його.
--
-- Тут лише ПОРЯДОК НАКЛАДАННЯ, і він названий один раз: значення користувача
-- сильніше за значення установки. Той самий довід, що в локалей — перевизначення
-- мусить жити в одному місці, інакше два виклики дадуть різну відповідь на те
-- саме питання.
--
-- Умовчання серед джерел немає навмисно: воно лежить РЯДКОМ у таблиці, який сіє
-- застосунок. Тримати умовчання ще й у коді означало б два його дома, і на
-- третьому релізі вони розійшлися б мовчки.

/**
 * Одне значення — цим користується SQL застосунку.
 *
 * Ім'я НЕ `setting_get`: команда моделі `setting` + `get` дає рівно таке ім'я з
 * підписом `(bigint, jsonb)`, і в схемі стояли б дві різні функції з однією
 * назвою. PostgreSQL їх розрізнить за типом, а людина — ні.
 *
 * `null` означає «такого ключа в каталозі немає»: це помилка оголошення, а не
 * порожнє значення. Порожнє лежить у рядку як `null`::jsonb і від відсутності
 * рядка відрізняється.
 */
drop function if exists app.setting_read(bigint, text);
create function app.setting_read(user_id bigint, key text)
returns jsonb
language sql
stable
as $$
  select s.value
  from app.setting_value s
  where s.key = setting_read.key
    and (s.user_id = setting_read.user_id or s.user_id is null)
  -- Свій рядок першим: nulls last саме про це.
  order by s.user_id nulls last
  limit 1;
$$;

/**
 * Усі налаштування однією мапою `{ ключ: значення }` — уже накладені.
 *
 * Клієнтові вони їдуть саме так і саме раз, разом із правами при вході: обидва
 * набори читаються один раз на сесію, обидва не реактивні, і другий round-trip
 * заради того самого моменту нічого не додав би.
 */
drop function if exists app.setting_effective(bigint, jsonb);
create function app.setting_effective(user_id bigint, payload jsonb)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', coalesce((
        select jsonb_object_agg(e.key, e.value)
        from (
          select distinct on (s.key) s.key, s.value
          from app.setting_value s
          where s.user_id = setting_effective.user_id or s.user_id is null
          order by s.key, s.user_id nulls last
        ) e
      ), '{}'::jsonb),
      'rows', '[]'::jsonb
    ),
    'messages', '[]'::jsonb
  );
$$;
