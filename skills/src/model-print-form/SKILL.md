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

Block types: `text`, `field-list`, `table`, `image`, `barcode`, `char-cells`,
`horizontal-line`, `vertical-line`.
Every block has `key`, `placement` (`xPercent`/`yPercent`/`widthPercent`/`heightPercent`
in % of the print area = A4 minus 40pt margins) and `text` (fontSize, align, fontWeight, color).

**`yPercent` is the TOP of the block, the same for every type.** The content sits below
that edge — the cell frame hangs from it, the image and the table start at it, text is
pushed down from it by one letter height. So two blocks that must line up carry the *same*
`yPercent`; you do not compensate for the type of either. (Before server 0.23.0 a `text`
block anchored its first **baseline** at `yPercent`, so its letters stuck out above the
frame — old blanks carry hand-tuned offsets that no longer mean anything.)

### Coordinates for the header, flow for everything below it

A coordinate is right for the **header** — it matches the approved form to the millimetre.
Below the header a blank is made of blocks whose height is only known *after* rendering:
how many rows the header of a nineteen-column table took, how far the item description
wrapped, where the first table ended. Writing a coordinate there means predicting what the
renderer will compute later, and the only way to check the prediction is a finished PDF.

So a block can stand **under the previous one instead**:

```json
{ "key": "section_b_caption", "type": "text", "value": "Розділ Б",
  "placement": { "mode": "flow", "gapPt": "10", "xPercent": "0", "widthPercent": "100" } }
{ "key": "section_b", "type": "table",
  "placement": { "mode": "flow", "gapPt": "4", "xPercent": "0", "widthPercent": "100" } }
```

- «previous» means **the previous entry in `blocks`**, not the one above by coordinate; an
  absolute block moves the cursor too, so a stack naturally starts under the header;
- `yPercent` stays in a flow block and decides nothing on paper — it is where the frame sits
  on the editor canvas;
- a block that does not fit moves to the next page whole; `keepTogether` holds this block
  and the next one on one page (that is how «do not tear the signature off the statement»
  is said). A table ignores it — it splits itself, by record;
- **a page break is declared, not guessed** — `"pageBreakBefore": true` on the block:

  ```json
  { "key": "back_title", "type": "text", "value": "Зворотний бік акта",
    "pageBreakBefore": true,
    "placement": { "mode": "flow", "gapPt": "0", "xPercent": "0", "widthPercent": "100" } }
  ```

  Nothing above replaces it: flow moves what does not fit, `keepTogether` holds a group
  together, the footer heuristic looks at the space left. An approved two-sided form (НА-1,
  НА-3, М-2, an inventory list with a receipt on the back) needs the opposite — the back
  side starts on a new sheet ALWAYS, even when the front took half a page. Read in `flow`
  only, like `keepTogether`, and ignored on the blank's first block: an empty first sheet
  reads as broken printing, not as a break. Requires `@altera/server` 0.25.0;
- **a two-level header can be written as a list of columns** instead of `colSpan`/`rowSpan`:

  ```json
  "columns": [
    { "key": "c_inv",    "width": "4%",   "header": "Номери", "headerSub": "інвентарний" },
    { "key": "c_serial", "width": "5.5%", "header": "Номери", "headerSub": "заводський" },
    { "key": "c_year",   "width": "3%",   "header": "Рік випуску (побудови)" }
  ]
  ```

  The merge is not declared, it is derived: ADJACENT columns with the same `header` become
  one top-level cell, a column without `headerSub` spans both levels, and a list with no
  `headerSub` at all yields a single header row. Order is the order of the columns in the
  form, so the same caption twice in a blank stays two merges. A hand-written
  `sections.header` always wins — the short form applies only while that section is empty,
  which is where three levels, data-bound headers and spacer cells still live. Cells come
  out centred and bold; a column that needs otherwise says `headerAlign` /
  `headerFontWeight`. Requires `@altera/server` 0.25.1;
- **one flow block switches the footer heuristic off for the whole blank.** Without flow the
  renderer treats everything below the *first* table as footer and glues it under the *last*
  one — which is why a caption between two tables used to drag the whole footer onto sheet
  two. Do not mix the two: put the header on coordinates and everything from the first table
  down into flow.

### Where did it actually land

`renderPrintPdfWithLayout` returns the bytes **and** a layout report — key, type, start and
end page, `topPt`/`bottomPt` (PDF axis, y grows upwards) and `overflow`. Use it in a probe
instead of unpacking the content stream of a finished PDF:

```ts
import { renderPrintPdfWithLayout } from "@altera/server/print/render";

const { bytes, layout } = await renderPrintPdfWithLayout(template, data);
layout.filter((block) => block.overflow);            // what did not fit
layout.find((block) => block.key === "section_b");   // where the table ended up
```

**The two axes are measured against different sides**: width against the width of the
print area (515.28 pt on portrait A4), height against its height (761.89 pt). The same
square is therefore two different numbers — 13 pt is `2.52 %` wide and `1.71 %` tall. Where
a square is what you actually need — the character cells — leave the height at `0` and the
renderer makes it square for you.

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

To check how it *looks* rather than whether it fits, build the PDF in the probe — same
renderer the runtime uses:

```ts
import { normalizePrintTemplateSchema } from "@altera/server/print";
import { renderPrintPdf } from "@altera/server/print/render";

const schema = normalizePrintTemplateSchema(JSON.parse(await Deno.readTextFile(file)));
if (!schema) throw new Error("not schemaVersion 2, or no blocks");

await Deno.writeFile("out.pdf", await renderPrintPdf(
  { code, name, targetModel, dataCommand, orientation: "portrait", schema },
  printData,                       // the same `data.item` the data command returns
));
```

