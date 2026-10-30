import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Diagnostics } from "../api";
import { invoke } from "../test/tauri-mocks";
import { DiagnosticsSettings, diagnosticsText } from "./DiagnosticsSettings";

const DIAG: Diagnostics = {
  version: "0.3.0",
  os: "windows x86_64",
  log: ["1700000000000 [ui] promise: TypeError: x is undefined"],
};

describe("diagnosticsText", () => {
  it("lists version, OS and the log", () => {
    expect(diagnosticsText(DIAG)).toBe(
      "Life OS 0.3.0 on windows x86_64\n\nRecent errors (oldest first):\n1700000000000 [ui] promise: TypeError: x is undefined\n",
    );
    expect(diagnosticsText({ ...DIAG, log: [] })).toContain("(no errors logged)");
  });
});

describe("DiagnosticsSettings", () => {
  it("shows the version and copies the report", async () => {
    invoke.mockResolvedValue(DIAG);
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DiagnosticsSettings />);
    expect(await screen.findByText("Version 0.3.0")).toBeInTheDocument();
    expect(screen.getByText("1 recent error logged")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(diagnosticsText(DIAG));
  });

  it("says so when the clipboard refuses", async () => {
    invoke.mockResolvedValue({ ...DIAG, log: [] });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
    });
    render(<DiagnosticsSettings />);
    expect(await screen.findByText("No errors logged")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy");
  });
});
