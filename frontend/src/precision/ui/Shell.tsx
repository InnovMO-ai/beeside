import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { useSession, useSessionOptional } from "../state/app";
import { useConnection } from "../state/connection";
import { Link, useRouter, type Route } from "../state/router";
import { useTheme } from "../state/theme";
import { Icon } from "./icons";
import { Brand } from "./Logo";
import { Banner, Button, CategoryStatusChip } from "./primitives";

/** "EN / ES": text toggle, the active language in bold. Each button keeps a 44px target; the slash sits between them. */
export function LocaleToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="pz-seg" role="group" aria-label={t("shell.language")}>
      <button type="button" lang="en" aria-pressed={locale === "en"} aria-label="English" onClick={() => setLocale("en")}>EN</button>
      <span className="pz-seg-sep" aria-hidden="true">/</span>
      <button type="button" lang="es" aria-pressed={locale === "es"} aria-label="Español" onClick={() => setLocale("es")}>ES</button>
    </div>
  );
}
/** Night Shift: an icon-only button (the name is visually hidden), pressed while Night Shift is on. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  return (
    <button type="button" className="pz-theme-toggle" aria-pressed={theme === "dark"} onClick={toggle}>
      <Icon name={theme === "dark" ? "moon" : "sun"} size={18} />
      <span className="pz-sr">{t("shell.nightShift")}</span>
    </button>
  );
}
function HelpLink() {
  const { t } = useI18n();
  const { route } = useRouter();
  return <Link to={{ name: "help" }} className="pz-toplink" aria-current={route.name === "help" ? "page" : undefined}>{t("nav.helpCenter")}</Link>;
}

/** Read-only notice and lost-connection notice, shown above any content. */
export function SystemBanners() {
  const { t, date } = useI18n();
  const conn = useConnection();
  const session = useSessionOptional();
  return (
    <div className="pz-banners">
      {session?.access.mode === "READ_ONLY" ? (
        <Banner tone="note" role="status">
          {session.access.readOnlyUntil ? t("banner.readOnly.until", { date: date(session.access.readOnlyUntil) }) : t("banner.readOnly")}
        </Banner>
      ) : null}
      {conn.offline ? (
        <Banner tone="warn" role="alert" title={t("ws.offline.title")} action={<Button variant="secondary" onClick={conn.retryNow}>{t("ws.offline.retry")}</Button>}>
          {t("ws.offline.body")}
        </Banner>
      ) : conn.restored ? (
        <div className="pz-sr" role="status">{t("ws.offline.restored")}</div>
      ) : null}
    </div>
  );
}

function SkipLink() {
  const { t } = useI18n();
  return <a className="pz-skip" href="#pz-main" onClick={(e) => { e.preventDefault(); document.getElementById("pz-main")?.focus(); }}>{t("shell.skip")}</a>;
}

/** Cover, link landing and system pages: no sidebar. */
export function BareShell({ children, tone }: { children: ReactNode; tone?: "cover" }) {
  return (
    <div className={`pz-bare ${tone === "cover" ? "pz-bare-cover" : ""}`}>
      <SkipLink />
      <header className="pz-barebar">
        <Brand />
        <div className="pz-tools"><LocaleToggle /><ThemeToggle /></div>
      </header>
      <SystemBanners />
      <main id="pz-main" tabIndex={-1} className="pz-bare-main">{children}</main>
    </div>
  );
}

/** Document view: no sidebar. A slim bar with the way back on the left; Help Center, language and Night Shift on the right. */
export function DocShell({ children, back, backLabel }: { children: ReactNode; back: Route; backLabel: string }) {
  return (
    <div className="pz-docshell">
      <SkipLink />
      <header className="pz-docbar">
        <Link to={back} className="pz-backlink"><Icon name="arrow-left" size={18} /><span>{backLabel}</span></Link>
        <div className="pz-tools"><HelpLink /><LocaleToggle /><ThemeToggle /></div>
      </header>
      <SystemBanners />
      <main id="pz-main" tabIndex={-1} className="pz-docmain"><div className="pz-docwrap">{children}</div></main>
    </div>
  );
}

