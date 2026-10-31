import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import "../styles/sheet.css";

/** Waits for the closing animation, if one runs (none under reduce motion). */
function animationsDone(el: HTMLElement): Promise<unknown> {
  if (typeof el.getAnimations !== "function") return Promise.resolve();
  const running = el.getAnimations();
  return Promise.all(running.map((a) => a.finished.catch(() => undefined)));
}

function show(dialog: HTMLDialogElement) {
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    // Environments without the dialog API still get an open, focused sheet.
    dialog.setAttribute("open", "");
    dialog.querySelector<HTMLElement>("[autofocus], button")?.focus();
  }
}

function hide(dialog: HTMLDialogElement) {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

/**
 * Grows the sheet from its trigger rather than the screen centre (ui-spec
 * M5): the scale origin is the trigger's centre, in the sheet's own box.
 */
function originFrom(dialog: HTMLElement, trigger: Element | null) {
  if (!trigger) return;
  const t = trigger.getBoundingClientRect();
  const d = dialog.getBoundingClientRect();
  if (d.width === 0 && d.height === 0) return;
  const x = t.left + t.width / 2 - d.left;
  const y = t.top + t.height / 2 - d.top;
  dialog.style.transformOrigin = `${String(Math.round(x))}px ${String(Math.round(y))}px`;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path
        d="M2 2 10 10M10 2 2 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * A modal sheet (ui-spec M5, L3): the native <dialog> opened with
 * showModal, so focus stays inside, Escape closes it and focus goes back to
 * the trigger. It is chrome, so it is glass, over a dimming scrim. It opens
 * from its trigger with a scale and fade and closes faster; under reduce
 * motion it only appears and disappears.
 */
export function Sheet({
  open,
  onClose,
  title,
  trigger,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The control that opened the sheet: the scale origin and where focus returns. */
  trigger?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // Stays mounted while the closing animation runs.
  const [mounted, setMounted] = useState(open);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      // Opened again while closing: stop the exit and stay open.
      delete dialog.dataset.state;
      if (dialog.hasAttribute("open")) return;
      returnTo.current =
        trigger?.current ??
        (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      show(dialog);
      originFrom(dialog, trigger?.current ?? returnTo.current);
      return;
    }
    if (!dialog.hasAttribute("open")) return;
    let cancelled = false;
    dialog.dataset.state = "closing";
    void animationsDone(dialog).then(() => {
      if (cancelled) return;
      hide(dialog);
      delete dialog.dataset.state;
      setMounted(false);
      returnTo.current?.focus();
    });
    return () => {
      cancelled = true;
    };
  }, [open, mounted, trigger]);

  if (!mounted) return null;

  return createPortal(
    // A modal dialog handles Escape and clicks on its own scrim.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Escape: close with the sheet's own exit, not the browser's instant one.
        e.preventDefault();
        closeRef.current();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeRef.current();
        }
      }}
      onClick={(e) => {
        // A click on the dialog box itself, not its content, is on the scrim.
        if (e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div className="sheet__body">
        <header className="sheet__head">
          <h2 id={titleId} className="sheet__title">
            {title}
          </h2>
          <button
            type="button"
            className="sheet__close"
            aria-label="Close"
            onClick={() => {
              closeRef.current();
            }}
          >
            <CloseIcon />
          </button>
        </header>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
