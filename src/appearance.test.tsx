import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { applyStoredTransparency, TRANSPARENCY_KEY } from "./appearance";
import { AppearanceSettings } from "./components/AppearanceSettings";
import { useScrolled } from "./useScrolled";
import { useState } from "react";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-transparency");
});

describe("Reduce transparency (L5)", () => {
  it("is off by default", () => {
    render(<AppearanceSettings />);
    expect(screen.getByRole("checkbox", { name: "Reduce transparency" })).not.toBeChecked();
    expect(document.documentElement).not.toHaveAttribute("data-transparency");
  });

  it("sets the attribute on <html> and remembers the choice", () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Reduce transparency" }));
    expect(document.documentElement).toHaveAttribute("data-transparency", "reduced");
    expect(window.localStorage.getItem(TRANSPARENCY_KEY)).toBe("1");
  });

  it("removes the attribute and the stored choice when turned off", () => {
    window.localStorage.setItem(TRANSPARENCY_KEY, "1");
    applyStoredTransparency();
    render(<AppearanceSettings />);
    const box = screen.getByRole("checkbox", { name: "Reduce transparency" });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(document.documentElement).not.toHaveAttribute("data-transparency");
    expect(window.localStorage.getItem(TRANSPARENCY_KEY)).toBeNull();
  });

  it("applies a stored choice at start-up", () => {
    window.localStorage.setItem(TRANSPARENCY_KEY, "1");
    applyStoredTransparency();
    expect(document.documentElement).toHaveAttribute("data-transparency", "reduced");
  });
});

function Scroller() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useScrolled(el);
  return <main ref={setEl} />;
}

describe("scroll-edge fade (L4)", () => {
  it("marks the area once it has scrolled, and clears it back at the top", () => {
    render(<Scroller />);
    const main = screen.getByRole("main");
    expect(main).not.toHaveAttribute("data-scrolled");
    main.scrollTop = 40;
    fireEvent.scroll(main);
    expect(main).toHaveAttribute("data-scrolled");
    main.scrollTop = 0;
    fireEvent.scroll(main);
    expect(main).not.toHaveAttribute("data-scrolled");
  });
});
