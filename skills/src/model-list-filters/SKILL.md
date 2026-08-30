---
name: model-list-filters
description: Add filters (отбори) to a list or a report screen — period, reference picker, select, checkbox, text — wiring the schema annotation, the SQL and the screen markup together. Use whenever a screen needs to be narrowed by anything other than the search box, or when a filter is set but does not apply.
argument-hint: Describe the model, whether it is a list or a report, and which filters it needs (period, reference, status, free text).
metadata:
  audience: app
---

# Screen filters

Use this skill when:

- a list or a report needs to be narrowed by a period, a reference, a status or free text;
- an existing filter misbehaves — set but not applied, the picker shows an empty box, the
  badge counts wrong, `Reset` leaves something behind;
- you are about to hand-write filter SQL (for a generated model that is a mistake; for a
  report it is the only way — read on).

**Lists and reports share the machinery** — state in `$root.$filters`, the same
`setFilter`/`filterValue`, the same nested `filters` in the payload (`FilteredBase` is the
common base). What differs is one thing, at the end of this skill. For the screens
themselves see [model-list-form](../model-list-form/SKILL.md) and
[model-report-form](../model-report-form/SKILL.md).

## The three places, and who does what

A filter is one idea spread over three files. Getting it wrong usually means doing
somebody else's part by hand.

| Place | What lives there | Who writes it |
|---|---|---|
| `<model>.schema.ts` | `x-filter` on the field | you, one line |
| `db/_generated/<model>.crud.gen.sql` | parsing, `where`, the mirrored answer | `deno task sql:gen` |
| `<Model>List.ts` → `renderFilters()` | the controls and their binding | you |

A **report** has no generator: it owns its `$filters` schema and its `index` function, so
the middle row is yours too. Nothing else about it changes.

**You do not write filter SQL.** Annotate the field and regenerate. The panel, the
`Filters` toolbar button with the active count, `Reset`, and remembering the collapsed
state per user and per model all come from the base class — you only supply the markup.

Whether a screen has filters at all is detected from `renderFilters()` being overridden,
so there is no flag that can drift out of sync with what is drawn.

## Where the value lives

Filter values sit in `$root.$filters` and travel to SQL as a **nested `filters` object**,
next to `search`/`page`/`sortBy` — never spread among them, or a filter name would sooner
or later collide with a `$query` field.

An empty value (`""`, `null`, `undefined`, `false`) is **deleted**, not stored. Because of
that, "how many filters are active" and "what to send" are both just the contents of
`$filters`, and SQL never has to tell "absent" from "empty" — every generated condition is
`(v is null or …)`.

| Method | Purpose |
|---|---|
| `filterValue<T>(key)` | read; `undefined` means not set |
| `setFilter(key, value, {debounce})` | write one, reload from page 1 |
| `setFilters(patch, {debounce})` | write several in **one** request |
| `bindFilter(key, {debounce})` | ready-made handler for a native `input`/`select` |
| `resetFilters()` | back to `defaultFilters()`, not to empty |
| `defaultFilters()` | what the screen opens with — override to declare |

`bindFilter` covers native controls only. ui-kit components differ in their events
(`value-changed`, `period-changed`, each with its own `detail`), so the
screen wires those itself through `setFilter` — exactly like `BaseUI.bindTo` for fields.

## The annotation

```ts
// invoice.schema.ts
counterpartyId: Type.String({
  "x-db-type": "bigint",
  "x-filter": true,
  "x-ref": { model: "counterparty", display: "name", as: "counterparty" },
}),
```

| Form | Payload key(s) | Generated condition |
|------|----------------|---------------------|
| `true` | `<field>` | `col = value` |
| `true` + `x-ref` | `<as>` (object!) | `col = value->>'id'` |
| `{ op: "range" }` | `<field>From`, `<field>To` | `col >= from`, `col <= to` |
| `{ op: "like" }` | `<field>` | `col ilike '%value%'` |
| `{ op: "range", key: "date" }` | `dateFrom`, `dateTo` | rename the payload keys |

