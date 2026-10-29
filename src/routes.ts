export type RouteId = "today" | "jobs" | "fitness" | "projects" | "search" | "settings";

export interface Route {
  id: RouteId;
  label: string;
  kicker: string;
  phase: number;
  summary: string;
}

export const MAIN_ROUTES: readonly Route[] = [
  {
    id: "today",
    label: "Today",
    kicker: "Home",
    phase: 1,
    summary: "Follow-ups due, weight, applications, gym session, habits and where to resume.",
  },
  {
    id: "jobs",
    label: "Jobs",
    kicker: "Job search",
    phase: 2,
    summary: "Applications from your sheet, company pipeline, outreach log and reply rates.",
  },
  {
    id: "fitness",
    label: "Fitness",
    kicker: "Training",
    phase: 3,
    summary: "Weight trend, steps, protein days, workout history and lift progress.",
  },
  {
    id: "projects",
    label: "Projects",
    kicker: "Tracker",
    phase: 3,
    summary: "Each project's steps, progress and the exact place to resume.",
  },
  {
    id: "search",
    label: "Search",
    kicker: "Find anything",
    phase: 4,
    summary: "Notes, companies, projects and quick actions from one box (Ctrl+K).",
  },
];

export const SETTINGS_ROUTE: Route = {
  id: "settings",
  label: "Settings",
  kicker: "App",
  phase: 1,
  summary: "Choose your vault folder and app preferences.",
};

export const ALL_ROUTES: readonly Route[] = [...MAIN_ROUTES, SETTINGS_ROUTE];
