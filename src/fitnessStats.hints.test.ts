import { describe, expect, it } from "vitest";
import { weekHints, type WeekSummary } from "./fitnessStats";

const summary = (over: Partial<WeekSummary> = {}): WeekSummary => ({
  avgSteps: 5600,
  proteinDays: 4,
  sessions: 4,
  stepsGoal: 8000,
  proteinGoal: 170,
  ...over,
});

describe("weekHints", () => {
  it("says what is left for each ring", () => {
    expect(weekHints(summary())).toEqual({
      steps: "2,400 steps a day below your goal",
      protein: "3 more days at 170 g to fill the ring",
      sessions: "1 session left this week",
    });
  });

  it("counts in the singular and plural", () => {
    const out = weekHints(summary({ avgSteps: 7999, proteinDays: 6, sessions: 2 }));
    expect(out.steps).toBe("1 step a day below your goal");
    expect(out.protein).toBe("1 more day at 170 g to fill the ring");
    expect(out.sessions).toBe("3 sessions left this week");
  });

  it("says the goal is reached at or over it", () => {
    const out = weekHints(summary({ avgSteps: 9000, proteinDays: 7, sessions: 6 }));
    expect(out).toEqual({
      steps: "Goal reached",
      protein: "Goal reached",
      sessions: "Goal reached",
    });
  });

  it("asks for steps when none are logged, and follows a custom sessions goal", () => {
    const out = weekHints(summary({ avgSteps: null, sessions: 1 }), 3);
    expect(out.steps).toBe("Log steps to start the average");
    expect(out.sessions).toBe("2 sessions left this week");
  });
});
