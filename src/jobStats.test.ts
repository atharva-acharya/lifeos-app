import { describe, expect, it } from "vitest";
import type { Application } from "./api";
import { outcome, parseApplied, perWeek, replyRates } from "./jobStats";

function app(over: Partial<Application>): Application {
  return {
    applied: null,
    company: null,
    role: null,
    source: null,
    inbox: null,
    status: null,
    lastUpdate: null,
    daysSince: null,
    followUp: null,
    email: null,
    notes: null,
    messageId: null,
    ...over,
  };
}

describe("parseApplied", () => {
  it("reads the Sheet's date styles", () => {
    expect(parseApplied("23 Aug 2026")).toEqual(new Date(2026, 7, 23));
    expect(parseApplied("05 September 2026")).toEqual(new Date(2026, 8, 5));
    expect(parseApplied("2026-01-05")).toEqual(new Date(2026, 0, 5));
    expect(parseApplied("23/08/2026")).toEqual(new Date(2026, 7, 23));
  });

  it("rejects blanks and impossible dates", () => {
    expect(parseApplied(null)).toBeNull();
    expect(parseApplied("")).toBeNull();
    expect(parseApplied("31 Feb 2026")).toBeNull();
    expect(parseApplied("2026-13-01")).toBeNull();
    expect(parseApplied("12 Foo 2026")).toBeNull();
    expect(parseApplied("soon")).toBeNull();
  });
});

describe("perWeek", () => {
  // Friday 30 Oct 2026; its week starts Monday 26 Oct.
  const today = new Date(2026, 9, 30);

  it("returns the last 12 weeks oldest first, Monday start, empty weeks as 0", () => {
    const weeks = perWeek([], today);
    expect(weeks).toHaveLength(12);
    expect(weeks[11].week).toBe("2026-10-26");
    expect(weeks[0].week).toBe("2026-08-10");
    expect(weeks.every((w) => w.count === 0)).toBe(true);
  });

  it("counts by week and skips reply-only, undated and out-of-range rows", () => {
    const weeks = perWeek(
      [
        app({ applied: "26 Oct 2026", source: "Indeed" }), // Monday, this week
        app({ applied: "01 Nov 2026", source: "Indeed" }), // Sunday, this week
        app({ applied: "25 Oct 2026", source: "Company site" }), // Sunday, last week
        app({ applied: "2026-10-20", source: "LinkedIn Easy Apply" }),
        app({ applied: "", source: "Reply only" }),
        app({ applied: "26 Oct 2026", source: "Reply only" }),
        app({ applied: null, source: "Indeed" }),
        app({ applied: "01 Jan 2026", source: "Indeed" }),
      ],
      today,
    );
    expect(weeks[11].count).toBe(2);
    expect(weeks[10].count).toBe(2);
    expect(weeks.reduce((n, w) => n + w.count, 0)).toBe(4);
  });

  it("keeps weeks aligned across the October clock change", () => {
    const weeks = perWeek(
      [app({ applied: "19 Oct 2026" }), app({ applied: "02 Nov 2026" })],
      new Date(2026, 10, 3),
    );
    expect(weeks.find((w) => w.week === "2026-10-19")?.count).toBe(1);
    expect(weeks[11]).toMatchObject({ week: "2026-11-02", count: 1 });
  });
});

describe("outcome", () => {
  it("sorts statuses into waiting, positive and rejected", () => {
    expect(outcome(null)).toBe("waiting");
    expect(outcome(" Applied ")).toBe("waiting");
    expect(outcome("Rejected")).toBe("rejected");
    expect(outcome("Closed")).toBe("rejected");
    expect(outcome("Interview")).toBe("positive");
    expect(outcome("Assessment")).toBe("positive");
    expect(outcome("Offer")).toBe("positive");
  });
});

describe("replyRates", () => {
  it("rates each source and counts reply-only rows apart", () => {
    const { sources, unmatched } = replyRates([
      app({ source: "LinkedIn Easy Apply", status: "Applied" }),
      app({ source: "LinkedIn Easy Apply", status: "Applied" }),
      app({ source: "LinkedIn Easy Apply", status: "Applied" }),
      app({ source: "LinkedIn Easy Apply", status: "Rejected" }),
      app({ source: "Company site", status: "Interview" }),
      app({ source: "Company site", status: "Rejected" }),
      app({ source: "Company site", status: "Applied" }),
      app({ source: "Reply only", status: "Rejected" }),
      app({ source: " reply only ", status: "Interview" }),
      app({ source: null, status: "Applied" }),
    ]);
    expect(unmatched).toBe(2);
    expect(sources.map((s) => s.source)).toEqual([
      "LinkedIn Easy Apply",
      "Company site",
      "No source",
    ]);
    expect(sources[0]).toMatchObject({ applied: 4, positive: 0, rejected: 1, rate: 25 });
    expect(sources[1]).toMatchObject({
      applied: 3,
      positive: 1,
      rejected: 1,
      rate: 66.7,
      positivePct: 33.3,
      rejectedPct: 33.3,
    });
    expect(sources[2]).toMatchObject({ applied: 1, rate: 0 });
  });

  it("is empty for no rows", () => {
    expect(replyRates([])).toEqual({ sources: [], unmatched: 0 });
  });
});
