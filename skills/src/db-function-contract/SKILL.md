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
- `x-db-type` / `x-db-col` — column type cast / column-name override. The type is a bare
  name from a closed list — `bigint`, `int`, `integer`, `numeric`, `json`, `jsonb`, `date`,
  `timestamp`, `timestamptz`, `text`, `varchar`. Precision and length belong to the DDL:
  `numeric(10,2)` here is a generation error, not a cast.

**Override semantics (standard vs custom):** decided by file presence, per function.
The assembler concatenates, in order, `db/_generated/<model>.crud.gen.sql` then
`db/<model>.custom.sql`. Both use `drop function … (argtypes); create function …`, so a
function present in the custom file overrides the generated one; the other four stay
generated. The runtime is unchanged — it still calls `{schema}.{model}_{command}`.

**Documents:** the generator emits `save` as `MERGE` (header upsert + one `MERGE` per
tabular part, with the mandatory `when not matched by source and <parentFk> = v_id`
guard). `post`/`unpost` are emitted as stubs — implement real posting in
`db/<model>.custom.sql`.

**A `not null default` column has to be sent explicitly.** The generated `save` builds
its `MERGE` source from `jsonb_to_recordset`, so a key that is **absent** from the
payload arrives as an explicit `null` — and an explicit `null` does not trigger the
column default:

```
null value in column "rate" of relation "supplier_invoice" violates not-null constraint
```

`not null default 1` in the DDL does not save an API call that omits `rate`. Forms never
hit this — `Value.Create` seeds `$root` from the schema, so every field of the schema is
in the payload; the first call from the side — the agent, `deno task api`, an import —
does. Give the field a `default` in the TypeBox schema (so it is at least declared in one
place both sides read) and treat the DDL default as what it is: a value for rows written
around the API, not a substitute for the key.

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
| `delete`  | **Mark** a record for deletion by id (does not destroy it) |
| `undelete`| Lift the deletion mark                                |
| `lookup`  | Search records for picker / autocomplete             |
| `post`    | Post a document (accounting posting)                 |
| `unpost`  | Reverse the posting of a document                    |

Extra commands follow the same naming style: `nextCode`, `nextNumber`, `<verb><Noun>`.

## Core rules

- Standard catalog-style models have a base function contract: list, get, save, delete, lookup.
- Document models keep the same base contract and add `post` and `unpost` when the manifest declares `type: "document"`.
- Information registers (`type: register`) get the generated CRUD — `list`, `get`, `save`,
  `delete` — like a catalog, minus `lookup`: nothing references a register row, so there is
  nobody to pick it in a picker, and no `LookupRowSchema` is required. What generation does
  not give is the register's own reading — `_at` (value on a date), `_history`, `_set`:
  those are period-based, they are yours to write, and they go in `db/<model>.custom.sql`.
  Note that `delete` on a register is **physical**: the generator branches on the presence
  of an `isDeleted` field, not on the model type, and a register normally has none — a row
  marked as deleted would silently distort a "latest value on date" slice.
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
{schema}.{model}_undelete
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

## Messages the user reads are named, not written

The server does not translate text and must not try: the user's language lives in the
browser, not on the server. So any message a **person** will read is emitted as a marker
that the client expands — `@[key]`, optionally followed by a JSON object of named
substitutions:

```sql
raise exception '@[invoice.postNoAmount]';

raise exception '@[core.debitAccountNotFound]%',
  jsonb_build_object('account', p_debit_account)::text;

-- a field error still binds to the form field
raise exception '@[common.fieldRequired]' using column = 'code';
```

The JSON tail — not `|key=value` — because substituted values are user data (an account
name, a counterparty) and any separator will eventually appear inside one.

A string **without** a marker is passed through untouched, and that is the point: it is
how a message for the user is told apart from a diagnostic for the developer.
`'attachment_save: id обов''язковий'` should never reach a person, so do not mark it.
Mark deliberately, only where the message really lands in a form banner or a dialog.

The key must exist in the locale files, in **every** language — a named key with no
translation reaches the screen as `invoice.postNoAmount`, which is worse than untranslated
text. Add it to the model's own `_locales/<code>.json` and run `deno task locales:build`;
framework-wide keys (`common.fieldRequired`, `core.*`) already ship inside `@altera/client`.
A test scans the SQL and fails on a key that has no translation.

TS-backed commands follow the same rule: `fail("@[user.notFound]")`, and with parameters
`` fail(`@[user.passwordTooShort]${JSON.stringify({ min: 8 })}`) ``.

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


## `delete` marks, it does not destroy

The generated `delete` sets `is_deleted = true`; `undelete` clears it. Nothing is
removed from the database.

