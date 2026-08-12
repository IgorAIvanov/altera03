---
name: screen-design-rules
description: Visual and usability rules for drawing any application screen — density, colour tokens, disabled and read-only states, field widths, status marks, keyboard expectations. Use whenever writing or reviewing the markup of a form, list, picker or report, and before adding any colour, size or spacing of your own.
argument-hint: Describe the screen you are drawing or reviewing (form, list, report) and what feels wrong about it.
metadata:
  audience: app
---

# Screen design rules

This is an **accounting desktop application**, not a marketing site or a mobile app.
Most general UI advice you have seen was written for a different product and will make
these screens worse. The rules below are the ones that hold here.

Everything visual comes from the framework theme. Your job on a screen is to compose,
not to invent colours, sizes or spacing.

## Density is deliberate — do not "modernize" it

Controls are 24px tall, table cells have 3px vertical padding, the base font is 14px,
radii are 2px.

A bookkeeper looks at 30 invoice lines at once. Advice like "row height 40–52px" or
"touch targets 44×44" comes from mobile and from admin panels with twenty rows; applying
it here cuts the visible data in half. Do not raise heights, do not add shadows, do not
round corners.

## Never write a colour of your own

| Need | Use | Never |
|---|---|---|
| secondary text (codes, dates, hints, empty states, counters) | `class="text-muted"` | `text-base-content/40…70` |
| surfaces, borders | theme vars (`--app-surface`, `--app-border-field`) | hex literals |
| status colours | `--color-success` / `-warning` / `-error` | your own red/green |

`text-base-content/50` renders at **2.8:1** against white, `/40` at **2.2:1** — roughly
half the AA floor of 4.5:1. This is not a nitpick: it is the difference between a hint
being readable on a laptop screen in an office and not. `.text-muted` is a token picked
to pass on white, on the zebra stripe and on the hover row.

If you catch yourself writing a hex value in a screen, the answer is almost always a
theme variable that already exists.

## Status must never be colour alone

Dimming an inactive row is fine as *reinforcement*, but the row must also say what it is
— a strikethrough, a badge, a column. A user with low vision, a bad monitor, or a
printout gets nothing from colour.

If you do dim, dim to a value that is still readable (`#6b7280` on white is 4.8:1).
`#9ca3af` is 2.5:1 and on a selected row 1.9:1 — that is invisible, not subtle.

## Field width is information

A field as wide as the form tells the user nothing. A code field that holds 6 characters
should be about 6 characters wide. Use the `class` option of `renderField`:

```ts
${this.renderField(t("common.code"), html`<input class="input input-bordered w-full" …/>`,
  { class: "w-32", field: "code" })}
```

Two or three short fields on one row, grouped by meaning, read far better than a single
column of full-width boxes. A single column is advice from signup forms optimised for
conversion — it does not apply to master data.

## Disabled and read-only are different problems

- A **disabled button**: its label may go grey (3:1 is enough) — nobody needs to read it.
- A **disabled field**: the value must stay readable (**≥ 4.5:1**). In view mode the whole
  form is disabled and the user came precisely to *read* it. The theme handles this
  already — do not override it with your own `opacity`.

Never use `opacity` to show a disabled state on anything containing text.

## Numbers

- numeric cells get `tabular-nums` so digits line up in a column;
- **account codes do not** — they are identifiers, not quantities. In report screens this
  is also the contract that decides whether a cell lands in Excel as a number or as text.

## Labels, errors, footers

- field labels only via `BaseUI.renderField(...)` — it produces a real `<label>`, so
  clicking the caption focuses the field;
- **`form-control` and `label-text` do not exist in daisyUI 5** — they are v4 markup and
  they break label alignment. If you see them in an example, the example is stale;
- the field error floats out of layout flow on purpose: showing and hiding it must not
  make the form jump. Do not wrap it in your own layout;
## The form frame comes from the base

Do not compose an edit form's `render()` by hand. Return `this.renderForm(fields)`: it
places the command panel, the banner and the fields, and it makes the field area — not
the whole tab — the scrolling region.

