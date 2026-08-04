---
name: model-form-root
description: Build a model edit form (and understand the shared $root data contract behind every list, picker and form) by extending BaseUI, seeding state from the TypeBox schema with Value.Create instead of hand-written empty objects.
argument-hint: Describe the model name and which fields the edit form shows; mention whether it has a tabular part.
metadata:
  audience: app
---

# Model Form / `$root` Contract Skill

Use this skill when:
- creating a `<Model>Edit.ts` form for a catalog or document model
- touching anything that reads or writes `$root` (list, picker, form — they all share it)
- wiring a form to the SQL envelope (`run` / `assign` / `loadInto`)
- you are about to hand-write an "empty item" literal, a `loading` flag, or a `bus.request` call in a screen

**Do not hand-write empty-object literals, transport calls, or per-form loading flags.** All of it
lives in `@client/ui-kit/base/base-ui.ts` → `BaseUI<T>`, which every screen base extends
(`@client/` is the alias for the `@altera/client` package).

## The one contract

```
SQL function → { ok, data, messages }        ← envelope, never changes
                      │
                      └── assign() → $root   ← reactive mirror of `data`
```

- **`$root` is a mirror of the envelope's `data`**, seeded from the model's TypeBox schema by
  `Value.Create(schema)` — so every field exists before the first render. Never `{} as T`.
- **Fields without a prefix** are model data returned by SQL: `item`, `rows`, `totals`, `options`.
- **`$`-prefixed fields are service state that round-trips with the DB**: `$query` (search / page /
  pageSize / sortBy / sortDir). The client sends it as payload; the server may return the
  *effective* (normalized, clamped) query, which mirrors straight back through `assign()`.
- **Transient UI state never enters `$root`**: `running`, `busy`, `messages` (base), `selectedId`,
  `pingResult` (subclass `@state`). Rule of thumb — if it is never serialized to or from SQL, it
  does not belong in `$root`.

### Why `assign()` skips top-level `null`

The generated SQL envelope always carries **all** data keys and puts `null` / `[]` / `{}` in the ones
the command does not use (`list` returns `item: null`; `get` returns `rows: []`). So at the top level
`null` means *"no data for this key"*, never *"clear it"*. `assign()` therefore ignores `null` and
`undefined`, which is what keeps a `get` of a deleted record from wiping the schema-seeded `$root.item`
and crashing the render.

Meaningful clearing always arrives **inside** an object (`item.counterparty = null`) — nested values
are not filtered.

## `BaseUI` API

| Member | Purpose |
|---|---|
| `$root: T` | Reactive container, seeded by `Value.Create(schema)`, deep-proxied (`signal-utils/deep`). |
| `model` | Abstract. Model key, e.g. `"bank"`. |
| `primaryKey` | Key of the main entity in `data` — `"item"` for edit forms, `null` (default) for lists/pickers. |
| `run(command, payload, kind?)` | Calls the model command over the bus, unwraps the envelope, drives `running` / `messages`. `kind: "save"` routes through `data.save` (which emits `model.changed`). |
| `loadInto(command, payload)` | `run` + not-found check + `assign`. Returns `false` and sets `notFound` when `primaryKey` came back `null`. **Prefer this over `run` in forms.** |
| `assign(patch)` | Partial merge of `data` into `$root`, skipping top-level `null`/`undefined`. |
| `bindTo(obj, field)` | Input binder for a nested node: `@input=${this.bindTo(item, "code")}`. |
| `running` / `busy` | Name of the in-flight command / whether any is running. |
| `notFound` | Request succeeded but the entity is missing (deleted or invalid id). |
| `canSave` | `!busy && !notFound` — use for the Save button. |
| `renderNotice()` | Shared banner: "record not found" + error messages. Drop in once per form. |
| `renderField(label, control, opts)` | Field layout: label + control + required asterisk + error text. Pass `{ field: "code" }` to wire it to validation. |
| `fieldRules()` | Override to declare required / custom checks **in the form**, incl. conditional ones. |
| `isRequired(f)` / `fieldError(f)` | For components that draw their own label (`<ui-picker>`): `?required=` / `.invalid=`. |
| `validate()` | Runs the rules, highlights, scrolls to the first invalid field. Called automatically before save. |
| `trySave()` | `validate()` + `saveItem()`. **Wire custom save buttons here, not to `saveItem`.** |
| `t` | Localizer. |

## Required fields: declare them in the form

Requiredness often depends on other fields, and a TypeBox schema cannot express that. Override
`fieldRules()` — it is a **method**, called on every render and before every save, so the condition
freely reads `$root`:

```ts
protected override fieldRules(): FieldRules {
  const item = this.$root.item;
  return {
    mfo: item.kind === "bank",                    // conditional
    prefix: false,                                // drop the schema's requiredness
    edrpou: { required: true, check: (v) => /^\d{8}$/.test(String(v)) ? null : t("…") },
  };
}
```

