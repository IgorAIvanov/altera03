---
name: document-tabular-section
description: Build an editable tabular section (табличну частину) of a document — controls that fill the table cell flush with the grid, decimal columns with live totals — using the shared .table-tabular / .cell-control contract instead of ad-hoc Tailwind utilities.
argument-hint: Describe the document model, which columns the tabular section has (picker / decimal / text), and whether the section needs live totals.
---

# Document Tabular Section Skill

Use this skill when:
- creating or refactoring the табличну частину of a `document` model
- a control inside a table cell still shows its own frame, rounded corners or gaps instead of merging with the grid
- rows look taller than the controls inside them
- adding decimal columns (quantity, price, amount) with live line/document totals
- a focus ring inside a cell does not line up with the cell borders

Reference implementation: `app/document/invoice/invoiceEdit.ts`.
Contract: `client/styles/tailwind.css`, section «Табличні частини документів».

## The trap: read this before touching any CSS

`client/styles/tailwind.css` contains a hand-written theme layer — `.input`,
`.btn`, `.join .join-item`, `.table td` — declared **outside any `@layer`**.

Per the CSS cascade, unlayered rules beat **every** cascade layer, including
Tailwind's `utilities`, regardless of specificity.

**Consequence: `p-0`, `border-0`, `rounded-none`, `h-*` in the markup silently do
nothing inside a table cell.** They lose to `.table td { padding: 5px 8px }` and
`.input { border: 1px solid }` no matter what you write.

Anything that must override the theme goes **into `tailwind.css`, below the theme
block, also unlayered**. Not into the markup, and not into a component's
`static styles` (a component sheet can be overridden by the adopted global one,
and `:host([attr])` additionally depends on the attribute surviving reflection).

Corollary: because `tw` is adopted into every shadow root via
`GlobalStyledLitElement`, a class defined in `tailwind.css` also reaches controls
**inside** component shadow roots. That is what makes a single global contract
possible across `ui-decimal`, `ui-picker` and the table itself.

## The contract

Three classes, defined once in `client/styles/tailwind.css`:

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

- `<ui-decimal cell>` — see [`ui-decimal.md`](../../../client/ui-kit/components/ui-decimal.md)
- `<ui-picker cell>` — see [`ui-picker.md`](../../../client/ui-kit/components/ui-picker.md)

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
  the unlayered theme; put the rule in `tailwind.css` below the theme
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
