import { useEffect, useState } from "react";

/** The bar's height when `--page-bar-height` cannot be read (tests, no CSS). */
const FALLBACK_HEIGHT = 48;

/**
 * True once the page's large title (`.page-title`) has scrolled up under the
 * page bar, false again when it comes back into view, as an iOS large title
 * collapses into the inline title (ui-spec L1, L4). A page without a large
 * title shows the bar as soon as it scrolls. `resetKey` (the current page)
 * re-checks the position when the content changes.
 */
export function usePageBar(main: HTMLElement | null, resetKey?: unknown): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!main) return;
    const update = () => {
      if (main.scrollTop <= 0) {
        setVisible(false);
        return;
      }
      const title = main.querySelector(".page-title");
      if (!title) {
        setVisible(true);
        return;
      }
      const height =
        parseFloat(getComputedStyle(main).getPropertyValue("--page-bar-height")) || FALLBACK_HEIGHT;
      const bottom = title.getBoundingClientRect().bottom - main.getBoundingClientRect().top;
      setVisible(bottom <= height);
    };
    update();
    main.addEventListener("scroll", update, { passive: true });
    return () => {
      main.removeEventListener("scroll", update);
    };
  }, [main, resetKey]);

  return visible;
}

/**
 * The compact page toolbar: glass chrome pinned to the top of the page area,
 * showing the page's title once the large title has scrolled away. It
 * repeats the page's own heading, so it is hidden from assistive technology.
 */
export function PageBar({ title, visible }: { title: string; visible: boolean }) {
  return (
    <div className="page-bar" data-visible={visible ? "" : undefined} aria-hidden="true">
      <div className="page-bar__surface">
        <span className="page-bar__title">{title}</span>
      </div>
    </div>
  );
}
