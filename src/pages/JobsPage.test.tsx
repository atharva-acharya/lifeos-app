import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Jobs } from "../api";
import { invoke } from "../test/tauri-mocks";
import { JobsPage } from "./JobsPage";

const STAGES = ["applied", "replied", "screen", "interview", "offer", "rejected"];

const JOBS: Jobs = {
  pipeline: STAGES.map((stage) => ({
    stage,
    companies:
      stage === "screen"
        ? [
            {
              path: "Jobs/Companies/Example Security Ltd.md",
              company: "Example Security Ltd",
              role: "SOC Analyst",
              stage,
              applied: "2026-01-05",
              contact: null,
              nextAction: "Prepare for phone screen",
              nextDate: "2000-01-01",
            },
          ]
        : [],
  })),
  outreach: [
    {
      sent: "2026-01-08",
      name: "Riley Test",
      profile: null,
      companyRole: "Northwind Labs",
      contactType: "Peer",
      status: "accepted",
      lastUpdate: "2026-01-09",
    },
    {
      sent: "2026-01-05",
      name: "Alex Example",
      profile: null,
      companyRole: "Example Security Ltd / SOC Analyst",
      contactType: "Recruiter",
      status: "replied",
      lastUpdate: "2026-01-07",
    },
  ],
};

describe("JobsPage", () => {
  it("shows the pipeline with every stage and overdue follow-ups", async () => {
    invoke.mockResolvedValue({ status: "ready", jobs: JOBS });
    render(<JobsPage onNavigate={vi.fn()} />);
    const screenColumn = await screen.findByRole("listitem", { name: "Screen" });
    expect(within(screenColumn).getByText("Example Security Ltd")).toBeInTheDocument();
    expect(within(screenColumn).getByText("Overdue · 1 Jan")).toBeInTheDocument();
    expect(
      screen.getAllByRole("listitem", { name: /Applied|Replied|Screen|Interview|Offer|Rejected/ }),
    ).toHaveLength(6);
  });

  it("filters the outreach log by status", async () => {
    invoke.mockResolvedValue({ status: "ready", jobs: JOBS });
    render(<JobsPage onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Outreach" }));
    expect(await screen.findByText("Alex Example")).toBeInTheDocument();
    expect(screen.getByText("2 contacted · 1 replied")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "accepted" } });
    expect(screen.queryByText("Alex Example")).not.toBeInTheDocument();
    expect(screen.getByText("Riley Test")).toBeInTheDocument();
  });

  it("loads the Charts tab on demand from the saved Sheet copy", async () => {
    invoke.mockImplementation((cmd: string) =>
      Promise.resolve(
        cmd === "get_applications"
          ? {
              configured: true,
              connected: true,
              error: null,
              cache: {
                fetchedAt: Date.now(),
                missingColumns: [],
                rows: [
                  {
                    applied: "2026-01-05",
                    company: "Example Ltd",
                    role: "SOC Analyst",
                    source: "Company site",
                    inbox: null,
                    status: "Interview",
                    lastUpdate: null,
                    daysSince: null,
                    followUp: null,
                    email: null,
                    notes: null,
                    messageId: null,
                  },
                ],
              },
            }
          : { status: "ready", jobs: JOBS },
      ),
    );
    render(<JobsPage onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Charts" }));
    expect(
      await screen.findByRole("heading", { name: "Applications per week" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Company site 1 1 0 100%" })).toBeInTheDocument();
  });

  it("points to settings for the Sheet until Google is connected", async () => {
    invoke.mockResolvedValue({ status: "ready", jobs: JOBS });
    const onNavigate = vi.fn();
    render(<JobsPage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("tab", { name: "Applications" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });
});
