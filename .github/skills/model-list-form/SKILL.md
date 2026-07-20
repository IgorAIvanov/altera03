---
name: model-list-form
description: Build a model list screen (catalog/document table) by extending the shared ModelListBase class instead of hand-writing toolbar, table, server sort, pagination and selection each time.
argument-hint: Describe the model name, its edit route, and which columns the list shows (key, title, width, sortable, muted).
---

# Model List Form Skill

Use this skill when:
- creating a `<Model>List.ts` screen for a catalog or document model
- you need the standard 1С-style list: toolbar with icons, searchable, server-side sort, pagination, row selection
- adding or changing columns on an existing list

**Do not hand-write the toolbar, table, pagination or sort logic.** All of it lives in the shared base class `ModelListBase`. A list screen is a thin subclass that declares the model, the edit route, and the columns.

## Base class

`client/ui-kit/base/model-list-base.ts` → `ModelListBase<Row> extends BaseUI<ListRoot<Row>>`

It owns: data load via `run()` / `assign()` on the shared envelope, server-side `sortBy`/`sortDir`, pagination (`page`/`pageSize` + footer), debounced search (300 ms), row selection, delete with confirm, and re-load on the `model.changed` bus event. The global loading bar (in `tab-controller`) already covers request progress — the list shows its own spinner only on the very first load.

State lives in the shared `$root` container, not in local `@state`: the filter is the service field `$root.$query` (`search/page/pageSize/sortBy/sortDir`) and the data is `$root.rows` / `$root.totals`. The familiar member names (`this.page`, `this.search`, `this.sortBy`, `this.rows`, `this.total`) are kept as getters/setters projecting onto `$root`, so subclass code reads the same as before. `$query` is sent as the `list` payload and mirrors back if the server returns an effective (clamped/normalized) query. See [model-form-root](../model-form-root/SKILL.md) for the full contract.

A list subclass needs **no constructor and no root schema** — the base passes a generic `listRootSchema` to `BaseUI` itself. `selectedId` stays a plain `@state` because it is transient UI, never sent to SQL.

The `Row` type comes from the model's TypeBox schema — see [typebox-model-schema](../typebox-model-schema/SKILL.md). Never re-declare a row interface by hand.

## Canonical example

`app/catalog/bank/bankList.ts` — keep it as the reference. A full list screen:

```ts
import { customElement } from "lit/decorators.js";
import { ModelListBase, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { BankRow } from "./bank.schema.ts";

export const tagName = "bank-list";

@customElement(tagName)
export class BankList extends ModelListBase<BankRow> {
  protected model = "bank";
  protected editRoute = "catalog/bank/edit";
  protected defaultSortBy = "code";

  protected columns: ListColumn<BankRow>[] = [
    { key: "code", title: "common.code", width: "8rem", sortable: true },
    { key: "name", title: "common.name", sortable: true },
    { key: "mfo",  title: "bank.mfo", width: "7rem", muted: true, sortable: true },
  ];
}
```

That is the whole file. Do not add `render()`, `static styles`, load logic, or pagination markup.

## Required members

| Member         | Purpose                                                        |
|----------------|---------------------------------------------------------------|
| `model`        | Model key — same as `manifest.json` `model`. Drives API + `model.changed`. |
| `editRoute`    | Route opened by Create / Open / double-click, e.g. `"catalog/bank/edit"`. |
| `columns`      | `ListColumn[]` — the table columns.                           |

## Column config (`ListColumn`)

| Field      | Meaning                                                            |
|------------|-------------------------------------------------------------------|
| `key`      | Row field key **and** the `sortBy` value sent to the server.      |
| `title`    | Localization key (preferred, e.g. `"common.code"`) or literal — passed through `t()`. |
| `width`    | CSS width, e.g. `"8rem"`. Omit for a flexible (stretch) column. Use a CSS value, **not** a Tailwind `w-*` class — dynamic Tailwind classes don't survive in shadow DOM here. |
| `align`    | `"left"` (default) \| `"right"` \| `"center"`.                    |
| `overflow` | `"wrap"` (default) \| `"nowrap"` \| `"ellipsis"`. `ellipsis` truncates with `…` and needs `width`. |
| `muted`    | `true` → dimmed text for secondary data (codes, dates).           |
| `sortable` | `true` → header is clickable, toggles asc/desc on the server.      |
| `tooltip`  | `(row) => string` — native cell tooltip (the `title` attribute).   |
| `render`   | `(row) => TemplateResult \| string` — custom cell (buttons, badges, two-line, formatted dates, picker labels). |

