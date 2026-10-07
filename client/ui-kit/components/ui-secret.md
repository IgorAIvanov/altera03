# `<ui-secret>` — поле-секрет

Токен API банку, ключ зовнішнього сервісу — поле з анотацією `x-secret` у схемі
запису. Значення секрету форма не бачить ніколи: сервер тримає його
зашифрованим в `app.secret` і віддає лише стан. Тому контрол показує «задано ·
змінено 07.10.26 14:05» або «не задано» і дві дії — задати новий чи очистити.
Поле вводу (`type="password"`) з'являється лише на час набору.

```ts
${this.renderField("token", html`
  <ui-secret
    .value=${item.token}
    ?is-set=${item.tokenSet}
    changed-at=${item.tokenChangedAt ?? ""}
    ?disabled=${this.readonlyMode}
    @value-changed=${(e: CustomEvent) => { this.$root.item.token = e.detail.value; }}
  ></ui-secret>`)}
```

| Атрибут / властивість | Що це |
|---|---|
| `.value` | намір: `undefined` чи `""` — не змінювати, рядок — записати, `null` — очистити |
| `is-set` | `<поле>Set` з відповіді `get` |
| `changed-at` | `<поле>ChangedAt` (ISO з `Z`), показується датою з часом |
| `disabled` | режим перегляду |
| `placeholder` | підказка в полі вводу |

Подія `value-changed` (`detail.value`) — на кожну зміну наміру, включно з
відміною (знову `undefined`). Esc у полі вводу — відміна.

Схема форми оголошує супутні поля сама — їх дописує рантайм, у таблиці їх немає:

```ts
token:          Type.Optional(Type.Union([Type.String(), Type.Null()], { "x-secret": true })),
tokenSet:       Type.Optional(Type.Boolean({ "x-transient": true })),
tokenChangedAt: Type.Optional(Type.Union([Type.String(), Type.Null()], { "x-transient": true })),
```

Записати секрет може лише людина на екрані: виклик персональним токеном
(агент, MCP) рантайм відбиває. Деталі — `docs/secret.md`.
