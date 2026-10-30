import type { Application } from "./api";

/** Sheet source for replies that could not be matched to an application. */
export const REPLY_ONLY = "reply only";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function valid(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? date : null;
}

/** Reads the Sheet's "Applied" cell: "23 Aug 2026", "2026-08-23" or "23/08/2026". */
export function parseApplied(value: string | null): Date | null {
  const s = value?.trim() ?? "";
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return valid(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    return month < 0 ? null : valid(Number(m[3]), month, Number(m[1]));
  }
  return null;
}

function monday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function isReplyOnly(r: Application): boolean {
  return (r.source ?? "").trim().toLowerCase() === REPLY_ONLY;
}

export interface WeekCount {
  /** Monday of the week, `YYYY-MM-DD`. */
  week: string;
  label: string;
  count: number;
}

/** Applications per week (Monday start) for the `weeks` weeks ending with today's week. */
export function perWeek(rows: Application[], today: Date, weeks = 12): WeekCount[] {
  const last = monday(today);
  const out: WeekCount[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(last.getFullYear(), last.getMonth(), last.getDate() - i * 7);
    out.push({
      week: `${String(start.getFullYear())}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
      label: start.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      count: 0,
    });
  }
  const first = out[0] ? parseApplied(out[0].week) : null;
  for (const r of rows) {
    if (isReplyOnly(r)) continue;
    const date = parseApplied(r.applied);
    if (!date || !first) continue;
    const index = Math.floor(
      Math.round((monday(date).getTime() - first.getTime()) / 86_400_000) / 7,
    );
    if (index >= 0 && index < out.length) out[index].count += 1;
  }
  return out;
}

export type Outcome = "waiting" | "positive" | "rejected";

/** Treats any status other than "Applied" (or blank) as a reply. */
export function outcome(status: string | null): Outcome {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "" || s === "applied") return "waiting";
  if (s.includes("reject") || s.includes("closed") || s.includes("unsuccessful")) return "rejected";
  return "positive";
}

export interface SourceRate {
  source: string;
  applied: number;
  positive: number;
  rejected: number;
  /** Share of applications with any reply, 0-100. */
  rate: number;
  positivePct: number;
  rejectedPct: number;
}

export interface ReplyRates {
  sources: SourceRate[];
  /** Replies the Sheet could not match to an application ("Reply only"). */
  unmatched: number;
}

function pct(n: number, of: number): number {
  return of === 0 ? 0 : Math.round((n / of) * 1000) / 10;
}

/** Reply rate per source, most applications first. */
export function replyRates(rows: Application[]): ReplyRates {
  const map = new Map<string, { applied: number; positive: number; rejected: number }>();
  let unmatched = 0;
  for (const r of rows) {
    if (isReplyOnly(r)) {
      unmatched += 1;
      continue;
    }
    const source = r.source?.trim() || "No source";
    const entry = map.get(source) ?? { applied: 0, positive: 0, rejected: 0 };
    entry.applied += 1;
    const o = outcome(r.status);
    if (o !== "waiting") entry[o] += 1;
    map.set(source, entry);
  }
  const sources = [...map.entries()]
    .map(([source, e]) => {
      const rate = pct(e.positive + e.rejected, e.applied);
      const positivePct = pct(e.positive, e.applied);
      // Derived so the two stacked segments always add up to the rate.
      const rejectedPct = Math.round((rate - positivePct) * 10) / 10;
      return { source, ...e, rate, positivePct, rejectedPct };
    })
    .sort((a, b) => b.applied - a.applied || a.source.localeCompare(b.source));
  return { sources, unmatched };
}
