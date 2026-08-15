import { Type, type Static } from "@sinclair/typebox";

/** Рух документа: одна команда вибірки `index`, CRUD немає. */

/** Значення субконто в проводці разом із ключем моделі для переходу. */
export const MovementAnalyticSchema = Type.Object({
  dimensionName: Type.String(),
  modelKey:      Type.String(),
  valueId:       Type.String(),
  presentation:  Type.String(),
});
export type MovementAnalytic = Static<typeof MovementAnalyticSchema>;

export const DocumentMovementRowSchema = Type.Object({
  lineNo:            Type.Number(),
  debitAccount:      Type.Optional(Type.String()),
  debitAccountName:  Type.Optional(Type.String()),
  debitAnalytics:    Type.Array(MovementAnalyticSchema, { default: [] }),
  creditAccount:     Type.Optional(Type.String()),
  creditAccountName: Type.Optional(Type.String()),
  creditAnalytics:   Type.Array(MovementAnalyticSchema, { default: [] }),
  amount:            Type.Number(),
  currencyCode:      Type.Optional(Type.Union([Type.String(), Type.Null()])),
  currencyAmount:    Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  // Дві кількості, як у регістрі: у складній проводці вони різні за змістом
  // (2 комплекти ← 6 корпусів), і одна колонка ховала б половину операції.
  quantityDebit:     Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  quantityCredit:    Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  description:       Type.Optional(Type.String()),
});
export type DocumentMovementRow = Static<typeof DocumentMovementRowSchema>;

/** Шапка документа (з `data.extra.document`), потрібна для заголовка й переходу. */
export const MovementDocumentSchema = Type.Object({
  documentId:       Type.String({ default: "" }),
  documentTypeCode: Type.String({ default: "" }),
  documentTypeName: Type.String({ default: "" }),
  number:           Type.Optional(Type.String()),
  docDate:          Type.String({ default: "" }),
  total:            Type.Number({ default: 0 }),
  presentation:     Type.String({ default: "" }),
  isPosted:         Type.Boolean({ default: false }),
  organizationName: Type.String({ default: "" }),
});
export type MovementDocument = Static<typeof MovementDocumentSchema>;

/**
 * `documentId` живе у `$filters` — за ним звіт переформовується при applyParams.
 *
 * Ссылкою не оголошений: підпис документа звіт віддає окремо, в `extra.document`
 * (номер, дата, сума, організація — заголовку потрібне все, а не самé ім'я).
 * Обов'язковий — без документа звіту немає взагалі; `Optional` тут означав би
 * «можна не задавати», і звіт мовчки віддавав би порожнечу.
 */
export const DocumentMovementsFiltersSchema = Type.Object({
  documentId: Type.String({ default: "" }),
});
export type DocumentMovementsFilters = Static<typeof DocumentMovementsFiltersSchema>;

export const DocumentMovementsRootSchema = Type.Object({
  $filters: DocumentMovementsFiltersSchema,
  rows:     Type.Array(DocumentMovementRowSchema, { default: [] }),
  document: MovementDocumentSchema,
});
export type DocumentMovementsRoot = Static<typeof DocumentMovementsRootSchema>;
