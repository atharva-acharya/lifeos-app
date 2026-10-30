import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "../test/tauri-mocks";
import { SettingsPage } from "./SettingsPage";

// Diagnostics has its own tests; stubbed so these tests control every invoke.
vi.mock("../components/DiagnosticsSettings", () => ({ DiagnosticsSettings: () => null }));

const VAULT = "D:\\Notes\\Life OS";
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
