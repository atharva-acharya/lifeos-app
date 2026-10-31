import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open details
      </button>
      <Sheet
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="What’s behind today"
        trigger={trigger}
      >
        <p>Steps 6,500</p>
        <button type="button">Inside</button>
      </Sheet>
    </>
  );
}

const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
const original = { showModal: proto.showModal, close: proto.close };

describe("Sheet with the dialog API", () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom has no showModal; stand in for the browser's modal behaviour.
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.querySelector<HTMLElement>("button")?.focus();
    });
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    Object.assign(HTMLDialogElement.prototype, { showModal, close });
  });

  afterEach(() => {
    for (const key of ["showModal", "close"] as const) {
      if (original[key]) Object.assign(HTMLDialogElement.prototype, { [key]: original[key] });
      else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
    }
  });

  it("renders nothing until opened", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens as a modal with its title and a close button", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open details" }));
    expect(showModal).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog", { name: "What’s behind today" });
    expect(dialog).toHaveAttribute("open");
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByText("Steps 6,500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("closes with the close button and returns focus to the trigger", async () => {
    render(<Harness />);
    const open = screen.getByRole("button", { name: "Open details" });
    fireEvent.click(open);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(open).toHaveFocus();
  });

  it("closes on Escape (the dialog's cancel event) and returns focus", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const open = screen.getByRole("button", { name: "Open details" });
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog");
    const cancel = new Event("cancel", { cancelable: true });
    act(() => {
      dialog.dispatchEvent(cancel);
    });
    // The sheet runs its own exit instead of the browser's instant close.
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(open).toHaveFocus();
  });

  it("closes on an Escape key press", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open details" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Inside" }), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("closes on a click on the scrim but not on its content", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open details" }));
    fireEvent.click(screen.getByText("Steps 6,500"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("waits for the closing animation before it closes", async () => {
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      value: () => [{ finished }],
    });
    try {
      render(<Harness />);
      fireEvent.click(screen.getByRole("button", { name: "Open details" }));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("data-state", "closing");
      expect(close).not.toHaveBeenCalled();
      await act(async () => {
        finish();
        await finished;
      });
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
    }
  });
});

describe("Sheet without the dialog API", () => {
  it("still opens, focuses its close button and closes", async () => {
    // jsdom's own <dialog> has no showModal or close.
    expect(typeof HTMLDialogElement.prototype.showModal).not.toBe("function");
    render(<Harness />);
    const open = screen.getByRole("button", { name: "Open details" });
    fireEvent.click(open);
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(open).toHaveFocus();
  });
});
