---
name: model-picker-form
description: Build a model picker dialog (lookup/select-from-list modal) by extending the shared ModelPickerBase class instead of hand-writing search, table, and select/cancel each time.
argument-hint: Describe the model name and which columns the picker shows (key, title, width, muted).
metadata:
  audience: app
---

# Model Picker Form Skill

Use this skill when:
- creating a `<Model>Picker.ts` selection dialog for a model
- the user needs to pick one record of a model from a searchable list (the modal opened by the magnifier button of `<ui-picker>`)
- adding or changing the columns shown in a picker

**Do not hand-write the search box, table, or select/cancel logic.** It all lives in `ModelPickerBase`. A picker is a thin subclass that declares the model and the columns.

## What a picker is

The picker dialog is rendered inside the `picker-host` modal. It is opened via
`bus.pick(route, params)` from the magnifier button of the `<ui-picker>` field
component. On confirm it emits `picker.select` with `{ id, label }`; on cancel,
`picker.cancel`. The `picker-host` resolves the dialog chunk from the model's
`manifest.json` `views.picker`.

Do not confuse the two:
- **`<ui-picker>`** (`@client/ui-kit/components/ui-picker.ts`) — the inline field with input + dropdown + magnifier. Shared, not per-model.
- **`<Model>Picker.ts`** — the per-model modal opened by that magnifier. This skill is about the latter.

## Base class

`@client/ui-kit/base/model-picker-base.ts` → `ModelPickerBase<Row> extends QueryTableBase<Row>`
(`@client/` is the alias for the `@altera/client` package).

`QueryTableBase` is the shared foundation under both the picker and the list screen. It owns the
table mechanics: loading, server-side sort, debounced search (300 ms), pagination, row keyboard
navigation (↑↓, Home/End, Space to select, Enter to activate) and the toolbar. `ModelPickerBase`
adds only what makes it a *dialog*: autofocus on search, confirm/cancel, and emitting
`picker.select` / `picker.cancel` on the bus.

This split matters when you extend it: anything about the **table** belongs in `QueryTableBase`
and changing it affects the list too; anything about **choosing a value** belongs here.

State lives in the shared `$root`, exactly as in the list: the filter is the service field
`$root.$query`, the data is `$root.rows` / `$root.totals`, and the familiar members
(`this.page`, `this.search`, `this.rows`, …) are getters/setters projecting onto it.
The dialog's own `params` are merged into the lookup payload next to `$query`.
See [model-form-root](../model-form-root/SKILL.md) for the full contract.

A picker subclass needs **no constructor and no root schema** — the base passes the generic
`listRootSchema` to `BaseUI` itself. `callbackId` / `params` stay `@property` (host contract) and
`selectedId` stays `@state` (transient UI).

Unlike the list, the picker keeps its in-place spinner on **every** load: it is a modal, so the
global loading bar in the toolbar is not visible behind it.

The `Row` type is the model's `LookupRow` from its TypeBox schema — see
[typebox-model-schema](../typebox-model-schema/SKILL.md). Never re-declare it.

## Canonical example

A complete picker dialog for a `bank` catalog — this is the entire file:

```ts
import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/table-contract.ts";
import type { BankLookupRow } from "./bank.schema.ts";

export const tagName = "bank-picker";

@customElement(tagName)
export class BankPicker extends ModelPickerBase<BankLookupRow> {
  protected model = "bank";

  protected columns: ListColumn<BankLookupRow>[] = [
    { key: "name", title: "common.name" },
    { key: "mfo",  title: "bank.mfo", width: "7rem", muted: true },
  ];
}
```

That is the whole file. Do not add `render()`, `static styles`, fetch logic, or buttons.

## Required members

| Member    | Purpose                                                         |
|-----------|-----------------------------------------------------------------|
| `model`   | Model key — same as `manifest.json` `model`. Drives the lookup API. |
| `columns` | `ListColumn[]` — the columns shown in the picker table.         |

## Columns

Picker columns use the **same `ListColumn` type as the list** (imported from
`model-list-base.ts`). Fields: `key`, `title` (t-key or literal), `width`
(CSS value, not Tailwind class), `align`, `overflow` (`"wrap"` | `"nowrap"` |
`"ellipsis"`), `muted`, `sortable` (server-side sort, same as the list),
`tooltip`, `render`.

Rich cells (buttons, badges, two-line) and `rowStyle(row)` work the same as in
the list — see the [model-list-form](../model-list-form/SKILL.md) "Rich cells"
section and the `stopRow` / `twoLine` helpers. `this.t(...)` is available in `render`.

## Optional overrides

