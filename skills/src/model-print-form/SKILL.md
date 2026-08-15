---
name: model-print-form
description: Add a printed form (PDF) to a model — data command, template file, manifest block and print button — using the core print runtime instead of writing any rendering, template parsing or PDF code.
argument-hint: Describe the model and what the printed form must show (header fields, table columns, totals, signatures).
metadata:
  audience: app
---

# Model Print Form Skill

Use this skill when:
- a model needs a printed form / PDF (накладна, акт, рахунок, довідка)
- an existing printed form must change (new field, new column, new totals row)
- a second template is added to a model that already prints

**Printing is core.** The `@altera/server` package owns the template format, the render
plan and the PDF renderer. Never write PDF generation, template parsing, HTML-to-PDF,
or client-side rendering. The application supplies only **data** and a **template**.

## The four artifacts

| # | File | What it is |
|---|------|-----------|
| 1 | `app/<family>/<model>/db/<model>.custom.sql` | SQL function `app.<model>_print_data(user_id, payload)` — denormalized data for print |
| 2 | `app/<family>/<model>/prints/<model>_<code>.template.json` | the template (source of the system template, seeded into the DB) |
| 3 | `app/<family>/<model>/manifest.json` | `prints` block + `commands.sql.printData` |
| 4 | `app/<family>/<model>/<Model>Edit.ts` | the print button |

All four are shown in full below, on an `invoice` document.

## 1. Manifest

```json
{
  "prints": {
    "invoice_default": {
      "templateFile": "./prints/invoice_default.template.json",
      "dataCommand": "printData"
    }
  },
  "commands": {
    "sql": { "printData": "invoice_print_data" }
  }
}
```

**Do NOT declare `commands.ts.printPdf`.** `deno task sql:registry` derives it from a
non-empty `prints` block and binds the core handler `runtime.printPdf`. Writing it by hand is
redundant — it is an override slot, only for a model that needs its own print handler
instead of the core one.

`commands.sql.printData` **is** required: `printData` is not one of the five standard
commands (`list`/`get`/`save`/`delete`/`lookup`), so the runtime cannot derive the
function name by convention and refuses to guess.

The key in `prints` (`invoice_default`) becomes the template `code` in `app.print_template`
and must be a unique lowercase identifier.

## 2. Data command

Signature is the standard model contract — see
[db-function-contract](../db-function-contract/SKILL.md):

```sql
app.<model>_print_data(user_id bigint, payload jsonb) returns jsonb
```

The payload is whatever the button sent (normally `{ "id": "..." }`). The renderer reads
**one root** — `data.item`. Everything else in the envelope (`rows`, `options`, `totals`)
is ignored by print.

Rules for the returned `item` — this is a **print projection, not the edit payload**:

- names instead of ids (`counterpartyName`, not `counterpartyId`);
- amounts already summed (`amount` per line, `total` per document) — the SQL that owns
  the document's arithmetic also owns the printed numbers, so rounding cannot diverge;
- dates and money already **strings**: `to_char(d, 'DD.MM.YYYY')`, `to_char(v, 'FM9999999990.00')`.
  The renderer does not format — it prints what it is given;
- `coalesce(..., '')` on every text field — the renderer prints nothing for null, but an
  explicit empty string keeps the projection honest;
- an explicit line number (`line_no` → `index`), not the array position;
- the array of lines ordered inside the function (`jsonb_agg(... order by l.line_no)`).

Keep this structure **stable**: template bindings are dotted paths into it, and templates
edited by users live in the database, out of reach of a refactor.

A complete data command (in `db/<model>.custom.sql`, because it is non-standard —
the generator does not emit it):

