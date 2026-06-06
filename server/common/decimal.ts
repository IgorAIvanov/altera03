import { Decimal } from "decimal.js";

// Configure Decimal.js for financial calculations
Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_UP,
});

/** Create a Decimal from any numeric input */
export function money(value: string | number | Decimal): Decimal {
  return new Decimal(value);
}

/** Format a Decimal as a string with 2 decimal places */
export function formatMoney(value: Decimal): string {
  return value.toFixed(2);
}

export { Decimal };
