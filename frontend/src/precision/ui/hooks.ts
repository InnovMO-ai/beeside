import { useEffect, useRef } from "react";
import { navigation } from "../state/router";

/** Sets the document title and, once the page content is there, moves focus to its heading (screen readers announce the new page). */
export function usePage(title: string | null, ready: boolean) {
  useEffect(() => { if (title) document.title = `${title} · Precision Center`; }, [title]);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !title || done.current === title) return;
    done.current = title;
    if (navigation.moves === 0) {
      // First page of a visit: no focus is stolen, and the Tab starting point is reset to the top so "Skip to main content" is the first stop
      // (the loading screens that were replaced would otherwise leave it in the middle of the page).
      try { window.getSelection()?.collapse(document.body, 0); } catch { /* optional */ }
      return;
    }
    const el = document.querySelector<HTMLElement>("[data-autofocus]");
    el?.focus({ preventScroll: true });
  }, [ready, title]);
}

export const reducedMotion = (): boolean => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};
