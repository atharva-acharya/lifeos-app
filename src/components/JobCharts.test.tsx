import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Application, ApplicationsView } from "../api";
import { invoke } from "../test/tauri-mocks";
import { ChartsTab, JobCharts } from "./JobCharts";

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

const ROWS = [
  app({ applied: "2026-01-05", source: "LinkedIn Easy Apply", status: "Applied" }),
  app({ applied: "2026-01-06", source: "LinkedIn Easy Apply", status: "Rejected" }),
  app({ applied: "2026-01-07", source: "Company site", status: "Interview" }),
  app({ source: "Reply only", status: "Rejected" }),
];

function view(over: Partial<ApplicationsView>): ApplicationsView {
  return { configured: true, connected: true, error: null, cache: null, ...over };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("JobCharts", () => {
  it("shows both charts with a reply-rate table and the unmatched note", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 8));
    render(<JobCharts rows={ROWS} />);

    expect(screen.getByRole("heading", { name: "Applications per week" })).toBeInTheDocument();
    const weekly = screen.getByRole("table", { name: /Applications per week/ });
    expect(within(weekly).getByRole("row", { name: "5 Jan 3" })).toBeInTheDocument();
    expect(screen.getByText(/This week/)).toHaveTextContent("This week 3 · 12-week average 0.3");

    const rates = screen
      .getAllByRole("table")
      .find((t) => within(t).queryByRole("columnheader", { name: "Reply rate" }));
    expect(rates).toBeDefined();
    if (!rates) return;
    expect(
      within(rates).getByRole("row", { name: "LinkedIn Easy Apply 2 0 1 50%" }),
    ).toBeInTheDocument();
    expect(within(rates).getByRole("row", { name: "Company site 1 1 0 100%" })).toBeInTheDocument();
    expect(screen.getByText(/1 reply not matched/)).toBeInTheDocument();
  });

  it("says so when the saved copy is empty or only has unmatched replies", () => {
    const { unmount } = render(<JobCharts rows={[]} />);
    expect(screen.getByText("No applications in the saved copy yet.")).toBeInTheDocument();
    unmount();
    render(<JobCharts rows={[app({ source: "Reply only", status: "Rejected" })]} />);
    expect(screen.getByText("No applications in the saved copy yet.")).toBeInTheDocument();
  });

  it("shows reply rates to one decimal place", () => {
    render(
      <JobCharts
        rows={[
          app({ applied: "2026-01-05", source: "Indeed", status: "Interview" }),
          app({ applied: "2026-01-05", source: "Indeed", status: "Applied" }),
          app({ applied: "2026-01-05", source: "Indeed", status: "Applied" }),
        ]}
      />,
    );
    expect(screen.getByRole("row", { name: "Indeed 3 1 0 33.3%" })).toBeInTheDocument();
  });
});

describe("ChartsTab", () => {
  it("shows an error when the saved copy cannot be read", async () => {
    invoke.mockRejectedValue("Could not read the saved copy.");
    render(<ChartsTab onNavigate={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not read the saved copy.");
  });

  it("shows the Sheet error above charts from an older copy", async () => {
    invoke.mockResolvedValue(
      view({
        error: "Google sign-in expired.",
        cache: { fetchedAt: 0, rows: ROWS, missingColumns: [] },
      }),
    );
    render(<ChartsTab onNavigate={() => undefined} />);
    expect(await screen.findByRole("status")).toHaveTextContent("Google sign-in expired.");
    expect(screen.getByRole("heading", { name: "Applications per week" })).toBeInTheDocument();
  });

  it("renders charts from the saved copy without refreshing", async () => {
    invoke.mockResolvedValue(
      view({ cache: { fetchedAt: Date.now(), rows: ROWS, missingColumns: [] } }),
    );
    render(<ChartsTab onNavigate={() => undefined} />);
    expect(
      await screen.findByRole("heading", { name: "Reply rate by source" }),
    ).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("get_applications");
    expect(invoke).not.toHaveBeenCalledWith("refresh_applications");
  });

  it("points to Settings when not connected", async () => {
    invoke.mockResolvedValue(view({ connected: false }));
    const onNavigate = vi.fn();
    render(<ChartsTab onNavigate={onNavigate} />);
    (await screen.findByRole("button", { name: "Open settings" })).click();
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("asks to load the Sheet when connected but nothing is saved", async () => {
    invoke.mockResolvedValue(view({}));
    render(<ChartsTab onNavigate={() => undefined} />);
    expect(await screen.findByText(/Open the Applications tab/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
