import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { setMode } from "./mode";
import { invoke, mockCommands, NO_GOOGLE, READY_SETTINGS, rejected } from "./test/tauri-mocks";

const NO_VAULT = { vaultPath: null, google: NO_GOOGLE, autoUpdate: false };

describe("App shell", () => {
  beforeEach(() => {
    mockCommands({ get_today: { status: "noVault" } });
  });
  afterEach(() => {
    setMode("real");
  });

  it("opens on Today", async () => {
    render(<App />);
    expect(await screen.findByRole("button", { name: "Today" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
  });

  it("lists every module in the sidebar with settings at the bottom", async () => {
    render(<App />);
    const main = await screen.findByRole("navigation", { name: "Main" });
    const labels = Array.from(main.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual([
      "Today",
      "Jobs",
      "Fitness",
      "Health",
      "Money",
      "Projects",
      "SearchCtrl K",
    ]);
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("navigates when a sidebar item is chosen", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Fitness" }));
    expect(screen.getByRole("heading", { level: 1, name: "Fitness" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fitness" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it("moves focus to the page after navigating", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("names the page bar after the current page", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Fitness" }));
    const bar = screen.getByRole("main").querySelector(".page-bar");
    expect(bar).toHaveTextContent("Fitness");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar).not.toHaveAttribute("data-visible");
  });

  it("opens Search with Ctrl+K", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Today" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBeInTheDocument();
  });

  it("shows no banner or Sample pill with real data", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Today" });
    expect(screen.queryByText(/looking at sample data/)).not.toBeInTheDocument();
    expect(screen.queryByText("Sample")).not.toBeInTheDocument();
  });
});

describe("First run", () => {
  afterEach(() => {
    setMode("real");
  });

  it("shows Welcome, without the sidebar, while no vault is set", async () => {
    mockCommands({ get_settings: NO_VAULT });
    render(<App />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Welcome to Life OS" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Choose vault folder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try with sample data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("opens the shell on Skip for now", async () => {
    mockCommands({ get_settings: NO_VAULT, get_today: { status: "noVault" } });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
  });

  it("lands on Today after a folder is chosen", async () => {
    mockCommands({
      get_settings: NO_VAULT,
      choose_vault_folder: READY_SETTINGS,
      get_today: { status: "noVault" },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose vault folder" }));
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });

  it("stays on Welcome when the folder picker is cancelled", async () => {
    mockCommands({ get_settings: NO_VAULT, choose_vault_folder: NO_VAULT });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose vault folder" }));
    expect(await screen.findByRole("button", { name: "Choose vault folder" })).toBeEnabled();
    expect(screen.getByRole("heading", { level: 1, name: "Welcome to Life OS" })).toBeVisible();
  });

  it("skips Welcome when a vault is already set", async () => {
    mockCommands({ get_today: { status: "noVault" } });
    render(<App />);
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.queryByText("Welcome to Life OS")).not.toBeInTheDocument();
  });
});

describe("Sample data", () => {
  afterEach(() => {
    setMode("real");
  });

  it("enters sample data from Welcome with the banner and a Sample pill", async () => {
    mockCommands({
      get_settings: NO_VAULT,
      enter_sample_mode: "sample",
      get_today: { status: "noVault" },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Try with sample data" }));
    expect(
      await screen.findByText("You're looking at sample data. None of it is yours."),
    ).toBeVisible();
    expect(screen.getByText("Sample", { selector: ".sidebar__mode *" })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("enter_sample_mode", {
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
    });
  });

  it("shows the banner on every page", async () => {
    mockCommands({ get_mode: "sample", get_today: { status: "noVault" } });
    render(<App />);
    expect(await screen.findByText(/looking at sample data/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(screen.getByText(/looking at sample data/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText(/looking at sample data/)).toBeInTheDocument();
  });

  it("leaves sample data and returns to Welcome when no vault is set", async () => {
    let mode = "sample";
    mockCommands({
      get_mode: () => mode,
      get_settings: NO_VAULT,
      exit_sample_mode: () => {
        mode = "real";
        return "real";
      },
      get_today: { status: "noVault" },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Leave sample data" }));
    expect(await screen.findByRole("heading", { name: "Welcome to Life OS" })).toBeVisible();
    expect(screen.queryByText(/looking at sample data/)).not.toBeInTheDocument();
  });

  it("leaves sample data and returns to the shell when a vault is set", async () => {
    mockCommands({
      get_mode: "sample",
      exit_sample_mode: "real",
      get_today: { status: "noVault" },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Leave sample data" }));
    await act(() => Promise.resolve());
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.queryByText(/looking at sample data/)).not.toBeInTheDocument();
  });

  it("shows why leaving failed and keeps the banner", async () => {
    mockCommands({
      get_mode: "sample",
      exit_sample_mode: () => {
        return rejected("could not delete the sample folder");
      },
      get_today: { status: "noVault" },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Leave sample data" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not delete");
    expect(screen.getByText(/looking at sample data/)).toBeInTheDocument();
  });
});
