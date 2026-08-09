import { Type, type Static } from "@sinclair/typebox";

/** Оборотно-сальдова відомість: одна команда вибірки `index`, CRUD немає. */

const RefSchema = Type.Union([
  Type.Object({ id: Type.String(), name: Type.String() }),
  Type.Null(),
], { default: null });

export const TurnoverBalanceRowSchema = Type.Object({
  accountCode:    Type.String(),
  accountName:    Type.String(),
  openingDebit:   Type.Number(),
  openingCredit:  Type.Number(),
  turnoverDebit:  Type.Number(),
  turnoverCredit: Type.Number(),
  closingDebit:   Type.Number(),
  closingCredit:  Type.Number(),
});
export type TurnoverBalanceRow = Static<typeof TurnoverBalanceRowSchema>;

export const TurnoverBalanceTotalsSchema = Type.Object({
  openingDebit:   Type.Number({ default: 0 }),
  openingCredit:  Type.Number({ default: 0 }),
  turnoverDebit:  Type.Number({ default: 0 }),
  turnoverCredit: Type.Number({ default: 0 }),
  closingDebit:   Type.Number({ default: 0 }),
  closingCredit:  Type.Number({ default: 0 }),
});
export type TurnoverBalanceTotals = Static<typeof TurnoverBalanceTotalsSchema>;

/**
 * Фільтри звіту. Той самий контракт, що в списків: `$filters`, у payload —
 * вкладений `filters`, ссылка ОДНИМ ключем з об'єктом `{id, name}`.
 */
export const TurnoverBalanceFiltersSchema = Type.Object({
  organization: Type.Optional(RefSchema),
  dateFrom:     Type.String({ default: "" }),
  dateTo:       Type.String({ default: "" }),
});
export type TurnoverBalanceFilters = Static<typeof TurnoverBalanceFiltersSchema>;

export const TurnoverBalanceRootSchema = Type.Object({
  $filters: TurnoverBalanceFiltersSchema,
  rows:   Type.Array(TurnoverBalanceRowSchema, { default: [] }),
  totals: TurnoverBalanceTotalsSchema,
});
export type TurnoverBalanceRoot = Static<typeof TurnoverBalanceRootSchema>;
