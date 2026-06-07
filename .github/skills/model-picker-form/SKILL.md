---
name: model-picker-form
description: Build a model picker dialog (lookup/select-from-list modal) by extending the shared ModelPickerBase class instead of hand-writing search, table, and select/cancel each time.
argument-hint: Describe the model name and which columns the picker shows (key, title, width, muted).
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
- **`<ui-picker>`** (`client/ui-kit/components/ui-picker.ts`) — the inline field with input + dropdown + magnifier. Shared, not per-model.
- **`<Model>Picker.ts`** — the per-model modal opened by that magnifier. This skill is about the latter.

## Base class

`client/ui-kit/base/model-picker-base.ts` → `ModelPickerBase<Row>`

It owns: load via `bus.request("data.load", { model, command: "lookup", payload })`,
debounced search (250 ms), autofocus on the search input, contrast row selection,
double-click / Enter to confirm, Escape to cancel, and emitting `picker.select` /
`picker.cancel` on the bus. The global loading bar covers request progress.

The `Row` type is the model's `LookupRow` from its TypeBox schema — see
[typebox-model-schema](../typebox-model-schema/SKILL.md). Never re-declare it.

## Canonical example

`app/catalog/bank/bankPicker.ts` — keep it as the reference:

```ts
import { customElement } from "lit/decorators.js";
import { ModelPickerBase } from "@client/ui-kit/base/model-picker-base.ts";
import type { ListColumn } from "@client/ui-kit/base/model-list-base.ts";
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

## Rules

- One subclass per model, named `<Model>Picker.ts`, exporting `tagName`.
- The `Row` type is the model's `LookupRow`, imported from `<model>.schema.ts`.
- Column `title` should be a localization key; add it to the locale JSON files.
- The SQL `lookup` function must return `{ rows: [{ id, <labelField>, … }] }` — see [db-function-contract](../db-function-contract/SKILL.md).
- Do not duplicate search/table/footer markup — change `ModelPickerBase` for all pickers, or accept the defaults.
- Keep `width` as CSS values, never dynamic Tailwind classes.

## Related

- [typebox-model-schema](../typebox-model-schema/SKILL.md) — defines the `LookupRow` type and `x-lookup` annotations.
- [model-list-form](../model-list-form/SKILL.md) — sibling base for the full list screen; shares the `ListColumn` type.
- [model-feature-architecture](../model-feature-architecture/SKILL.md) — where the picker file sits in the model folder.
- [db-function-contract](../db-function-contract/SKILL.md) — the `lookup` SQL function contract.
