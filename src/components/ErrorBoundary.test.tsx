import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "../test/tauri-mocks";
import { ErrorBoundary } from "./ErrorBoundary";

let broken = true;
function Page() {
  if (broken) throw new Error("boom");
  return <p>Page content</p>;
}

describe("ErrorBoundary", () => {
  it("shows a recoverable card instead of a blank app, and logs the error", () => {
    invoke.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    broken = true;
    const { rerender } = render(
      <ErrorBoundary resetKey="today">
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This page hit a problem");
    expect(invoke).toHaveBeenCalledWith("log_error", {
      message: expect.stringContaining("render: Error: boom") as unknown,
    });

    // Navigating to another page clears the error.
    broken = false;
    rerender(
      <ErrorBoundary resetKey="jobs">
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("can retry the same page", () => {
    invoke.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    broken = true;
    render(
      <ErrorBoundary resetKey="today">
        <Page />
      </ErrorBoundary>,
    );
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });
});
