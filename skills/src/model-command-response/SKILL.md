---
name: model-command-response
description: Derive the exact shape of a model command's response before consuming it in a screen — never hand-write the interface from memory. Use whenever a component reads `data.rows`, `data.item`, `data.extra` or any field of a command's answer, especially for core commands (menu/current, printPdf) whose SQL lives inside the framework package.
argument-hint: Name the model and command the screen calls, and what the screen needs out of the answer.
metadata:
  audience: app
---

# Response shape of a model command

The **envelope** is fixed and identical everywhere:

```json
{ "ok": true, "data": { "item": …, "rows": [], "options": {}, "totals": {} }, "messages": [] }
```

What is **inside** `item` / `rows` / `extra` is not. It is whatever the SQL function
put there with `jsonb_build_object`, key by key. The runtime does not rename
anything: no snake_case → camelCase conversion happens on the way out. If the
function writes `'route'`, the client receives `route` — not `routePath`.

So: **read the source, do not recall it.** A hand-written interface is
self-consistent, so TypeScript stays green and the screen silently renders
nothing useful.

## How to find the shape (in this order)

**1. Your own model** — the SQL is in the repository:

```
app/<family>/<model>/db/_generated/<model>.crud.gen.sql   ← standard commands
app/<family>/<model>/db/<model>.custom.sql                ← everything else
```

Find `jsonb_build_object(` inside the function and copy the keys.

**2. A core model** (`menu`, `users`, `user_group`, print, attachments) — the SQL
ships inside `@altera/server` as an embedded text map, and after `deno install`
it is a real file on disk:

```
vendor/jsr.io/@altera/server/<version>/sql/core-sql.generated.ts
```

Grep it for the function name (`menu_current`, `user_list`, …). The text is the
same SQL, escaped into a string — the `jsonb_build_object` keys are readable.

**3. Call the command and look.** The screen itself does it through
`bus.request("data.load", { model, command, payload })`; from outside, POST
`/api/model/<model>/<command>` with the session cookie. Printing the envelope
once is cheaper than debugging a component that renders blanks.

## Type it at the call site, and say where it came from

```ts
/** Рядок відповіді `menu/current` (server/sql/menu/db/menu.sql). */
interface MenuRow {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  route: string | null;
}

const envelope = await bus.request("data.load", {
  model: "menu", command: "current", payload: {},
}) as { data?: { rows?: MenuRow[] } } | undefined;
```

`bus.request` is typed generically on purpose — only the caller knows the shape of
the command it invoked. Narrow explicitly, and put the source function in a
comment above the interface so the next reader can re-check it.

For your own models the interface must come from the model's TypeBox schema
instead — see [typebox-model-schema](../typebox-model-schema/SKILL.md). Never
re-declare a row type that already exists there.

## The trap this skill exists for

`menu/current` returns a **flat** list, and the route key is `route`:

```sql
jsonb_build_object(
  'id',       m.path,          -- ланцюжок кодів, не число
  'parentId', m.parent_path,
  'name',     m.name,
  'icon',     m.icon_key,
  'route',    m.route_path     -- null → тека
)
```

A menu component was written against an imagined `{ code, name, routePath,
children }`. Result: every `routePath` was `undefined`, so every item took the
"folder" branch and rendered as a grey section header — nothing was clickable,
and the tree was never built because nothing populated `children`. Types were
green, the request succeeded, the envelope was `ok: true`. The only symptom was
a menu that looked like two headings.

Two lessons encoded here:

- **flat vs nested is part of the contract.** If the answer is flat with
  `id`/`parentId`, the client builds the tree — and decides what to do with an
  orphan (a child whose parent is hidden by permissions should be lifted to the
  root, not dropped);
- **a wrong key name never throws.** It reads as `undefined`, and `undefined`
  usually means "empty" somewhere downstream. Nothing fails loudly, so the only
  defence is deriving the shape rather than assuming it.

## Core shapes worth knowing

| command | what arrives |
|---------|--------------|
| `menu/current` | `rows: { id, parentId, name, icon, route }` — flat, pre-sorted; `route` is a **view route** (`family/model/view`), `null` for a folder |
| `<model>/printPdf` | `data.extra: { fileName, mimeType, pdfBase64 }` — the PDF is base64 in `extra`, not a download URL |
| `<model>/list` | `rows` + `totals: { count, page, pageSize }`; the effective query mirrors back into `$query` |
| `<model>/get` | `item` (or `null` when not found) + `options` |
| `<model>/lookup` | `rows` of `{ id, name, … }` — only the fields marked `x-lookup` |

Attachment fields are the one place where the runtime **does** rewrite a value:
SQL returns the raw `access_key` in `token` / `<field>Token`, and the runtime
swaps it for a session-scoped token. The key name stays as SQL wrote it.

## Related

- [db-function-contract](../db-function-contract/SKILL.md) — the other side: writing the function that produces this answer.
- [model-form-root](../model-form-root/SKILL.md) — how `data` becomes `$root` in a screen.
- [model-list-form](../model-list-form/SKILL.md) — list screens, where `rows`/`totals` are handled by the base class.
