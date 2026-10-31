import { useEffect, useRef, useState } from "react";

/** How long a number takes to reach its new value (ui-spec M9). */
export const COUNT_UP_MS = 400;

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Ease-out cubic: fast at first, settling onto the value. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * The number to display while `value` changes: it counts from the previous
 * value to the new one over 400 ms, ease-out (ui-spec M9). The first render,
 * reduce motion and values that are not finite numbers show the value at once.
 */
export function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  // What is on screen right now, so an interrupted count starts from there.
  const current = useRef(value);

  useEffect(() => {
    const from = current.current;
    if (
      from === value ||
      !Number.isFinite(value) ||
      !Number.isFinite(from) ||
      reducedMotion() ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      current.current = value;
      setShown(value);
      return;
    }

    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min((now - start) / COUNT_UP_MS, 1);
      const next = t >= 1 ? value : from + (value - from) * easeOut(t);
      current.current = next;
      setShown(next);
      if (t < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [value]);

  return Number.isFinite(value) ? shown : value;
}
