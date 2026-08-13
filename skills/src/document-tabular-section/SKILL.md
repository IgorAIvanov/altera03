---
name: document-tabular-section
description: Build an editable tabular section (табличну частину) of a document — controls that fill the table cell flush with the grid, decimal columns with live totals — using the shared .table-tabular / .cell-control contract instead of ad-hoc Tailwind utilities.
argument-hint: Describe the document model, which columns the tabular section has (picker / decimal / text), and whether the section needs live totals.
metadata:
  audience: app
---

# Document Tabular Section Skill

Use this skill when:
- creating or refactoring the табличну частину of a `document` model
- a control inside a table cell still shows its own frame, rounded corners or gaps instead of merging with the grid
- rows look taller than the controls inside them
- adding decimal columns (quantity, price, amount) with live line/document totals
- a focus ring inside a cell does not line up with the cell borders

The CSS contract lives in the framework theme (`@client/styles/theme.css`, section
«Табличні частини документів») and ships with `@altera/client` — the application
never redefines those classes, it only uses them.

## Default path: the TabularSection primitive

Do NOT hand-write the table markup and row mechanics — use the primitive
(`@client/ui-kit/tabular/`). The form declares a typed section (columns, where
rows live, how a new row looks) and places two INDEPENDENT view components —
either can be replaced with custom markup, all actions are public on the section:

```ts
private lines = new TabularSection<InvoiceLine>(this, {
  rows: () => this.$root.item.lines,
  setRows: (lines) => { this.$root.item = { ...this.$root.item, lines }; },
  createLine: () => ({ id: null, lineNo: 0, bankId: "", bank: null, qty: "0.000", price: "0.00" }),
  columns: [
    { kind: "picker",  key: "bankId", refKey: "bank", title: "invoice.bank", url: "catalog/bank" },
    { kind: "decimal", key: "qty",   title: "invoice.qty",   precision: 3, width: "7rem" },
    { kind: "decimal", key: "price", title: "invoice.price", precision: 2, width: "7rem" },
    { kind: "computed", title: "invoice.amount", width: "7rem", total: true,
      value: (l) => dec(l.qty).mul(dec(l.price)).toFixed(2) },
  ],
});
// render():
//   <ui-tabular-toolbar .section=${this.lines}></ui-tabular-toolbar>
//   <ui-tabular-table   .section=${this.lines}></ui-tabular-table>
```