`docDate` and `isPosted` are annotated in the shared `DocumentHeaderSchema`, so **every
document list can already filter by period and posted state** — nothing to declare, and
nothing happens until a screen draws the panel.

## A question asked in whole units

Not every period is a range. A month-end closing statement, a quarterly return, a yearly
balance — the answer does not change with the day, because the question was asked in
months. Such a screen filters by **one value**, the first day of the unit, and the
annotation is the plain scalar form, not `range`:

```ts
// closing.schema.ts — the filter is one date, so it is one key
period: Type.String({ "x-db-type": "date", "x-filter": true }),   // col = value
```

Reaching for `{ op: "range" }` here is the mistake to expect, because the control is
called a period. A range would let the user ask for a month and a half, which is a
question the report cannot answer.

Draw it with `<ui-period units="…">`, which picks the unit itself — a strip of units, a
`‹ 2026 ›` navigator and a grid of 12 months, 4 quarters or 12 years:

```ts
import "@client/ui-kit/components/ui-period.ts";

<ui-period
  units="month"
  .label=${t("closing.period")}
  .value=${this.filterValue<string>("period") ?? ""}
  @period-changed=${(e: PeriodEvent) => this.setFilter("period", e.detail.dateFrom)}
></ui-period>
```

- **`units` lists the units, in the order you want the tabs**: `month`, `quarter`, `year`
  and `custom` (an arbitrary range as one more tab). One unit draws no tab strip at all —
  a choice of one is not a choice. No `units` at all leaves the eight presets, unchanged.
- **`value` is the start of the unit**, and it is normalised to it: 17 August put into a
  month field means August and reads back as `2026-08-01`. `dateFrom`/`dateTo` stay
  available, so a screen that wants the pair binds those instead and `setFilters` both
  bounds together.
- **the event carries `unit`** — the unit the period equals exactly, or `null` for an
  arbitrary span. One handler then serves both shapes.
- day and week are **not** offered: their grid is a calendar, and that is `<ui-date>`.

What this replaces is a `<ui-date>` with the value rounded down in the handler. It works,
and it lies to the user: the box shows `01.08.2026` as if the day mattered, and the
calendar offers to pick the 17th and silently turns it into August. Requires
`@altera/client` 0.13.4.

## A reference filter is ONE key holding an object

This is the rule most likely to be got wrong, so it is stated plainly:

```jsonc
// ✓ one filter, one key
"filters": { "counterparty": { "id": "4", "name": "Fierst" } }

// ✗ never: an id and a label as two entries
"filters": { "counterpartyId": "4", "counterparty": { "id": "4", "name": "Fierst" } }
```

The id selects the records, the label draws the picker. SQL reads **only the id** out of
the object, and returns the same key rebuilt from that id plus the display value taken
from the database — so the answer *refines* the filter rather than adding a second entry
beside it, and the label shown is always the database's, never the client's guess.

Splitting it in two looks natural and costs two silent defects: the badge on the *Filters*
button counts the label as a filter of its own (one chosen counterparty shows «2»), and
clearing the id leaves the label behind forever, because the client keeps sending it back
and the server returns it unchanged.

## Worked example — a document list

Everything below is one `renderFilters()`, and it is the whole of the screen's filter code.

