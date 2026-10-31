import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { fromKeyboard } from "../motion";
import { nextTab } from "./HealthTrends";
import "../styles/segmented.css";

export interface Segment<T extends string> {
  id: T;
  label: string;
}

/** Fixed width the indicator is drawn at; it is scaled to the selected segment. */
const BASE = 100;

/**
 * A segmented control used as tabs (ui-spec C5): a raised track whose
 * selected segment slides to the new choice with the spring (M1). Arrow keys,
 * Home and End move the choice, and keyboard changes are instant (M4): both
 * the slide and the change itself (`onChange(next, true)`). Only the
 * indicator's transform animates (M11); reduce motion sets its duration to 0.
 */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  tabId,
  panelId,
}: {
  items: readonly Segment<T>[];
  value: T;
  /** `instant` is true when the keyboard made the change. */
  onChange: (next: T, instant: boolean) => void;
  label: string;
  tabId: (id: T) => string;
  panelId: (id: T) => string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // The next slide is instant: the first paint, and any keyboard change.
  const instant = useRef(true);
  const index = Math.max(
    0,
    items.findIndex((i) => i.id === value),
  );

  useLayoutEffect(() => {
    const el = track.current;
    const bar = indicator.current;
    if (!el || !bar) return;
    const place = (now: boolean) => {
      const tab = tabs.current[index];
      if (!tab || tab.offsetWidth === 0) {
        delete el.dataset.ready;
        return;
      }
      if (now) el.dataset.instant = "";
      else delete el.dataset.instant;
      const x = String(tab.offsetLeft);
      const y = String(tab.offsetTop);
      bar.style.height = `${String(tab.offsetHeight)}px`;
      bar.style.transform = `translate(${x}px, ${y}px) scaleX(${String(tab.offsetWidth / BASE)})`;
      el.dataset.ready = "";
    };
    place(instant.current);
    instant.current = false;
    if (typeof ResizeObserver !== "function") return;
    // Fonts loading or the window resizing move segments: follow without a slide.
    const watch = new ResizeObserver(() => {
      place(true);
    });
    watch.observe(el);
    return () => {
      watch.disconnect();
    };
  }, [index]);

  const choose = (next: number, fromKeys: boolean) => {
    instant.current = fromKeys;
    onChange(items[next].id, fromKeys);
  };

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const target = nextTab(e.key, i, items.length);
    if (target === null) return;
    e.preventDefault();
    choose(target, true);
    tabs.current[target]?.focus();
  };

  return (
    <div ref={track} className="tabs segmented" role="tablist" aria-label={label}>
      <span ref={indicator} className="segmented__indicator" aria-hidden="true" />
      {items.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            tabs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={tabId(t.id)}
          aria-selected={i === index}
          aria-controls={panelId(t.id)}
          tabIndex={i === index ? 0 : -1}
          className="tabs__tab"
          onClick={(e) => {
            // Enter or Space on a tab is instant (M4); a mouse click animates.
            choose(i, fromKeyboard(e));
          }}
          onKeyDown={(e) => {
            onKeyDown(e, i);
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
