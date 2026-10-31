import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/toast.css";

/** How long a toast stays up (ui-spec C8). */
export const TOAST_MS = 5000;

export interface ToastMessage {
  /** Changes for every new toast, so the timer restarts. */
  id: number;
  text: string;
  /** Shown as an alert instead of a status update. */
  error?: boolean;
  /** Offers an Undo button when the action can be undone. */
  onUndo?: () => void;
}

/**
 * A short confirmation at the bottom centre of the window (ui-spec C8). It is
 * chrome, so it is glass (L3), and it is rendered into `document.body` so no
 * content ancestor's transform or animation can break the backdrop. It closes
 * after five seconds; hovering or focusing it holds it open.
 */
export function Toast({
  toast,
  onDismiss,
  busy = false,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
  /** Disables Undo while its write runs. */
  busy?: boolean;
}) {
  // Held by hover or focus; tied to one toast so a replaced toast is not held.
  const [heldId, setHeldId] = useState<number | null>(null);
  const held = toast !== null && heldId === toast.id;
  const dismiss = useEffectEvent(onDismiss);

  // Restarts for every new toast, and again whenever it stops being held.
  useEffect(() => {
    if (!toast || held) return undefined;
    const timer = window.setTimeout(() => {
      dismiss();
    }, TOAST_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast, held]);

  if (!toast) return null;
  const id = toast.id;
  const stop = () => {
    setHeldId(id);
  };
  const start = () => {
    setHeldId(null);
  };
  return createPortal(
    <div
      key={toast.id}
      className={`toast${toast.error ? " toast--error" : ""}`}
      role={toast.error ? "alert" : "status"}
      onMouseEnter={stop}
      onMouseLeave={start}
      onFocus={stop}
      onBlur={start}
    >
      <span className="toast__text">{toast.text}</span>
      {toast.onUndo && (
        <button type="button" className="toast__undo" disabled={busy} onClick={toast.onUndo}>
          Undo
        </button>
      )}
    </div>,
    document.body,
  );
}
