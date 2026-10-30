import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "../test/tauri-mocks";
import { UpdateBanner } from "./UpdateBanner";
import { UpdateSettings } from "./UpdateSettings";

const SETTINGS = { vaultPath: null, google: {}, autoUpdate: true };

/** Answers each command; an Error value becomes a rejection with its text. */
function route(map: Record<string, unknown>) {
  invoke.mockImplementation((cmd: string) => {
    const value = cmd in map ? map[cmd] : new Error(`unexpected ${cmd}`);
    // Tauri commands reject with plain strings, so the mocks do too.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return value instanceof Error ? Promise.reject(value.message) : Promise.resolve(value);
  });
}

describe("UpdateBanner", () => {
  it("checks at start-up and offers the newer version", async () => {
    route({
      get_settings: SETTINGS,
      check_for_update: { version: "0.3.1", notes: "" },
      install_update: undefined,
    });
    render(<UpdateBanner />);
    expect(await screen.findByText("Life OS 0.3.1 is available.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(invoke).toHaveBeenCalledWith("install_update");
  });

  it("does not check when updates are switched off", async () => {
    route({ get_settings: { ...SETTINGS, autoUpdate: false } });
    render(<UpdateBanner />);
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_settings");
    });
    expect(invoke).not.toHaveBeenCalledWith("check_for_update");
    expect(screen.queryByLabelText("Update available")).not.toBeInTheDocument();
  });

  it("stays quiet when the check fails, and shows install errors", async () => {
    route({
      get_settings: SETTINGS,
      check_for_update: { version: "0.3.1", notes: "" },
      install_update: new Error("The update could not be installed: signature mismatch"),
    });
    render(<UpdateBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Install and restart" }));
    expect(await screen.findByText(/signature mismatch/)).toBeInTheDocument();
    // A refused update cannot be retried from the banner.
    expect(screen.queryByRole("button", { name: "Install and restart" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByLabelText("Update available")).not.toBeInTheDocument();
  });
});

describe("UpdateSettings", () => {
  it("checks on demand and reports up to date", async () => {
    route({ check_for_update: null });
    render(<UpdateSettings autoUpdate onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("You have the latest version.")).toBeInTheDocument();
  });

  it("saves the start-up switch", async () => {
    route({ set_auto_update: { ...SETTINGS, autoUpdate: false } });
    const onChange = vi.fn();
    render(<UpdateSettings autoUpdate onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Check for updates/ }));
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({ ...SETTINGS, autoUpdate: false });
    });
    expect(invoke).toHaveBeenCalledWith("set_auto_update", { enabled: false });
  });

  it("shows a check failure", async () => {
    route({ check_for_update: new Error("Could not check for updates.") });
    render(<UpdateSettings autoUpdate onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not check for updates.");
  });
});