This is not politeness — it is the only thing that makes a mistaken click
recoverable. A hard delete of a posted document takes its lines and its register
entries with it, and there is nowhere to get them back from.

Consequences you must keep in mind when writing SQL by hand:

- **`list` shows marked records**, `lookup` hides them. If `list` filtered them out too,
  the mark would be indistinguishable from disappearance and the user could never lift it.
- **the row carries `isDeleted`** so the list can draw the status glyph; add it to
  `<Model>RowSchema`.
- documents mark `app.document` (the header owns the record), catalogs mark their own
  table.
- physical deletion is a **separate** operation that must check references and refuse —
  it does not exist yet.

`undelete` is a standard command: the runtime knows it and maps it to the `delete`
permission, so it needs no `commands.access` entry.

## One hook runs before every write to a document header

A closed-period lock, "who may post back-dated documents", any "may this document
be touched at all" rule — these must hold on **every** path that writes
`app.document`: `save` of any document model, `post` / `unpost`, the delete mark,
and every model added later. Writing the check into each command means it holds
where nobody forgot; putting your own trigger on `app.document` means adding an
object to a table the core owns, which the core knows nothing about.

So the core calls one hook, from its own trigger. You switch it on by **creating
the function** — there is nothing to register:

```sql
create function app.doc_before_write(
  p_user_id bigint, p_op text, p_doc jsonb, p_prev jsonb
) returns void
language plpgsql
as $$
begin
  if p_op in ('insert', 'update', 'post', 'unpost')
     and (p_doc->>'doc_date')::date <= app.period_lock_date(p_user_id) then
    raise exception '@[app.periodLocked]%',
      jsonb_build_object('date', p_doc->>'doc_date')::text;
  end if;
end $$;
```

- **`p_op` is the application's word, not SQL's:** `insert`, `update`, `post`,
  `unpost`, `delete` (the mark), `undelete`, `purge` (a physical row delete). The
  core has to name it, because `TG_OP` cannot: posting and marking for deletion
  are both `update`.
- **rows arrive as JSONB, not as an id.** On insert there is nothing to read yet,
  and a check needs the fields themselves — the date, the organization.
  `p_prev` is the state before the write, so moving a document *into* a locked
  period is visible too.
- **it is a guard, not an editor.** Whatever it returns goes nowhere; the row is
  written as it came. To refuse, `raise` — the message reaches the user in the
  normal envelope, so name it with a translation marker.
- **no function, no check** — the core stays silent. But a function of that name
  with a *different signature* fails the write loudly: silently not being called
  is the one outcome worse than not existing, because the application would
  believe the rule is in force.
- one function per database, not per model — that is the point: it holds for
  models that do not exist yet.

## Posting is a STATE, not only movements

A document that produces no accounting entries at all is **still posted**. "Posted"
means *filled in correctly, not editable any more* — that is what an invoice for
payment (рахунок на оплату) and a payment order need, and neither of them moves
anything in the register, here or in the system your users come from. Most of
those users come from 1С, where this is exactly how it behaves.

So `post` on such a document does **not** refuse. Its `<model>_post_entries`
**checks** instead of writing: the things `app.doc_entry_add` would have checked
for a document with movements — that the lines are not empty, that the amounts
are non-zero, that the mandatory fields of the form are filled — have to be named
here, because further down there is nobody left to check them.

The mistake to avoid (it has been made, and both documents had to be rewritten):
refusing to post with a well-argued message — *«це намір, а не господарська
операція; проводки робить списання з рахунку»*. It reads as consistent, because
the generator emits `post` for every document and a silent stub would give a
"posted" document with no movements. But it equates *posted* with *has entries*,
and those are two different things — the users need the second one less often
than the first.

Consequences for the screen come for free: `BaseUI` opens a posted document
read-only, the toolbar shows «Розпровести», and the list shows the posted mark.
Nothing extra to write.

## Movements that are not entries: `<model>_unpost_records`

`doc_unpost` clears `app.journal_entry` and nothing else, because nothing else is
known to it. A document that also writes rows somewhere of its own — a periodic
register of prices, a stock register, a VAT register — has to take those rows
back itself, or unposting leaves them in force: the price of an unposted document
keeps pricing invoices, and the screen says the document is not posted.

Declare the symmetric half of `<model>_post_entries` and it will be called:

```sql
create function app.price_setting_unpost_records(user_id bigint, document_id bigint)
returns void language plpgsql as $$
begin
  delete from app.nomenclature_price
  where document_id = price_setting_unpost_records.document_id;
end $$;
```

Three things worth knowing:

