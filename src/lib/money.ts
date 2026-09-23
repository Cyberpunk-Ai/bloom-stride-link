/**
 * Minor-unit safe money helpers.
 *
 * All monetary values inside the platform are integers in the currency's
 * minor unit (cents). Never do arithmetic on floats.
 */

export type Minor = number;

export const MINOR_PER_UNIT = 100;

export function toMinor(amount: number): Minor {
  return Math.round(amount * MINOR_PER_UNIT);
}

export function fromMinor(minor: Minor): number {
  return minor / MINOR_PER_UNIT;
}

export function addMinor(...values: Minor[]): Minor {
  return values.reduce((sum, value) => sum + Math.trunc(value), 0);
}

export function bps(minor: Minor, basisPoints: number): Minor {
  return Math.round((Math.trunc(minor) * basisPoints) / 10_000);
}

export function clampMinor(minor: Minor, min: Minor, max?: Minor): Minor {
  const value = Math.trunc(minor);
  if (value < min) return min;
  if (typeof max === "number" && value > max) return max;
  return value;
}

export function formatMinor(minor: Minor, currency = "USD", locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(fromMinor(minor));
  } catch {
    return `${currency} ${fromMinor(minor).toFixed(2)}`;
  }
}

/** Convert an amount in the platform base currency (USD) to the charge currency. */
export function convertMinor(minor: Minor, rate: number): Minor {
  return Math.round(Math.trunc(minor) * rate);
}

export function isValidMinor(value: unknown): value is Minor {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}
