import { useEffect } from "react";

/**
 * Marks a scroll area with `data-scrolled` once it has scrolled away from the
 * top, so its scroll-edge fade shows only then (ui-spec L4). `resetKey` (the
 * current page) re-checks the position when the content under it changes.
 */
export function useScrolled(el: HTMLElement | null, resetKey?: unknown): void {
  useEffect(() => {
    if (!el) return;
    const update = () => {
      el.toggleAttribute("data-scrolled", el.scrollTop > 0);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      el.removeEventListener("scroll", update);
    };
  }, [el, resetKey]);
}
