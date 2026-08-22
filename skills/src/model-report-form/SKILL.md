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
| `hasData` | no | what counts as data (default: `$root.rows` is non-empty) |
| `emptyHint()` | no | what narrowed the result (default: `printSubtitle()`) |

## The empty report is drawn by the base

`renderBody()` is called **only when there is data**. Otherwise the base draws
the empty state, and it tells two cases apart: the report has not been built yet
(«press Refresh») versus it was built and came back empty («no data» plus the
selection that produced it — organization, period).

That difference matters more in a report than in a list: a report's filter is
mandatory, so "we are looking in the wrong place" is the *usual* reason for an
empty screen — a second organization in the database, a period with no documents
— and it is the easiest thing to mistake for a broken report. People go looking
in the SQL.

So **do not write your own «no data» row inside `<tbody>`** — it is unreachable
now. And if an empty row list is still a meaningful answer for your report,
override `hasData` rather than fighting the base: an account card with an opening
balance and no movements in the period has an answer to show, and the same flag
also enables Print and Excel.

A report keeps its own root schema (`<model>.schema.ts` with `$filters`, `rows`,
`totals`) and passes it to `super(...)` — unlike a list, where the base supplies
a generic schema.

## Filters — the same machinery as a list

Report filters are not a separate invention: `$root.$filters`, written through
`setFilter` / `setFilters`, read through `filterValue`, and sent to SQL as a nested
`filters` object. A reference filter is **one key holding `{id, name}`** — never an
`…Id` plus a separate label. The whole contract, with the reasoning and the traps, is in
**[model-list-filters](../model-list-filters/SKILL.md)**; read it before adding a filter
to a report.

**A report whose question is a whole month filters by one date, not a range.** Closing
statements, returns and yearly balances are asked in units, and a range would offer to ask
for a month and a half — a question the report cannot answer. The annotation is the plain
`"x-filter": true`, and the control is `<ui-period units="month">`, which picks the unit
itself instead of taking a date and rounding it behind the user's back. See
[A question asked in whole units](../model-list-filters/SKILL.md).

Two things are specific to reports, and both follow from what a report costs:

- **a filter change does not rebuild the report.** `onFiltersChanged()` stays empty (a
  list overrides it to reload) — a turnover sheet for a year is not something to re-run on
  every click in a picker. `Refresh` builds it, and `canRun` guards the required filters;
- **only the query is hand-written.** `sql:gen` generates the `index` wrapper from the
  filters schema — filter parsing, the required-filter refusal, the `$filters` echo and
  the envelope. What you write is the part a report exists for: the query itself.

**A report that no longer matches its filters says so.** Change a filter after the report
was built and the base blurs the body, disables clicking through it, and floats a
`Parameters changed` notice with a `Rebuild` button over it. Nothing to declare: the base
sets the mark in `onFiltersChanged()` and clears it when the `index` command returns —
one place that every path to building the report goes through. Without it the screen would
show numbers for the old filters under a new period in the panel: everything looks fine,
the number is wrong, and it prints that way too. On paper the blur is gone — printing is a
deliberate act, and a blurred sheet would just be spoilt.

```ts
protected override get canRun(): boolean {
  return !this.busy && !!this.filterValue<Ref>("organization")?.id;
}

protected override async buildReport() {
  await this.loadInto("index", this.filtersPayload());   // → { filters: {…} }
}
```

## SQL: a generated wrapper and a hand-written body

Two functions, and only the second one is yours:

| file | function | who writes it |
|---|---|---|
| `db/_generated/<report>.index.gen.sql` | `app.<report>_index(user_id, payload)` | `deno task sql:gen` |
| `db/<report>.sql` | `app.<report>_data(user_id, filters)` | you |

The wrapper reads the **filters schema** — `<Pascal>FiltersSchema`, the same one the
screen binds to — and does everything around the query:

- parses `payload.filters`, collapsing a reference to its id: `organization` (an object
  `{id, name}`) arrives at your function as `organizationId`, an empty string becomes
  "not set";
- refuses when a required filter is missing, with the message bound to that field —
  so an unset organization is a clear refusal, not an empty sheet;
- echoes `$filters` back with the label read from the database, so the picker in the
  panel is not left blank next to a filter that is in force;
- wraps your result in the envelope.

Declare the origin of a reference filter in the schema — without it the wrapper has
nowhere to read the label from. Requiredness is `Type.Optional`, exactly as in a form:

```ts
const refFilter = (model: string) =>
  Type.Union([Type.Object({ id: Type.String(), name: Type.String() }), Type.Null()],
    { default: null, "x-ref": { model } });

export const TurnoverBalanceFiltersSchema = Type.Object({
  organization: refFilter("organization"),                    // required
  dateFrom:     Type.Optional(Type.String({ default: "" })),  // optional
  dateTo:       Type.Optional(Type.String({ default: "" })),
});
```

**The key you declare must be the key the label comes back under.** The echo is
built from the target model's display column — by default its *first* field marked
`x-lookup`, which is `name` in most catalogues and `code` in some (warehouse, unit
of measure, bank account). The echo lands first in `v_filters || …`, so a mismatch
overwrites the label the form had put there: the filter applies, the figures are
right, and the picker in the panel goes blank. Name the column explicitly whenever
the target's first `x-lookup` is not what you declared:

```ts
const refFilter = (model: string, display?: string) =>
  Type.Union([Type.Object({ id: Type.String(), name: Type.String() }), Type.Null()],
    { default: null, "x-ref": { model, ...(display ? { display } : {}) } });

warehouse: Type.Optional(refFilter("warehouse", "name")),
```

`sql:gen` refuses on the mismatch and names both halves, so this is a generation
error rather than something to find on the screen.

Your function then starts with parsed values and returns only the contents of `data` —
no envelope, no echo, and no check that a required filter is set:

```sql
create function app.turnover_balance_data(user_id bigint, filters jsonb)
returns jsonb
language sql
as $$
  with params as (
    select
      nullif(filters->>'organizationId', '')::bigint as org_id,
      nullif(filters->>'dateFrom', '')::date         as date_from,
      nullif(filters->>'dateTo', '')::date           as date_to
  ),
  -- … the query …
  select jsonb_build_object('rows', …, 'totals', …);   -- 'extra' if the screen needs it
$$;
```

**Drill-down goes through the filters too.** `tab.open` `params` land straight in
`$filters` of the target report (`ReportBase.applyParams`), so the keys a report passes
are the keys the other one filters by — nothing is translated on the way:

```ts
bus.emit({
  type: "tab.open",
  route: "report/account_card/list",
  params: { organization: f.organization, accountCode: row.accountCode,
            dateFrom: f.dateFrom, dateTo: f.dateTo },
});
```

Filters are drawn **under the toolbar**, not in the collapsible right-hand panel a list
uses: in a report they are filled in *before* anything appears, so hiding them is
pointless.

## Canonical example

Two shapes cover almost everything, and both are just subclasses:

- a **turnover sheet** — own filters (organization, period, account), drill-down to
  another report on row click, two-level header with `colspan`/`rowspan`, totals in
  `tfoot`;
- a **movements listing** — no visible filters (`renderFilters()` returns nothing),
  opened only by navigation from a document, so its single `documentId` filter arrives
  through `applyParams` and the report builds itself at once.

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

## Related

- [model-list-filters](../model-list-filters/SKILL.md) — the filter contract, shared with
  list screens.
- [screen-design-rules](../screen-design-rules/SKILL.md) — density, colours, empty states.

## Details

Deep dive (framework repository, not part of an application): `docs/report-screen.md`
— the three levels of print CSS, the sheet model, and how to verify a generated
`.xlsx` without Excel.