```ts
import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { ModelListBase, type ListColumn } from "@client/ui-kit/base/model-list-base.ts";
import type { InvoiceRow } from "./invoice.schema.ts";
// The screen imports the controls it actually uses — the table base knows nothing
// about ui-kit components, or every list and every picker dialog would carry them.
import "@client/ui-kit/components/ui-period.ts";
import "@client/ui-kit/components/ui-picker.ts";
import "@client/ui-kit/components/ui-select.ts";

type PeriodEvent = CustomEvent<{ dateFrom: string; dateTo: string }>;
type PickEvent = CustomEvent<{ id: string; label: string }>;
type SelectEvent = CustomEvent<{ value: string }>;
/** Reference filter value: the id selects, `name` is what the picker shows. */
type FilterRef = { id: string; name: string };

@customElement("invoice-list")
export class InvoiceList extends ModelListBase<InvoiceRow> {
  protected model = "invoice";
  protected editRoute = "document/invoice/edit";
  protected columns: ListColumn<InvoiceRow>[] = [ /* … */ ];

  protected override renderFilters() {
    const counterparty = this.filterValue<FilterRef>("counterparty");

    return html`
      <!-- Period: both bounds in ONE write. Two consecutive setFilter calls would
           fire two requests, and the second would cancel the first. -->
      <ui-period
        .label=${this.t("period.label")}
        .dateFrom=${this.filterValue<string>("dateFrom") ?? ""}
        .dateTo=${this.filterValue<string>("dateTo") ?? ""}
        @period-changed=${(e: PeriodEvent) =>
          this.setFilters({ dateFrom: e.detail.dateFrom, dateTo: e.detail.dateTo })}
      ></ui-period>

      <!-- Reference: one key, object value. Clearing writes null → key deleted. -->
      <ui-picker
        .label=${this.t("invoice.counterparty")}
        url="catalog/counterparty" show-clear
        .value=${counterparty ?? null}
        @value-changed=${(e: PickerChangeEvent) => this.setFilter("counterparty", e.detail.value)}
      ></ui-picker>

      <!-- Closed set of values: ui-select, placeholder is the "any" option.
           Its empty value is deleted, so "any" means "no filter". -->
      <ui-select
        .label=${this.t("invoice.state")}
        size="sm"
        .placeholder=${this.t("common.any")}
        .options=${[
          { value: "draft", label: this.t("invoice.draft") },
          { value: "sent", label: this.t("invoice.sent") },
        ]}
        .value=${this.filterValue<string>("state") ?? ""}
        @value-changed=${(e: SelectEvent) => this.setFilter("state", e.detail.value)}
      ></ui-select>

      <!-- Native control: bindFilter is enough. An unchecked box is `false`,
           i.e. deleted — so this is "posted only", never "unposted only". -->
      <label class="flex items-center gap-2">
        <input type="checkbox" class="checkbox checkbox-xs"
          .checked=${this.filterValue("isPosted") === true}
          @change=${this.bindFilter("isPosted")} />
        <span>${this.t("document.posted")}</span>
      </label>

      <!-- Typed input: debounce, or every keystroke is a request. -->
      <label class="flex flex-col gap-1">
        <span class="label text-sm leading-none">${this.t("invoice.number")}</span>
        <input type="text" class="input input-sm"
          .value=${this.filterValue<string>("number") ?? ""}
          @input=${this.bindFilter("number", { debounce: true })} />
      </label>
    `;
  }
}
```

Two-state versus three-state is a decision, not a detail. A checkbox can only say
"posted only" — the unchecked state is `false`, which is deleted, i.e. *no filter*. When
the screen genuinely needs "unposted only", use a `ui-select` with three options and
string values (`""` / `"yes"` / `"no"`); a boolean cannot express it.

## Reports

A report uses the same contract and differs in exactly two ways:

- **a filter change does not rebuild it.** `onFiltersChanged()` stays empty (a list
  overrides it to `reload()`) — a turnover sheet for a year is not something to re-run on
  every click in a picker. `Refresh` builds it, `canRun` guards the required filters, and
  `buildReport()` sends `this.filtersPayload()`;
- **the filters are drawn under the toolbar**, not in the collapsible right-hand panel:
  in a report they are filled in *before* anything appears, so hiding them is pointless.

Because it does not rebuild itself, a report **shows when it has gone out of date**: the
base blurs the body and floats a `Rebuild` notice over it as soon as a filter is touched
after the report was built. Nothing to maintain on your side — and it is the reason the
"no auto-rebuild" rule is safe to keep.

