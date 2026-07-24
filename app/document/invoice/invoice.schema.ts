import { Type, type Static } from "@sinclair/typebox";
import { DocumentHeaderSchema, SortDirSchema } from "@client/shared/schema.ts";

// ── Рядок табличної частини ───────────────────────────────────────────────────

export const InvoiceLineSchema = Type.Object({
  id:     Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint" }),
  lineNo: Type.Number({ title: "№", "x-db-type": "int" }),
  bankId: Type.String({
    title: "Банк",
    "x-db-type": "bigint",
    "x-ref": { model: "bank", display: "name", as: "bank" },
  }),
  qty:    Type.Number({ title: "Кількість", "x-db-type": "numeric" }),
  price:  Type.Number({ title: "Ціна", "x-db-type": "numeric" }),
});
export type InvoiceLine = Static<typeof InvoiceLineSchema>;

// ── Item — ЛИШЕ реквізити цього документа ─────────────────────────────────────
//
// Спільної шапки (id, організація, номер, дата, сума, проведення) тут немає:
// вона живе в app.document і підмішується генератором із DocumentHeaderSchema.
// Описати її тут — помилка збірки, а не мовчазне дублювання.

export const InvoiceItemSchema = Type.Object({
  counterpartyId: Type.String({
    title: "Контрагент",
    "x-db-type": "bigint",
    "x-ref": {
      model: "counterparty",
      display: "name",
      as: "counterparty",
      sortable: true,
      searchable: true,
    },
  }),
  lines: Type.Array(InvoiceLineSchema, {
    "x-table": { table: "invoice_line", parentFk: "document_id", orderBy: "line_no" },
  }),
});
export type InvoiceItem = Static<typeof InvoiceItemSchema>;

// ── Form ($root форми редагування) — шапка + реквізити + display-ref'и ────────

/** Відображуване посилання (id + name), що приходить з `get` для показу в UI. */
const RefSchema = Type.Union([
  Type.Object({ id: Type.String(), name: Type.String() }),
  Type.Null(),
], { default: null });

/** Рядок табличної частини у формі: поля БД + display-ref `bank`. */
export const InvoiceFormLineSchema = Type.Object({
  id:     Type.Union([Type.String(), Type.Null()], { default: null }),
  lineNo: Type.Number({ default: 0 }),
  bankId: Type.String({ default: "" }),
  bank:   Type.Optional(RefSchema),
  // Десяткові поля у формі — рядки: точність не втрачається, ввід не «стрибає».
  qty:    Type.String({ default: "0.000" }),
  price:  Type.String({ default: "0.00" }),
});
export type InvoiceFormLine = Static<typeof InvoiceFormLineSchema>;

/**
 * Шапка у формі = спільні реквізити документа + власні поля invoice.
 * Type.Composite, а не рукописний список, щоб форма й БД не розходилися.
 */
export const InvoiceFormSchema = Type.Composite([
  DocumentHeaderSchema,
  Type.Object({
    organization:   Type.Optional(RefSchema),
    counterpartyId: Type.String({ default: "" }),
    counterparty:   Type.Optional(RefSchema),
    lines:          Type.Array(InvoiceFormLineSchema, { default: [] }),
  }),
]);
export type InvoiceForm = Static<typeof InvoiceFormSchema>;

/** `$root` форми редагування: `item` (форма) + `options`. */
export const InvoiceEditRootSchema = Type.Object({
  item:    InvoiceFormSchema,
  options: Type.Object({}),
});
export type InvoiceEditRoot = Static<typeof InvoiceEditRootSchema>;

// ── Row (список) ──────────────────────────────────────────────────────────────

export const InvoiceRowSchema = Type.Object({
  id:           Type.String({ "x-db-type": "bigint" }),
  number:       Type.Optional(Type.String()),
  docDate:      Type.String(),
  counterparty: Type.Object({ id: Type.String(), name: Type.String() }),
  total:        Type.Optional(Type.Number()),
  isPosted:     Type.Optional(Type.Boolean()),
});
export type InvoiceRow = Static<typeof InvoiceRowSchema>;

// ── LookupRow ─────────────────────────────────────────────────────────────────

export const InvoiceLookupRowSchema = Type.Object({
  id:      Type.String({ "x-db-type": "bigint" }),
  number:  Type.Optional(Type.String()),
  docDate: Type.String(),
});
export type InvoiceLookupRow = Static<typeof InvoiceLookupRowSchema>;

// ── Payloads ──────────────────────────────────────────────────────────────────

export const InvoiceListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
              Type.Literal("number"),
              Type.Literal("docDate"),
              Type.Literal("counterparty"),
            ])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type InvoiceListPayload = Static<typeof InvoiceListPayloadSchema>;

/** Проведення / скасування проведення — команди post і unpost. */
export const InvoicePostPayloadSchema = Type.Object({
  id: Type.String({ "x-db-type": "bigint" }),
});
export type InvoicePostPayload = Static<typeof InvoicePostPayloadSchema>;
