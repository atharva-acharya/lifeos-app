import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { invoke } from "../test/tauri-mocks";
import { SettingsPage } from "./SettingsPage";

const VAULT = "D:\\Notes\\Life OS";

describe("SettingsPage", () => {
  it("asks for a vault when none is set", async () => {
    invoke.mockResolvedValueOnce({ vaultPath: null });
    render(<SettingsPage />);
    expect(await screen.findByText("Not set")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeEnabled();
    expect(invoke).toHaveBeenCalledWith("get_settings");
  });

  it("shows the connected vault", async () => {
    invoke.mockResolvedValueOnce({ vaultPath: VAULT });
    render(<SettingsPage />);
    expect(await screen.findByText(VAULT)).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change folder" })).toBeInTheDocument();
  });

  it("saves the chosen folder", async () => {
    invoke.mockResolvedValueOnce({ vaultPath: null }).mockResolvedValueOnce({ vaultPath: VAULT });
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose folder" }));
    expect(await screen.findByText(VAULT)).toBeInTheDocument();
    expect(invoke).toHaveBeenLastCalledWith("choose_vault_folder");
  });

  it("shows why a folder was refused", async () => {
    invoke
      .mockResolvedValueOnce({ vaultPath: null })
      .mockRejectedValueOnce("the chosen vault is a link or junction; pick the real folder");
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("link or junction");
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });
});