Normalise a template you read yourself — a file in `prints/` has not been through
`normalizePrintTemplateSchema`, and a half-described table is where
`Cannot read properties of undefined` comes from.

### A regulated form: character cells and rotated text

Two things a Ukrainian approved blank needs and nothing else can express. Both are
renderer features — there is no way around them from the application side, and a
simplified blank is not a simpler document, it is the wrong one.

**One value per cell** — tax number, personal number, date, declaration number:

```json
{
  "key": "seller_tax", "type": "char-cells",
  "path": "doc.sellerTaxNumber", "count": "12",
  "borderColor": "#262626", "lineWidth": "1",
  "placement": { "mode": "absolute", "xPercent": "22", "yPercent": "14", "widthPercent": "30.3", "heightPercent": "0" }
}
```

`count` comes from the **approved form**, not from the length of the value (tax number
12, personal number 10, date 8) — empty cells stay empty, that is how the blank looks.

**The frame is the geometry**: cell width = frame width ÷ `count`, and a zero height
makes the cell **square**. So you size the frame from the cell you want —
`widthPercent = count × cellPt ÷ 5.1528` — and leave the height alone. Twelve 13 pt cells
= `30.3`; eight = `20.2`. Set a height only where the approved form has an oblong cell;
never set it to "roughly the same number" as the width, because the two axes count against
different sides of the sheet.

A caption beside the cells takes the **same** `yPercent` as the cells — both anchor their
top edge. It ends up higher than the digits (a 7 pt caption in a 13 pt cell), which is what
the approved forms show; centring it by eye is what the old, pre-0.23.0 blanks did, and
those offsets are now wrong.

**The renderer slices, the data command formats.** `22.06.2026` in eight cells prints
`2 2 . 0 6 . 2 0` — dots are characters too. Return a separate field for it
(`to_char(d, 'DDMMYYYY')`), exactly as you return every other date as a string. This is
the trap worth remembering: the blank looks filled in.

Alignment says **where the value sits in the frame** (each character is always centred in
its own cell), and it also decides which end of an over-long value survives: `left` keeps
the head, `right` keeps the tail. The frame never stretches.

**Rotated text** — `"textOrientation": "90"`, reading bottom to top, on a `text` block and
on a table cell:

```json
{ "type": "text", "value": "Звіт про використання коштів…", "textOrientation": "90" }
{ "text": "Ставка ПДВ", "fontWeight": "bold", "textOrientation": "90" }
```

Use it where the approved form does: the whole title running up the left edge (advance
report), or a caption in a column too narrow for it horizontally. Two consequences:

- a rotated **block** makes `heightPercent` affect print — it becomes the length the line
  wraps at; leave it unset and the text runs as one line of its full length;
- a rotated **cell** does not wrap at all: the length of its caption becomes the row
  height.

Alignment in both runs along the reading direction: `left` sticks to the bottom.

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

Columns carry **only** their key and their width. Titles live in cells, because one column
can sit under several header levels.

A column may state a **width** instead of a number, and then the core computes the points —
it is the only side that knows the font, the word wrapping, and how merged header cells fall
onto real columns:

```json
{ "key": "num",  "width": "fit" }
{ "key": "name", "width": "auto", "minPt": "60" }
{ "key": "vat",  "width": "8%" }
```

`fit` is "never wrap this value" (numbers, codes, dates); `auto` takes the slack (a name, a
description); a percentage is the fixed share it always was. `minPt` is a floor in points for
`auto`/`fit`.

Reach for it when the column set changes with the data, or when there are too many columns to
size by hand — that is where hand-written percentages cost the most: on a nineteen-column
landscape form the sum of what the columns *needed* was 970.5 pt against a 761.9 pt sheet, and
without redistribution the header ran to eleven lines instead of six. The room was there from
the start; the distribution was not.

**`widthPercent` stays valid and is not going away.** The renderer switches to computing widths
only when at least one column states a `width`, so a form built on percentages lays out exactly
as before, to the point. Requires `@altera/server` 0.24.0.

**Do not hunt for `minPt` by re-rendering the PDF.** The render reports what it decided:
a table entry in `renderPrintPdfWithLayout`'s layout carries `columns`, one row per column
with `widthPt` (what it got), `minPt` (the floor — its longest word, or your declared
minimum), `naturalPt` (what it needs to never wrap) and `atMin` (it got exactly the floor,
so it wraps as much as it can). The pair `minPt`/`naturalPt` answers the question directly:
below the floor the column will not shrink, above the natural width there is nothing left to
buy. Guessing by table height instead does not converge — the curve is not monotonic, and
height never says *which* column ran out of room. Percentage tables carry no `columns`:
nothing computes a floor there, and zeros would be a lie. Requires `@altera/server` 0.25.2.

Two wrapping rules come with it, and both are about long captions in approved forms: an explicit
`\n` in a cell breaks the line where you say, and a word wider than its cell is now broken
instead of spilling onto the neighbour. If you inserted hyphens by hand to work around that
("сіль- сько- госпо- дарська"), that is what the `\n` replaces.

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

The same step also puts `printPdf` into the **agent** tool list, so an external agent can ask
for the blank itself — "give me invoice 42" then means the PDF, not the document JSON. It
needs no permission of its own: printing reads, so `view` covers it, and a read-only token
prints too.

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
