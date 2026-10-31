import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { HealthDay } from "../api";
import { rollingAverage } from "../fitnessStats";
import { RANGES, range, type RangeId } from "../healthStats";
import { withTransition } from "../motion";
import { Group } from "./Card";
import { HealthSleep } from "./HealthSleep";
import { TrendCard } from "./HealthTrendCard";

function sourceName(s: HealthDay["weightSource"]): string | null {
  return s === "health" ? "Apple Health" : s === "vault" ? "Vault" : null;
}

/** Index of the tab to move to for a key press, or null if the key does nothing. */
export function nextTab(key: string, index: number, count: number): number | null {
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
      return index >= last ? 0 : index + 1;
    case "ArrowLeft":
      return index <= 0 ? last : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/** Week, month and 3-month trends of heart rate, HRV, weight and sleep. */
export function HealthTrends({ days, sleepGoal }: { days: HealthDay[]; sleepGoal: number }) {
  const [id, setId] = useState<RangeId>("week");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const series = useMemo(() => {
    // Averages run over all 90 days, then the range is cut, so the first point is complete.
    const hr = days.map((d) => d.restingHr);
    const hrv = days.map((d) => d.hrv);
    const weight = days.map((d) => d.weight);
    return {
      dates: range(
        days.map((d) => d.date),
        id,
      ),
      hr: range(hr, id),
      hrAvg: range(rollingAverage(hr, 7), id),
      hrv: range(hrv, id),
      hrvAvg: range(rollingAverage(hrv, 7), id),
      weight: range(weight, id),
      weightAvg: range(rollingAverage(weight, 7), id),
      weightSource: range(
        days.map((d) => sourceName(d.weightSource)),
        id,
      ),
      days: range(days, id),
    };
  }, [days, id]);

  const choose = (next: RangeId) => {
    withTransition(() => {
      setId(next);
    });
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const target = nextTab(e.key, index, RANGES.length);
    if (target === null) return;
    e.preventDefault();
    choose(RANGES[target].id);
    tabs.current[target]?.focus();
  };

  return (
    <Group
      title="Trends"
      className="health__trends"
      bare
      action={
        <div className="tabs" role="tablist" aria-label="Trend range">
          {RANGES.map((r, i) => (
            <button
              key={r.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`health-range-${r.id}`}
              aria-selected={id === r.id}
              aria-controls="health-range-panel"
              tabIndex={id === r.id ? 0 : -1}
              className="tabs__tab"
              onClick={() => {
                choose(r.id);
              }}
              onKeyDown={(e) => {
                onKeyDown(e, i);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      <div
        role="tabpanel"
        id="health-range-panel"
        aria-labelledby={`health-range-${id}`}
        className="grid grid--2"
      >
        <TrendCard
          title="Resting heart rate"
          name="Resting heart rate"
          unit=" bpm"
          color="var(--cat-heart)"
          dates={series.dates}
          values={series.hr}
          average={series.hrAvg}
          decimals={0}
        />
        <TrendCard
          title="Heart rate variability"
          name="HRV"
          unit=" ms"
          color="var(--cat-heart)"
          dates={series.dates}
          values={series.hrv}
          average={series.hrvAvg}
          decimals={0}
        />
        <TrendCard
          title="Weight"
          name="Weight"
          unit=" kg"
          color="var(--cat-body)"
          dates={series.dates}
          values={series.weight}
          average={series.weightAvg}
          noteHeader="Source"
          notes={series.weightSource}
        />
        <HealthSleep days={series.days} goal={sleepGoal} />
      </div>
    </Group>
  );
}
