---
name: model-list-form
description: Build a model list screen (catalog/document table) by extending the shared ModelListBase class instead of hand-writing toolbar, table, server sort, pagination and selection each time.
argument-hint: Describe the model name, its edit route, and which columns the list shows (key, title, width, sortable, muted).
metadata:
  audience: app
---

# Model List Form Skill

Use this skill when:
- creating a `<Model>List.ts` screen for a catalog or document model
- you need the standard 1С-style list: toolbar with icons, searchable, server-side sort, pagination, row selection
- adding or changing columns on an existing list

**Do not hand-write the toolbar, table, pagination or sort logic.** All of it lives in the shared base class `ModelListBase`. A list screen is a thin subclass that declares the model, the edit route, and the columns.

## Base class

`@client/ui-kit/base/model-list-base.ts` → `ModelListBase<Row> extends QueryTableBase<Row>`
(`@client/` is the alias for the `@altera/client` package — import from it, never copy it into the app).

`QueryTableBase` is the shared foundation under both the list and the picker dialog. It owns the table mechanics: data load via `run()` / `assign()` on the shared envelope, server-side `sortBy`/`sortDir`, pagination (`page`/`pageSize` + footer), debounced search (300 ms), the toolbar, row selection, optional row checkboxes, and full keyboard navigation. `ModelListBase` adds what makes it a *screen*: create/open/delete, the group tree for hierarchical catalogues, Excel export, and re-load on the `model.changed` bus event. The global loading bar (in `tab-controller`) already covers request progress — the list shows its own spinner only on the very first load.

**Keyboard.** ↑↓ move the cursor and roll over to the next/previous page at the edges; `PageUp`/`PageDown` page directly; `Home`/`End` jump within the page and `Ctrl+Home`/`Ctrl+End` to the first/last page; `Enter` activates the row; `Space` selects it (or toggles the checkbox when `selectable`), and `Ctrl+A` checks everything on the page. Focus follows the page change, so a keyboard session never needs the mouse to page through a list.

State lives in the shared `$root` container, not in local `@state`: the filter is the service field `$root.$query` (`search/page/pageSize/sortBy/sortDir`) and the data is `$root.rows` / `$root.totals`. The familiar member names (`this.page`, `this.search`, `this.sortBy`, `this.rows`, `this.total`) are kept as getters/setters projecting onto `$root`, so subclass code reads the same as before. `$query` is sent as the `list` payload and mirrors back if the server returns an effective (clamped/normalized) query. See [model-form-root](../model-form-root/SKILL.md) for the full contract.

A list subclass needs **no constructor and no root schema** — the base passes a generic `listRootSchema` to `BaseUI` itself. `selectedId` stays a plain `@state` because it is transient UI, never sent to SQL.

The `Row` type comes from the model's TypeBox schema — see [typebox-model-schema](../typebox-model-schema/SKILL.md). Never re-declare a row interface by hand.

## Canonical example

A complete list screen for a `bank` catalog — this is the entire file, nothing is omitted:

```ts
import { customElement } from "lit/decorators.js";
import { ModelListBase, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import { icons } from "@client/ui-kit/icons.ts";
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
    // Остання колонка — «відкрити». Ставиться в КОЖЕН список, де є форма
    // редагування, доки не сказано інакше (див. нижче).
    {
      key: "_actions", title: "", width: "3rem", align: "center",
      render: (row) => html`
        <button class="btn btn-ghost btn-xs px-1" title=${this.t("common.open")}
          @click=${stopRow(() => this.openEdit(row.id))}>
          ${icons.open}
        </button>
      `,
    },
  ];
}
```

That is the whole file. Do not add `render()`, `static styles`, load logic, or pagination markup.

## The open button: put it in unless told otherwise

**Every list with an `editRoute` ends the row with an open button** — the last
column above. It is not part of the base class and never has been: a list where
the button does not belong (a journal that opens the *referenced* record instead
of its own row, a read-only register) has to be able to simply not have it, and
a base that draws it for everyone takes that away.

So it is a rule of the screen, not of the framework: **declare it unless the task
says otherwise.** A list without it is not broken — double-click and Enter open
the same form — but the button is the only thing that says so with a mouse and
without guessing, and its absence reads as "this row does not open".

Where it differs, it differs on purpose: the audit journal draws the same glyph
but opens the record the event was about, and only for rows that name one.

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
| `exportText` | `(row) => string` — cell text for the Excel export. Needed whenever `render` shows something other than the raw field. |
| `export`   | `false` → keep the column out of the export. A column with no title (the actions column) is skipped anyway. |