`sortable: true` requires the SQL `list` function to accept that `key` in its `sortBy` whitelist — see [db-function-contract](../db-function-contract/SKILL.md).

## Optional overrides

| Member / hook            | When to use                                                   |
|--------------------------|---------------------------------------------------------------|
| `defaultSortBy` / `defaultSortDir` | Initial sort column/direction. Defaults to first column, asc. |
| `pageSizeOptions`        | Override the `[10, 20, 50, 100]` page-size choices.           |
| `listCommand`            | Use a non-standard list command instead of `"list"`.         |
| `rowLabel(row)`          | Text shown in the delete-confirm dialog (defaults to `row.name`). |
| `rowClass(row)`          | Extra CSS classes per row (status highlight).                |
| `rowStyle(row)`          | Inline row style (text/background colour). Applied to each `<td>` so it beats `table-zebra`; selection still wins. E.g. `row.isActive === false ? "color:#9ca3af" : ""`. |
| `onActivate(row)`        | Double-click action (defaults to open edit).                 |
| `extraPayload()`         | Extra fields merged into the list payload — **the seam for a filter panel**. |
| `renderToolbarExtra()`   | Extra toolbar buttons between the standard actions and search.|
| `renderHeaderArea()`     | Full-width zone under the toolbar — **the seam for a filter bar or group breadcrumbs**. |

## Rich cells

A column's `render` returns arbitrary Lit content — buttons, badges, marks,
two-line text. Two helpers from `model-list-base.ts` cover the common needs, and
`this.t(...)` is available in `render` for localization.

- **Buttons / actions in a cell** — wrap the handler in `stopRow(...)` so the
  click does not select or activate the row:

  ```ts
  import { html } from "lit";
  import { ModelListBase, stopRow, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";

  { key: "_actions", title: "", width: "3rem", align: "center",
    render: (row) => html`
      <button class="btn btn-ghost btn-xs" title=${this.t("common.open")}
        @click=${stopRow(() => this.openEdit(row.id))}>✎</button>` }
  ```

- **Badge / mark** — return a daisyUI badge:

  ```ts
  { key: "status", title: "doc.status", width: "7rem",
    render: (row) => html`<span class="badge ${row.posted ? "badge-success" : "badge-ghost"}">
      ${row.posted ? this.t("doc.posted") : this.t("doc.draft")}</span>` }
  ```

- **Two-line cell** — use `twoLine(primary, secondary)`:

  ```ts
  import { twoLine } from "@client/ui-kit/base/model-list-base.ts";

  { key: "name", title: "common.name", render: (row) => twoLine(row.name, row.edrpou) }
  ```

- **Row colour** — override `rowStyle(row)` (see Optional overrides).
- **Tooltip** — set the column `tooltip` field, or `title=` inside `render`.

## Variants (build as sibling subclasses)

- **Document list with filters (`отбори`)**: override `renderHeaderArea()` to draw a filter panel, and `extraPayload()` to send the selected filters into the `list` command. Call `this.reload()` when a filter changes.
- **Catalog with groups**: a two-pane group-tree + element-list layout is a separate base (a future `ModelTreeListBase`) — do not force it into `ModelListBase`. Reuse the same column/selection/pagination conventions documented here.

## Rules

- One subclass per model, named `<Model>List.ts`, exporting `tagName`.
- The `Row` type is imported from `<model>.schema.ts`, never re-declared.
- Column `title` should be a localization key; add the key to `client/_locales/*.json` (shared) or `app/_locales/*.json` (model-specific).
- Do not duplicate toolbar/table/pagination markup into the subclass — if you need a change for all lists, edit `ModelListBase`; if it's model-specific, use the documented hooks.
- Keep `width` as CSS values, never dynamic Tailwind classes.

## Related

- [typebox-model-schema](../typebox-model-schema/SKILL.md) — defines the `Row` type and `x-list` column annotations.
- [model-feature-architecture](../model-feature-architecture/SKILL.md) — where the list file sits in the model folder.
- [db-function-contract](../db-function-contract/SKILL.md) — the `list` SQL function: payload (`search`, `page`, `pageSize`, `sortBy`, `sortDir`) and response envelope (`rows`, `totals`).
