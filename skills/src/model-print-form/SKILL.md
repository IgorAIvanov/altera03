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
| `field-list` item `path` | `data.item` | `document.counterpartyName` |
| table `source` | `data.item` | `document.lines` |
| cell `path` in section `row` | **one array record** | `name` — never `document.lines.name` |
| cell `path` in `header` / `footer` | `data.item` | `document.total` |

### Table = column grid + three sections

Columns carry **only** `key` and `widthPercent`. Titles live in cells, because one column
can sit under several header levels.

| Section | Printed |
|---|---|
| `header` | on every page |
| `row` | once per `source` record (may be several rows per record; a record is never split across pages) |
| `footer` | once, after the last record |

Cells take `colSpan`/`rowSpan` (as in HTML), a static `text` **or** a `path`; a non-empty
`text` wins over `path`. Sections are optional.

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
