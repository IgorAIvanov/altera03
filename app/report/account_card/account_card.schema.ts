import { Type, type Static } from "@sinclair/typebox";

/**
 * Картка рахунку. CRUD у звіту немає — є одна команда вибірки `index`,
 * тому й схема описує не запис, а параметри та результат.
 */

const RefSchema = Type.Union([
  Type.Object({ id: Type.String(), name: Type.String() }),
  Type.Null(),
], { default: null });

/** Значення субконто в рядку звіту разом з ключем моделі для переходу. */
export const ReportAnalyticSchema = Type.Object({
  dimensionCode: Type.String(),
  dimensionName: Type.String(),
  modelKey:      Type.String(),
  valueId:       Type.String(),
  presentation:  Type.String(),
});
export type ReportAnalytic = Static<typeof ReportAnalyticSchema>;

export const AccountCardRowSchema = Type.Object({
  entryId:          Type.String(),
  documentId:       Type.String(),
  // Ключ моделі документа — маршрут форми клієнт знайде у view-manifest.
  documentTypeCode: Type.String(),
  documentTypeName: Type.String(),
  docDate:          Type.String(),
  docNumber:        Type.Optional(Type.String()),
  corrAccount:      Type.Optional(Type.String()),
  corrAccountName:  Type.Optional(Type.String()),
  debit:            Type.Number(),
  credit:           Type.Number(),
  balanceDebit:     Type.Number(),
  balanceCredit:    Type.Number(),
  description:      Type.Optional(Type.String()),
  analytics:        Type.Array(ReportAnalyticSchema, { default: [] }),
  corrAnalytics:    Type.Array(ReportAnalyticSchema, { default: [] }),
});
export type AccountCardRow = Static<typeof AccountCardRowSchema>;

export const AccountCardTotalsSchema = Type.Object({
  account:        Type.Optional(Type.String()),
  accountName:    Type.Optional(Type.String()),
  openingDebit:   Type.Number({ default: 0 }),
  openingCredit:  Type.Number({ default: 0 }),
  turnoverDebit:  Type.Number({ default: 0 }),
  turnoverCredit: Type.Number({ default: 0 }),
  closingDebit:   Type.Number({ default: 0 }),
  closingCredit:  Type.Number({ default: 0 }),
});
export type AccountCardTotals = Static<typeof AccountCardTotalsSchema>;

/** Параметри звіту. `$`-префікс — службовий стан, що дзеркалиться з БД. */
export const AccountCardQuerySchema = Type.Object({
  organizationId: Type.String({ default: "" }),
  organization:   Type.Optional(RefSchema),
  accountCode:    Type.String({ default: "" }),
  dateFrom:       Type.String({ default: "" }),
  dateTo:         Type.String({ default: "" }),
});
export type AccountCardQuery = Static<typeof AccountCardQuerySchema>;

export const AccountCardRootSchema = Type.Object({
  $query: AccountCardQuerySchema,
  rows:   Type.Array(AccountCardRowSchema, { default: [] }),
  totals: AccountCardTotalsSchema,
});
export type AccountCardRoot = Static<typeof AccountCardRootSchema>;
