# Підсистема вкладень (бінарні об'єкти)

Зображення й прикріплені файли для будь-якої моделі — і документа, і довідника.
Зовнішнє сховище не використовується: байти лежать у PostgreSQL (`bytea`).

## Чому окремий канал, а не команда моделі

`POST /api/model/:model/:command` возить JSON. Бінарник у ньому їде або base64
(+33% і зайве кодування), або ніяк. Але головне інше: браузеру зображення
потрібне як звичайний GET-URL у `<img src>`, куди не почепиш заголовок
`Authorization`. Тому:

| | канал | авторизація |
|---|---|---|
| метадані вкладень (список, прив'язка, видалення) | команди моделі `attachment` | як у будь-якої моделі |
| байти (віддача / приймання) | `GET/POST /api/blob` | токен доступу в URL |

## Токен доступу

Право доступу несе сам URL. Токен — це підписані HMAC-SHA256 претензії:
id вкладення, його `access_key`, користувач, сесія, термін дії.

```
/api/blob/42?token=eyJhIjoiNDIiLCJrIjoi….<підпис>
```

Що це дає:

- **не підробити й не вгадати** — id сусіднього вкладення без підпису марний;
- **різний у різних сесіях** (як в A2v10) — сесія входить у претензії, і на
  кожен GET перевіряється, що вона жива; вихід із системи знецінює посилання;
- **ротація `access_key`** (`update app.attachment set access_key =
  gen_random_uuid()`) миттєво знецінює всі токени конкретного вкладення;
- **термін життя** — `BLOB_TOKEN_TTL_HOURS` (за замовчуванням 12 годин).

Секрет підпису — `BLOB_TOKEN_SECRET`, інакше `JWT_SECRET` (legacy-фолбек). Якщо
не задано жодного, генерується разовий ключ процесу (dev): після рестарту старі
посилання перестають діяти, і в лог іде попередження. Плейсхолдер
`change-me-in-production` з `.env.example` — загальновідомий рядок, з ним токен
підпише хто завгодно, тому в продуктивному оточенні `configFromEnv()` з таким
(або відсутнім) секретом валить старт сервера; у dev — лише попередження.

### Як токен потрапляє у відповідь

SQL-функції моделей віддають **сирий `access_key`** у полі `token` або
`<field>Token`. Рантайм (`ModelRuntimeService`) перед відправкою проходить
конверт і міняє такі поля на підписаний токен — це прямий аналог типу `!Token`
в A2v10. Id вкладення береться з поля-побратима: `token` → `id`,
`logoToken` → `logoId`. Якщо побратима немає, поле обнуляється — сирий ключ
доступу назовні не виходить ніколи.

## Схема даних

Одна таблиця `app.attachment` на весь застосунок (пакет ядра `@core/attachment`, `server/sql/attachment/`):

| колонка | навіщо |
|---|---|
| `id` | ключ; його зберігає модель у своєму полі-посиланні |
| `access_key uuid` | база токена доступу |
| `name`, `mime`, `size`, `sha256` | метадані; `sha256` іде і в ETag |
| `stream bytea` | самі дані |
| `owner_model`, `owner_id` | власник: ключ моделі + id запису |
| `created_by`, `created_at` | аудит |

Два способи використання — обидва однією таблицею:

1. **Поле-посилання** (одне зображення): у моделі колонка `logo_id bigint
   references app.attachment(id)`. Так зроблено логотип організації.
2. **Список вкладень** (багато файлів): рядки шукаються за
   `owner_model = 'invoice' and owner_id = <id>`. Так зроблено вкладення
   накладної. Модель нічого не зберігає — зв'язок тримає саме вкладення.

### «Сироти»

Файл завантажують до того, як запис отримав id (нова форма). Такі вкладення
створюються без власника, і їх прибирає `app.attachment_gc(hours)` — планова
команда, не рантайм.

Щоб корисний файл не потрапив під очищення, після збереження запису
вкладення треба **прив'язати**: `<ui-image>` робить це сам, щойно бачить
`owner-id`; вручну — `bindBlobOwner()` (клієнт) або команда
`attachment/save` з `{ item: { id, ownerModel, ownerId } }`.

## SQL-контракт

Функції вкладень свідомо діляться на дві групи.

**Бінарні** (їх кличе `server/modules/blob`, контракт `(user_id, payload jsonb)`
тут не діє — байти в jsonb возити немає сенсу):

```sql
app.attachment_load(user_id bigint, attachment_id bigint)
  returns table (id, name, mime, size, sha256, access_key, stream)

app.attachment_update(p_user_id, p_name, p_mime, p_stream,
                      p_owner_model, p_owner_id, p_sha256)
  returns table (id bigint, access_key uuid)
```

Це прямі аналоги процедур `.Load` / `.Update` з A2v10. Поля `BlobName`
(зовнішнє сховище) немає: якщо колись знадобиться S3, воно додається міграцією,
і `attachment_load` починає повертати його замість `stream`.

**Модельні** (звичайний контракт моделі, кличе `ModelRuntimeService`):

| команда | payload | що робить |
|---|---|---|
| `attachment/list` | `{ ownerModel, ownerId }` | список вкладень запису |
| `attachment/get` | `{ id }` | метадані одного вкладення |
| `attachment/save` | `{ item: { id, ownerModel?, ownerId?, name? } }` | прив'язка до власника, перейменування |
| `attachment/delete` | `{ id }` | видалення |

Моделі `attachment` немає маніфесту: вона інфраструктурна, живе в
`@core/attachment` і працює на стандартному авто-маршруті
`{schema}.{model}_{command}`.

## HTTP

### `POST /api/blob/upload`

`multipart/form-data`: `file` (обов'язково), `ownerModel`, `ownerId`
(необов'язкові). Повертає звичайний конверт із `data.item = { id, token, name,
mime, size }`. Ліміт розміру — `BLOB_MAX_SIZE_MB` (за замовчуванням 10).

**Id потрапляє в модель лише при збереженні самої форми** — до того це просто
число в пам'яті клієнта.

### `GET /api/blob/:id?token=…&disp=inline|attachment`

Віддає байти. Заголовки, які тут не косметика:

- `Content-Disposition: attachment` для всього, крім білого списку типів
  (зображення + PDF). Інакше користувач заллє `.html` і відкриє його на нашому
  origin — це готовий XSS.
- `X-Content-Type-Options: nosniff` і `Content-Security-Policy: sandbox` — з тієї ж причини.
- `Cache-Control: private` — URL містить токен, у спільні кеші йому не можна.
- `ETag` = id + sha256, підтримується `304`.

Діапазонні запити (`Range`) не реалізовані: підсистема розрахована на
документи й зображення, а не на стрімінг відео.

## Клієнт

`client/shared/blob.ts` — `blobUrl()`, `uploadBlob()`, `bindBlobOwner()`,
`isImageMime()`, `formatFileSize()`.

Компоненти ui-kit:

- [`<ui-image>`](../client/ui-kit/components/ui-image.md) — одне зображення з
  прев'ю (логотип, фото, скан);
- [`<ui-attachments>`](../client/ui-kit/components/ui-attachments.md) — список
  файлів запису.

## Як додати вкладення новій моделі

**Одне зображення:**

1. `db/struc.sql` (+ `db/migration.sql` для існуючих баз):
   `logo_id bigint references app.attachment(id) on delete set null`.
2. У `<model>.schema.ts` два поля:
   ```ts
   logoId: Type.Optional(Type.Union([Type.String(), Type.Null()], {
     "x-db-type": "bigint", "x-blob": true, default: null,
   })),
   logoToken: Type.Optional(Type.Union([Type.String(), Type.Null()], {
     "x-transient": true, default: null,
   })),
   ```
   `x-blob` велить генератору віддавати поруч ключ доступу (`logoToken`);
   `x-transient` каже, що колонки під токен немає — інакше генератор шукав би
   `logo_token` у таблиці.
3. У формі — `<ui-image>` з `owner-model` і `.ownerId=${item.id}`.
4. `deno task model:build`.

**Список файлів:** нічого в моделі не змінюється — у формі ставиться
`<ui-attachments owner-model="<модель>" .ownerId=${item.id}>`.

## Змінні середовища

```
BLOB_TOKEN_SECRET=...   # секрет підпису токенів; інакше береться JWT_SECRET
BLOB_TOKEN_TTL_HOURS=12 # термін життя токена
BLOB_MAX_SIZE_MB=10     # максимальний розмір завантаження
```