- **it runs on both paths, and posting is the one that matters.** `doc_post_begin`
  does not refuse a document that is already posted — it clears the entries and
  lets you post again — so the hook is called before `<model>_post_entries` too.
  Without that, every re-post would add another copy of your rows to the foreign
  table. Write it as a plain delete by `document_id` and both paths are correct:
  re-posting rewrites from scratch, exactly as the core already does for entries;
- **it is optional, and switched on by creating the function** — the same rule as
  `app.doc_before_write`. A document whose only movements are entries needs
  nothing;
- **the same name with a different signature refuses the unposting** instead of
  being skipped. Silence here is the worse failure: the application would be sure
  the movements were withdrawn while they went on being in force;
- **do not reach for a trigger on `app.document`.** It works, and that is the
  trap — the core puts its own triggers on that table, the firing order between
  yours and theirs is written down nowhere, and the day they start to interfere
  you find out from the data rather than from an error.

The register whose rows you are deleting usually belongs to *another* model, with
its own CRUD and its own screens. That is fine and is the point: the document
knows what it wrote, and the core does not have to know anything about the table.

## One-sided entries: off-balance accounts

`app.doc_entry_add` accepts an empty side — `null` for `debit_account` or for
`credit_account`, but not both. This is what off-balance accounting is: in the
Ukrainian chart of accounts «Дт 021» corresponds to nothing, and pairing it with
a helper account to satisfy double entry corrupts the data — the register gains a
correspondence that does not exist in the books, and every correspondence report
starts showing links that were never there.

The core requires the surviving account to be `is_off_balance`. On a balance
account an empty side is not a design, it is an unfinished line: accepting it
silently would put a discrepancy into the balance sheet that people look for in
the documents rather than in the entry.

If you write your own `<model>_post_entries`, two consequences:

- pass `null` for the side that does not exist, rather than inventing an account;
- **check every query of yours over `app.journal_entry`.** A `union all` of the
  two sides now collects the empty one as an account named `null`, whose amount
  makes the totals look balanced. Add `where … is not null` to each side, and
  decide what off-balance accounts do to your totals — in this repository's
  turnover sheet they stay as rows but are left out of the sum, because otherwise
  "the balance adds up" stops meaning anything.

## Reading the register: use the ledger layer, do not scan it yourself

Balances and turnovers are not stored anywhere — they are computed by scanning
`app.journal_entry`. The core package `@core/ledger` is where that scanning
lives, and a report or a document that needs figures calls it instead of writing
its own query:

| Function | A row is | For |
|---|---|---|
| `app.acc_entries(org, from, to, accounts, dims)` | one **side** of an entry | account card, anything looking *from an account* |
| `app.acc_journal(org, from, to, accounts, dims, document_id)` | one **entry**, both sides | entry journal, document movements |
| `app.acc_balance_turnover(org, from, to, accounts, dims)` | one account | turnover sheet — opening, turnover and closing in one pass |
| `app.acc_balance(org, before, …)` / `app.acc_turnover(org, from, to, …)` | one account | a single figure |
| `app.acc_account_tree(code)` | — | an account together with its sub-accounts |

Two rules the layer exists to keep, both of which have already cost real money:

- **what counts as a movement** — posted, not marked for deletion, of that
  organization — is stated once, in `acc_entries`. Forget `is_posted` in one
  report and it silently disagrees with every other;
- **an opening balance with an open start date is zero.** A movement cannot be
  both the balance brought forward and a turnover of the period. Take the
  opening figure from `acc_balance_turnover`, never from
  `acc_balance(org, date_from)` — that mistake doubled the closing balance twice,
  and it is invisible on screen because the period control always fills a period
  in.

The layer deliberately does **not** decide whether a balance is shown as debit or
credit: it returns the net (debit − credit, debit positive), and the report
splits it by account type. Arithmetic and presentation are different jobs.

**Quantities come out of the same call.** `acc_balance_turnover` and
`..._by_dim` return `opening_quantity`, `quantity_debit`, `quantity_credit` and
`closing_quantity` beside the money, so a stock turnover sheet — how much was
there, came in, went out, is left, in units and in hryvnia — is one pass and no
arithmetic of yours. Do not scan `acc_entries` and fold the periods yourself:
that is the methodology the layer exists to hold, and your copy stops agreeing
with it the moment the core changes a rule.

Those columns are **empty**, not zero, on an account without `is_quantitative` —
zero would read as "we measured and got none". A row whose movement is in units
only, with no money, is returned rather than dropped.

One thing the layer still cannot answer: **more than one dimension at a time**.
`..._by_dim` takes a single `p_dimension_code`, and stock lives in two — warehouse
and item — so "how much of what, and where" is not a question you can put to it
yet.

Add `"@core/ledger"` to `app/sql.json` after `@core/document_core` and after your
chart of accounts.
