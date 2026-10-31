import { describe, expect, it } from "vitest";
import { allocate, checkSplit, percentText, summarise, toBasisPoints, toShares } from "./splitMath";

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

describe("allocate", () => {
  it("gives the spare pence to the largest remainders, earlier first on ties", () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(100, [3333, 3333, 3334])).toEqual([33, 33, 34]);
    expect(allocate(1001, [2500, 2500, 5000])).toEqual([250, 250, 501]);
  });

  it("always adds up to the total exactly", () => {
    const weights = [[1], [7, 3], [3333, 3333, 3334], [1, 2, 3, 4, 5, 6, 7], [1250, 8750]];
    for (const total of [1, 99, 1000, 4567, 123457, 999999999]) {
      for (const w of weights) {
        const parts = allocate(total, w);
        expect(sum(parts)).toBe(total);
        expect(parts.every((p) => p >= 0)).toBe(true);
      }
    }
  });

  it("keeps zero weights at zero and copes with no weight", () => {
    expect(allocate(500, [0, 1, 0])).toEqual([0, 500, 0]);
    expect(allocate(500, [0, 0])).toEqual([0, 0]);
    expect(allocate(500, [])).toEqual([]);
  });
});

describe("parsing", () => {
  it("reads percentages into basis points", () => {
    expect(toBasisPoints("50")).toBe(5000);
    expect(toBasisPoints(" 33.33% ")).toBe(3333);
    expect(toBasisPoints("12.5")).toBe(1250);
    expect(toBasisPoints("0")).toBe(0);
    expect(toBasisPoints("100.01")).toBeNull();
    expect(toBasisPoints("1.234")).toBeNull();
    expect(toBasisPoints("-5")).toBeNull();
    expect(toBasisPoints("")).toBeNull();
  });

  it("reads whole shares from 1 to 1000", () => {
    expect(toShares(" 2 ")).toBe(2);
    expect(toShares("0")).toBeNull();
    expect(toShares("1001")).toBeNull();
    expect(toShares("1.5")).toBeNull();
  });

  it("prints basis points as percentages", () => {
    expect([5000, 3333, 1250, 5, 0].map(percentText)).toEqual([
      "50%",
      "33.33%",
      "12.5%",
      "0.05%",
      "0%",
    ]);
  });
});

describe("checkSplit", () => {
  it("shows what each person pays when splitting equally", () => {
    expect(checkSplit("equal", 9000, ["", "", ""])).toEqual({
      values: [0, 0, 0],
      progress: "£30.00 each",
      problem: null,
    });
    expect(checkSplit("equal", 1000, ["", "", ""]).progress).toBe(
      "£3.33 or £3.34 each, adding up to £10.00",
    );
  });

  it("shows the gap for amounts until they add up", () => {
    expect(checkSplit("amounts", 5000, ["20", ""])).toMatchObject({
      values: null,
      progress: "£30.00 left to assign",
      problem: "Enter an amount for everyone.",
    });
    expect(checkSplit("amounts", 5000, ["20", "20"])).toMatchObject({
      progress: "£10.00 left to assign",
      problem: "Amounts must add up to the total.",
    });
    expect(checkSplit("amounts", 5000, ["40", "20"]).progress).toBe("£10.00 over");
    expect(checkSplit("amounts", 5000, ["30", "20.00"])).toEqual({
      values: [3000, 2000],
      progress: "Adds up to £50.00",
      problem: null,
    });
  });

  it("turns percentages into exact pence", () => {
    expect(checkSplit("percent", 1000, ["33.33", "33.33", ""])).toMatchObject({
      progress: "33.34% left",
      problem: "Enter a percentage for everyone.",
    });
    expect(checkSplit("percent", 1000, ["60", "50"])).toMatchObject({
      progress: "10% over",
      problem: "Percentages must add up to 100%.",
    });
    const ok = checkSplit("percent", 1000, ["33.33", "33.33", "33.34"]);
    expect(ok).toEqual({ values: [333, 333, 334], progress: "Adds up to 100%", problem: null });
    expect(sum(ok.values ?? [])).toBe(1000);
  });

  it("counts shares", () => {
    expect(checkSplit("shares", 1000, ["2", "1"])).toEqual({
      values: [2, 1],
      progress: "Shares: 3 total",
      problem: null,
    });
    expect(checkSplit("shares", 1000, ["2", "0"]).problem).toBe(
      "Give everyone a whole number of shares.",
    );
  });
});

describe("summarise", () => {
  it("totals what you owe, are owed and the net", () => {
    expect(summarise([1200, -500, 0, -200])).toEqual({ owe: 700, owed: 1200, net: 500 });
    expect(summarise([])).toEqual({ owe: 0, owed: 0, net: 0 });
  });
});
