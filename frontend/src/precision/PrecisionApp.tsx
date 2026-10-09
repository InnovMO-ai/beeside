import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { I18nProvider, useI18n } from "./i18n";
import { SessionProvider, useAuthGate, useSession, type TransportFactory } from "./state/app";
import { ConnectionProvider } from "./state/connection";
import { RouterProvider, useRouter } from "./state/router";
import { ThemeProvider, useTheme } from "./state/theme";
import { Skeleton } from "./ui/primitives";
import { BareShell } from "./ui/Shell";
import { LinkPage } from "./screens/LinkPages";
import { LoadErrorPage, NotFoundPage, RevokedPage } from "./screens/SystemPages";
import "./precision.css";

// Screens are code-split so the first view (Cover or Center) stays light.
const CoverScreen = lazy(() => import("./screens/Cover").then((m) => ({ default: m.CoverScreen })));
const CenterScreen = lazy(() => import("./screens/Center").then((m) => ({ default: m.CenterScreen })));
const UnderstandingScreen = lazy(() => import("./screens/Workspace").then((m) => ({ default: m.UnderstandingScreen })));
const CategoryWorkspace = lazy(() => import("./screens/Workspace").then((m) => ({ default: m.CategoryWorkspace })));
const AddServiceScreen = lazy(() => import("./screens/Workspace").then((m) => ({ default: m.AddServiceScreen })));
const ServiceMapScreen = lazy(() => import("./screens/ServiceMap").then((m) => ({ default: m.ServiceMapScreen })));
const CrpScreen = lazy(() => import("./screens/Crp").then((m) => ({ default: m.CrpScreen })));
const PreviewScreen = lazy(() => import("./screens/Preview").then((m) => ({ default: m.PreviewScreen })));
const SentScreen = lazy(() => import("./screens/Preview").then((m) => ({ default: m.SentScreen })));
const HelpScreen = lazy(() => import("./screens/Help").then((m) => ({ default: m.HelpScreen })));

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
      {() => <Suspense fallback={<Loading />}><Routes /></Suspense>}
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
