import { useId, useState, type ReactNode } from "react";
import { SegmentedTabs } from "./SegmentedTabs";
import "../styles/page-tabs.css";

export interface PageTab<T extends string> {
  id: T;
  label: string;
  content: ReactNode;
}

/**
 * A page that would not fit the window as one column shows one view at a
 * time, chosen with a segmented control. Every view stays mounted, so
 * switching is instant and charts keep their state; the ones not chosen are
 * hidden with CSS. A view taller than the window scrolls inside itself.
 */
export function PageTabs<T extends string>({
  tabs,
  label,
  initial,
}: {
  tabs: readonly PageTab<T>[];
  label: string;
  initial?: T;
}) {
  const [current, setCurrent] = useState<T>(initial ?? tabs[0].id);
  const base = useId().replace(/:/g, "");
  const tabId = (id: T) => `${base}-tab-${id}`;
  const panelId = (id: T) => `${base}-panel-${id}`;
  return (
    <div className="page page--fit page-tabs">
      <div className="page-tabs__bar">
        <SegmentedTabs
          items={tabs.map((t) => ({ id: t.id, label: t.label }))}
          value={current}
          label={label}
          tabId={tabId}
          panelId={panelId}
          onChange={(next) => {
            setCurrent(next);
          }}
        />
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={panelId(t.id)}
          aria-labelledby={tabId(t.id)}
          className="page-tabs__panel"
          data-active={t.id === current ? "" : undefined}
          // A long view scrolls on its own; the page never does.
          tabIndex={0}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
