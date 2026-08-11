import { Type, type Static } from "@sinclair/typebox";

/**
 * Картка рахунку. CRUD у звіту немає — є одна команда вибірки `index`,
 * тому й схема описує не запис, а параметри та результат.
 */

/**
 * Ссылочний фільтр звіту: значення — `{id, name}`, як і в списках.
 *
 * Функція, а не спільна константа, бо `x-ref` у кожного фільтра свій: він
 * називає МОДЕЛЬ, з якої береться підпис. Ключ той самий, що в моделях, щоб
 * словник був один — див. пояснення в turnover_balance.schema.ts.
 */
const refFilter = (model: string) =>
  Type.Union([
    Type.Object({ id: Type.String(), name: Type.String() }),
    Type.Null(),
  ], { default: null, "x-ref": { model } });

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
  currencyCode:     Type.Optional(Type.Union([Type.String(), Type.Null()])),
  currencyAmount:   Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  quantity:         Type.Optional(Type.Union([Type.Number(), Type.Null()])),
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

/**
 * Фільтри звіту. Той самий контракт, що в списків: `$filters`, у payload —
 * вкладений `filters`, ссылка ОДНИМ ключем з об'єктом `{id, name}`.
 */
export const AccountCardFiltersSchema = Type.Object({
  organization: refFilter("organization"),
  // Рахунок ссылкою НЕ оголошений навмисно: значення фільтра — сам код
  // (`361`), і пікер показує його ж (`display-field="code"`). Підпису, який
  // треба було б донести з бази, тут немає, тож і `x-ref` нема чого робити.
  accountCode:  Type.String({ default: "" }),
  // Обов'язковість — це `Type.Optional`; чому саме так і що було доти —
  // див. turnover_balance.schema.ts.
  dateFrom:     Type.Optional(Type.String({ default: "" })),
  dateTo:       Type.Optional(Type.String({ default: "" })),
});
export type AccountCardFilters = Static<typeof AccountCardFiltersSchema>;

export const AccountCardRootSchema = Type.Object({
  $filters: AccountCardFiltersSchema,
  rows:   Type.Array(AccountCardRowSchema, { default: [] }),
  totals: AccountCardTotalsSchema,
});
export type AccountCardRoot = Static<typeof AccountCardRootSchema>;