function NavLink({ to, active, children }: { to: Route; active: boolean; children: ReactNode }) {
  return <Link to={to} className="pz-navlink" aria-current={active ? "page" : undefined}><span className="pz-navlabel">{children}</span></Link>;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t, tn } = useI18n();
  const { route } = useRouter();
  const { center } = useSession();
  const c = center.data;
  const catId = route.name === "category" || route.name === "crp" || route.name === "preview" || route.name === "sent" ? route.id : null;
  return (
    <nav className="pz-nav" aria-label={t("shell.navLabel")} onClick={(e) => { if ((e.target as HTMLElement).closest("a")) onNavigate?.(); }}>
      <ul className="pz-navlist">
        <li><NavLink to={{ name: "center" }} active={route.name === "center"}>{t("nav.center")}</NavLink></li>
        <li><NavLink to={{ name: "understanding" }} active={route.name === "understanding"}>{t("nav.understanding")}</NavLink></li>
        <li>
          {c?.serviceMap.available
            ? <NavLink to={{ name: "serviceMap" }} active={route.name === "serviceMap"}>{t("nav.serviceMap")}</NavLink>
            : <span className="pz-navlink pz-navlink-off" aria-disabled="true"><span className="pz-navlabel">{t("nav.serviceMap")}</span></span>}
        </li>
      </ul>
      {c?.addService.available ? (
        <>
          <hr className="pz-nav-rule" />
          <Link to={{ name: "addService" }} className="pz-addbtn" aria-current={route.name === "addService" ? "page" : undefined}><Icon name="plus" size={16} /><span>{t("nav.addService")}</span></Link>
        </>
      ) : null}
      {c && c.categories.length > 0 ? (
        <>
          <span className="pz-eyebrow pz-nav-group">{t("shell.categories")}</span>
          <ul className="pz-navlist pz-catnavlist">
            {c.categories.map((k) => (
              <li key={k.id}>
                <Link to={{ name: "category", id: k.id }} className="pz-catnav" aria-current={catId === k.id ? "page" : undefined}>
                  <span className="pz-catbadge"><Icon name={k.iconKey} size={16} /></span>
                  <span className="pz-navlabel">{k.label}</span>
                  <span className="pz-catnav-meta">
                    <span className="pz-nav-pct">{k.progressPct !== null && k.status !== "not_started" ? `${k.progressPct}%` : ""}</span>
                    {k.criticalOpen > 0 && k.status !== "not_started" ? <span className="pz-diamond"><Icon name="diamond" size={11} /><span className="pz-sr"> {tn("center.cat.critical", k.criticalOpen)}</span></span> : null}
                    <span className="pz-sr"> {t(`status.${k.status}`)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </nav>
  );
}

/** Precision Center and Conversational Workspace: top bar + sidebar + content. Below 900px the sidebar becomes a left drawer. */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const node = drawer.current!;
    const items = () => Array.from(node.querySelectorAll<HTMLElement>("a[href], button")).filter((n) => n.offsetParent !== null);
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); opener.current?.focus(); return; }
      if (e.key !== "Tab") return;
      const f = items(); if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="pz-app" data-drawer={open ? "open" : "closed"}>
      <SkipLink />
      <header className="pz-topbar">
        <button type="button" ref={opener} className="pz-iconbtn pz-menubtn" aria-label={t("shell.menuOpen")} aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" size={22} /></button>
        <Brand />
        <div className="pz-tools"><HelpLink /><LocaleToggle /><ThemeToggle /></div>
      </header>
      <div className="pz-scrim pz-scrim-drawer" onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className="pz-side" ref={drawer} role={open ? "dialog" : undefined} aria-modal={open ? true : undefined} aria-label={open ? t("shell.navLabel") : undefined}>
        <div className="pz-side-top">
          <Brand />
          <button type="button" className="pz-iconbtn pz-side-close" aria-label={t("shell.menuClose")} onClick={() => { setOpen(false); opener.current?.focus(); }}><Icon name="close" size={22} /></button>
        </div>
        <Sidebar onNavigate={() => setOpen(false)} />
        <div className="pz-side-foot">
          <HelpLink />
          <div className="pz-tools"><LocaleToggle /><ThemeToggle /></div>
        </div>
      </aside>
      <div className="pz-content">
        <SystemBanners />
        <main id="pz-main" tabIndex={-1} className="pz-main">{children}</main>
      </div>
    </div>
  );
}

export { CategoryStatusChip };
