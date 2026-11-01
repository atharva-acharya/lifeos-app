import { useId, useRef, useState, type MouseEvent } from "react";
import type { HealthDay, HealthGoals, HealthRingsDay } from "../api";
import { shortLabel } from "../fitnessStats";
import { sleepHours, todayContributors, todayHint } from "../healthStats";
import { Contributors } from "./Contributors";
import { EmptyHint } from "./EmptyHint";
import { Rings, type Ring } from "./Rings";
import { CardHead } from "./Card";
import { Sheet } from "./Sheet";
import "../styles/contributors.css";

/**
 * Today's rings (or the latest day that has data) against the daily goals,
 * each with what to do next (ui-spec P3). Clicking the card opens what is
 * behind it: each input against the owner's 30-day average (P4).
 */
export function HealthToday({
  day,
  goals,
  days = [],
}: {
  day: HealthRingsDay | null;
  goals: HealthGoals;
  /** The daily series (oldest first) the 30-day averages come from. */
  days?: HealthDay[];
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const isToday = day?.isToday ?? true;
  const sleep = day?.sleep?.total ?? null;
  const rings: Ring[] = [
    {
      key: "steps",
      name: "Steps",
      value: day?.steps ?? 0,
      goal: goals.steps,
      color: "var(--ring-move)",
      hint: todayHint("steps", day?.steps ?? null, goals.steps, isToday),
    },
    {
      key: "energy",
      name: "Active energy",
      value: day?.activeEnergy ?? 0,
      goal: goals.activeEnergy,
      color: "var(--ring-exercise)",
      unit: " kcal",
      hint: todayHint("energy", day?.activeEnergy ?? null, goals.activeEnergy, isToday),
    },
    {
      key: "sleep",
      name: "Sleep",
      value: sleep ?? 0,
      goal: goals.sleepHours,
      color: "var(--ring-stand)",
      format: sleepHours,
      hint: todayHint("sleep", sleep, goals.sleepHours, isToday),
    },
  ];

  // The whole card opens the sheet with the mouse; the button is the
  // keyboard and screen-reader target. Clicks from inside the (portalled)
  // sheet bubble here through React, so only clicks on the card itself count.
  const onCardClick = (e: MouseEvent<HTMLElement>) => {
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    setOpen(true);
  };

  const title = day === null || day.isToday ? "Today" : `Latest: ${shortLabel(day.date)}`;

  if (day === null) {
    return (
      <section className="card rings-card" aria-labelledby={id}>
        <CardHead id={id} title={title} />
        <EmptyHint lead="No steps, energy or sleep in the exports yet.">
          Turn on Step Count, Active Energy and Sleep Analysis in Health Auto Export.
        </EmptyHint>
      </section>
    );
  }

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the details button is the keyboard target
    <section
      className="card rings-card metric--link health-today"
      aria-labelledby={id}
      onClick={onCardClick}
    >
      <CardHead
        id={id}
        title={title}
        action={
          <button
            ref={button}
            type="button"
            className="link-button card__action health-today__details"
            aria-haspopup="dialog"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
          >
            What&rsquo;s behind {day.isToday ? "today" : shortLabel(day.date)}
          </button>
        }
      />
      <Rings size={200} variant="hero" rings={rings} />
      <p className="muted rings-card__note">
        {day.isToday
          ? "Goals come from your plan, with defaults where it sets none."
          : `Nothing recorded for today yet, so this shows ${day.date}.`}
      </p>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={day.isToday ? "What’s behind today" : `What’s behind ${shortLabel(day.date)}`}
        trigger={button}
      >
        <Contributors
          lead="Each input against your own average over the 30 days before."
          items={todayContributors(days, day)}
        />
      </Sheet>
    </section>
  );
}
