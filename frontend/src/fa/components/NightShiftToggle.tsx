import { useEffect, useState } from "react";
import { T } from "../copy";

/**
 * NightShiftToggle (2026-09-30 Product Owner authorization, item 1: converge to the frozen Snapshot's
 * `.night-toggle` — dark mode for the Snapshot experience). Purely additive: toggles `data-theme="dark"`
 * on `document.documentElement`, exactly as the frozen file's own `toggleNightShift()` does, so every
 * `[data-theme="dark"] ...` rule in styles.css activates together. Unmounting (leaving the Snapshot
 * screen) always clears the attribute, so dark mode never leaks into an unrelated screen that has no
 * themed styles of its own.
 */
export function NightShiftToggle({ t }: { t: T }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    return () => {
      document.documentElement.removeAttribute("data-theme");
    };
  }, [dark]);

  return (
    <button type="button" className="night-toggle" aria-pressed={dark} onClick={() => setDark((value) => !value)}>
      {dark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
      <span>{dark ? t("virtual_snapshot", "night_toggle_day") : t("virtual_snapshot", "night_toggle_night")}</span>
    </button>
  );
}
