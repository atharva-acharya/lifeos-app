import { useEffect, useState } from "react";
import "../styles/skeleton.css";

/** Loads faster than this show nothing, so a quick load never flashes grey. */
export const SKELETON_DELAY_MS = 150;

/** One titled group in the placeholder: a title bar above its card shapes. */
export interface SkeletonGroup {
  /** Card shapes under the title (default 1). */
  cards?: number;
  /** Height of each card shape in px (default 96). */
  height?: number;
  /** Columns the cards are laid out in (default 1). */
  columns?: number;
  /** Share of the row's width, as a grid fraction (default 1). */
  weight?: number;
  /** False for cards that sit without a group title, like Money's metric row (default true). */
  title?: boolean;
}

/**
 * A grey stand-in shaped like the page that is loading (ui-spec C7): group
 * title bars and card shapes, with a soft shimmer that reduce motion turns
 * off. Each inner array of `layout` is one row of groups side by side.
 * Nothing renders for the first 150 ms.
 */
export function Skeleton({ label, layout }: { label: string; layout: SkeletonGroup[][] }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShown(true);
    }, SKELETON_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  if (!shown) return null;

  return (
    <div className="skeleton" aria-busy="true" data-testid="skeleton">
      <p className="sr-only">Loading {label}…</p>
      <div className="skeleton__rows" aria-hidden="true">
        {layout.map((row, r) => (
          <div
            key={r}
            className="skeleton__row"
            style={{
              gridTemplateColumns: row
                .map((g) => `minmax(0, ${String(g.weight ?? 1)}fr)`)
                .join(" "),
            }}
          >
            {row.map((g, i) => (
              <div key={i} className="skeleton__group">
                {g.title !== false && <span className="skeleton__title skeleton__shape" />}
                <div
                  className="skeleton__cards"
                  style={{
                    gridTemplateColumns: `repeat(${String(g.columns ?? 1)}, minmax(0, 1fr))`,
                  }}
                >
                  {Array.from({ length: g.cards ?? 1 }, (_, c) => (
                    <div
                      key={c}
                      className="skeleton__card skeleton__shape"
                      style={{ height: `${String(g.height ?? 96)}px` }}
                    >
                      {/* Button-height shapes (Money's quick actions) are too short for lines. */}
                      {(g.height ?? 96) >= 64 && (
                        <>
                          <span className="skeleton__line skeleton__line--label" />
                          <span className="skeleton__line skeleton__line--value" />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
