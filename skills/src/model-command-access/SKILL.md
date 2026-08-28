---
name: model-command-access
description: Declare the permission a model command requires in manifest.json (commands.access) so the runtime can enforce it. Use whenever adding or changing a model command that is not one of list/get/save/delete/lookup (or post/unpost on documents) — including every TS command, report index, print data command and copy/import command.
argument-hint: Name the model and the command, and say what the command does (reads / creates / modifies / deletes / acts on the caller's own data).
metadata:
  audience: app
---

# Model Command Access Skill

Use this skill when:
- adding a non-standard command to a model (SQL or TS)
- a command returns `501 … не оголошує потрібного права`
- deciding whether a command should be restricted or open to any signed-in user
- reviewing a manifest that declares `commands.sql` / `commands.ts`

Deep dive (framework repository, not part of an application): `docs/access-control.md`.

## The rule

A permission is the triple **group → model → action**. The runtime resolves the
action a command needs and folds `app.access_can(user_id, model, action)` into the
same `select` that calls the command. **Standard commands need no declaration.
Every other command must declare one, or it will not run at all.**

| Command | Action — derived, do not declare |
|---|---|
| `list`, `get`, `lookup` | `view` |
| `save` | `create` when `payload.item.id` is empty, else `edit` |
| `delete` | `delete` |
| `post`, `unpost` | `post` / `unpost` — only when the manifest says `type: "document"` |

Everything else — `index`, `printData`, `current`, `copy`, `setPassword`, any
`commands.ts` handler — is non-standard.

## What to write

Add the command to `commands.access` in the model's `manifest.json`. The block is
shared by SQL and TS commands: declaration is keyed by command name, not by how the
command is implemented.

```json
{
  "model": "menu",
  "commands": {
    "sql": { "current": "menu_current", "copy": "menu_copy" },
    "access": { "current": "authenticated", "copy": "create" }
  }
}
```

Then run `deno task sql:registry` — the declaration is copied into
`app/_generated/model-registry.generated.ts` as an `access` map. Without that step the
runtime still sees the command as undeclared.

### `commands` has exactly three keys

`sql`, `ts`, `access` — nothing else. The block is plain JSON, so a command written one
level too high parses fine and reaches nothing:

```json
"commands": { "fill": { "access": "edit" } }
```

The generator reads only the three keys, so the model lands in the registry as though it
had no non-standard commands at all, and the runtime refuses the call. Everything else
stays green — the SQL function is in the database and works, a demo dataset that calls it
directly passes, `deno task check` passes, publishing passes. Only pressing the button
shows it.

Since tools 0.13.26 this is a generation error rather than silence, and the same check
rejects an `access` value outside the runtime's vocabulary — `view`, `create`, `edit`,
`delete`, `post`, `unpost`, `authenticated`. A string like `"vat_compensating.update"` can
be satisfied by no permission row that exists, so it is a typo, not a strict policy.

## Choosing the action

| What the command does | Declare |
|---|---|
| reads model data (report, selection, print data) | `view` |
| creates a record (copy, import) | `create` |
| modifies an existing record (recalculate, set password, re-post) | `edit` |
| deletes | `delete` |
| posts / unposts a document | `post` / `unpost` |
| returns something *about the caller* | `authenticated` |

When torn between `view` and `edit`, pick `edit`. Erring strict produces a clear user
complaint; erring loose produces nothing.

### `authenticated` — narrow, deliberate

`"authenticated"` means the model permission is not checked at all. Use it **only** for
self-service commands: ones whose result depends on who is asking and grant nothing
beyond what that person already has.

The canonical case is `menu/current` — every sign-in calls it, and requiring `view` on
model `menu` would leave users without a menu unless they could also administer menus.

Do not reach for `authenticated` because picking an action is awkward. If the command
touches other people's data or writes anything, it needs a real action.

## Fail-closed — do not work around it

An undeclared non-standard command returns 501 with the exact fix in the message. That
is deliberate: a forgotten declaration surfaces on the first call, a silent allow never
surfaces. Never "fix" this by loosening the command to `authenticated` just to make the
error go away.

A command the registry never saw returns 404 instead — and the message names the manifest
key that declares it, because the usual cause is the shape above, not a misspelled name.

## Derived automatically

`printPdf` needs no declaration when the manifest has a non-empty `prints` block — the
generator emits `printPdf: "view"` alongside the handler it already derives. An explicit
declaration overrides it.

Declaration always beats derivation, including for standard commands: `"access": {
"list": "edit" }` really does make `list` require `edit`. Rarely useful — but if a model
is sensitive enough that listing it is privileged, this is the lever.

## Reaching the agent

Declaring the permission makes a command **callable**. It does not make it **visible**:
the external agent — and the MCP wrapper over it — offers only what the model lists in
`agent.allowCommands`, on top of the default set derived from `type`.

```json
"agent": { "allow": true, "allowCommands": ["list", "get", "save", "delete", "at"] }
```

The list both adds and subtracts. A name from `commands.sql` or `commands.ts` joins the
default set; a standard name left out of the list is withheld. Omit `allowCommands`
altogether and the model keeps the default — standard commands only, never a custom one.
That is deliberate: `commands.access` says *this command may run with this permission*,
not *show it to the agent*.

A name the generator cannot deliver now fails `sql:registry` — either the model declares
no such command, or the command has no `commands.access` entry and would answer 501 to
every call. Until that check existed the name was dropped in silence, so a manifest could
look as though it had opened the command while the agent answered
`Команда 'at' не оголошена для агента`. Nothing else said a word: the manifest was valid,
`altera_describe` returned `[]`, and the screen calling that same command worked.

If the command has its own payload, export `<Model><Command>PayloadSchema` from
`<model>.schema.ts` — that is what the agent reads to learn the fields. Without it the
command is still offered, but as an object of unstated shape, and the agent has to guess.

## Verify

```bash
deno task sql:registry
```

Then call the command twice — once as a user who holds the action, once as one who does
not. Any client will do: the screen itself, `curl` against
`POST /api/model/<model>/<command>`, or a dev wrapper over the in-process app
(`@altera/tools/app-client`) if the project has one.

The unprivileged call must come back as an envelope, not an exception:

```json
{ "ok": false, "data": { … }, "messages": ["Немає права «create» на модель «menu»"] }
```

A denial is `ok:false` with 200 — the same envelope as any other refusal. Only "no such
command" is an exception (404/501). Do not add HTTP status handling for denials on the
client.

## Checklist

1. Implement the command (SQL function `{schema}.{model}_{command}(bigint, jsonb)` or TS module).
2. Declare it in `commands.sql` or `commands.ts`.
3. **Declare its permission in `commands.access`.**
4. Name it in `agent.allowCommands` if the agent should reach it too.
5. `deno task sql:registry`.
6. Confirm the target groups actually hold that action (`model = '*'` covers every model).
7. Call it as an unprivileged user and confirm the denial envelope.

## Related

- [`db-function-contract`](../db-function-contract/SKILL.md) — the SQL side of a command.
- Framework repository (not part of an application): `docs/ts-model-command.md` — TS commands;
  `docs/access-control.md` — the permission model in full.
