import { Type, type Static } from "@sinclair/typebox";

/** Оборотно-сальдова відомість: одна команда вибірки `index`, CRUD немає. */

/**
 * Ссылочний фільтр звіту: значення — `{id, name}`, як і в списках.
 *
 * Функція, а не спільна константа, бо `x-ref` у кожного фільтра свій: він
 * називає МОДЕЛЬ, з якої береться підпис (`app.organization`, поле `name`).
 * Доти схема описувала лише форму значення — «якась ссылка», — і звідси
 * підпис узяти було нізвідки: кожен звіт діставав його руками у своєму SQL.
 * Ключ той самий, що в моделях (`x-ref`), щоб словник був один.
 */
const refFilter = (model: string) =>
  Type.Union([
    Type.Object({ id: Type.String(), name: Type.String() }),
    Type.Null(),
  ], { default: null, "x-ref": { model } });

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
 *
 * **Обов'язковість фільтра — це `Type.Optional`**, як і в полях форми: те, без
 * чого звіт не будується, оголошене обов'язковим, решта — `Optional`. Доти
 * було навпаки в обидва боки: організація стояла `Optional`, хоча пікер у
 * розмітці позначений `required`, а `dateFrom`/`dateTo` — обов'язковими, хоча
 * звіт без періоду законний. Поки обов'язковість ніхто не читав, це нічого не
 * ламало; щойно її почне читати генератор обгортки, брехня схеми стане
 * поведінкою — «порожній звіт» замість зрозумілої відмови.
 */
export const TurnoverBalanceFiltersSchema = Type.Object({
  organization: refFilter("organization"),
  dateFrom:     Type.Optional(Type.String({ default: "" })),
  dateTo:       Type.Optional(Type.String({ default: "" })),
});
export type TurnoverBalanceFilters = Static<typeof TurnoverBalanceFiltersSchema>;

export const TurnoverBalanceRootSchema = Type.Object({
  $filters: TurnoverBalanceFiltersSchema,
  rows:   Type.Array(TurnoverBalanceRowSchema, { default: [] }),
  totals: TurnoverBalanceTotalsSchema,
});
export type TurnoverBalanceRoot = Static<typeof TurnoverBalanceRootSchema>;
