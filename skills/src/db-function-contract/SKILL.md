---
name: db-function-contract
description: Define PostgreSQL function contracts for models that use List, Get, Save, Delete, and Lookup with JSONB payloads and JSONB results.
argument-hint: Describe the model and the shape of list, item, options, and save data.
metadata:
  audience: app
---

# Database Function Contract Skill

Use this skill when:
- defining model-level PostgreSQL functions
- standardizing JSONB request and response envelopes
- replacing inline backend SQL with function calls
- designing multidataset responses

## Generated CRUD (default path — do not hand-write the five)

Standard `list / get / save / delete / lookup` are produced **deterministically by a
build script**, not written by hand and not written by the agent. The single source
of truth is the model's `<model>.schema.ts` (TypeBox) + `manifest.json`. The generator
(`deno task sql:gen <family>/<model>`) reads the schema and emits
`db/_generated/<model>.crud.gen.sql` — a committed source file, not a build product.

So when adding a model, the agent writes **only**:
- `manifest.json`, `<model>.schema.ts`,
- `db/struc.sql` (DDL),
- UI components,
- and a `db/<model>.custom.sql` **only** if a command needs non-standard logic.

Then run, in this order:

```bash
deno task sql:gen <family>/<model>   # only after the schema changed
deno task sql:registry && deno task sql:assemble && deno task sql:publish
```

**Schema annotations the generator reads** (in `<model>.schema.ts`):
- `x-search: true` — field participates in the `ilike` search (fallback: all string fields).
- `x-list.sortable: true` — field is allowed in `sortBy`.
- `x-lookup: true` — field shown in the picker.
- `x-ref: { model, fk?, display?, as?, sortable?, searchable? }` — reference to another
  model: stores the FK id, returns a nested `{id, <display>}` object in get/list, sorts
  and searches by the target's display column.
- `x-table: { table, parentFk, orderBy? }` — tabular part (master-detail); the array's
  item schema describes the line columns (which may themselves carry `x-ref`).
- `x-db-type` / `x-db-col` — column type cast / column-name override.

**Override semantics (standard vs custom):** decided by file presence, per function.
The assembler concatenates, in order, `db/_generated/<model>.crud.gen.sql` then
`db/<model>.custom.sql`. Both use `drop function … (argtypes); create function …`, so a
function present in the custom file overrides the generated one; the other four stay
generated. The runtime is unchanged — it still calls `{schema}.{model}_{command}`.

**Documents:** the generator emits `save` as `MERGE` (header upsert + one `MERGE` per
tabular part, with the mandatory `when not matched by source and <parentFk> = v_id`
guard). `post`/`unpost` are emitted as stubs — implement real posting in
`db/<model>.custom.sql`.

Hand-write a SQL function only as an exception (non-standard logic), and put it in
`db/<model>.custom.sql`. Deep dive on the generator (framework repository, not part of
an application): `docs/sql-codegen.md`.

The sections below describe the *contract* every command (generated or custom) must honor.

## Standard command names

Use these names consistently everywhere: SQL functions, backend command routing, frontend API calls, and model config files.

| Command   | Purpose                                              |
|-----------|------------------------------------------------------|
| `list`    | Paginated or filtered list of records                |
| `get`     | Load a single record by id (for form)                |
| `save`    | Create or update a record (upsert semantics)         |
| `delete`  | Delete a record by id                                |
| `lookup`  | Search records for picker / autocomplete             |
| `post`    | Post a document (accounting posting)                 |
| `unpost`  | Reverse the posting of a document                    |

Extra commands follow the same naming style: `nextCode`, `nextNumber`, `<verb><Noun>`.

## Core rules

