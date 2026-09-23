/**
 * Platform fee applied to creator tip earnings.
 *
 * The fee is taken off the creator's earnings ledger *before* a withdrawal can
 * be requested, so the available balance is always the amount the creator can
 * actually receive. Percentages are environment-swappable and match the public
 * pricing table (Free 5%, Creator 3%, Studio 1%).
 */

type EnvRecord = Record<string, string | undefined>;

const env: EnvRecord = ((typeof import.meta !== "undefined" && import.meta.env) || {}) as EnvRecord;

function pct(key: string, fallback: number): number {
  const raw = Number(env[key]);
  return Number.isFinite(raw) && raw >= 0 && raw <= 50 ? raw : fallback;
}

export const PLATFORM_FEE_PERCENT = {
  free: pct("VITE_PLATFORM_FEE_FREE", 5),
  plus: pct("VITE_PLATFORM_FEE_PLUS", 3),
  pro: pct("VITE_PLATFORM_FEE_PRO", 1),
} as const;

/** Fee percentage retained for a creator on a given plan. */
export function feePercentForPlan(plan?: string | null): number {
  const key = String(plan ?? "free").toLowerCase();
  if (key === "pro" || key === "business") return PLATFORM_FEE_PERCENT.pro;
  if (key === "plus" || key === "premium") return PLATFORM_FEE_PERCENT.plus;
  return PLATFORM_FEE_PERCENT.free;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/** Splits gross tip earnings into the platform's cut and the creator's net. */
export function splitEarnings(gross: number, plan?: string | null) {
  const percent = feePercentForPlan(plan);
  const fee = round2((gross * percent) / 100);
  return { percent, fee, net: round2(gross - fee), gross: round2(gross) };
}

/** What a creator keeps from a single tip, for display before paying. */
export function creatorReceives(amount: number, plan?: string | null) {
  return splitEarnings(amount, plan).net;
}
