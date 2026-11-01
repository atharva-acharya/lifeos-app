import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMode } from "../mode";

/** The window's own top bar, in place of the Windows title bar: the empty
 *  middle drags the window and a double-click maximises or restores it
 *  (Tauri handles both through `data-tauri-drag-region`). */
export function TitleBar() {
  const mode = useMode();
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let active = true;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      win
        .isMaximized()
        .then((m) => {
          if (active) setMaximised(m);
        })
        .catch(() => undefined);
    };
    sync();
    win
      .onResized(sync)
      .then((u) => {
        if (active) unlisten = u;
        else u();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const act = (fn: () => Promise<void>) => () => {
    fn().catch(() => undefined);
  };
  const win = getCurrentWindow();

  return (
    <header className="titlebar">
      <div className="titlebar__brand" data-tauri-drag-region>
        <svg className="titlebar__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeDasharray="40 17"
            strokeLinecap="round"
            transform="rotate(-90 12 12)"
          />
          <circle cx="12" cy="12" r="3.2" fill="currentColor" />
        </svg>
      </div>
      <span className="titlebar__name" data-tauri-drag-region>
        Life OS
      </span>
      {mode === "sample" && <span className="pill pill--read titlebar__mode">Sample data</span>}
      <div className="titlebar__drag" data-tauri-drag-region />
      <div className="titlebar__controls">
        <button
          type="button"
          className="titlebar__button"
          aria-label="Minimise"
          onClick={act(() => win.minimize())}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <path d="M0 5h10" />
          </svg>
        </button>
        <button
          type="button"
          className="titlebar__button"
          aria-label={maximised ? "Restore down" : "Maximise"}
          onClick={act(() => win.toggleMaximize())}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            {maximised ? (
              <path d="M2 3h5v5H2zM3 3V1.5h5.5V7H7" />
            ) : (
              <rect x="0.5" y="0.5" width="9" height="9" />
            )}
          </svg>
        </button>
        <button
          type="button"
          className="titlebar__button titlebar__button--close"
          aria-label="Close"
          onClick={act(() => win.close())}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <path d="M0 0l10 10M10 0 0 10" />
          </svg>
        </button>
      </div>
    </header>
  );
}