- Standard catalog-style models have a base function contract: list, get, save, delete, lookup.
- Document models keep the same base contract and add `post` and `unpost` when the manifest declares `type: "document"`.
- Information-register models are a separate family. Do not force them into catalog CRUD naming if the real contract is period-based or slice-based. Define the function set from the register semantics first: for example history, actual-on-date, slice-last, upsert, or bulk-upsert.
- Functions accept `userId` as the first parameter and a JSONB payload as the second parameter unless there is a strong reason not to.
- Functions return JSONB.
- `lookup` functions used for picker / autocomplete should return business-facing labels. Prefer `name` as the picker `label` by default; keep technical codes in separate fields only when the UI explicitly needs them.
- For new models, function contracts should assume sequence-based technical primary keys by default, with UUID only for explicit exceptions.
- Backend calls functions by name and does not embed screen-oriented SQL.
- Standard function calls are reachable through a generic backend runtime route `/api/model/<model>/<command>`.
- Extra model commands may be implemented either as extra SQL functions or as TS handlers declared in the model's `manifest.json` under `commands.ts`.
- When a function signature changes, the publication script should drop the legacy signature before creating the new one.
- Result JSON must be explicit about item data, rows, options, totals, messages, and metadata.

### SQL never constructs empty entities

`get` for a missing or null id returns **`item: null`** — do *not* hand-build a well-formed empty
object so the form has something to show. Defaults are owned by the model's TypeBox schema and
applied on the client by `Value.Create` before the first render; a form for a new record never calls
`get` at all. Duplicating the defaults in SQL only guarantees they drift from the schema.

What SQL must still guarantee: never raise on a missing/invalid id (the command is reachable by the
agent and by direct API calls, not only by the form) and always return a valid envelope.

The client relies on one more property of the envelope: **every data key is always present**, with
`null` / `[]` / `{}` in the ones the command does not use (`list` → `item: null`, `get` → `rows: []`).
Because of that, a top-level `null` unambiguously means "no data for this key", and the frontend
`assign()` skips it instead of overwriting state. Keep emitting the full key set.

See [model-form-root](../model-form-root/SKILL.md).

## SQL function naming

The schema prefix comes from the `schema` field in the model's `manifest.json`.  
The model name comes from the `model` field in the same file.

```json
{ "model": "bank", "type": "catalog", "schema": "app" }
```

Pattern: `{schema}.{model}_{command}`

```
{schema}.{model}_list
{schema}.{model}_get
{schema}.{model}_save
{schema}.{model}_delete
{schema}.{model}_lookup
{schema}.{model}_post          -- document models only
{schema}.{model}_unpost        -- document models only
{schema}.{model}_{extra}       -- extra SQL commands
{schema}.catalog_next_code     -- shared catalog code generation
```

Register-oriented naming examples:
```
{schema}.{model}_history
{schema}.{model}_actual
{schema}.{model}_slice_last
{schema}.{model}_upsert
{schema}.{model}_bulk_upsert
```

## Recommended function signatures

```sql
{schema}.{model}_list   (user_id bigint, payload jsonb) returns jsonb
{schema}.{model}_get    (user_id bigint, payload jsonb) returns jsonb
{schema}.{model}_save   (user_id bigint, payload jsonb) returns jsonb
{schema}.{model}_delete (user_id bigint, payload jsonb) returns jsonb
{schema}.{model}_lookup (user_id bigint, payload jsonb) returns jsonb
```

## Response envelope

```json
{
  "ok": true,
  "data": {
    "item": null,
    "rows": [],
    "options": {},
    "totals": {},
    "extra": {}
  },
  "messages": [],
  "meta": {}
}
```

- `data.item` — single record (get, save)
- `data.rows` — list of records (list, lookup)
- `data.options` — dropdown / select options needed by the form (get response), e.g. `data.options.currencies`, `data.options.statuses`
- `data.totals` — aggregates: count, page, pageSize, sums
- `data.extra` — auxiliary data: generated code, generated number, warnings
- `messages` — user-visible messages (errors, warnings, info)
- `meta` — technical metadata (execution time, etc.)

## Workflow