| Member                       | When to use                                          |
|------------------------------|------------------------------------------------------|
| `lookupCommand`              | Non-standard command instead of `"lookup"`.          |
| `labelField`                 | Row field returned as the selected `label` (default `"name"`). |
| `defaultSortBy` / `defaultSortDir` | Initial sort (default: first sortable column, asc). |
| `pageSizeOptions`            | Override the `[10, 20, 50]` page-size choices.       |
| `dialogWidth` / `dialogHeight` | Modal size, e.g. `"720px"` / `"560px"` (read by `picker-host`; defaults `560px` × `480px`). |

The picker has the same server-side search, sort and pagination as the list —
the `lookup` SQL function must accept `search`, `page`, `pageSize`, `sortBy`,
`sortDir` and return `{ rows, totals: { count, page, pageSize } }`.

The caller passes `params` (from `<ui-picker fetch-params=…>`); they are merged
into the lookup payload automatically — use them to scope results (e.g. only active records).

### Own buttons in the toolbar

The dialog has a toolbar, same as the list screen: extra buttons on the left, search and refresh
on the right. Add your own with `renderToolbarExtra()` — the one extension point for this, so that
every picker puts its buttons in the same place:

```ts
protected override renderToolbarExtra() {
  return html`
    <button class="btn btn-sm" @click=${() => { this.showArchived = !this.showArchived; this.reload(); }}>
      ${t("counterparty.showArchived")}
    </button>
  `;
}
```

Anything the button changes and the server must see goes through `extraPayload()` — it is merged
into the lookup payload alongside `params`:

```ts
protected override extraPayload() {
  return { showArchived: this.showArchived };
}
```

Keep the flag in `@state`, not in `$root`: it is transient UI, not model data.

### Multiple selection

The **caller** decides, not the picker — the same catalogue is picked one value at a
time into a field, and in batches into a document's tabular section:

```ts
const rows = await bus.pickMany("catalog/nomenclature");   // → [{id, label}, …] | null
```

`bus.pickMany()` opens the same dialog with `multiple: true`. The base then shows a
checkbox column, a check-all-on-page box, a `Checked: N` counter, and `Select (N)` in
the footer. `bus.pick()` is unchanged and still returns a single value.

Two behaviours worth knowing:

- **Double-click and Enter check the row instead of closing the dialog** when it is
  multiple. Otherwise picking a batch would end on the first row — exactly when you
  need it least.
- **Checks survive paging**, and `checked` holds whole rows, so labels are available
  for rows no longer on screen. This is why the answer can carry `label` for every id.

Nothing in the picker subclass changes: `multiple` arrives as a property from
`picker-host`.

## Tree of items in the dialog (`ModelTreePickerBase`)

For a catalog whose parent is a regular record (цех → дільниця, cost/income items — the same models that use `ModelTreeListBase` for the list), extend `ModelTreePickerBase` from `@client/ui-kit/base/model-tree-picker-base.ts` instead of `ModelPickerBase`. Same dialog contract (search, confirm/cancel, `picker-host`, `multiple`), but rows render as a tree: indent + expand/collapse toggles in the first column, ←/→ on the keyboard, sibling-level sort. Any node is selectable, including one with children — a workshop is as valid a value as its section (that is the whole point of item hierarchy; a catalog where "groups" must not be selectable is the *group* mechanism and a plain `ModelPickerBase`).

Requirements beyond the plain picker: the `lookup` SQL must return `parentId` in its rows (the standard `LookupRowSchema` carries only `id` + `name` — add the field to the model's schema and lookup query; rename via `treeParentKey`). In tree mode the dialog loads the whole set (`page: 1, pageSize: treeRowLimit`, default 5000; truncation shows a banner); an active search switches to the ordinary flat paginated view. Programmatic node control is the same verb set as the list (`expandNode`/`collapseNode`, `expandAll`/`collapseAll`, `revealNode(id)`); `revealNode` is the one pickers actually need — call it after load to unfold the path to the field's current value.

## Rules

- One subclass per model, named `<Model>Picker.ts`, exporting `tagName`.
- The `Row` type is the model's `LookupRow`, imported from `<model>.schema.ts`.
- Column `title` should be a localization key; add it to the model's own `app/<family>/<model>/_locales/<code>.json` and run `deno task locales:build`. `app/_locales/*.json` is the merged build output — editing it directly is lost on the next build.
- The SQL `lookup` function must return `{ rows: [{ id, <labelField>, … }] }` — see [db-function-contract](../db-function-contract/SKILL.md).
- Do not duplicate search/table/footer markup — change `ModelPickerBase` for all pickers, or accept the defaults.
- Keep `width` as CSS values, never dynamic Tailwind classes.

## Related

- [typebox-model-schema](../typebox-model-schema/SKILL.md) — defines the `LookupRow` type and `x-lookup` annotations.
- [model-list-form](../model-list-form/SKILL.md) — sibling base for the full list screen; shares the `ListColumn` type.
- [model-feature-architecture](../model-feature-architecture/SKILL.md) — where the picker file sits in the model folder.
- [db-function-contract](../db-function-contract/SKILL.md) — the `lookup` SQL function contract.
