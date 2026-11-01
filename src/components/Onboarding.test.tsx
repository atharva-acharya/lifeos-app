import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Setup, SetupItem } from "../api";
import { setMode } from "../mode";
import { COMPLETE_SETUP, invoke, mockCommands, rejected } from "../test/tauri-mocks";
import { EmptyHint } from "./EmptyHint";
import { GuidePanel } from "./GuidePanel";
import { NotConnected } from "./NotConnected";
import { SampleBanner } from "./SampleBanner";
import { SetupCard } from "./SetupCard";
import { SetupChecklist, progressText } from "./SetupChecklist";

function setup(
  over: Partial<Record<SetupItem["id"], Partial<SetupItem>>>,
  dismissed = false,
): Setup {
  const items = COMPLETE_SETUP.items.map((i) => ({ ...i, ...over[i.id] }));
  const setUp = items.filter((i) => i.done).length;
  const skipped = items.filter((i) => i.skipped).length;
  return {
    items,
    dismissed,
    total: items.length,
    setUp,
    skipped,
    complete: setUp + skipped === items.length,
  };
}

const PARTIAL = setup({
  daily: { done: false },
  plan: { done: false, detail: "2 of 3 fields" },
  sheet: { done: false, skipped: true },
  projects: { done: false },
});

afterEach(() => {
  setMode("real");
});

describe("progressText", () => {
  it("counts what is set up and, separately, what is skipped", () => {
    expect(progressText({ setUp: 3, total: 5, skipped: 0 })).toBe("3 of 5 set up");
    expect(progressText({ setUp: 3, total: 5, skipped: 1 })).toBe("3 of 5 set up · 1 skipped");
  });
});

describe("SetupChecklist", () => {
  it("shows progress, states and field detail", async () => {
    mockCommands({ get_setup: PARTIAL });
    render(<SetupChecklist />);
    expect(await screen.findByText("2 of 6 set up · 1 skipped")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Setup progress" })).toHaveAttribute(
      "aria-valuenow",
      "3",
    );
    expect(screen.getByText("2 of 3 fields")).toBeInTheDocument();
    expect(screen.getAllByText("To do")).toHaveLength(3);
    expect(screen.getByText("Skipped")).toBeInTheDocument();
  });

  it("never offers to skip the vault", async () => {
    mockCommands({ get_setup: setup({ vault: { done: false } }) });
    render(<SetupChecklist onChooseVault={vi.fn()} />);
    await screen.findByText("Vault folder");
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
  });

  it("skips an item and undoes it", async () => {
    mockCommands({
      get_setup: setup({ projects: { done: false } }),
      skip_setup_item: setup({ projects: { done: false, skipped: true } }),
      unskip_setup_item: setup({ projects: { done: false } }),
    });
    render(<SetupChecklist />);
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(await screen.findByText("5 of 6 set up · 1 skipped")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("skip_setup_item", { id: "projects" });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("5 of 6 set up")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("unskip_setup_item", { id: "projects" });
  });

  it("opens the Health item's settings section and lets it be skipped", async () => {
    mockCommands({ get_setup: setup({ health: { done: false } }) });
    const onOpenSection = vi.fn();
    render(<SetupChecklist onOpenSection={onOpenSection} />);
    expect(await screen.findByText("Health export")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Vault and Health" }));
    expect(onOpenSection).toHaveBeenCalledWith("data");
    expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled();
  });

  it("shows why a change failed", async () => {
    mockCommands({
      get_setup: setup({ projects: { done: false } }),
      skip_setup_item: () => {
        return rejected("unknown setup item");
      },
    });
    render(<SetupChecklist />);
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("unknown setup item");
  });

  it("opens a guide with the template and field notes", async () => {
    mockCommands({ get_setup: setup({ plan: { done: false } }) });
    render(<SetupChecklist />);
    fireEvent.click(await screen.findByRole("button", { name: "Guide" }));
    const guide = screen.getByRole("group", { name: "Fitness plan guide" });
    expect(guide).toHaveTextContent("Fitness/Plan.md");
    expect(guide).toHaveTextContent("type: plan");
    expect(guide).toHaveTextContent("steps_goal");
  });

  it("can start with a guide open", async () => {
    mockCommands({ get_setup: setup({ daily: { done: false } }) });
    render(<SetupChecklist openGuide="daily" />);
    expect(await screen.findByRole("group", { name: "Daily notes guide" })).toBeInTheDocument();
  });

  it("disables changes while sample data is on", async () => {
    mockCommands({ get_setup: setup({ projects: { done: false } }) });
    render(<SetupChecklist disabled />);
    expect(await screen.findByRole("button", { name: "Skip" })).toBeDisabled();
  });
});

describe("GuidePanel", () => {
  const write = vi.fn();

  it("copies the template", async () => {
    write.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: write },
      configurable: true,
    });
    render(<GuidePanel id="daily" today="2026-10-30" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(write).toHaveBeenCalledWith(expect.stringContaining("date: 2026-10-30"));
  });

  it("says so when the clipboard refuses, without throwing", async () => {
    write.mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: write },
      configurable: true,
    });
    render(<GuidePanel id="daily" today="2026-10-30" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText(/Copy failed/)).toBeInTheDocument();
  });

  it("says so when there is no clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<GuidePanel id="plan" today="2026-10-30" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText(/Copy failed/)).toBeInTheDocument();
  });
});

