import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarChart, fit, niceScale, type Series } from "./BarChart";

interface Row {
  name: string;
  a: number;
  b: number;
}

const A: Series<Row> = { key: "a", name: "Alpha", color: "var(--c-read)", value: (r) => r.a };
const B: Series<Row> = { key: "b", name: "Beta", color: "var(--c-danger)", value: (r) => r.b };

describe("niceScale", () => {
  it("rounds the axis top up to whole, tidy steps", () => {
    expect(niceScale(41)).toEqual({ top: 60, ticks: [0, 20, 40, 60] });
    expect(niceScale(7)).toEqual({ top: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceScale(3)).toEqual({ top: 3, ticks: [0, 1, 2, 3] });
    expect(niceScale(1)).toEqual({ top: 1, ticks: [0, 1] });
  });

  it("gives a default axis when there is no data", () => {
    expect(niceScale(0)).toEqual({ top: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceScale(Number.NaN).top).toBe(4);
  });
});

describe("fit", () => {
  it("shortens labels that do not fit their slot", () => {
    expect(fit("Indeed", 100)).toBe("Indeed");
    expect(fit("LinkedIn Easy Apply", 70)).toBe("LinkedIn…");
    expect(fit("Anything", 0)).toBe("An…");
  });
});

describe("BarChart", () => {
  const data: Row[] = [
    { name: "One", a: 2, b: 1 },
    { name: "Two", a: 0, b: 0 },
    { name: "Three", a: 4, b: 0 },
  ];

  it("draws one path per non-zero segment with a hover title", () => {
    const { container } = render(<BarChart data={data} label={(r) => r.name} series={[A, B]} />);
    const bars = container.querySelectorAll(".bar-chart__bar");
    expect(bars).toHaveLength(3);
    expect([...bars].map((b) => b.querySelector("title")?.textContent)).toEqual([
      "One · Alpha: 2",
      "One · Beta: 1",
      "Three · Alpha: 4",
    ]);
    expect(bars[0].getAttribute("fill")).toBe("var(--c-read)");
  });

  it("stacks segments and scales them to the axis", () => {
    const { container } = render(
      <BarChart data={data} label={(r) => r.name} series={[A, B]} max={8} height={240} />,
    );
    const [alpha, beta, three] = [...container.querySelectorAll(".bar-chart__bar")].map((b) =>
      (b.getAttribute("d") ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number),
    );
    // Plot is 208 px tall from y=8: 2 of 8 is 52 px, 1 of 8 is 26 px, 4 of 8 is 104 px.
    expect(alpha?.[1]).toBe(216);
    expect(alpha?.[2]).toBe(164);
    expect(beta?.[1]).toBe(164);
    // The top segment has 4 px rounded corners.
    expect(three?.[2]).toBe(116);
  });

  it("puts grouped bars side by side from the baseline, scaled to the larger one", () => {
    const { container } = render(
      <BarChart
        data={data}
        label={(r) => r.name}
        series={[A, B]}
        layout="grouped"
        max={8}
        height={240}
      />,
    );
    const [alpha, beta] = [...container.querySelectorAll(".bar-chart__bar")].map((b) =>
      (b.getAttribute("d") ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number),
    );
    // Both start on the baseline (y=216), so neither sits on top of the other.
    expect(alpha?.[1]).toBe(216);
    expect(beta?.[1]).toBe(216);
    // Side by side: Beta starts to the right of Alpha.
    expect(beta?.[0]).toBeGreaterThan(alpha?.[0] ?? Infinity);
    // Each is rounded only at the top and grows from zero: 2 of 8 and 1 of 8.
    expect(alpha?.[2]).toBe(216 - 52 + 4);
    expect(beta?.[2]).toBe(216 - 26 + 4);
  });

  it("scales a grouped axis to the largest single bar, not the sum", () => {
    const { container } = render(
      <BarChart
        data={[{ name: "One", a: 30, b: 25 }]}
        label={(r) => r.name}
        series={[A, B]}
        layout="grouped"
      />,
    );
    expect(container.textContent).toContain("30");
    expect(container.textContent).not.toContain("60");
  });

  it("labels the axis and shows a legend only for stacked charts", () => {
    const one = render(
      <BarChart data={data} label={(r) => r.name} series={[A]} unit="%" max={100} />,
    );
    expect(one.container.textContent).toContain("100%");
    expect(one.container.textContent).toContain("Three");
    expect(one.container.querySelector(".bar-chart__legend")).toBeNull();
    one.unmount();
    const two = render(<BarChart data={data} label={(r) => r.name} series={[A, B]} />);
    expect(two.container.querySelector(".bar-chart__legend")?.textContent).toBe("AlphaBeta");
  });

  it("draws a dashed target line and makes room for it on the axis", () => {
    const { container } = render(
      <BarChart
        data={data}
        label={(r) => r.name}
        series={[A]}
        target={{ value: 20, label: "Goal 20" }}
      />,
    );
    expect(container.querySelector(".line-chart__target text")?.textContent).toBe("Goal 20");
    // The data tops out at 4, but the axis must reach the target.
    expect(container.textContent).toContain("20");
    expect(container.querySelectorAll(".line-chart__target line")).toHaveLength(1);
  });

  it("renders an empty chart without bars", () => {
    const { container } = render(<BarChart data={[]} label={(r: Row) => r.name} series={[A]} />);
    expect(container.querySelectorAll(".bar-chart__bar")).toHaveLength(0);
    expect(container.querySelectorAll(".bar-chart__grid").length).toBeGreaterThan(0);
  });
});
