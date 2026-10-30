import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { progress, Rings } from "./Rings";

describe("progress", () => {
  it("is the share of the goal, full at the goal", () => {
    expect(progress(5000, 10000)).toBe(0.5);
    expect(progress(12000, 10000)).toBe(1);
  });

  it("is zero for missing, negative or goal-less values", () => {
    expect(progress(0, 10000)).toBe(0);
    expect(progress(-5, 10)).toBe(0);
    expect(progress(5, 0)).toBe(0);
    expect(progress(Number.NaN, 10)).toBe(0);
  });
});

describe("Rings", () => {
  it("draws one track and fill per ring, inner rings smaller, with a legend", () => {
    const { container } = render(
      <Rings
        rings={[
          { key: "steps", name: "Steps", value: 6500, goal: 10000, color: "var(--c-done)" },
          {
            key: "energy",
            name: "Active energy",
            value: 0,
            goal: 500,
            color: "var(--c-danger)",
            unit: " kcal",
          },
        ]}
      />,
    );
    const fills = [...container.querySelectorAll(".rings__fill")];
    expect(fills).toHaveLength(2);
    expect((fills[0] as SVGElement).style.strokeDashoffset).toBe("0.35");
    expect(Number(fills[1].getAttribute("r"))).toBeLessThan(Number(fills[0].getAttribute("r")));
    // An empty ring shows only its track, not a rounded dot.
    expect(fills[1].getAttribute("opacity")).toBe("0");
    expect(container.querySelector(".rings__legend")?.textContent).toContain("6,500 / 10,000");
    expect(container.querySelector(".rings__legend")?.textContent).toContain("0 kcal / 500 kcal");
  });

  it("writes legend values with a custom format", () => {
    const { container } = render(
      <Rings
        rings={[
          {
            key: "sleep",
            name: "Sleep",
            value: 7.2,
            goal: 8,
            color: "var(--c-read)",
            unit: " ignored",
            format: (n) => `${n.toFixed(1)}h`,
          },
        ]}
      />,
    );
    expect(container.querySelector(".rings__legend")?.textContent).toContain("7.2h / 8.0h");
    expect(container.querySelector(".rings__legend")?.textContent).not.toContain("ignored");
  });
});
