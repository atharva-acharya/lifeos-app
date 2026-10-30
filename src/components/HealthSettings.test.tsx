import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../api";
import { invoke } from "../test/tauri-mocks";
import { HealthSettings } from "./HealthSettings";

const FOLDER = "D:\\iCloud\\Health Auto Export";
const NO_GOOGLE = {
  clientId: "",
  sheetId: "",
  hasSecret: false,
  configured: false,
  connected: false,
};
const settings = (healthPath: string | null): AppSettings => ({
  vaultPath: null,
  healthPath,
  google: NO_GOOGLE,
  autoUpdate: true,
});

describe("HealthSettings", () => {
  it("asks for a folder when none is set", () => {
    render(<HealthSettings healthPath={null} onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Health export" })).toBeInTheDocument();
    expect(screen.getByText("Not chosen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Health folder" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/only reads it and nothing from it leaves this PC/),
    ).toBeInTheDocument();
  });

  it("shows the folder with change and remove buttons", () => {
    render(<HealthSettings healthPath={FOLDER} onChange={vi.fn()} />);
    expect(screen.getByText(FOLDER)).toBeInTheDocument();
    expect(screen.getByText("Reading")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change Health folder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("saves the chosen folder", async () => {
    const onChange = vi.fn();
    invoke.mockResolvedValueOnce(settings(FOLDER));
    render(<HealthSettings healthPath={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Health folder" }));
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(settings(FOLDER));
    });
    expect(invoke).toHaveBeenCalledWith("choose_health_folder");
  });

  it("removes the folder", async () => {
    const onChange = vi.fn();
    invoke.mockResolvedValueOnce(settings(null));
    render(<HealthSettings healthPath={FOLDER} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(settings(null));
    });
    expect(invoke).toHaveBeenCalledWith("clear_health_folder");
  });

  it("shows why a folder was refused", async () => {
    invoke.mockRejectedValueOnce(
      "the chosen Health folder is a link or junction; pick the real folder",
    );
    render(<HealthSettings healthPath={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Health folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("link or junction");
    expect(screen.getByRole("button", { name: "Choose Health folder" })).toBeEnabled();
  });

  it("disables both buttons while a request runs and clears an old error on retry", async () => {
    invoke.mockRejectedValueOnce("first failure");
    let finish: (s: AppSettings) => void = () => undefined;
    invoke.mockReturnValueOnce(
      new Promise<AppSettings>((resolve) => {
        finish = resolve;
      }),
    );
    const onChange = vi.fn();
    render(<HealthSettings healthPath={FOLDER} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("first failure");

    fireEvent.click(screen.getByRole("button", { name: "Change Health folder" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change Health folder" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    finish(settings(FOLDER));
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(settings(FOLDER));
    });
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
  });

  it("shows an error that looks like markup as plain text", async () => {
    invoke.mockRejectedValueOnce("<img src=x onerror=alert(1)>");
    const { container } = render(<HealthSettings healthPath={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Health folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a very long folder path as text", () => {
    const long = `D:\\${"deep\\".repeat(100)}Health`;
    render(<HealthSettings healthPath={long} onChange={vi.fn()} />);
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  it("uses a generic message for an unknown error", async () => {
    invoke.mockRejectedValueOnce(new Error("boom"));
    render(<HealthSettings healthPath={FOLDER} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});
