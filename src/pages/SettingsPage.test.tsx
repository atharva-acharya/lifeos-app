import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "../test/tauri-mocks";
import { SettingsPage } from "./SettingsPage";

// Diagnostics has its own tests; stubbed so these tests control every invoke.
vi.mock("../components/DiagnosticsSettings", () => ({ DiagnosticsSettings: () => null }));
// The checklist has its own tests; stubbed so the queued results below stay in order.
vi.mock("../components/SetupChecklist", () => ({ SetupChecklist: () => null }));

const VAULT = "D:\\Notes\\Life OS";
const HEALTH = String.raw`D:\iCloud\Health`;
const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-ab";
const NO_GOOGLE = {
  clientId: "",
  sheetId: "",
  hasSecret: false,
  configured: false,
  connected: false,
};

describe("SettingsPage", () => {
  it("asks for a vault when none is set", async () => {
    invoke.mockResolvedValueOnce({ vaultPath: null, google: NO_GOOGLE });
    render(<SettingsPage />);
    expect(await screen.findByText("Not set")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeEnabled();
    expect(invoke).toHaveBeenCalledWith("get_settings");
  });

  it("shows the Health export card next to the vault card", async () => {
    invoke.mockResolvedValueOnce({
      vaultPath: VAULT,
      healthPath: HEALTH,
      google: NO_GOOGLE,
    });
    render(<SettingsPage />);
    expect(await screen.findByRole("heading", { name: "Health export" })).toBeInTheDocument();
    expect(screen.getByText(HEALTH)).toBeInTheDocument();
    // The vault card keeps its own button.
    expect(screen.getByRole("button", { name: "Change folder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change Health folder" })).toBeInTheDocument();
  });

  it("shows a refused Health folder on its own card and keeps the old folder", async () => {
    invoke
      .mockResolvedValueOnce({ vaultPath: VAULT, healthPath: HEALTH, google: NO_GOOGLE })
      .mockRejectedValueOnce("the chosen Health folder is a link or junction; <b>pick</b> it");
    const { container } = render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Change Health folder" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("link or junction");
    // Text, not markup.
    expect(alert).toHaveTextContent("<b>pick</b>");
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(HEALTH)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change Health folder" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
    expect(screen.getByText(VAULT)).toBeInTheDocument();
  });

  it("treats a missing healthPath from an older backend as not chosen", async () => {
    invoke.mockResolvedValueOnce({ vaultPath: VAULT, google: NO_GOOGLE });
    render(<SettingsPage />);
    expect(await screen.findByText("Not chosen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Health folder" })).toBeEnabled();
  });

  it("shows the connected vault", async () => {
    invoke.mockResolvedValueOnce({ vaultPath: VAULT, google: NO_GOOGLE });
    render(<SettingsPage />);
    expect(await screen.findByText(VAULT)).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change folder" })).toBeInTheDocument();
  });

  it("saves the chosen folder", async () => {
    invoke
      .mockResolvedValueOnce({ vaultPath: null, google: NO_GOOGLE })
      .mockResolvedValueOnce({ vaultPath: VAULT, google: NO_GOOGLE });
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose folder" }));
    expect(await screen.findByText(VAULT)).toBeInTheDocument();
    expect(invoke).toHaveBeenLastCalledWith("choose_vault_folder");
  });

  it("shows why a folder was refused", async () => {
    invoke
      .mockResolvedValueOnce({ vaultPath: null, google: NO_GOOGLE })
      .mockRejectedValueOnce("the chosen vault is a link or junction; pick the real folder");
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("link or junction");
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("saves Google details without echoing the secret back", async () => {
    invoke.mockResolvedValueOnce({ vaultPath: VAULT, google: NO_GOOGLE }).mockResolvedValueOnce({
      vaultPath: VAULT,
      google: { ...NO_GOOGLE, clientId: "id", sheetId: SHEET, hasSecret: true, configured: true },
    });
    render(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText("Client ID"), { target: { value: "id" } });
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "s3cret" } });
    fireEvent.change(screen.getByLabelText("Sheet ID"), { target: { value: SHEET } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Ready to connect")).toBeInTheDocument();
    expect(invoke).toHaveBeenLastCalledWith("save_google_config", {
      clientId: "id",
      clientSecret: "s3cret",
      sheetId: SHEET,
    });
    expect(screen.getByLabelText("Client secret")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("offers disconnect once connected", async () => {
    invoke.mockResolvedValueOnce({
      vaultPath: VAULT,
      google: {
        clientId: "id",
        sheetId: SHEET,
        hasSecret: true,
        configured: true,
        connected: true,
      },
    });
    render(<SettingsPage />);
    expect(await screen.findByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.getAllByText("Connected")).toHaveLength(2);
  });

  it("shows the real status when Disconnect could not reach Google", async () => {
    const google = {
      clientId: "id",
      sheetId: SHEET,
      hasSecret: true,
      configured: true,
      connected: true,
    };
    invoke
      .mockResolvedValueOnce({ vaultPath: VAULT, google })
      .mockRejectedValueOnce("Disconnected here, but Google could not be reached.")
      .mockResolvedValueOnce({ vaultPath: VAULT, google: { ...google, connected: false } });
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText(/Google could not be reached/)).toBeInTheDocument();
    expect(await screen.findByText("Ready to connect")).toBeInTheDocument();
    expect(invoke).toHaveBeenLastCalledWith("get_settings");
  });
});
