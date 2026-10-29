import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App shell", () => {
  it("opens on Today", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });

  it("lists every module in the sidebar with settings at the bottom", () => {
    render(<App />);
    const main = screen.getByRole("navigation", { name: "Main" });
    const labels = Array.from(main.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["Today", "Jobs", "Fitness", "Projects", "SearchCtrl K"]);
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("navigates when a sidebar item is chosen", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Fitness" }));
    expect(screen.getByRole("heading", { level: 1, name: "Fitness" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fitness" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Today" })).not.toHaveAttribute("aria-current");
  });

  it("moves focus to the page after navigating", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("opens Search with Ctrl+K", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBeInTheDocument();
  });
});
