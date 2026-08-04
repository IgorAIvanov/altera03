---
name: model-report-form
description: Build a report screen (turnover sheet, account card, register listing) by extending the shared ReportBase class, which already provides the sticky toolbar with refresh, print and Excel export.
argument-hint: Describe the report model name, its filters (organization, period, account) and the columns of its table.
metadata:
  audience: app
---

# Model Report Form Skill

Use this skill when:
- creating a `<Report>Report.ts` screen for a model of type `report`
- adding print or Excel export to a screen that shows a report table
- changing filters or columns of an existing report

**Do not hand-write the toolbar, the print logic or any Excel/CSV generation.**
All of it lives in the shared base class `ReportBase`. Print and export take the
already rendered table, so a report gets both actions with zero configuration —
no column metadata, no manifest block, no server command.

## Base class

`@client/ui-kit/base/report-base.ts` → `ReportBase<Root> extends BaseUI<Root>`
(`@client/` is the alias for the `@altera/client` package).

It owns: the sticky toolbar (**Оновити / Друк / Excel**), the error banner, the
print-only header (report title + subtitle), `window.print()` wiring and the
`.xlsx` build + download.

The subclass declares:

| Member | Required | What it is |
| --- | --- | --- |
| `model` | yes | model name from `manifest.json` |
| `reportTitle` | yes | locale key of the report name (paper + file + sheet name) |
| `buildReport()` | yes | run the query, usually `loadInto("index", …)` |
| `renderBody()` | yes | the `<table>` itself |
| `canRun` | no | guard for required filters (default: not busy) |
| `renderFilters()` | no | pickers and dates under the toolbar |
| `renderToolbarExtra()` | no | extra action buttons in the toolbar |
| `printSubtitle()` | no | organization and period line under the title |

A report keeps its own root schema (`<model>.schema.ts` with `$query`, `rows`,
`totals`) and passes it to `super(...)` — unlike a list, where the base supplies
a generic schema.

## Canonical example

Two shapes cover almost everything, and both are just subclasses:

- a **turnover sheet** — own filters (organization, period, account), drill-down to
  another report on row click, two-level header with `colspan`/`rowspan`, totals in
  `tfoot`;
- a **movements listing** — no filters of its own (`renderFilters()` returns
  nothing), opened only by navigation from a document, so `buildReport()` reads its
  parameters from the route.

## Markup rules that the export depends on

The Excel export reads the rendered table, so the classes that shape the screen
also shape the file:

- **money and quantity cells get `text-right tabular-nums`** — `tabular-nums` is
  what tells the export «this is a number»; without it the value lands in Excel
  as text and the column does not sum;
- **codes must NOT get `tabular-nums`** — an account code would turn into a
  number and lose leading zeros;
- `<th>` means header or totals (bold + fill), `colspan`/`rowspan` become merged
  cells — no extra attributes needed;
- `no-print` marks screen-only elements (hints, navigation buttons);
- do not use `table-tabular` / `cell-text` in a report: that contract belongs to
  editable document sections and zeroes the vertical padding of rows.

## Access

A report is a normal model command, so the non-standard `index` command must
declare its permission in `manifest.json`:

```json
"commands": {
  "sql": { "index": "turnover_balance_index" },
  "access": { "index": "view" }
}
```

See [model-command-access](../model-command-access/SKILL.md). Print and export
need no command of their own — both happen in the browser over data already
loaded by `index`.

## Details

Deep dive (framework repository, not part of an application): `docs/report-screen.md`
— the three levels of print CSS, the sheet model, and how to verify a generated
`.xlsx` without Excel.
