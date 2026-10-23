import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { PrecisionApp } from "../PrecisionApp";
import { sessionStore } from "../api/session";
import type { Locale } from "../api/dto";
import { createMockServer } from "../mock/mockTransport";

let n = 0;

export function setupDom() {
  beforeEach(() => {
    sessionStorage.clear(); localStorage.clear(); sessionStore.clear();
    // jsdom has none of these; the app only uses them as progressive enhancements.
    window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null }) as MediaQueryList);
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => undefined);
    window.scrollTo = (() => undefined) as typeof window.scrollTo;
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
}

/** Boots the whole app against a fresh in-memory server. `mock` is the same switch list the address accepts (?mock=...). */
export function boot(path: string, opts: { locale?: Locale; mock?: string } = {}) {
  const code = `test-${++n}`;
  const mock = `latency:0${opts.mock ? "," + opts.mock : ""}`;
  const query = `?code=${code}&mock=${mock}`;
  window.history.replaceState({}, "", `${path}${query}`);
  if (opts.locale) localStorage.setItem("beeside.precision.locale", opts.locale);
  const server = createMockServer({ persist: false, query });
  const view = render(<PrecisionApp transport={async () => server.transport} />);
  return { ...view, server };
}
