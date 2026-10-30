import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentMode, setMode } from "../mode";
import { invoke, mockCommands, NO_GOOGLE, READY_SETTINGS, rejected } from "../test/tauri-mocks";
import { WelcomePage } from "./WelcomePage";

afterEach(() => {
  setMode("real");
});

describe("WelcomePage", () => {
  it("explains the app and its privacy line", () => {
    render(<WelcomePage onChosen={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Welcome to Life OS" })).toBeVisible();
    expect(screen.getByText(/Nothing leaves it except the read-only Google Sheet/)).toBeVisible();
  });

  it("reports the chosen vault", async () => {
    mockCommands({ choose_vault_folder: READY_SETTINGS });
    const onChosen = vi.fn();
    render(<WelcomePage onChosen={onChosen} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose vault folder" }));
    await vi.waitFor(() => {
      expect(onChosen).toHaveBeenCalledWith(READY_SETTINGS);
    });
  });

  it("does nothing when the picker is cancelled", async () => {
    mockCommands({ choose_vault_folder: { vaultPath: null, google: NO_GOOGLE, autoUpdate: true } });
    const onChosen = vi.fn();
    render(<WelcomePage onChosen={onChosen} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose vault folder" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Choose vault folder" })).toBeEnabled();
    });
    expect(onChosen).not.toHaveBeenCalled();
  });

  it("shows why a folder was refused", async () => {
    mockCommands({
      choose_vault_folder: () => {
        return rejected("the chosen vault is a link or junction; pick the real folder");
      },
    });
    render(<WelcomePage onChosen={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose vault folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("link or junction");
  });

  it("turns sample mode on", async () => {
    mockCommands({ enter_sample_mode: "sample" });
    render(<WelcomePage onChosen={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Try with sample data" }));
    await vi.waitFor(() => {
      expect(currentMode()).toBe("sample");
    });
    expect(invoke).toHaveBeenCalledWith("enter_sample_mode", expect.anything());
  });

  it("skips without calling the core", () => {
    const onSkip = vi.fn();
    render(<WelcomePage onChosen={vi.fn()} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onSkip).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
