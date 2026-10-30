import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Width of an element in pixels, kept up to date as it resizes. */
export function useWidth<T extends HTMLElement>(fallback = 480): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, width];
}