Everything else is identical, including the reference-filter rule. Reports have no
generator, so their `index` function is hand-written — see the next section; the payload
contract does not change because of that, which is exactly the point.

Drill-down also travels through the filters: `tab.open` `params` land straight in
`$filters` of the target report, so the keys one report passes are the keys the other
filters by, with nothing translated on the way.

## When SQL is hand-written

Not every model is generated — admin models declare `"sql": { "generate": false }`, and
reports have no generator at all. Then you write the parsing yourself, and the contract is
exactly the same: read
`payload->'filters'`, take only the id out of a reference, return the key rebuilt with the
label. From `app.audit_log_list`:

```sql
with params as (
  select
    nullif(f->>'dateFrom', '')::date                as date_from,
    nullif(f->>'dateTo', '')::date                  as date_to,
    -- Reference filter: one key holding an object; only the id matters here.
    nullif(f->'user'->>'id', '')::bigint            as f_user_id,
    nullif(f->>'model', '')                         as f_model,
    -- Three-state goes as a string: `false` would be deleted client-side,
    -- so "failures only" would never reach the server at all.
    case f->>'result' when 'success' then true when 'failure' then false else null end
                                                    as f_success
  from (select coalesce(payload->'filters', '{}'::jsonb) as f) src
),
filters_out as (
  select (select coalesce(payload->'filters', '{}'::jsonb))
    || jsonb_strip_nulls(jsonb_build_object(
         'user',
         (select jsonb_build_object('id', u.id::text, 'name', u.full_name)
          from app.users u cross join params p where u.id = p.f_user_id)
       )) as value
)
-- … where (p.date_from is null or l.occurred_at >= p.date_from)
--       and (p.date_to   is null or l.occurred_at <  p.date_to + 1)
--       and (p.f_user_id is null or l.user_id = p.f_user_id)
-- … and in the envelope:  '$filters', (select value from filters_out)
```

Three things to copy from it:

- **the upper bound of a period over a `timestamp` is `< to + 1`**, not `<= to` —
  otherwise the whole last day except midnight falls out of the result. It also keeps the
  index usable, unlike casting the column to `date`;
- **`jsonb_strip_nulls` around the rebuilt reference** — if the record behind the id is
  gone, the key keeps what the client sent instead of being wiped to `null`;
- **wrap the search condition in brackets** before adding `and` for the filters. Without
  them the first `and` binds to the last `or` of the search, and the filters apply only to
  that branch. This one type-checks, runs, and returns plausible rows.

## Empty result

Nothing to do: `QueryTableBase.renderEmpty()` already tells "nothing matches the selected
filters" from "no data" and offers `Reset` right there. Do not hand-write an empty state
on a table screen.

## Traps

- **A key that does not match is silent.** `jsonb` ignores unknown keys, so a filter with
  a typo simply does nothing — no error anywhere. The key in `renderFilters()`, the key in
  the payload and the key the SQL reads are one and the same string.
- **`setFilters` for anything that produces several values at once.** `<ui-period>` emits
  both bounds together; two `setFilter` calls would fire two requests where the second
  cancels the first.
- **A period is not always a range** — see "A question asked in whole units" above before
  reaching for `{ op: "range" }`.
- **`debounce` is for typed text only.** A select, a date, a checkbox or a picker produce
  one value per user action — delaying them just makes the screen feel broken.
- **Changing a filter reloads from page 1** and clears checked rows: a different result set
  makes old marks meaningless. Paging and sorting keep them.
- **Filters go to the right, not above the table** — the base puts them there. On a
  hierarchical catalogue the panel and the group tree share that one column, filters on
  top, tree below. A picker dialog is the exception the base handles itself: there the
  panel is a strip above the table, because the dialog is narrow and short-lived.

## The screen opens with its defaults, and Reset returns to them

```ts
protected override defaultFilters() {
  return { ...super.defaultFilters(), dateFrom: periodStart(), dateTo: periodEnd() };
}
```

