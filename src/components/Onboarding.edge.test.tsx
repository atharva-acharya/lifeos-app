import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Setup } from "../api";
import { setMode } from "../mode";
import { WelcomePage } from "../pages/WelcomePage";
import { mockCommands } from "../test/tauri-mocks";
import { progressText, SetupProgress } from "./SetupChecklist";

afterEach(() => {
  setMode("real");
});

function setup(over: Partial<Setup>): Setup {
  return { items: [], setUp: 0, skipped: 0, total: 5, complete: false, dismissed: false, ...over };
}

describe("Welcome keyboard use", () => {
  it("offers three real buttons in reading order, all reachable by Tab", () => {
    render(<WelcomePage onChosen={vi.fn()} onSkip={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Choose vault folder",
      "Try with sample data",
      "Skip for now",
    ]);
    for (const b of buttons) {
      expect(b.tagName).toBe("BUTTON");
      expect(b).toHaveAttribute("type", "button");
      // A negative tabindex would take it out of the Tab order.
      expect(b.getAttribute("tabindex") ?? "0").not.toMatch(/^-/);
      b.focus();
      expect(b).toHaveFocus();
    }
  });

  it("is a landmark with a title, so a screen reader announces where it is", () => {
    render(<WelcomePage onChosen={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByRole("main")).toHaveAccessibleName("Welcome to Life OS");
  });

  it("locks every button while sample data opens, so a second Enter does nothing", async () => {
    mockCommands({ enter_sample_mode: () => new Promise(() => undefined) });
    const onSkip = vi.fn();
    render(<WelcomePage onChosen={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "Try with sample data" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Skip for now" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Choose vault folder" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try with sample data" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onSkip).not.toHaveBeenCalled();
  });
});

describe("Setup progress with skipped items", () => {
  it("counts skipped items as handled for the bar but not for the text", () => {
    render(<SetupProgress setup={setup({ setUp: 1, skipped: 2 })} />);
    expect(screen.getByText("1 of 5 set up · 2 skipped")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Setup progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
    expect(bar.firstElementChild).toHaveStyle({ width: "60%" });
  });

  it("is full when everything is either set up or skipped", () => {
    render(<SetupProgress setup={setup({ setUp: 2, skipped: 3, complete: true })} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "100%" });
  });

  it("does not divide by zero with an empty list", () => {
    render(<SetupProgress setup={setup({ total: 0 })} />);
    expect(screen.getByText("0 of 0 set up")).toBeInTheDocument();
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "0%" });
  });

  it("omits the skipped suffix at zero", () => {
    expect(progressText({ setUp: 0, total: 5, skipped: 0 })).toBe("0 of 5 set up");
    expect(progressText({ setUp: 0, total: 5, skipped: 5 })).toBe("0 of 5 set up · 5 skipped");
  });
});