```ts
protected override formWidth = "max-w-md";   // default is max-w-3xl

protected override renderActions() {         // your buttons, left, after Save
  return html`<button class="btn btn-sm btn-secondary" @click=${this.post}>…</button>`;
}
protected override renderAuxActions() {      // after a separator: print, export
  return html`<button class="btn btn-sm btn-outline" @click=${this.printPdf}>…</button>`;
}

override render() {
  return this.renderForm(html` …fields… `);
}
```

**The command panel is at the top, not in a footer.** In a document with a 30-line
tabular section a footer scrolls out of view — "Save" disappears exactly where the form
is longest. Lists and reports already keep their toolbar on top.

**There is no "Close" button.** The tab closes by the × on its label and by Esc, both
with the unsaved-changes dialog. A panel left with nothing in it is not rendered at all.

The two groups are parted by a thin **separator**, not by a full-width spacer. A spacer
throws the second group against the right edge of the screen, and on a wide monitor the
print button has to be hunted for — a large emptiness does not read as grouping, it reads
as "nothing here".

**Put an icon on every toolbar button.** Take it from `@client/ui-kit/icons.ts` — one
glyph set for the whole ui-kit — and never size it with Tailwind classes; the glyphs live
in shadow DOM and must not depend on whether `h-4` was generated elsewhere.

**The full list of glyphs is [icons.md](icons.md), next to this file** — every key with
what it draws. Read it before drawing an `<svg>` of your own: the set already covers save,
post, print, Excel, filter, refresh, copy, row order, clear and document movements, and a
hand-written copy stops following the set (including the `--icon-size` token). The list is
generated from the source, so it cannot go stale; if the glyph you need is genuinely
missing, that is a framework gap — report it through whatever channel this application
uses, rather than hand-drawing a replacement.

Navigation icons are a **different** set: they live in the application's own
`app/menu/icons.ts` (Material Design, filled), the database stores only the key, and an
administrator picks them visually in the menu editor.

Slots take **markup, not descriptors**, because a command is not always a button: import
is a `<label class="btn">` wrapping a hidden file input, "Add block" is a `<details>`
dropdown.

A screen with a genuinely different layout simply does not call `renderForm()` and builds
its own `render()` — the base sets a default, it does not forbid.

## Filters go to the right, not above the table

Filters in an accounting list are long-lived (organization, period, status). A strip of
controls above the grid permanently eats the height a dense table needs. The right-hand
collapsible panel is the place, and the base already puts it there — see
[model-list-filters](../model-list-filters/SKILL.md).

## Inline SVG sizes go in attributes

```html
<svg width="13" height="13" …>   <!-- yes -->
<svg class="h-4 w-4" …>          <!-- no -->
```

Icons live inside shadow DOM; they must not depend on whether Tailwind happened to
generate `h-4` somewhere else in the app.

## Empty states

"No data" alone does not tell the user whether the catalogue is empty or their filter
matched nothing — and those call for opposite actions: enter the first record, or clear
the filter.

On a **table screen the base already does this**: `QueryTableBase.renderEmpty()` looks at
the live search and the active filter count, names the cause and offers the way out with
the very button that caused it. Do not hand-write an empty state there; `emptyText()`
remains the override point for the genuinely-empty case only (the picker uses it to say
«nothing found»).

Anywhere else — a report body, a tabular section, a custom panel — the rule is yours to
apply: say which of the two it is, and offer the exit.

## Accessibility floor

The base classes already give you keyboard navigation, `aria-sort`, `role="alert"` on
banners and named pagination buttons. What is left for you:

- an **icon-only button needs a name** — `title` plus `aria-label`;
- an input with no visible caption needs `aria-label` (a placeholder is not a name — it
  disappears at the first typed character);
- do not put a click handler on a `<div>` or `<span>` that performs an action; use a
  `<button>`, otherwise the action does not exist for keyboard users.

## Before you call a screen done

1. Every colour is a token; no hex literals in the screen.
2. Secondary text uses `.text-muted`.
3. No status conveyed by colour alone.
4. Field widths hint at content length.
5. Icon-only buttons have names; every input has a label.
6. Tab reaches every action; nothing is mouse-only.
7. The empty state explains itself.