1. Identify the model family before naming any functions.
2. For catalog-style models, define what the model needs for list, form, picker, and deletion flows and map that into List, Get, Save, Delete, and Lookup.
3. For information registers, define the contract from period, dimensions, resources, and required read/write scenarios.
4. If the catalog needs code generation, decide whether it should call `app.catalog_next_code(...)` and which parameters control numbering: schema, table, code column, pad length, and optional prefix.
5. Keep the JSON contract stable and explicit.
6. Add extra functions (post, unpost, validate, calculate) when the model needs domain commands.
7. Ensure returned data is convenient for the screen and still auditable.

## Lookup guidance

- For standard lookup results, return rows shaped as `id` plus `name` (plus any extra searchable fields).
- The default `label` shown in the picker should be the entity `name` only.
- Do not concatenate `code`, login, article, or other technical identifiers into `name` unless there is an explicit UX reason.
- If a lookup must expose extra searchable or diagnostic fields, return them as separate JSON properties.
- For hierarchical catalogs, keep structural markers such as `[Група]` when needed to distinguish folders from items.

## Auto numbering pattern

- Shared catalog numbering: `app.catalog_next_code(user_id, payload)` — parameters: schema, table, code_column, pad_length, optional prefix.
- Frontend forms call `nextCode` command to prefill the code field for new records; the `save` function must still generate the code when the payload arrives without one.
- For document numbers, expose a `nextNumber` command; use a model-local SQL function when numbering depends on year, document type, organization, or other document-specific rules.
- For document saves, the `save` function should regenerate the number when `item.number` is empty.
- If document numbers are unique only within a year, both `nextNumber` and the `save` uniqueness check must use the document date year as part of the scope.

## Backend dispatch

- Standard commands are dispatched by convention from the generic route `/api/model/<model>/<command>`.
- For `type: "document"`, the generic runtime also resolves `post` and `unpost` by convention.
- Do not create a dedicated backend module for a model that only uses list, get, save, delete, and lookup.
- Declare a TS-backed command in the model's `manifest.json` when the model needs extra commands, special validation, or TS-side orchestration.
- Keep extra command names stable because frontend callers and generic routing depend on them directly.
- **Every command beyond `list`/`get`/`save`/`delete`/`lookup` (and `post`/`unpost` on
  documents) must also declare the permission it requires** in `commands.access`, or the
  runtime refuses to run it. See [`model-command-access`](../model-command-access/SKILL.md).

## TS-backed commands

Use a TS handler only when the command cannot be expressed as a plain SQL function
(password hashing, external API calls, file generation, multi-step orchestration with
non-SQL side effects). Otherwise stay on the SQL function contract above.

- Declare the command in the model's `manifest.json` under `commands.ts`, pointing at a
  TS file colocated with the model. `module` is the path relative to the model folder;
  `export` is optional (defaults to the `default` export):

  ```jsonc
  "commands": {
    "ts": {
      "recalc": { "module": "./db/<model>.commands.ts" }
    }
  }
  ```

- The handler signature is `(payload, ctx: ModelCommandContext) => Promise<unknown>`.
  The SQL context arrives as an argument: `ctx.db.sql\`...\`` and
  `ctx.db.transaction(...)`. `ctx` also carries `model`, `command`, `userId`.
- TS-backed commands return the same response envelope shape as SQL-backed commands.
- A TS command overrides the SQL function of the same name for that command.
- `deno task sql:registry` regenerates `model-registry.generated.ts` from the manifests
  (it emits a static import + binding). There is no manual handler registration.
- The command file joins the server import graph — import only server-safe modules
  (no client/Lit dependencies).
- Standard `lookup`/`list`/`get`/`save`/`delete` stay on SQL functions by convention;
  do not turn them into TS commands without a real reason.
- Declare the command's permission in `commands.access` — a TS command is non-standard by
  definition, and an undeclared command returns 501 instead of running. Details and how to
  pick the action: [`model-command-access`](../model-command-access/SKILL.md).

Deep dive (framework repository, not part of an application): `docs/ts-model-command.md`.
