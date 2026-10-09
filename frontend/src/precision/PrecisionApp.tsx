import { Component, lazy, Suspense, useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { I18nProvider, useI18n } from "./i18n";
import { SessionProvider, useAuthGate, useSession, type TransportFactory } from "./state/app";
import { ConnectionProvider, useConnection } from "./state/connection";
import { RouterProvider, useRouter } from "./state/router";
import { ThemeProvider, useTheme } from "./state/theme";
import { Skeleton } from "./ui/primitives";
import { BareShell } from "./ui/Shell";
import type { EntryDto } from "./api/dto";
import { LinkPage } from "./screens/LinkPages";
import { LoadErrorPage, NotFoundPage, RevokedPage } from "./screens/SystemPages";
import "./precision.css";

// Screens are code-split so the first view (Cover or Center) stays light. React.lazy caches a failed import
// forever, so each screen is wrapped: after a failed load (connection lost, an asset replaced by a new release)
// the loader is created again and the next attempt really requests the chunk.
const resetters: Array<() => void> = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyScreen<P>(load: () => Promise<{ default: ComponentType<any> }>): ComponentType<P> {
  let Current = lazy(load);
  resetters.push(() => { Current = lazy(load); });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function LazyScreen(props: P) { const C = Current as ComponentType<any>; return <C {...props} />; };
}
const CoverScreen = lazyScreen<{ entry: EntryDto }>(() => import("./screens/Cover").then((m) => ({ default: m.CoverScreen })));
const CenterScreen = lazyScreen<object>(() => import("./screens/Center").then((m) => ({ default: m.CenterScreen })));
const UnderstandingScreen = lazyScreen<object>(() => import("./screens/Workspace").then((m) => ({ default: m.UnderstandingScreen })));
const CategoryWorkspace = lazyScreen<{ id: string }>(() => import("./screens/Workspace").then((m) => ({ default: m.CategoryWorkspace })));
const AddServiceScreen = lazyScreen<object>(() => import("./screens/Workspace").then((m) => ({ default: m.AddServiceScreen })));
const ServiceMapScreen = lazyScreen<object>(() => import("./screens/ServiceMap").then((m) => ({ default: m.ServiceMapScreen })));
const CrpScreen = lazyScreen<{ id: string }>(() => import("./screens/Crp").then((m) => ({ default: m.CrpScreen })));
const PreviewScreen = lazyScreen<{ id: string }>(() => import("./screens/Preview").then((m) => ({ default: m.PreviewScreen })));
const SentScreen = lazyScreen<{ id: string }>(() => import("./screens/Preview").then((m) => ({ default: m.SentScreen })));
const HelpScreen = lazyScreen<object>(() => import("./screens/Help").then((m) => ({ default: m.HelpScreen })));

/** A screen that could not be loaded: friendly page, "Connection lost" banner, automatic retry with backoff, manual retry. */
function ScreenFailure({ onRetry }: { onRetry: () => void }) {
  const { markFail, tick } = useConnection();
  const first = useRef(tick);
  useEffect(() => { markFail(); }, [markFail]);
  useEffect(() => { if (tick !== first.current) { first.current = tick; onRetry(); } }, [tick, onRetry]);
  return <LoadErrorPage onRetry={onRetry} />;
}

function reloadAllowed(): boolean {
  try {
    const k = "pz-chunk-reload";
    const last = Number(sessionStorage.getItem(k) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(k, String(Date.now()));
  } catch { /* storage blocked: reload anyway, once per call */ }
  return true;
}

class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  attempts = 0;
  retry = () => {
    // A browser remembers a failed module import for the page's lifetime, so after one more failed attempt while the network is
    // back, one reload (at most every 30 s) is the reliable recovery. The session lives in sessionStorage and survives it.
    if (this.attempts >= 1 && navigator.onLine && reloadAllowed()) { window.location.reload(); return; }
    this.attempts += 1;
    resetters.forEach((r) => r());
    this.setState({ failed: false });
  };
  render() { return this.state.failed ? <ScreenFailure onRetry={this.retry} /> : this.props.children; }
}

function Loading() {
  return <BareShell><Skeleton lines={4} /></BareShell>;
}

function Routes() {
  const { route, navigate } = useRouter();
  const { entry, access } = useSession();
  useEffect(() => { if (route.name === "root") navigate({ name: entry.screen === "cover" ? "cover" : "center" }, { replace: true }); }, [route.name, entry.screen, navigate]);
  if (access.mode === "REVOKED") return <RevokedPage />;
  switch (route.name) {
    case "root": return <Loading />;
    case "cover": return <CoverScreen entry={entry} />;
    case "center": return <CenterScreen />;
    case "understanding": return <UnderstandingScreen />;
    case "serviceMap": return <ServiceMapScreen />;
    case "category": return <CategoryWorkspace key={route.id} id={route.id} />;
    case "crp": return <CrpScreen key={route.id} id={route.id} />;
    case "preview": return <PreviewScreen key={route.id} id={route.id} />;
    case "sent": return <SentScreen key={route.id} id={route.id} />;
    case "addService": return <AddServiceScreen />;
    case "help": return <HelpScreen />;
    case "accessEnded": return <RevokedPage />;
    default: return <NotFoundPage />;
  }
}

function Gate({ transport }: { transport?: TransportFactory }) {
  const { auth, client, retryExchange } = useAuthGate(transport);
  if (auth.s !== "ready") return <LinkPage state={auth.s} onRetry={retryExchange} />;
  return (
    <SessionProvider client={client} fallback={(state, retry) => (state === "loading" ? <Loading /> : state === "invalid" ? <LinkPage state="invalid" onRetry={retry} /> : <LoadErrorPage onRetry={retry} />)}>
      {() => <ScreenBoundary><Suspense fallback={<Loading />}><Routes /></Suspense></ScreenBoundary>}
    </SessionProvider>
  );
}

function Root({ children }: { children: ReactNode }) {
  const { theme, explicit } = useTheme();
  const { locale } = useI18n();
  useEffect(() => {
    // Keep overscroll and the browser chrome in the theme colour.
    const bg = theme === "dark" ? "#0f0d18" : "#f1f1fa";
    document.documentElement.style.backgroundColor = bg;
    document.documentElement.style.colorScheme = theme;
    document.body.style.margin = "0";
    if (!document.querySelector('link[rel="icon"]')) { const l = document.createElement("link"); l.rel = "icon"; l.href = "data:,"; document.head.appendChild(l); }
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
    meta.content = bg;
  }, [theme]);
  return <div className="pz-root" data-theme={explicit ?? undefined} data-locale={locale}>{children}</div>;
}

/** Precision Center V2.0 customer app. `transport` is for tests; the real app picks the transport from VITE_PRECISION_API_MODE. */
export function PrecisionApp({ transport }: { transport?: TransportFactory }) {
  return (
    <I18nProvider>
      <ThemeProvider>
        <ConnectionProvider>
          <RouterProvider>
            <Root><Gate transport={transport} /></Root>
          </RouterProvider>
        </ConnectionProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
