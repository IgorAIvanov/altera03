# TS-команды модели (`commands.ts` в manifest)

Руководство для разработчика: как добавить серверную команду модели на TypeScript,
когда одной SQL-функции недостаточно.

> Это документация для человека. Параллельный инструктаж для AI-агента — в skill
> [`db-function-contract`](../.github/skills/db-function-contract/SKILL.md), раздел
> «TS-backed commands». Держите оба в синхроне.

---

## Когда нужна TS-команда

По умолчанию команда модели — это PostgreSQL-функция `{schema}.{model}_{command}`
(см. [`db-function-contract`](../.github/skills/db-function-contract/SKILL.md)).
Runtime вызывает её по соглашению об именах, никакого кода на сервере писать не надо.

TS-команда — это **escape hatch** для логики, которую неудобно или невозможно
держать в SQL:

- хеширование пароля, обращение к внешнему API, генерация файла (Excel/PDF);
- оркестрация нескольких шагов в одной транзакции с не-SQL побочными эффектами;
- интеграции, которым нужен Deno-рантайм, а не только база.

Если всё это укладывается в чистый SQL — оставайтесь на SQL-функции.

---

## Как это работает

1. В `manifest.json` модели объявляется команда в блоке `commands.ts`, она указывает
   на **TS-файл рядом с моделью** (`module`).
2. `deno task sql:registry` сканирует манифесты и генерирует
   `server/modules/model-runtime/model-registry.generated.ts`: туда попадает
   **статический `import`** вашего файла и привязка `{ model, command, handler }`.
3. На старте `model-registry.ts` собирает реестр; `ModelRuntimeService.execute`
   видит TS-команду в `tsCommands` и вызывает её **вместо** SQL-функции.

Ручной регистрации хендлеров больше нет — `manifest.json` единственный источник
правды. Статический импорт сохраняет типобезопасность и совместимость с
`deno compile` (файл виден компилятору, не грузится по строке в рантайме).

```
manifest.json (commands.ts.recalc.module)
        │  deno task sql:registry
        ▼
model-registry.generated.ts   import ts_<model>_recalc from "../../../app/<family>/<model>/db/<model>.commands.ts"
        │                       { model, command, handler: ts_<model>_recalc }
        ▼
model-registry.ts → ModelRuntimeService.execute → handler(payload, ctx)
```

---

## Быстрый старт: новая TS-команда за 3 шага

Допустим, у модели `invoice` нужна команда `recalc` (пересчёт итогов на сервере).

**1. Объявите команду в манифесте.** `module` — путь относительно папки модели.

```jsonc
// app/document/invoice/manifest.json
{
  "model": "invoice",
  "type": "document",
  "schema": "app",
  "commands": {
    "ts": {
      "recalc": { "module": "./db/invoice.commands.ts" }
    }
  },
  "views": { /* ... */ }
}
```

По умолчанию берётся **default-экспорт**. Если в файле несколько команд — укажите
именованный экспорт:

```jsonc
"recalc": { "module": "./db/invoice.commands.ts", "export": "recalcCommand" }
```

**2. Напишите хендлер** рядом с SQL модели. Сигнатура и контекст — из
`ModelCommandContext`. SQL-доступ приходит **аргументом** (`ctx.db`), не амбиентно.

```ts
// app/document/invoice/db/invoice.commands.ts
import type { ModelCommandContext } from "../../../../server/modules/model-runtime/model-runtime.types.ts";

export default async function recalc(
  payload: Record<string, unknown>,
  ctx: ModelCommandContext,
): Promise<unknown> {
  const id = String(payload.id ?? "");

  return await ctx.db.transaction(async (sql) => {
    await sql`update app.invoice_line set amount = qty * price where invoice_id = ${id}::bigint`;
    const [row] = await sql<{ result: unknown }[]>`
      select app.invoice_get(${ctx.userId}::bigint, jsonb_build_object('id', ${id})) as result
    `;
    return row?.result ?? null;
  });
}
```

**3. Перегенерируйте реестр:**

```bash
deno task sql:registry
```

Команда станет доступна на стандартном маршруте
`POST /api/model/invoice/recalc`, как и любая SQL-команда.

---

## Контракт

- **Сигнатура:** `(payload: Record<string, unknown>, ctx: ModelCommandContext) => Promise<unknown>`.
- **Контекст** (`ModelCommandContext`): `db`, `model`, `command`, `userId`.
  - `ctx.db.sql\`...\`` — запрос, `ctx.db.transaction(async (sql) => …)` — транзакция.
- **Ответ** — тот же envelope, что у SQL-команд (см.
  [`db-function-contract`](../.github/skills/db-function-contract/SKILL.md)):

  ```json
  { "ok": true, "data": { "item": {}, "rows": [], "options": {}, "totals": {} }, "messages": [] }
  ```

- **Валидация** payload — внутри хендлера (бросайте `Error` с человекочитаемым
  сообщением); стандартная проверка `id`/`item` применяется только к SQL-командам
  `save`/`delete`.

---

## Правила и подводные камни

- **Файл команды попадает в server-граф импорта.** Это задумано (логика модели
  живёт рядом с моделью), но из такого файла нельзя тянуть client/Lit-зависимости —
  только server-типы и то, что нужно самому хендлеру.
- **Имя команды — латиница, цифры, underscore** (`^[a-z][a-zA-Z0-9_]*$`). Имена
  должны быть стабильными: на них завязаны фронтенд-вызовы и роутинг.
- **TS-команда перекрывает SQL** с тем же именем: если в `commands.ts` есть
  `recalc`, функция `{schema}.invoice_recalc` для этой команды не вызывается.
- **`module` обязателен.** Старая схема со строковым `handlerKey` и ручным map в
  `model-registry.ts` удалена — генератор упадёт, если у ts-команды нет `module`.
- **Не редактируйте** `model-registry.generated.ts` руками — он перезаписывается
  `deno task sql:registry`.