```sql
drop function if exists app.invoice_print_data(bigint, jsonb);
create function app.invoice_print_data(user_id bigint, payload jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'item', (
        select jsonb_build_object(
          'document', jsonb_build_object(
            'id',               h.id::text,
            'number',           coalesce(h.number, ''),
            'date',             to_char(h.doc_date, 'DD.MM.YYYY'),
            'counterpartyName', coalesce(c.name, ''),
            'total',            to_char(coalesce(sum_lines.total, 0), 'FM9999999990.00'),
            'lines',            coalesce(lines.items, '[]'::jsonb)
          )
        )
        from app.document h
        join app.invoice t on t.document_id = h.id
        left join app.counterparty c on c.id = t.counterparty_id
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'index',    l.line_no,
            'name',     coalesce(n.name, ''),
            'quantity', to_char(l.qty, 'FM9999999990.000'),
            'price',    to_char(l.price, 'FM9999999990.00'),
            'amount',   to_char(l.qty * l.price, 'FM9999999990.00')
          ) order by l.line_no) as items
          from app.invoice_line l
          left join app.nomenclature n on n.id = l.nomenclature_id
          where l.document_id = h.id
        ) lines on true
        left join lateral (
          select sum(l.qty * l.price) as total
          from app.invoice_line l
          where l.document_id = h.id
        ) sum_lines on true
        where h.id = nullif(payload->>'id', '')::bigint
      ),
      'rows',    '[]'::jsonb,
      'options', '{}'::jsonb,
      'totals',  '{}'::jsonb,
      'extra',   '{}'::jsonb
    ),
    'messages', '[]'::jsonb
  );
$$;
```

## 3. Template file

`schemaVersion: 2`, absolute layout, all numbers as **strings** (so a form field does not
jump while typing; `resolvePrintTemplateBlockPlacement` converts them).

```json
{
  "name": "Накладна — типова форма",
  "paperSize": "A4",
  "orientation": "portrait",
  "isDefault": true,
  "isActive": true,
  "schema": { "schemaVersion": 2, "blocks": [ … ] }
}
```

Block types: `text`, `field-list`, `table`, `image`, `horizontal-line`, `vertical-line`.
Every block has `key`, `placement` (`xPercent`/`yPercent`/`widthPercent`/`heightPercent`
in % of the print area = A4 minus 40pt margins) and `text` (fontSize, align, fontWeight, color).

### Binding paths

| Where | Root | Example |
|---|---|---|
| `text` block `path` | `data.item` | `document.title` |
| `image` block `path` | `data.item` | `invoice.sellerStamp` (a `data:` URI) |
| `field-list` item `path` | `data.item` | `document.counterpartyName` |
| table `source` | `data.item` | `document.lines` |
| cell `path` in section `row` | **one array record** | `name` — never `document.lines.name` |
| cell `path` in `header` / `footer` | `data.item` | `document.total` |

A static value **overrides** the binding — in a `text` block, an `image`, a table cell and a
barcode alike. One rule across the format, so you never have to recall where the priority is
reversed.

Logo, stamp and facsimile signature belong to the **organisation** you print on behalf of, not
to the blank — and a database holds several. Bind them; return a `data:` URI from the data
command. A hard-coded `src` is not a simplified document, it is a wrong one.

### A line of values with no caption

The blank's title («Рахунок на оплату № 12 від 02.02.2026 р.»), the summary line, a party's
details — these are values with no caption. Two ways, pick by whether it is one value or several:

```json
{ "type": "text", "path": "document.title" }
{ "type": "field-list", "items": [{ "key": "org", "label": "", "path": "org.name" }] }
```

An empty `label` prints the value alone. Do **not** fold the caption into the data command
(`titleTail`, `itemsSummary` and other halves of sentences): the moment the data command
returns fragments of phrases instead of values, presentation has leaked into the data, and the
next blank needs its own set of fields.

### Check the layout before the paper does

A blank breaks silently: a number wider than its cell wraps onto a second line, and a
**word** wider than its column does not wrap at all — it spills over the neighbour. Nothing
catches it; the SQL is green, the template valid, the data right.

Measure it in a probe, with the same code the renderer uses:

