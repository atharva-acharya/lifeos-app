import { pounds, toPence } from "./money";

/** How a bill is divided. "percent" is turned into exact pence before saving. */
export type SplitMethod = "equal" | "amounts" | "percent" | "shares";

/** 100% in basis points (hundredths of a percent). */
export const WHOLE = 10_000;

/**
 * Divides `total` pence in proportion to `weights` with the largest-remainder
 * method: everyone gets the floor of their exact share, then the pence left
 * over go one each to the largest remainders (earlier people win ties). The
 * parts always add up to `total` exactly.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (weights.length === 0 || sum <= 0) return weights.map(() => 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  const remainders = weights.map((w, i) => ({ i, r: (total * w) % sum }));
  let left = total - parts.reduce((a, p) => a + p, 0);
  remainders.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of remainders) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

/** Reads a percentage ("33.33", "50%") into basis points, or null. */
export function toBasisPoints(text: string): number | null {
  const clean = text.replace(/[%\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bp <= WHOLE ? bp : null;
}

/** Reads a whole number of shares from 1 to 1000, or null. */
export function toShares(text: string): number | null {
  const clean = text.trim();
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return n >= 1 && n <= 1000 ? n : null;
}

/** Formats basis points as a percentage: 3333 → "33.33%", 5000 → "50%". */
export function percentText(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(bp % 100);
  return frac === 0
    ? `${String(whole)}%`
    : `${String(whole)}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}

export interface SplitCheck {
  /** The pence (or share) values to send for each person, when ready. */
  values: number[] | null;
  /** The live line under the people inputs, e.g. "£4.00 left to assign". */
  progress: string;
  /** Why the parts cannot be saved yet, or null when they add up. */
  problem: string | null;
}

/**
 * Checks the per-person values against the total for a split method and
 * describes the gap. `total` is pence, or null when the total is not valid.
 * For "percent" the returned values are exact pence (method "amounts").
 */
export function checkSplit(
  method: SplitMethod,
  total: number | null,
  inputs: string[],
): SplitCheck {
  const n = inputs.length;
  if (method === "equal") {
    if (total === null || n === 0)
      return { values: inputs.map(() => 0), progress: "", problem: null };
    const parts = allocate(
      total,
      inputs.map(() => 1),
    );
    const low = Math.min(...parts);
    const high = Math.max(...parts);
    const progress =
      low === high
        ? `${pounds(low)} each`
        : `${pounds(low)} or ${pounds(high)} each, adding up to ${pounds(total)}`;
    return { values: inputs.map(() => 0), progress, problem: null };
  }

  if (method === "shares") {
    const shares = inputs.map(toShares);
    const sum = shares.reduce<number>((a, s) => a + (s ?? 0), 0);
    const progress = `Shares: ${String(sum)} total`;
    if (shares.some((s) => s === null)) {
      return { values: null, progress, problem: "Give everyone a whole number of shares." };
    }
    return { values: shares as number[], progress, problem: null };
  }

  if (method === "percent") {
    const bps = inputs.map(toBasisPoints);
    const sum = bps.reduce<number>((a, b) => a + (b ?? 0), 0);
    const gap = WHOLE - sum;
    const progress =
      gap > 0
        ? `${percentText(gap)} left`
        : gap < 0
          ? `${percentText(-gap)} over`
          : "Adds up to 100%";
    if (bps.some((b) => b === null)) {
      return { values: null, progress, problem: "Enter a percentage for everyone." };
    }
    if (gap !== 0) return { values: null, progress, problem: "Percentages must add up to 100%." };
    if (total === null) return { values: null, progress, problem: null };
    return { values: allocate(total, bps as number[]), progress, problem: null };
  }

  const amounts = inputs.map(toPence);
  const sum = amounts.reduce<number>((a, p) => a + (p ?? 0), 0);
  let progress = "";
  if (total !== null) {
    const gap = total - sum;
    progress =
      gap > 0
        ? `${pounds(gap)} left to assign`
        : gap < 0
          ? `${pounds(-gap)} over`
          : `Adds up to ${pounds(total)}`;
  }
  if (amounts.some((p) => p === null)) {
    return { values: null, progress, problem: "Enter an amount for everyone." };
  }
  if (total !== null && sum !== total) {
    return { values: null, progress, problem: "Amounts must add up to the total." };
  }
  return { values: amounts as number[], progress, problem: null };
}

export interface SplitSummary {
  /** Positive pence the owner owes friends. */
  owe: number;
  /** Positive pence friends owe the owner. */
  owed: number;
  /** owed − owe. */
  net: number;
}

/** Totals the per-friend balances (pence each friend owes the owner). */
export function summarise(balances: number[]): SplitSummary {
  let owe = 0;
  let owed = 0;
  for (const b of balances) {
    if (b > 0) owed += b;
    else owe -= b;
  }
  return { owe, owed, net: owed - owe };
}

/**
 * What each person pays so far, in pence, for the live amounts beside each
 * name while a split is being filled in. People whose value is not entered
 * yet (or not readable) show 0; equal and share splits divide the whole
 * total once every share is readable.
 */
export function liveShares(method: SplitMethod, total: number | null, inputs: string[]): number[] {
  const none = inputs.map(() => 0);
  if (method === "amounts") return inputs.map((t) => toPence(t) ?? 0);
  if (total === null || inputs.length === 0) return none;
  if (method === "equal")
    return allocate(
      total,
      none.map(() => 1),
    );
  if (method === "shares") {
    const shares = inputs.map(toShares);
    if (shares.some((s) => s === null)) return none;
    const weights = shares as number[];
    return weights.some((w) => w > 0) ? allocate(total, weights) : none;
  }
  return inputs.map((t) => {
    const bp = toBasisPoints(t);
    return bp === null ? 0 : Math.round((total * bp) / WHOLE);
  });
}
