import { Type, type Static } from "@sinclair/typebox";
import { SortDirSchema } from "@shared/schema.ts";

// ── Рядок табличної частини ───────────────────────────────────────────────────

export const InvoiceLineSchema = Type.Object({
  id:     Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint" }),
  lineNo: Type.Number({ title: "№", "x-db-type": "int" }),
  // Ссылка ВСЕРЕДИНІ табличної частини (на існуючий bank)
  bankId: Type.String({
    title: "Банк",
    "x-db-type": "bigint",
    "x-ref": { model: "bank", display: "name", as: "bank" },
  }),
  qty:    Type.Number({ title: "Кількість", "x-db-type": "numeric" }),
  price:  Type.Number({ title: "Ціна", "x-db-type": "numeric" }),
});
export type InvoiceLine = Static<typeof InvoiceLineSchema>;

// ── Item (шапка) ──────────────────────────────────────────────────────────────

export const InvoiceItemSchema = Type.Object({
  id:     Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint" }),
  number: Type.String({
    title: "Номер", minLength: 1, maxLength: 20,
    "x-list": { sortable: true },
    "x-search": true,
  }),
  invoiceDate: Type.Optional(Type.String({
    title: "Дата", "x-db-type": "date",
    "x-list": { sortable: true },
  })),
  // Ссылка в шапці: зберігається counterparty_id, sort/search по name, на load — об'єкт
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
  // Таблична частина
  lines: Type.Array(InvoiceLineSchema, {
    "x-table": { table: "invoice_line", parentFk: "invoice_id", orderBy: "line_no" },
  }),
});
export type InvoiceItem = Static<typeof InvoiceItemSchema>;

// ── Form ($root форми редагування) — item з display-ref'ами ───────────────────

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
  qty:    Type.Number({ default: 0 }),
  price:  Type.Number({ default: 0 }),
});
export type InvoiceFormLine = Static<typeof InvoiceFormLineSchema>;

/** Шапка у формі: поля БД + display-ref `counterparty` + рядки. */
export const InvoiceFormSchema = Type.Object({
  id:             Type.Union([Type.String(), Type.Null()], { default: null }),
  number:         Type.String({ default: "" }),
  invoiceDate:    Type.String({ default: "" }),
  counterpartyId: Type.String({ default: "" }),
  counterparty:   Type.Optional(RefSchema),
  lines:          Type.Array(InvoiceFormLineSchema, { default: [] }),
});
export type InvoiceForm = Static<typeof InvoiceFormSchema>;

/** `$root` форми редагування: `item` (форма) + `options`. */
export const InvoiceEditRootSchema = Type.Object({
  item:    InvoiceFormSchema,
  options: Type.Object({}),
});
export type InvoiceEditRoot = Static<typeof InvoiceEditRootSchema>;

// ── Row (список) — ссылка як вкладений об'єкт ─────────────────────────────────

export const InvoiceRowSchema = Type.Object({
  id:           Type.String({ "x-db-type": "bigint" }),
  number:       Type.String(),
  invoiceDate:  Type.Optional(Type.String()),
  counterparty: Type.Object({ id: Type.String(), name: Type.String() }),
});
export type InvoiceRow = Static<typeof InvoiceRowSchema>;

// ── LookupRow ─────────────────────────────────────────────────────────────────

export const InvoiceLookupRowSchema = Type.Object({
  id:     Type.String({ "x-db-type": "bigint" }),
  number: Type.String(),
});
export type InvoiceLookupRow = Static<typeof InvoiceLookupRowSchema>;

// ── Payloads ──────────────────────────────────────────────────────────────────

export const InvoiceListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
              Type.Literal("number"),
              Type.Literal("invoiceDate"),
              Type.Literal("counterparty"),
            ])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type InvoiceListPayload = Static<typeof InvoiceListPayloadSchema>;