```ts
import {
  createPrintTextMeasurer,
  PRINT_CELL_PADDING,
  printContentWidth,
} from "@altera/server/print/metrics";

const measure = await createPrintTextMeasurer();          // once per run — embedding a font is not free
const usable = printContentWidth() * 0.10 - PRINT_CELL_PADDING * 2;

measure("1 234 567.89", 9) <= usable;
caption.split(/\s+/).every((word) => measure(word, 9, true) <= usable);
```

Measure a caption **by its longest word**, not by the whole string: wrapping is by words, so
two short words split across two lines happily — one long word never does.

Test with a realistic amount, not the demo one. A blank built around `12 000.00` looks
finished until the first invoice for `1 234 567.89`.

### Conditional parts: `visibleWhen`

A regulated blank is rarely one blank. The discount column, the «У т.ч. ПДВ» line, the returnable
packaging block, the footer with a facsimile — each is there or not **depending on the document**.
Bind one flag per variation:

```json
{ "type": "field-list", "visibleWhen": "invoice.hasVat", "items": [ … ] }
{ "key": "c_vat",  "widthPercent": "10", "visibleWhen": "invoice.hasVat" }
{ "key": "r_note", "cells": [ … ],       "visibleWhen": "note" }
{ "key": "vat", "label": "У т.ч. ПДВ", "path": "vat", "visibleWhen": "hasVat" }
```

It sits on **every** element: any block (lines, image and barcode included), a table column, a
row of any section, an item of a field list. Empty means always visible.

Scope is the same as `path` next to it: root data for blocks, columns, header/footer rows and
field items — **the record** for a row of the `row` section.

Compute the flag in the **data command** (`total_vat > 0 as "hasVat"`), never in the template:
the condition is a path, not an expression, because a bookkeeper edits the template. Falsy is
`false`, `0`, `""`, `[]`, `null`, a missing field — and the strings `"false"` / `"0"`, so a data
command that returns everything as text does not silently show the block.

Do **not** solve variation by shipping a template per combination: discounts × VAT × packaging ×
three footers is 24 templates of one invoice, all of them editable, and they diverge on the first
edit because whoever edits fixes the one they happened to open.

A hidden column hands its width to its neighbours by itself, and a cell merged across it narrows
rather than disappears — you do not compensate for either.

### Amount in words

A regulated blank needs the sum spelled out, and that sentence belongs to the **language**,
not to your application. Do not compute it in the data command — bind the number and let the
template say how to print it:

```json
{ "type": "field-list", "items": [
  { "key": "sum", "label": "Сума словами", "path": "document.total", "format": "amountInWords" }
]}
```

`format` works on a `text` block, a `field-list` item and a table cell. The same number can be bound twice
— once plain, once in words — because the data command knows nothing about presentation.

Language and currency come from the **template**, not from the data:

```json
{ "schemaVersion": 2, "locale": "uk", "currency": "UAH", "blocks": [ … ] }
```

Defaults are `uk` / `UAH`, so older templates keep working. Locales: `uk`, `ru`, `en`.
A currency whose word forms are not declared is refused — and, like a broken barcode value,
a refusal prints the plain number instead of killing the document, so **check the printed
result** rather than assuming it worked.

Output: `Одна тисяча двісті тридцять чотири гривні 56 коп.` — capital first letter, kopecks
in digits, as blanks require.

### Table = column grid + three sections

Columns carry **only** `key` and `widthPercent`. Titles live in cells, because one column
can sit under several header levels.

| Section | Printed |
|---|---|
| `header` | on every page |
| `row` | once per `source` record (may be several rows per record; a record is never split across pages) |
| `footer` | once, after the last record |

Cells take `colSpan`/`rowSpan` (as in HTML), a static `text` **or** a `path`; a non-empty
`text` wins over `path`. Sections are optional — a form whose total sits under the table
rather than in its last row simply omits `footer`, and printing does not care.