A document journal opens narrowed — to the current organisation (the base does that) and to
the period from the user's settings. A journal over all time is the most expensive query on
the screen, and without an organisation it shows two sets of books mixed together. So
«Скинути» returns the filters to that state rather than emptying them.

`defaultFilters()` is what the screen **opens** with, not only what `Reset` restores: the
base seeds it into `$filters` before the first request, so there is no extra round trip and
no flash of unfiltered rows. It fills only keys that are still unset — a restored tab or a
link that carries its own filters keeps them.

Always call `super.defaultFilters()`; skipping it silently drops the base's own default.
Do not override `resetFilters()` and do not hide the button with CSS — both were workarounds
for the old behaviour. `filterReset = false` removes the button if a screen truly has nothing
to reset.

## The organisation filter is a flag, not markup

A document journal never writes this one by hand:

```ts
protected override organizationFilter = true;
```

`organization_id` lives in `app.document` and its `x-filter` is declared in the core
`DocumentHeaderSchema`, so there is nothing for you to annotate and nothing to render.
The base supplies the default (the current organisation, seeded before the first load),
the «all organisations» option that clears it, and silence when only one organisation
exists.

Do **not** add your own organisation picker to `renderFilters()` — you would get two
controls over one key, and yours would have neither the default nor the auto-hide.

The framework learns the organisations from the application, registered once in the
composition root; without that registration it behaves as if there were one organisation:

```ts
// app/main.ts
setOrganizationContext({ current: () => currentOrg(), list: () => knownOrgs() });
```

## Rules

- One line in the schema per filter; regenerate with `deno task sql:gen <family>/<model>`
  and commit the generated SQL — it is a source file, not a build product.
- A reference filter is one key with an object value. Never an `…Id` plus a label.
- The markup is yours, the panel is not: no `Filters` button, no `Reset`, no collapse
  state written by hand.
- Localise every caption; do not redefine framework-wide `common.*` keys.

## Related

- [model-list-form](../model-list-form/SKILL.md) — the list screen the panel belongs to.
- [model-report-form](../model-report-form/SKILL.md) — the report screen; same filters,
  built on `Refresh`.
- [typebox-model-schema](../typebox-model-schema/SKILL.md) — the `x-filter` annotation.
- [db-function-contract](../db-function-contract/SKILL.md) — the `list` payload and envelope.
- [screen-design-rules](../screen-design-rules/SKILL.md) — captions, widths, empty states.

## Narrowing a picker is the same declaration, not a new one

A form often needs a picker to show a subset: accounts of *this* organization,
contracts of *this* counterparty, goods of *this* warehouse. That narrowing uses
the very `x-filter` declarations this skill is about — the generator now builds
them for `lookup` as well as for `list`:

```html
<ui-picker url="catalog/bank_account"
  .filters=${{ organizationId: item.organizationId }}
  .value=${item.bankAccount ?? null}
  @value-changed=${(e) => this.setRef("bankAccount", e.detail.value)}
></ui-picker>
```

One property drives both ways of choosing — the dropdown and the 🔍 dialog. A
picker narrowed in one and complete in the other is worse than one that is not
narrowed at all, because the mistake is invisible.

**This is not a list filter, even though it reuses the declaration.** In a list
the user sets the filter from the panel and may clear it; here the form sets it
and the user must not be able to: an account of your own organization in the
"payer's account" field is not a narrowed choice, it is a data entry error.

**A picker dialog can have filters of its own, and they are a different thing.**
`.filters` narrows; `.pickerParams = { filters: … }` sets the dialog's *initial*
panel state, which the user may then change (`Reset` returns to it, not to
nothing). Declare the controls in the dialog's `renderFilters()` — see
[model-picker-form](../model-picker-form/SKILL.md).

**An unknown key is refused, not ignored.** A form that narrowed a picker
believes it narrowed it; silently dropping a mistyped filter name leaves the full
list on screen and no trace anywhere. A model that declares no filters refuses
any set at all, for the same reason.