`sortable: true` requires the SQL `list` function to accept that `key` in its `sortBy` whitelist — see [db-function-contract](../db-function-contract/SKILL.md).

## Excel export

The toolbar has an **Excel** button out of the box. It re-runs the same `list`
command with the same filters and `pageSize` covering the whole result, then
builds the `.xlsx` in the browser from the declared columns — the screen is left
untouched (the response is not merged into `$root`).

What this means when declaring columns:

- **a column whose `render` returns anything but the raw field needs `exportText`** —
  a nested object (`counterparty.name`), a translated code, a badge. Without it
  the file gets `row[key]`, and for an object that is an empty cell;
- numbers stay numbers; a numeric-looking **string** is converted only in a
  column with `align: "right"`, so account codes keep their leading zeros;
- `boolean` without `exportText` becomes «Так» / empty;
- `exportRowLimit` (default 10 000) caps the file; the banner reports how many
  rows actually made it.

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
| `selectable`             | `true` adds a checkbox column for group actions (see below).  |

## Checking rows for group actions

Set `selectable = true` and the base adds a checkbox column, a check-all-on-page
box in the header, and a `Checked: N` counter with a clear button in the toolbar.
Your group-action buttons go in `renderToolbarExtra()`:

```ts
protected override selectable = true;

protected override renderToolbarExtra() {
  if (!this.checked.length) return "";
  return html`
    <button class="btn btn-sm" @click=${this.#postChecked}>${t("invoice.postChecked")}</button>
  `;
}

async #postChecked() {
  await this.run("postMany", { ids: this.checkedIds }, "save");
  this.clearChecked();
}
```

Two things to know, because both are deliberate:

- **`checked` holds whole rows, not ids**, and survives paging. So `this.checked`
  gives you labels for a confirm dialog even for rows that are no longer on screen;
  `this.checkedIds` gives the ids your command needs. The toolbar counter exists
  precisely because checks outlive the page you made them on.
- **Checks clear on search and on `reload()`** (filter change) but not on paging or
  sorting — a different result set makes the old marks meaningless.

Do not confuse this with `selectedId`. That is the *cursor*: one row, driven by
click and arrow keys, and it is what `Open` and `Delete` act on. Checked rows are
a *set* for a batch command, and there can be none while the cursor is alive.

## Filters (right-hand panel)

The base gives you **the place, the state and the binding**; the markup and the controls
are yours — any control, including `<ui-period>`, `<ui-date>`, `<ui-select>` and
`<ui-picker>`. Override `renderFilters()` and the collapsible panel, the `Filters` toolbar
button with an active-count badge, `Reset` and the remembered collapsed state all appear.

```ts
import "@client/ui-kit/components/ui-period.ts";   // the screen imports what it uses

protected override renderFilters() {
  return html`
    <ui-period
      .dateFrom=${this.filterValue<string>("dateFrom") ?? ""}
      .dateTo=${this.filterValue<string>("dateTo") ?? ""}
      @period-changed=${(e: CustomEvent) =>
        this.setFilters({ dateFrom: e.detail.dateFrom, dateTo: e.detail.dateTo })}
    ></ui-period>

    <label class="flex items-center gap-2">
      <input type="checkbox" class="checkbox checkbox-xs"
        .checked=${this.filterValue("isPosted") === true}
        @change=${this.bindFilter("isPosted")} />
      <span>${t("document.posted")}</span>
    </label>
  `;
}
```

Whether a screen has filters is detected from `renderFilters()` being overridden — there
is no separate flag to drift out of sync with the markup. Values live in `$root.$filters`
and go into the payload as a nested `filters` object; you annotate the field with
`x-filter` in the schema and `deno task sql:gen` writes the SQL.

There is deliberately **no declarative filter descriptor**. The most common filters in an
accounting list are a date and a period, i.e. `<ui-date>` and `<ui-period>`; a built-in
set of filter kinds would force the base to import those statically, and then every list
**and every picker dialog** would carry them.

**The full story — every filter kind, the reference-filter rule, hand-written SQL and the
traps — is in [model-list-filters](../model-list-filters/SKILL.md). Read it before adding
a filter.**

On a hierarchical catalogue the filter panel and the group tree share **one** right-hand
column — filters on top, tree below.


## Deletion mark and the status column

`delete` **marks** a record instead of destroying it. The base handles the whole story:

- the toolbar button flips with the cursor — `Mark for deletion` ↔ `Unmark`, the same
  way `Post`/`Unpost` do in a document form;
- a **status column** appears on the left as soon as the rows carry `isDeleted` or
  `isPosted`: a plain sheet (entered), a green tick (posted), a red cross (marked).
  Nothing to declare — the base looks at the data, so the column cannot drift out of
  sync with a flag someone forgot to set;
- marked rows **stay in the list**. If they vanished, the mark would be
  indistinguishable from deletion and could never be lifted. Pickers do hide them.

Two things to do on your side:

1. **Put `isDeleted` in `<Model>RowSchema`** (and `isPosted` for documents) — the column
   draws from the row, and SQL only returns declared fields.
2. **Do not add your own «Posted» column.** The status glyph already says it; a separate
   badge column is a duplicate. Dimming the row via `rowStyle` is fine as *reinforcement*
   — `row.isDeleted === true ? "color:#6b7280" : ""` — but never as the only sign.

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
- **Hierarchical catalog (A2v10 pattern)**: set `protected override hierarchy = true` in the subclass AND `"hierarchy": true` in the model's `manifest.json`. The flat paginated list stays the main area; a group tree with checkboxes appears on the right (checking a group filters the list by that branch INCLUDING subgroups), and a "To group…" toolbar button moves the selected row (root is just another target — there is no separate "remove from group"). Requirements: `app.{model}_group` table (id, parent_id, name) in `struc.sql`, a `groupId` field in ItemSchema (`x-db-type: bigint`), optional `groupName` in RowSchema (the generator joins it), and `commands.sql`/`commands.access` declarations for `groupTree`/`groupSave`/`groupDelete`/`moveToGroup` in the manifest. `deno task sql:gen` emits all group SQL.
- **Tree of items (`HierarchyOfItems` — parent is a regular record: цех → дільниця, cost/income items)**: extend `ModelTreeListBase` from `@client/ui-kit/base/model-tree-list-base.ts` instead of `ModelListBase`. This is a *different mechanism* from the group tree above and the two are mutually exclusive (`hierarchy: true` throws): here the tree nodes are the model's own rows, indented in the first column with expand/collapse toggles (←/→ on the keyboard), and the parent goes into the row as a self-reference. Requirements: `parent_id bigint references app.{model}(id)` in `struc.sql`, a `parentId` field in RowSchema (rename via `treeParentKey`), nothing special in SQL — the generated `list` works as is, because in tree mode the base requests the whole set (`page: 1, pageSize: treeRowLimit`, default 5000) and regroups rows by parent on the client. Column sort orders *siblings* within each node; an active search temporarily switches to the ordinary flat paginated view (clearing it restores the tree); Excel export stays flat. The edit form needs a parent picker field on itself (`<ui-picker url="<family>/<model>">`) — same pattern as any reference field. Programmatic node control from the subclass: `expandNode(id)` / `collapseNode(id)` / `toggleNode(id)`, `expandAll()` / `collapseAll()`, and `revealNode(id)` — expands all ancestors and moves the cursor to the node (in flat search mode it just moves the cursor), returns `false` when the id is not in the loaded set. These are verbs, not a toggle, on purpose: a future lazy-loading variant will hook child loading into expand.

## Rules

- One subclass per model, named `<Model>List.ts`, exporting `tagName`.
- The `Row` type is imported from `<model>.schema.ts`, never re-declared.
- Column `title` should be a localization key; add it to the model's own `app/<family>/<model>/_locales/<code>.json` and run `deno task locales:build`. Do **not** edit `app/_locales/*.json` — that file is the merged build output and your edit is overwritten on the next build. Framework-wide keys (`common.code`, `common.name`, …) already ship inside `@altera/client` — do not redefine them.
- Do not duplicate toolbar/table/pagination markup into the subclass. Model-specific changes go through the documented hooks; a change every list needs belongs in `ModelListBase` itself, i.e. in the framework — copying the base class into the app is never the answer.
- Keep `width` as CSS values, never dynamic Tailwind classes.

## Related

- [typebox-model-schema](../typebox-model-schema/SKILL.md) — defines the `Row` type and `x-list` column annotations.
- [model-feature-architecture](../model-feature-architecture/SKILL.md) — where the list file sits in the model folder.
- [db-function-contract](../db-function-contract/SKILL.md) — the `list` SQL function: payload (`search`, `page`, `pageSize`, `sortBy`, `sortDir`) and response envelope (`rows`, `totals`).
