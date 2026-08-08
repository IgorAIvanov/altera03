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

The base gives you **the place, the state and the binding**. The markup and the controls
are yours — any control, including `<ui-period>`, `<ui-date>` and `<ui-picker>`.

```ts
// the screen imports what it actually uses:
import "@client/ui-kit/components/ui-period.ts";

protected override renderFilters() {
  return html`
    <ui-period
      .dateFrom=${this.filterValue("dateFrom") ?? ""}
      .dateTo=${this.filterValue("dateTo") ?? ""}
      @value-changed=${(e: CustomEvent) =>
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

The collapsible panel, the `Filters` toolbar button with an active-count badge, `Reset`,
and remembering the collapsed state per user and per model all come from the base.
Whether a screen has filters is detected from `renderFilters()` being overridden — there
is no separate flag to drift out of sync with the markup.

There is deliberately **no declarative filter descriptor**. The most common filters in an
accounting list are a date and a period, i.e. `<ui-date>` and `<ui-period>`; a built-in
set of filter kinds would force the base to import those statically, and then every list
**and every picker dialog** would carry them.

### Binding

| Method | Purpose |
|---|---|
| `filterValue<T>(key)` | read; `undefined` means not set |
| `setFilter(key, value, {debounce})` | write one, reload from page 1 |
| `setFilters(patch, {debounce})` | write several in **one** request |
| `bindFilter(key, {debounce})` | ready-made handler for native `input`/`select` |
| `resetFilters()` | clear everything |

Use `setFilters` for anything that produces several values at once — `<ui-period>` emits
both bounds together, and two consecutive `setFilter` calls would fire two requests where
the second cancels the first. `debounce` is for typed input only.

ui-kit components differ in their events (`value-changed`, `item-selected`, their own
`detail` shape), so the screen wires them itself via `setFilter`; `bindFilter` covers
native controls only — exactly like `BaseUI.bindTo` for form fields.

### The SQL contract

Values live in `$root.$filters` and go into the payload as a **nested `filters` object**,
not spread next to `search`/`page` — a filter name would eventually collide with a
`$query` field. An empty value is **deleted** rather than stored, so "how many filters are
active" and "what to send" are both just the contents of `$filters`.

**You do not write the SQL.** Annotate the field with `x-filter` in the model schema and
`deno task sql:gen` generates the parsing, the `where` conditions and the mirrored answer
inside `<model>_list` — see [typebox-model-schema](../typebox-model-schema/SKILL.md).

```ts
// invoice.schema.ts
counterpartyId: Type.String({
  "x-db-type": "bigint",
  "x-filter": true,
  "x-ref": { model: "counterparty", display: "name", as: "counterparty" },
}),
```

**Reference filters carry a label back.** The client sends only the id; the generated
`_list` returns `counterparty: {id, name}` inside `$filters`, and `assign()` mirrors it
into the panel. Read it in `renderFilters()` for the picker's display value — without it
the picker would know the id but show an empty box after a reload, and the filter would
look cleared while still applying.

`docDate` and `isPosted` are annotated in the shared `DocumentHeaderSchema`, so every
document list already parses `dateFrom`/`dateTo`/`isPosted`.

The payload key must match the key you write in `renderFilters()`. A mismatch is silent:
`jsonb` ignores unknown keys.

On a hierarchical catalogue the filter panel and the group tree share **one** right-hand
column — filters on top, tree below.

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

## Rules

- One subclass per model, named `<Model>List.ts`, exporting `tagName`.
- The `Row` type is imported from `<model>.schema.ts`, never re-declared.
- Column `title` should be a localization key; add it to `app/_locales/*.json`. Framework-wide keys (`common.code`, `common.name`, …) already ship inside `@altera/client` — do not redefine them.
- Do not duplicate toolbar/table/pagination markup into the subclass. Model-specific changes go through the documented hooks; a change every list needs belongs in `ModelListBase` itself, i.e. in the framework — copying the base class into the app is never the answer.
- Keep `width` as CSS values, never dynamic Tailwind classes.

## Related

- [typebox-model-schema](../typebox-model-schema/SKILL.md) — defines the `Row` type and `x-list` column annotations.
- [model-feature-architecture](../model-feature-architecture/SKILL.md) — where the list file sits in the model folder.
- [db-function-contract](../db-function-contract/SKILL.md) — the `list` SQL function: payload (`search`, `page`, `pageSize`, `sortBy`, `sortDir`) and response envelope (`rows`, `totals`).