What the primitive provides: add / copy (id is stripped — the save merge would
otherwise overwrite the original) / delete / move up-down with automatic
`lineNo` renumbering, current-row highlight, live totals in `<tfoot>`
(`total: true`), empty state, canonical decimal normalization
(`section.normalizedRows()` — call it around save/get/post), and keyboard
entry: Enter walks editable cells and appends a row at the end, ↑/↓ move
between rows, Insert adds, Ctrl+Delete removes. Column kinds: `text`,
`decimal`, `picker`, `date`, `checkbox`, `computed`, and the escape hatch
`custom` (`render(line, index)` returns the `<td>` CONTENT — never the `<td>`
itself). Conditional columns: `visible: () => boolean` (see currency columns
in `manualEntryEdit.ts`). Two-level headers: ADJACENT columns sharing the same
`group: "key"` get one spanning header cell above their own titles («Дебет»
over «Рахунок» + «Субконто»); columns without `group` span both rows.
Multi-row records (1С style): a column with `row: 2` renders as a SECOND `<tr>`
of the same record, laid left-to-right under the row-1 grid; `span: N` says how
many grid columns its cell covers (default 1, remainder is padded). The `#` and
delete cells rowspan the whole record; a sub-row header line appears only if a
`row: 2` column has a `title`; `total` on sub-row columns is ignored. The typical use
is subconto printed under its account in a manual journal entry. Dynamic per-line
controls (subconto pickers whose model depends on the line's account) stay in
`custom` cells.

The CSS knowledge below still applies to `custom` cells and to fully
hand-written tables (which remain legal — the primitive is a default, not a
requirement).

## How many sections: as many as the subject area has

One tabular section is the **exception**, not the norm. In the systems these
documents come from a document usually has three to six, and the reason they are
separate is not technical:

> several sections exist not because they could not be merged into one, but
> because that is how a **person** fills them in.

Goods have a unit and a quantity, a service has a description, a payment has a
counterparty and a contract. One table with an account column per line does work
technically — the entry is the same for all of them — and it means two thirds of
the columns are empty in every row.

This has been got wrong twice and rewritten twice (an expense report with one
section instead of five, a goods receipt with one instead of six). Both times the
argument was "the sections of the source differ by *registers*, which we do not
have, and the accounting entry is identical" — technically true and wrong on the
substance. Model the sections the subject area has; posting merges them, the form
does not.

Each section is its own `TabularSection` over its own array in `$root`, its own
table in the database (`x-table`), and all of them are returned from `sections()`:

```ts
protected override sections(): FormSection[] { return [this.goods, this.services]; }
```

## Several sections go on TABS — `<ui-form-tabs>`

Three tables stacked vertically hide the header and each other. Put them on a tab
strip — one section visible at a time, the rest listed with their row counts — and
do **not** write that strip yourself:

```ts
import "@client/ui-kit/tabular/ui-form-tabs.ts";

// render():
html`<ui-form-tabs .tabs=${[
  { key: "goods",    titleKey: "supplierInvoice.goods",    section: this.goods },
  { key: "services", titleKey: "supplierInvoice.services", section: this.services },
  { key: "extra",    titleKey: "common.extra",             content: () => this.renderExtra() },
]}></ui-form-tabs>`
```

A tab with a `section` is drawn whole — toolbar, table, row count, error mark.
`content` is the escape hatch for a tab that holds ordinary fields instead of a
table. Only the active panel is rendered; the rows live in `$root`, so nothing is
lost while a table is out of the DOM. Everything the form has to declare is above:
`sections()` still returns all of the sections, and the rest is the component's.

Two of its jobs are worth knowing about, because a hand-written strip gets both
wrong:

- **the tab with the error opens itself.** `BaseUI` validates every section from
  `sections()`, hidden ones included — so the banner would say «Рядок 2, „Сума“…»
  about a row that is not on screen. The component reacts to the focus request the
  base makes (`pendingFocus` on the first section with errors), not to
  `errorCount`, so it switches once on a failed save instead of dragging the user
  back every time they look at a neighbouring section;
- **a tab may be a `<button>` again.** A strip written in the form's own markup
  sits inside the `<fieldset disabled>` of `renderFields()`, and that cascade kills
  every native control in it — the strip stops working exactly on a **posted**
  document, where editing is forbidden (fine) but *looking* at the other sections
  is the whole point. The cascade does not cross a shadow root, so inside the
  component the button works, keyboard and accessibility included.

## The trap: read this before touching any CSS

The framework theme contains a hand-written layer — `.input`, `.btn`,
`.join .join-item`, `.table td` — declared **outside any `@layer`**. It is plain CSS
shipped inside `@altera/client`, and `setAppStyles()` appends it **after** the
application's compiled Tailwind, so it beats the `utilities` layer regardless of
specificity. You cannot out-specify it from markup.

Per the CSS cascade, unlayered rules beat **every** cascade layer, including
Tailwind's `utilities`, regardless of specificity.

**Consequence: `p-0`, `border-0`, `rounded-none`, `h-*` in the markup silently do
nothing inside a table cell.** They lose to `.table td { padding: 5px 8px }` and
`.input { border: 1px solid }` no matter what you write.

Anything that must override the theme goes **into `theme.css`, below the theme
block, also unlayered**. Not into the markup, and not into a component's
`static styles` (a component sheet can be overridden by the adopted global one,
and `:host([attr])` additionally depends on the attribute surviving reflection).

Corollary: because `tw` is adopted into every shadow root via
`GlobalStyledLitElement`, a class defined in `theme.css` also reaches controls
**inside** component shadow roots. That is what makes a single global contract
possible across `ui-decimal`, `ui-picker` and the table itself.

## The contract

Three classes, defined once in the framework theme:

| Class | Where | Effect |
|-------|-------|--------|
| `.table-tabular` | on `<table>` | `td { padding: 0; vertical-align: middle }` — the cell is the only boundary |
| `.cell-text` | on text `<td>` | `padding: 0 8px` — horizontal padding for readability, **zero vertical** |
| `.cell-control` | on the control inside a component | height 24px, no border / radius / shadow / background, **no focus outline** |

Rules of the contract:
- row height is 24px and is set by the control, never by cell padding;
- the grid is drawn by the table only;
- **there is no focus ring inside a cell at all** — focus is visible through the
  caret and the selection. Do not try to align an `outline` with the cell borders;
  that is the mistake this skill exists to prevent.

## Markup

```html
<table class="table table-sm w-full table-tabular">
  <thead>…</thead>
  <tbody>
    <tr>
      <td class="cell-text">1</td>                              <!-- text -->
      <td><ui-picker cell …></ui-picker></td>                   <!-- control: no class -->
      <td><ui-decimal cell .precision=${3} …></ui-decimal></td>
      <td class="cell-text text-right tabular-nums">20.05</td>  <!-- computed -->
    </tr>
  </tbody>
</table>
```

Cells holding a control get **no class** — `.table-tabular td` already zeroes the
padding. Only text cells get `cell-text`.

## Controls in cells

Both shared controls take a boolean `cell` attribute, which switches them to the
contract (drops the label wrapper and applies `cell-control`):

- `<ui-decimal cell>` — decimal input; `scale` sets the number of decimals
- `<ui-picker cell url="catalog/bank">` — picker field; `url` is the
  **view route** (`family/model`), not an API path

When adding a **new** control that will be used in tabular sections, give it the
same `cell` property and let it put `cell-control` on its root element. Do not
invent a second styling mechanism, and do not change the control's default
(non-cell) appearance.

## Decimal columns

Follow `<ui-decimal>`; the rules that matter for the tabular section:

- keep decimal form fields as **strings** in the form schema
  (`Type.String({ default: "0.000" })`), not `Type.Number` — precision survives
  and typing does not fight the user. The DB-facing schema stays `numeric`;
  SQL reads `e->>'qty'`, which accepts a string unchanged;
- wire **two** events per cell: `@value-input` writes the raw text (so line and
  document totals recalculate live) and `@value-changed` writes the canonical
  value on blur/Enter;
- never rewrite the field being edited — the component keeps its own draft, so a
  parent re-render on every keystroke is safe;
- compute amounts and totals with `decimal.js`, never with float arithmetic;
- normalize every decimal field again in `save()`, even though blur handlers
  exist — a row may never lose focus before submit;
- typical precision: quantity 3, money 2, exchange rate 6.

## Required cells and per-cell checks

Declare them **on the column**, next to everything else about that column:

```ts
{ kind: "picker", key: "bankId", url: "catalog/bank", required: true },
{ kind: "picker", key: "warehouseId", required: (line) => line.kind === "goods" },
{ kind: "decimal", key: "qty",
  // NOT `required` — 0 is a filled value, not an empty one. "must be > 0" is
  // exactly what `check` is for.
  check: (v) => dec(v).gt(0) ? null : t("invoice.qtyPositive") },
```

Then let the form validate the section together with its header fields:

```ts
protected override sections(): FormSection[] { return [this.lines]; }
```

Everything else is automatic: the bad cell gets a tint and an inset outline, its
`title` carries the message, the form banner names row and column, and focus
lands on the first bad cell. Only **visible** columns are checked — a hidden
conditional column cannot be highlighted anyway.

Do not hand-write per-row loops in `saveItem()`; do not put the rule in the form
and the asterisk in the column. Deep dive (framework repository, not part of an
application): `docs/ui-form-validation.md`.

## Changing the set of sections is a MIGRATION

Publishing SQL never drops anything, so a table you renamed or split stays in the
database forever, and the old one keeps its rows. When the set of sections changes:

- `drop table if exists <old>` goes in `db/migration.sql` — explicitly, by you;
- if the old table already has rows, **move them first**. Splitting one section
  into several is not a rename: something in the row has to say which new table it
  belongs to. In practice that is the **account** — it is what made the line what
  it was (an expense report split into three sections was migrated exactly that
  way).

## Implementation flow

1. Render the section as a real `<table class="table table-sm table-tabular">`.
2. Text cells → `cell-text`; control cells → no class.
3. Controls → the `cell` attribute; new controls → add `cell` + `cell-control`.
4. Decimal columns → string fields in the form schema, `@value-input` +
   `@value-changed`, `Decimal` for amounts and totals.
5. Normalize decimals on load (SQL returns JSON numbers) and again in `save()`.
6. `deno check` on the edit form and the touched components.
7. Check visually: the row must be exactly as tall as the controls in it.

## Validation checklist

- controls fill the cell edge to edge — no gaps left, right, top or bottom
- the row is no taller than the controls (no stray vertical padding anywhere)
- no control renders its own border, radius or shadow inside the grid
- entering a cell shows no misaligned focus frame
- the same controls outside a tabular section still look normal (with label,
  border and focus ring)
- numeric columns and their totals are right-aligned
- typing does not reformat the field being edited; blur does
- the save payload contains canonical decimal strings

## Non-negotiable checks

- do not style cells or in-cell controls with Tailwind utilities — they lose to
  the unlayered theme; put the rule in `theme.css` below the theme
- do not give in-cell controls `height: 100%` or `min-height` — the row only
  grows from it; the control's own height defines the row
- do not add a focus outline inside a cell
- do not change the default appearance of a control to fix a tabular section —
  add or reuse the `cell` mode
- do not use float arithmetic for amounts, and do not turn decimal form fields
  into `number`
- do not re-implement per document what `.table-tabular` / `.cell-control`
  already give you

## Related

- [model-feature-architecture](../model-feature-architecture/SKILL.md) — where the edit form sits in the model folder
- [typebox-model-schema](../typebox-model-schema/SKILL.md) — form vs DB schema, `x-table` annotation for the lines array
- [model-list-form](../model-list-form/SKILL.md) — read-only lists (a different surface: `ModelListBase`, not this contract)
- [db-function-contract](../db-function-contract/SKILL.md) — how `save` merges the lines array
