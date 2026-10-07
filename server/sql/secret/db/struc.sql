-- Секрети моделей: токени API банків, ключі зовнішніх сервісів.
--
-- Окрема таблиця, а не колонка моделі — і це головне рішення пакета. Рядок
-- моделі секрету не містить узагалі, тож його не віддасть жоден шлях читання:
-- згенерований get/list, рукописний SQL застосунку, вивантаження в книгу,
-- друк, канал агента. Зашифрована колонка вимагала б, щоб кожен із цих шляхів
-- її пропускав, і один забутий виносив би шифротекст назовні.
--
-- Шифрує й розшифровує рантайм (server/modules/secret), ключем з оточення
-- (SECRET_KEY). SQL ключа не бачить і бачити не мусить: тут лише байти.
--
-- Власник — пара (owner_model, owner_id), як у app.attachment. Зовнішнього
-- ключа на власника немає (власник поліморфний); запис моделі позначається на
-- видалення, а не знищується, тож секрет живе стільки ж, скільки рядок.
create table if not exists app.secret (
  owner_model varchar(80)  not null,
  owner_id    bigint       not null,
  -- Поле схеми моделі з анотацією x-secret (camelCase, як у payload).
  field       varchar(80)  not null,
  -- AES-256-GCM: 12 байт IV + шифротекст із тегом. Додаткові дані (AAD) —
  -- «модель:id:поле», тож перенесений в інший рядок шифротекст не розшифрується.
  iv          bytea        not null,
  cipher      bytea        not null,
  -- Яким ключем зашифровано: перші 16 hex SHA-256 ключа. Потрібно для заміни
  -- ключа — старий (SECRET_KEY_PREVIOUS) ще читає, новий уже пише.
  key_id      varchar(16)  not null,
  updated_by  bigint       references app.users(id),
  updated_at  timestamptz  not null default now(),
  constraint pk_secret primary key (owner_model, owner_id, field)
);
