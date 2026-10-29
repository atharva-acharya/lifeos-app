import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Application, ApplicationsView } from "../api";
import { invoke } from "../test/tauri-mocks";
import { ApplicationsTab } from "./ApplicationsTab";

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

const VIEW: ApplicationsView = {
  configured: true,
  connected: false,
  error: null,
  cache: {
    fetchedAt: Date.now() - 5 * 60_000,
    missingColumns: [],
    rows: [
      app({
        applied: "2026-01-05",
        company: "Example Ltd",
        role: "SOC Analyst",
        source: "Easy Apply",
        status: "Applied",
      }),
      app({
        applied: "2026-01-07",
        company: "Sample Bank",
        role: "Security Analyst",
        source: "Company site",
        status: "Rejected",
      }),
      app({
        applied: "2026-01-06",
        company: "Northwind",
        role: "Junior Analyst",
        source: "Easy Apply",
        status: "Applied",
      }),
    ],
  },
};

describe("ApplicationsTab", () => {
  it("shows the saved copy with counts, newest first", async () => {
    invoke.mockResolvedValue(VIEW);
    render(<ApplicationsTab onNavigate={vi.fn()} />);
    expect(await screen.findByText("Updated 5 min ago")).toBeInTheDocument();
    const counts = screen.getByRole("list", { name: "Applications by status" });
    expect(within(counts).getByText("3")).toBeInTheDocument();
    const firstRow = screen.getAllByRole("row")[1];
    expect(within(firstRow).getByText("Sample Bank")).toBeInTheDocument();
  });

  it("filters by source and searches", async () => {
    invoke.mockResolvedValue(VIEW);
    render(<ApplicationsTab onNavigate={vi.fn()} />);
    await screen.findByText("Example Ltd");
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "Easy Apply" } });
    expect(screen.queryByText("Sample Bank")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "north" } });
    expect(screen.queryByText("Example Ltd")).not.toBeInTheDocument();
    expect(screen.getByText("Northwind")).toBeInTheDocument();
  });

  it("refreshes a stale copy when connected and shows errors beside the saved copy", async () => {
    if (!VIEW.cache) throw new Error("fixture has a cache");
    const stale = { ...VIEW, connected: true, cache: { ...VIEW.cache, fetchedAt: 0 } };
    invoke.mockResolvedValueOnce(stale).mockResolvedValueOnce({
      ...stale,
      error: "could not reach Google; showing the last saved copy",
    });
    render(<ApplicationsTab onNavigate={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("could not reach Google");
    expect(invoke).toHaveBeenCalledWith("refresh_applications");
    expect(screen.getByText("Example Ltd")).toBeInTheDocument();
  });
});
