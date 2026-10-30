import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LineChart, linePath, niceRange } from "./LineChart";

describe("niceRange", () => {
  it("fits the axis to the data instead of starting at zero", () => {
    expect(niceRange(80.4, 82.1)).toEqual({
      lo: 80,
      hi: 82.5,
      ticks: [80, 80.5, 81, 81.5, 82, 82.5],
    });
    expect(niceRange(4200, 11800).lo).toBe(4000);
  });

  it("copes with flat and empty data", () => {
    expect(niceRange(81, 81)).toMatchObject({ lo: 80, hi: 82 });
    expect(niceRange(Infinity, -Infinity)).toEqual({ lo: 0, hi: 1, ticks: [0, 1] });
  });
});

describe("linePath", () => {
  const x = (i: number) => i * 10;
  const y = (v: number) => v;

  it("starts a new segment after each gap", () => {
    expect(linePath([1, 2, null, 4, 5], x, y)).toBe("M0,1L10,2M30,4L40,5");
  });

  it("is empty when there is no data", () => {
    expect(linePath([null, null], x, y)).toBe("");
    expect(linePath([Number.NaN], x, y)).toBe("");
  });
});

describe("LineChart", () => {
  const labels = ["1 Oct", "2 Oct", "3 Oct", "4 Oct"];

  it("draws each line, dots with titles, and the target", () => {
    const { container } = render(
      <LineChart
        labels={labels}
        unit=" kg"
        target={{ value: 78, label: "Target 78 kg" }}
        lines={[
          {
            key: "w",
            name: "Weight",
            color: "var(--c-read)",
            values: [82, null, 81.6, 81.2],
            dots: true,
          },
          {
            key: "avg",
            name: "7-day average",
            color: "var(--c-progress)",
            values: [82, 81.8, 81.6, 81.4],
          },
        ]}
      />,
    );
    expect(container.querySelectorAll(".line-chart__line")).toHaveLength(2);
    const dots = container.querySelectorAll(".line-chart__dot");
    expect(dots).toHaveLength(3);
    expect(dots[0].querySelector("title")?.textContent).toBe("1 Oct · Weight: 82 kg");
    expect(container.querySelector(".line-chart__target")?.textContent).toBe("Target 78 kg");
    expect(container.querySelector(".bar-chart__legend")?.textContent).toBe("Weight7-day average");
    // The newest day is always labelled.
    expect(container.textContent).toContain("4 Oct");
  });

  it("renders an empty chart without crashing", () => {
    const { container } = render(
      <LineChart labels={[]} lines={[{ key: "w", name: "Weight", color: "red", values: [] }]} />,
    );
    expect(container.querySelector(".line-chart__line")?.getAttribute("d")).toBe("");
  });
});
