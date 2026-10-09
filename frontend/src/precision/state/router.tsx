import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

export const BASE = "/precision";

export type Route =
  | { name: "root" } | { name: "cover" } | { name: "center" } | { name: "understanding" } | { name: "serviceMap" }
  | { name: "category"; id: string } | { name: "crp"; id: string } | { name: "preview"; id: string } | { name: "sent"; id: string }
  | { name: "addService" } | { name: "help" } | { name: "accessEnded" } | { name: "notFound" };

export function parseRoute(pathname: string): Route {
  let p = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  p = p.replace(/\/+$/, "") || "/";
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
  if (seg.length === 0) return { name: "root" };
  const [a, b, c] = seg;
  if (seg.length === 1) {
    if (a === "cover") return { name: "cover" };
    if (a === "center") return { name: "center" };
    if (a === "understanding") return { name: "understanding" };
    if (a === "service-map") return { name: "serviceMap" };
    if (a === "add-service") return { name: "addService" };
    if (a === "help") return { name: "help" };
    if (a === "access-ended") return { name: "accessEnded" };
  }
  if (a === "category" && b) {
    if (seg.length === 2) return { name: "category", id: b };
    if (seg.length === 3 && c === "summary") return { name: "crp", id: b };
    if (seg.length === 3 && c === "preview") return { name: "preview", id: b };
    if (seg.length === 3 && c === "sent") return { name: "sent", id: b };
  }
  return { name: "notFound" };
}

export function routePath(r: Route): string {
  const enc = encodeURIComponent;
  switch (r.name) {
    case "root": return BASE;
    case "cover": return `${BASE}/cover`;
    case "center": return `${BASE}/center`;
    case "understanding": return `${BASE}/understanding`;
    case "serviceMap": return `${BASE}/service-map`;
    case "addService": return `${BASE}/add-service`;
    case "help": return `${BASE}/help`;
    case "accessEnded": return `${BASE}/access-ended`;
    case "category": return `${BASE}/category/${enc(r.id)}`;
    case "crp": return `${BASE}/category/${enc(r.id)}/summary`;
    case "preview": return `${BASE}/category/${enc(r.id)}/preview`;
    case "sent": return `${BASE}/category/${enc(r.id)}/sent`;
    default: return `${BASE}/not-found`;
  }
}

interface RouterCtx { route: Route; navigate: (to: Route, opts?: { replace?: boolean }) => void }
const Ctx = createContext<RouterCtx | null>(null);

/** Counts the moves the person made inside the app (links and Back/Forward). Moving focus to the new heading only makes sense after one. */
export const navigation = { moves: 0 };

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPop = () => { navigation.moves++; setRoute(parseRoute(window.location.pathname)); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: Route, opts?: { replace?: boolean }) => {
    const path = routePath(to);
    // Keep any query string out of the address once the session exists: it may carry test switches only.
    if (opts?.replace) window.history.replaceState({}, "", path + window.location.search);
    else { window.history.pushState({}, "", path + window.location.search); navigation.moves++; }
    setRoute(to);
    window.scrollTo?.(0, 0);
  }, []);
  const value = useMemo(() => ({ route, navigate }), [route, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useRouter(): RouterCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("RouterProvider missing");
  return v;
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> { to: Route }
export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={routePath(to) + window.location.search} onClick={handle}>{children}</a>;
}
