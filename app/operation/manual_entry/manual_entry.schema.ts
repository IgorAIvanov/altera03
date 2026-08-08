import { Type, type Static } from "@sinclair/typebox";
import { DocumentHeaderSchema, SortDirSchema } from "@client/shared/schema.ts";

/**
 * Значення субконто рядка: {код виміру → {id, name}}.
 *
 * Зберігається в jsonb — це НАМІР документа, а не рух. Назву тримаємо поруч з
 * id, щоб форма показала субконто після перезавантаження без окремого запиту;
 * знімок для регістру ядро все одно бере з довідника (app.doc_analytic_set).
 */
const AnalyticValueSchema = Type.Object({
  id:   Type.String(),
  name: Type.String(),
});

const AnalyticsSchema = Type.Record(Type.String(), AnalyticValueSchema, {
  "x-db-type": "jsonb",
  default: {},
});

// ── Рядок проводки ────────────────────────────────────────────────────────────

export const ManualEntryLineSchema = Type.Object({
  id:     Type.Union([Type.String(), Type.Null()], { "x-db-type": "bigint" }),
  lineNo: Type.Number({ title: "№", "x-db-type": "int" }),
  debitAccount:    Type.String({ title: "Дебет", maxLength: 10 }),
  debitAnalytics:  AnalyticsSchema,
  creditAccount:   Type.String({ title: "Кредит", maxLength: 10 }),
  creditAnalytics: AnalyticsSchema,
  amount:      Type.Number({ title: "Сума", "x-db-type": "numeric" }),
  // Валюта й кількість — заповнюються лише для валютних/кількісних рахунків.
  currencyId:     Type.Optional(Type.String({ title: "Валюта", "x-db-type": "bigint" })),
  currencyAmount: Type.Optional(Type.Number({ title: "Сума вал.", "x-db-type": "numeric" })),
  quantity:       Type.Optional(Type.Number({ title: "Кількість", "x-db-type": "numeric" })),
  description: Type.Optional(Type.String({ title: "Зміст" })),
});
export type ManualEntryLine = Static<typeof ManualEntryLineSchema>;
export type AnalyticValue = Static<typeof AnalyticValueSchema>;

// ── Item — власних реквізитів немає, лише таблична частина ───────────────────

export const ManualEntryItemSchema = Type.Object({
  entries: Type.Array(ManualEntryLineSchema, {
    "x-table": { table: "manual_entry_line", parentFk: "document_id", orderBy: "line_no" },
  }),
});
export type ManualEntryItem = Static<typeof ManualEntryItemSchema>;

// ── Form ($root форми редагування) ────────────────────────────────────────────

const RefSchema = Type.Union([
  Type.Object({ id: Type.String(), name: Type.String() }),
  Type.Null(),
], { default: null });

/** Рядок у формі: суми — рядками (точність не втрачається при вводі). */
export const ManualEntryFormLineSchema = Type.Object({
  id:     Type.Union([Type.String(), Type.Null()], { default: null }),
  lineNo: Type.Number({ default: 0 }),
  debitAccount:    Type.String({ default: "" }),
  debitAnalytics:  Type.Record(Type.String(), AnalyticValueSchema, { default: {} }),
  creditAccount:   Type.String({ default: "" }),
  creditAnalytics: Type.Record(Type.String(), AnalyticValueSchema, { default: {} }),
  amount:      Type.String({ default: "0.00" }),
  // Валютна пара: id для запису + назва для показу після перезавантаження.
  currencyId:     Type.String({ default: "" }),
  currency:       Type.Optional(RefSchema),
  currencyAmount: Type.String({ default: "0.00" }),
  quantity:       Type.String({ default: "0.000" }),
  description: Type.Optional(Type.String({ default: "" })),
});
export type ManualEntryFormLine = Static<typeof ManualEntryFormLineSchema>;

export const ManualEntryFormSchema = Type.Composite([
  DocumentHeaderSchema,
  Type.Object({
    organization: Type.Optional(RefSchema),
    entries:      Type.Array(ManualEntryFormLineSchema, { default: [] }),
  }),
]);
export type ManualEntryForm = Static<typeof ManualEntryFormSchema>;

export const ManualEntryEditRootSchema = Type.Object({
  item:    ManualEntryFormSchema,
  options: Type.Object({}),
});
export type ManualEntryEditRoot = Static<typeof ManualEntryEditRootSchema>;

// ── Row (список) ──────────────────────────────────────────────────────────────

export const ManualEntryRowSchema = Type.Object({
  id:       Type.String({ "x-db-type": "bigint" }),
  number:   Type.Optional(Type.String()),
  docDate:  Type.String(),
  total:    Type.Optional(Type.Number()),
  isPosted: Type.Optional(Type.Boolean()),
  // Потрібне списку: службова колонка стану показує позначку на видалення.
  isDeleted: Type.Optional(Type.Boolean()),
  description: Type.Optional(Type.String()),
});
export type ManualEntryRow = Static<typeof ManualEntryRowSchema>;

// ── LookupRow ─────────────────────────────────────────────────────────────────

export const ManualEntryLookupRowSchema = Type.Object({
  id:      Type.String({ "x-db-type": "bigint" }),
  number:  Type.Optional(Type.String()),
  docDate: Type.String(),
});
export type ManualEntryLookupRow = Static<typeof ManualEntryLookupRowSchema>;

// ── Payloads ──────────────────────────────────────────────────────────────────

export const ManualEntryListPayloadSchema = Type.Object({
  search:   Type.Optional(Type.String()),
  page:     Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  sortBy:   Type.Optional(Type.Union([
              Type.Literal("number"),
              Type.Literal("docDate"),
            ])),
  sortDir:  Type.Optional(SortDirSchema),
});
export type ManualEntryListPayload = Static<typeof ManualEntryListPayloadSchema>;

/** Рядок відповіді chart_of_account/analytics — які субконто веде рахунок. */
export const AccountAnalyticSchema = Type.Object({
  slotNo:        Type.Number(),
  dimensionCode: Type.String(),
  dimensionName: Type.String(),
  modelKey:      Type.String(),
  entityKind:    Type.String(),
  isRequired:    Type.Boolean(),
});
export type AccountAnalytic = Static<typeof AccountAnalyticSchema>;
