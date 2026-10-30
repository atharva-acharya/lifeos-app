/** Note shapes the app reads, with a front matter template to copy. Nothing here is written to disk. */

export type GuideId = "daily" | "plan" | "projects" | "company" | "outreach" | "workout";

/** Guides that belong to a setup checklist item; the rest open inline. */
export const CHECKLIST_GUIDES: readonly GuideId[] = ["daily", "plan", "projects"];

export interface GuideField {
  name: string;
  text: string;
}

export interface Guide {
  id: GuideId;
  title: string;
  /** Suggested place in the vault. */
  path: string;
  template: (today: string) => string;
  fields: GuideField[];
}

const DAYS = "Push A, Pull A, Legs, Push B or Pull B";

export const GUIDES: Record<GuideId, Guide> = {
  daily: {
    id: "daily",
    title: "Daily notes",
    path: "Daily/2026-10-30.md (one note per day)",
    template: (today) =>
      [
        "---",
        "type: daily",
        `date: ${today}`,
        "weight: 83.5",
        "steps: 8000",
        "protein_g: 160",
        "meals_tracked: true",
        "gym: Push A",
        "mobility: true",
        "applications: 2",
        "---",
      ].join("\n"),
    fields: [
      { name: "type", text: "Must be daily so the app treats the note as a day." },
      { name: "date", text: "The day, as YYYY-MM-DD. Today reads the note whose date is today." },
      { name: "weight", text: "Body weight in kg. Feeds the weight trend." },
      { name: "steps", text: "Steps for the day. Feeds the steps ring and chart." },
      { name: "protein_g", text: "Protein in grams. Compared with your protein goal." },
      { name: "meals_tracked", text: "true when you logged your meals." },
      { name: "gym", text: `The session you trained: ${DAYS}.` },
      { name: "mobility", text: "true when you did your mobility work." },
      { name: "applications", text: "Jobs you applied to that day." },
    ],
  },
  plan: {
    id: "plan",
    title: "Fitness plan",
    path: "Fitness/Plan.md",
    template: (today) =>
      [
        "---",
        "type: plan",
        "name: Cut",
        `start: ${today}`,
        "end: 2027-01-29",
        "start_weight: 85",
        "target_weight: 80",
        "steps_goal: 9000",
        "protein_goal: 160",
        "---",
      ].join("\n"),
    fields: [
      { name: "type", text: "Must be plan. Keep the note at Fitness/Plan.md." },
      { name: "start / end", text: "The dates of your plan. The target line runs between them." },
      { name: "start_weight", text: "Your weight at the start, in kg." },
      { name: "target_weight", text: "The weight you are aiming for, in kg." },
      { name: "steps_goal", text: "Daily steps goal. Without it the app uses 8000." },
      { name: "protein_goal", text: "Daily protein goal in grams. Without it the app uses 170." },
    ],
  },
  projects: {
    id: "projects",
    title: "Projects",
    path: "Projects/home-lab.md (one note per project)",
    template: (today) =>
      [
        "---",
        "type: project",
        "project: home-lab",
        "status: active",
        "next_step: Set up log forwarding",
        `updated: ${today}`,
        "---",
        "## Steps",
        "- [x] Install hypervisor",
        "- [ ] Set up log forwarding",
        "- [ ] Write detection rules",
        "## Log",
        `- ${today}: Hypervisor running.`,
      ].join("\n"),
    fields: [
      { name: "type", text: "Must be project." },
      { name: "project", text: "The project's name." },
      {
        name: "status",
        text: "active, paused or done. Only active projects appear in Resume here.",
      },
      {
        name: "next_step",
        text: "What to do next (the first unchecked step is used when it is missing).",
      },
      { name: "updated", text: "When you last worked on it, as YYYY-MM-DD." },
      {
        name: "## Steps",
        text: "A checklist of - [ ] and - [x] lines. Progress is counted from it.",
      },
      { name: "## Log", text: "Optional dated lines, newest at the bottom." },
    ],
  },
  company: {
    id: "company",
    title: "Companies",
    path: "Jobs/Companies/Example Ltd.md (one note per company)",
    template: (today) =>
      [
        "---",
        "type: company",
        "company: Example Ltd",
        "role: SOC Analyst",
        "stage: applied",
        `applied: ${today}`,
        "contact: Jo Example",
        "next_action: Send a follow-up",
        "next_date: 2026-11-06",
        "---",
      ].join("\n"),
    fields: [
      { name: "type", text: "Must be company." },
      { name: "company / role", text: "Who and what you applied for." },
      { name: "stage", text: "applied, replied, screen, interview, offer or rejected." },
      {
        name: "next_action / next_date",
        text: "The follow-up. It shows on Today when the date arrives.",
      },
    ],
  },
  outreach: {
    id: "outreach",
    title: "Outreach log",
    path: "Jobs/Outreach.md",
    template: () =>
      [
        "---",
        "type: outreach-log",
        "---",
        "| Sent | Name | Profile | Company / role | Type | Status | Last update |",
        "|---|---|---|---|---|---|---|",
        "| 2026-10-30 | Jo Example | linkedin.com/in/jo-example | Example Ltd / SOC Analyst | Recruiter | sent | 2026-10-30 |",
      ].join("\n"),
    fields: [
      { name: "type", text: "Must be outreach-log." },
      { name: "table", text: "One row per contact, with the columns shown above." },
      { name: "Status", text: "sent, accepted, messaged, replied or withdrawn." },
    ],
  },
  workout: {
    id: "workout",
    title: "Workouts",
    path: "Fitness/Log/2026-10-30-push-a.md (one note per session)",
    template: (today) =>
      [
        "---",
        "type: workout",
        `date: ${today}`,
        "day: Push A",
        "week: 1",
        "deload: false",
        "duration_min: 60",
        "exercises:",
        "  - Bench press 3 x 8 @ 60 kg",
        "  - Overhead press 3 x 10 @ 35 kg",
        "---",
      ].join("\n"),
    fields: [
      { name: "type", text: "Must be workout." },
      { name: "date", text: "The day of the session, as YYYY-MM-DD." },
      { name: "day", text: `Which session it was: ${DAYS}.` },
      {
        name: "exercises",
        text: "One line each: name, sets x reps @ weight. Feeds lift progress.",
      },
    ],
  },
};