Precedence: inline `renderField(…, { required })` → `fieldRules()` → schema. The schema stays the
default, so forms that need no conditions keep working untouched.

Only two sets are validated: fields named in `fieldRules()`, and fields passed to `renderField` as
`{ field }`. Never the whole schema — `id` is schema-required but empty on a new record.

**Tabular parts** declare their rules on the column (`required` / `check`, see
[document-tabular-section](../document-tabular-section/SKILL.md)); the form only names its sections
so `validate()` covers them too:

```ts
protected override sections(): FormSection[] { return [this.lines]; }
```

**Server-side rejections** highlight the field too: an envelope message may carry `field`
(`{ type, text, field }`). SQL sets it via `raise exception … using column = 'code'`; PostgreSQL
sets it itself on not-null and unique violations; a TS command uses `fieldErr(field, text)`. Nothing
to wire in the form — but the field must be one the form actually renders, otherwise the message
stays in the banner rather than vanishing.

Deep dive (framework repository, not part of an application): `docs/ui-form-validation.md`.

## Gotcha: the schema goes through `super()`

Subclass field initializers run **after** `super()`, so an `abstract schema` field is still
`undefined` inside the base constructor. The schema must be passed as a constructor argument:

```ts
constructor() { super(BankEditRootSchema); }   // ✅
```

Not as a declared property the base reads at construction time.

## Canonical example — simple form

An edit form for a `bank` catalog (`bankEdit.ts` next to the model's `manifest.json`):

```ts
@customElement(tagName)
export class BankEdit extends BaseUI<BankEditRoot> {
  protected model = "bank";
  protected override primaryKey = "item";

  @property({ type: String }) modelId: string | null = null;

  constructor() { super(BankEditRootSchema); }

  override connectedCallback() {
    super.connectedCallback();
    if (this.modelId) this.load();          // new record → no request at all
  }

  private async load() {
    await this.loadInto("get", { id: this.modelId });
  }

  private async save() {
    await this.run("save", { item: this.$root.item }, "save");
  }

  override render() {
    if (this.running === "get") return html`…spinner…`;
    const item = this.$root.item;
    return html`
      ${this.renderNotice()}
      <input .value=${item.code ?? ""} @input=${this.bindTo(item, "code")} />
      <button ?disabled=${!this.canSave} @click=${this.save}>${this.t("common.save")}</button>
    `;
  }
}
```

A document form with a tabular part follows the same shape — the section is declared in the form and
rendered inside `renderFields()`; for the table itself use
[document-tabular-section](../document-tabular-section/SKILL.md).

## Root schema per screen

Define it in `<model>.schema.ts`, reusing the field schemas (see
[typebox-model-schema](../typebox-model-schema/SKILL.md)):

```ts
export const BankEditRootSchema = Type.Object({
  item:    BankItemSchema,        // non-null here, so render needs no null guards
  options: Type.Object({}),
});
```

Give `id` a `default: null` so `Value.Create` seeds a new record correctly.

**Lists and pickers need no root schema and no constructor.** `ModelListBase` / `ModelPickerBase`
pass a generic `listRootSchema` (`{ $query, rows, totals }`) to `BaseUI` themselves — the row shape
matters only as the TypeScript generic `Row`, never at runtime for seeding an empty `rows`.

## New record vs. record not found

Both end up showing an empty form, because `$root` is schema-seeded either way. They must not behave
the same:

| | `modelId` is null | `modelId` set, entity missing |
|---|---|---|
| `get` request | not sent | sent, returns `item: null` |
| `notFound` | `false` | `true` |
| Save | creates the record ✔ | blocked via `canSave` ✔ |

Without `primaryKey`, the second case would silently send `item.id = null` and **create a duplicate
record** instead of reporting an error. Always set `primaryKey = "item"` on an edit form.

## Consequences for SQL

**SQL must not construct empty entities.** The old habit of building a well-formed empty JSON when
`id` is null is now dead weight: the client never calls `get` for a new record, and duplicating the
defaults in SQL guarantees drift from the schema. A `get` for a missing record returns
`item: null` — that is the whole contract. SQL only has to stay null-safe (never raise on a missing
or invalid id) and return a valid envelope. See
[db-function-contract](../db-function-contract/SKILL.md).

## Checklist

- [ ] Root schema in `<model>.schema.ts`, `id` has `default: null`
- [ ] `extends BaseUI<…Root>`, `model`, `primaryKey = "item"`
- [ ] `constructor() { super(…RootSchema); }`
- [ ] `load()` uses `loadInto`, not raw `run` + `assign`
- [ ] `${this.renderNotice()}` in render, `?disabled=${!this.canSave}` on Save
- [ ] No empty-object literals, no per-form `loading`/`saving` flags, no direct `bus.request`
- [ ] Nothing transient stored in `$root`