describe("SetupCard", () => {
  it("shows what is left and opens Settings", async () => {
    mockCommands({ get_setup: PARTIAL });
    const onNavigate = vi.fn();
    render(<SetupCard onNavigate={onNavigate} />);
    expect(await screen.findByText("2 of 6 set up · 1 skipped")).toBeInTheDocument();
    expect(
      screen.getByText(/Still to do: Daily notes, Fitness plan, Projects/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open setup" }));
    expect(onNavigate).toHaveBeenCalledWith("settings", "setup");
  });

  it("can be dismissed", async () => {
    mockCommands({ get_setup: PARTIAL, dismiss_setup: setup({}, true) });
    render(<SetupCard onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await vi.waitFor(() => {
      expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
    });
    expect(invoke).toHaveBeenCalledWith("dismiss_setup");
  });

  it("hides when everything is handled, dismissed, or in sample mode", async () => {
    mockCommands({ get_setup: COMPLETE_SETUP });
    const { unmount } = render(<SetupCard onNavigate={vi.fn()} />);
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_setup");
    });
    expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
    unmount();

    mockCommands({ get_setup: setup({ daily: { done: false } }, true) });
    const second = render(<SetupCard onNavigate={vi.fn()} />);
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
    second.unmount();

    setMode("sample");
    mockCommands({ get_setup: PARTIAL });
    render(<SetupCard onNavigate={vi.fn()} />);
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_setup");
    });
    expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
  });
});

describe("EmptyHint", () => {
  it("names the note and links checklist guides to Settings", () => {
    const onNavigate = vi.fn();
    render(
      <EmptyHint lead="No daily note for 30 Oct." guide="daily" onNavigate={onNavigate}>
        Add a note with <code>type: daily</code>.
      </EmptyHint>,
    );
    expect(screen.getByText("No daily note for 30 Oct.")).toBeInTheDocument();
    expect(screen.getByText("type: daily")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "How to set this up" }));
    expect(onNavigate).toHaveBeenCalledWith("settings", "daily");
  });

  it("expands other guides in place", () => {
    render(
      <EmptyHint lead="No companies." guide="company">
        Add notes.
      </EmptyHint>,
    );
    fireEvent.click(screen.getByRole("button", { name: "How to set this up" }));
    expect(screen.getByRole("group", { name: "Companies guide" })).toHaveTextContent(
      "type: company",
    );
  });

  it("has no guide button without a guide", () => {
    render(<EmptyHint lead="Nothing due. Nice.">Follow-ups.</EmptyHint>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("NotConnected", () => {
  it("offers settings and sample data", async () => {
    mockCommands({ enter_sample_mode: "sample" });
    const onNavigate = vi.fn();
    render(<NotConnected onNavigate={onNavigate}>Choose a vault.</NotConnected>);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(onNavigate).toHaveBeenCalledWith("settings", "data");
    fireEvent.click(screen.getByRole("button", { name: "Try with sample data" }));
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("enter_sample_mode", expect.anything());
    });
  });

  it("reports a refusal", async () => {
    mockCommands({
      enter_sample_mode: () => {
        return rejected("could not write the sample data");
      },
    });
    render(<NotConnected onNavigate={vi.fn()}>Choose a vault.</NotConnected>);
    fireEvent.click(screen.getByRole("button", { name: "Try with sample data" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not write");
  });
});

describe("SampleBanner", () => {
  it("says the data is not yours and leaves on request", async () => {
    mockCommands({ exit_sample_mode: "real" });
    const onLeft = vi.fn();
    render(<SampleBanner onLeft={onLeft} />);
    expect(screen.getByText("You're looking at sample data. None of it is yours.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Leave sample data" }));
    await vi.waitFor(() => {
      expect(onLeft).toHaveBeenCalledWith("D:\\Notes\\Life OS");
    });
  });
});
