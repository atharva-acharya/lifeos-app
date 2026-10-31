import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PageBar, usePageBar } from "./PageBar";

/** A scroll area with a large title, as App renders a page inside `.main`. */
function Harness({ withTitle = true }: { withTitle?: boolean }) {
  const [main, setMain] = useState<HTMLElement | null>(null);
  const visible = usePageBar(main);
  return (
    <main ref={setMain} data-testid="main" data-page-bar={visible ? "" : undefined}>
      <PageBar title="Money" visible={visible} />
      {withTitle && <h1 className="page-title">Money</h1>}
    </main>
  );
}

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
    x: 0,
    y: top,
  } as DOMRect;
}

/** Scrolls the area so the title's bottom edge sits `titleBottom` px below its top. */
function scrollTo(main: HTMLElement, scrollTop: number, titleBottom: number) {
  main.getBoundingClientRect = () => rect(0, 640);
  const title = main.querySelector(".page-title");
  if (title) title.getBoundingClientRect = () => rect(titleBottom - 37, titleBottom);
  main.scrollTop = scrollTop;
  act(() => {
    fireEvent.scroll(main);
  });
}

function bar() {
  return document.querySelector(".page-bar");
}

describe("PageBar", () => {
  it("shows the page title, hidden from assistive technology", () => {
    render(<PageBar title="Health" visible />);
    const el = bar();
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("data-visible");
    expect(el).toHaveTextContent("Health");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("stays hidden at the top of the page", () => {
    render(<Harness />);
    expect(bar()).not.toHaveAttribute("data-visible");
    expect(screen.getByTestId("main")).not.toHaveAttribute("data-page-bar");
  });

  it("stays hidden while the large title is still in view", () => {
    render(<Harness />);
    scrollTo(screen.getByTestId("main"), 20, 80);
    expect(bar()).not.toHaveAttribute("data-visible");
  });

  it("appears once the large title has scrolled under the bar, and hides back at the top", () => {
    render(<Harness />);
    const main = screen.getByTestId("main");
    scrollTo(main, 120, 30);
    expect(bar()).toHaveAttribute("data-visible");
    expect(main).toHaveAttribute("data-page-bar");

    scrollTo(main, 0, 150);
    expect(bar()).not.toHaveAttribute("data-visible");
    expect(main).not.toHaveAttribute("data-page-bar");
  });

  it("appears as soon as a page without a large title scrolls", () => {
    render(<Harness withTitle={false} />);
    scrollTo(screen.getByTestId("main"), 1, 0);
    expect(bar()).toHaveAttribute("data-visible");
  });
});