What makes them optional is `normalizePrintTemplateSchema`, which fills the missing ones
before anything reads the template. Both entries into printing go through it — the
`printPdf` command and the editor preview — so a stored template never reaches the render
plan half-described. **A template you read yourself does**, and that is the one way to meet
`Cannot read properties of undefined (reading 'filter')`: a layout probe, a migration, a
script that loads `prints/*.template.json` off disk and plans it. Normalize first, with the
same entry the editor uses:

```ts
import { normalizePrintTemplateSchema } from "@altera/server/print";

const schema = normalizePrintTemplateSchema(JSON.parse(await Deno.readTextFile(file)));
if (!schema) throw new Error("не schemaVersion 2 або порожній шаблон");
```

Padding the template file with `"footer": []` to get past that is a workaround for the
wrong thing — it fixes one file and leaves the next script to hit it again.

Totals are **read from the data** (`document.total`), never summed by the template.

## 4. Print button

The whole button is this method plus a toolbar entry calling it — `printPdf` is a core
TS command, the form only asks for it and shows the answer:

```ts
/** `data.extra` of the core printPdf command. */
interface PrintPdfExtra {
  fileName?: string;
  mimeType?: string;
  pdfBase64?: string;
}

private async printPdf() {
  const id = this.$root.item.id;
  if (!id) {
    this.messages = [{ type: "error", text: t("invoice.saveBeforePrint") }];
    return;
  }

  // Вікно — ДО await: інакше браузер вважає popup не ініційованим користувачем.
  const preview = globalThis.open("", "_blank");

  const env = await this.run<{ extra?: PrintPdfExtra }>("printPdf", { id });
  const pdfBase64 = env.data?.extra?.pdfBase64;
  if (!env.ok || !pdfBase64) {
    preview?.close();
    return;
  }

  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(
    new Blob([bytes], { type: env.data?.extra?.mimeType ?? "application/pdf" }),
  );

  if (preview) preview.location.href = url;
  else globalThis.open(url, "_blank");

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
```

Two details that are not optional:
- **open the window before `await`** — otherwise the browser treats the popup as
  non-user-initiated and blocks it;
- **refuse on an unsaved record** (`if (!item.id)`) — print reads from the database.

## Publish

```bash
deno task sql:registry && deno task sql:assemble && deno task sql:publish
```

`sql:registry` regenerates the model registry (this is where `printPdf` appears);
`sql:assemble` turns `prints/*.template.json` into `insert … on conflict (code) do nothing`.

**The runtime reads templates only from `app.print_template` — never from disk.** The file
in `prints/` is the *source* of the system template. `do nothing` means a republish will not
overwrite a template the user has edited. `"republishOnPublish": true` in the template file
switches that row to `do update` and **does** overwrite user edits — set it deliberately;
to refresh a system template once, deleting the row and publishing again is simpler.

Template selection at print time (`app.print_template_resolve`): explicit `templateCode`
from the payload → the row with `is_default` → the newest active one.

## Rules

- Never add `commands.ts.printPdf` — it is derived from `prints`.
- Never format dates or money in the template or on the client — the data command returns strings.
- Never compute totals in the template — return them from SQL.
- Never render or parse a template in `app/` or in the client; the client only opens the returned PDF.
- Row-section cell paths are relative to the record, not to the data root — the single most
  common template bug.
- The template file is a seed, not the runtime source: after publishing, edits belong in
  `admin/print_template/edit`, whose preview calls the same core renderer (`runtime.printPreview`).
- To bind fields in the editor, load the payload under "Дані прев'ю" — it runs the same
  data command the print runtime will run and builds the path list from the answer.

## Related

- Framework repository (not part of an application): `docs/print-subsystem.md` — the subsystem in full: file layout, multi-page rules, editor canvas.
- [db-function-contract](../db-function-contract/SKILL.md) — envelope and signature of the data command.
- [model-feature-architecture](../model-feature-architecture/SKILL.md) — where `prints/` sits in the model folder.
- [model-form-root](../model-form-root/SKILL.md) — the `$root` contract of the edit form that hosts the print button.
