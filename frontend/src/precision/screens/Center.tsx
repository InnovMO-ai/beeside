import { useState } from "react";
import type { CategoryCardDto, CenterDto, UnderstandingState } from "../api/dto";
import { useI18n, type DictKey } from "../i18n";
import { useSession } from "../state/app";
import { Link, type Route } from "../state/router";
import { AppShell } from "../ui/Shell";
import { Icon } from "../ui/icons";
import { usePage } from "../ui/hooks";
import { Button, CategoryStatusChip, Meter, Skeleton, UnderstandingChip } from "../ui/primitives";
import { ContactDialog } from "./Contact";
import { InlineError } from "./SystemPages";

/** Where each category row leads, by status. */
export function categoryTarget(c: Pick<CategoryCardDto, "id" | "status" | "sendState">): { to: Route; cta: DictKey } {
  if (c.status === "sent") return { to: { name: "crp", id: c.id }, cta: "center.cat.cta.sent" };
  if (c.status === "confirmed") return { to: { name: "preview", id: c.id }, cta: c.sendState === "failed" ? "center.cat.cta.failed" : "center.cat.cta.confirmed" };
  if (c.status === "ready_for_review") return { to: { name: "crp", id: c.id }, cta: "center.cat.cta.ready_for_review" };
  return { to: { name: "category", id: c.id }, cta: c.status === "in_progress" ? "center.cat.cta.in_progress" : "center.cat.cta.not_started" };
}

type Next = { titleKey: DictKey; bodyKey: DictKey; to: Route | null; ctaKey: DictKey | null; label?: string };
export function nextStep(c: CenterDto, canWrite = true): Next {
  const u: UnderstandingState = c.understanding.state;
  if (!canWrite) return { titleKey: "center.title.readOnly", bodyKey: "center.body.readOnly", to: null, ctaKey: null };
  if (u === "not_started" || u === "in_progress") return { titleKey: `center.title.${u}`, bodyKey: `center.body.${u}`, to: { name: "understanding" }, ctaKey: `center.u.cta.${u}` };
  if (u === "ready_to_confirm" || c.serviceMap.hasUnconfirmedChanges) return { titleKey: "center.title.ready_to_confirm", bodyKey: "center.body.ready_to_confirm", to: { name: "serviceMap" }, ctaKey: "center.sm.cta.review" };
  const order: CategoryCardDto["status"][] = ["in_progress", "ready_for_review", "confirmed", "not_started"];
  for (const s of order) {
    const hit = c.categories.find((k) => k.status === s);
    if (hit) { const tg = categoryTarget(hit); return { titleKey: "center.title.confirmed", bodyKey: "center.body.confirmed", to: tg.to, ctaKey: tg.cta, label: hit.label }; }
  }
  return { titleKey: "center.title.sentAll", bodyKey: "center.body.sentAll", to: null, ctaKey: null };
}

function Step({ n, title, status, desc, action, children }: { n: number; title: string; status?: React.ReactNode; desc: string; action?: React.ReactNode; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <li className="pz-step">
      <span className="pz-step-n" aria-hidden="true">{n}</span>
      <div className="pz-step-main">
        <div className="pz-step-head">
          <h3 className="pz-h3"><span className="pz-sr">{t("center.step", { n })}. </span>{title}</h3>
          {status}
        </div>
        <p className="pz-muted">{desc}</p>
        {action ? <div className="pz-step-action">{action}</div> : null}
        {children}
      </div>
    </li>
  );
}

function CategoryRow({ c }: { c: CategoryCardDto }) {
  const { t, tn } = useI18n();
  const { canWrite } = useSession();
  // Read-only: nothing can be started or sent, so rows only offer to look at what exists.
  const tg = canWrite ? categoryTarget(c) : c.status === "not_started" ? null : { ...categoryTarget(c), cta: "center.cat.cta.sent" as DictKey };
  const showProgress = c.status !== "not_started" && c.progressPct !== null;
  return (
    <li className="pz-catrow">
      <span className="pz-caticon"><Icon name={c.iconKey} size={22} /></span>
      <div className="pz-catmain">
        <h4 className="pz-h4"><Link to={{ name: "category", id: c.id }}>{c.label}</Link></h4>
        <div className="pz-catmeta">
          {showProgress ? <><Meter pct={c.progressPct} label={`${c.label}: ${t("center.cat.captured", { pct: c.progressPct ?? 0 })}`} /><span className="pz-pct">{t("center.cat.captured", { pct: c.progressPct ?? 0 })}</span></> : <span className="pz-muted">{t("center.cat.noProgress")}</span>}
        </div>
        {c.status === "in_progress" || c.status === "ready_for_review" || c.pendingCount > 0 || c.criticalOpen > 0 ? (
          <p className="pz-counts">
            {c.criticalOpen > 0 ? <span>{tn("center.cat.critical", c.criticalOpen)}</span> : null}
            {c.pendingCount > 0 ? <span>{tn("center.cat.pending", c.pendingCount)}</span> : null}
          </p>
        ) : null}
      </div>
      <div className="pz-catside">
        <CategoryStatusChip status={c.status} sendState={c.sendState} />
        {tg ? <Link to={tg.to} className="pz-textlink" aria-label={`${t(tg.cta)}: ${c.label}`}>{t(tg.cta)}<Icon name="arrow-right" size={16} /></Link> : null}
      </div>
    </li>
  );
}

export function CenterScreen() {
  const { t, date } = useI18n();
  const { center, canWrite } = useSession();
  const [sherpa, setSherpa] = useState(false);
  const c = center.data;
  const next = c ? nextStep(c, canWrite) : null;
  usePage(t("nav.center"), !!c);
  return (
    <AppShell>
      {!c ? (center.error ? <InlineError onRetry={() => void center.reload()} /> : <div className="pz-page"><Skeleton lines={5} /></div>) : (
        <div className="pz-page pz-centerpage">
          <header className="pz-hero">
            <span className="pz-eyebrow">{t("center.eyebrow")}</span>
            <h1 className="pz-h1" tabIndex={-1} data-autofocus>{t(next!.titleKey)}</h1>
            <p className="pz-lead">{t(next!.bodyKey)}</p>
            {next!.to && next!.ctaKey ? (
              <div className="pz-hero-action"><Link to={next!.to} className="pz-btn pz-btn-primary pz-cta-lg"><span>{next!.label ? `${t(next!.ctaKey)} · ${next!.label}` : t(next!.ctaKey)}</span><Icon name="arrow-right" size={18} /></Link></div>
            ) : null}
          </header>

          <section aria-labelledby="pz-journey-h" className="pz-journey">
            <h2 id="pz-journey-h" className="pz-eyebrow">{t("center.journey")}</h2>
            <ol className="pz-steps">
              <Step n={1} title={t("nav.understanding")} status={<UnderstandingChip state={c.understanding.state} />} desc={t("center.u.desc")}
                action={<Link to={{ name: "understanding" }} className="pz-textlink">{t(`center.u.cta.${c.understanding.state}`)}<Icon name="arrow-right" size={16} /></Link>} />
              <Step n={2} title={t("nav.serviceMap")}
                status={c.serviceMap.confirmedAt ? <span className="pz-chip" data-tone="ok"><Icon name="s-done" size={16} /><span>{t("ustate.confirmed")}</span></span> : undefined}
                desc={!c.serviceMap.available ? t("center.sm.locked") : c.serviceMap.confirmedAt ? (c.serviceMap.hasUnconfirmedChanges ? t("center.sm.changes") : t("center.sm.confirmed", { date: date(c.serviceMap.confirmedAt) })) : t("center.sm.available")}
                action={c.serviceMap.available ? <Link to={{ name: "serviceMap" }} className="pz-textlink">{c.serviceMap.confirmedAt && !c.serviceMap.hasUnconfirmedChanges ? t("center.sm.cta.open") : t("center.sm.cta.review")}<Icon name="arrow-right" size={16} /></Link> : undefined} />
              <Step n={3} title={t("center.cat.title")} desc={c.categories.length ? t("center.cat.help") : t("center.cat.locked")}>
                {c.categories.length ? <ul className="pz-catlist">{c.categories.map((k) => <CategoryRow key={k.id} c={k} />)}</ul> : null}
              </Step>
            </ol>
          </section>

          {c.addService.available ? (
            <section className="pz-band" aria-labelledby="pz-add-h">
              <div><h2 id="pz-add-h" className="pz-h3">{t("center.add.title")}</h2><p className="pz-muted">{t("center.add.body")}</p></div>
              <Link to={{ name: "addService" }} className="pz-btn pz-btn-secondary"><Icon name="plus" size={18} /><span>{t("center.add.cta")}</span></Link>
            </section>
          ) : null}

          {c.operationHub.state !== "hidden" ? (
            <section className="pz-band pz-band-oh" aria-labelledby="pz-oh-h">
              <div>
                <h2 id="pz-oh-h" className="pz-h3">{t("center.oh.title")}</h2>
                <p className="pz-muted" role="status">{c.operationHub.state === "pending_access" ? t("center.oh.pending") : t("center.oh.enter")}</p>
              </div>
              <div className="pz-band-actions">
                {c.operationHub.state === "enter" && c.operationHub.url ? <a className="pz-btn pz-btn-primary" href={c.operationHub.url}><span>{t("center.oh.go")}</span><Icon name="external" size={18} /></a> : null}
                {c.operationHub.contactSherpa ? <Button variant="secondary" onClick={() => setSherpa(true)}>{t("center.oh.contactSherpa")}</Button> : null}
              </div>
            </section>
          ) : null}

          <section className="pz-band pz-band-help" aria-labelledby="pz-help-h">
            <div><h2 id="pz-help-h" className="pz-h3">{t("center.help.title")}</h2><p className="pz-muted">{t("center.help.body")}</p></div>
            <Link to={{ name: "help" }} className="pz-btn pz-btn-quiet"><Icon name="help" size={18} /><span>{t("center.help.cta")}</span></Link>
          </section>
        </div>
      )}
      {sherpa ? <ContactDialog title={t("center.oh.contactSherpa")} onClose={() => setSherpa(false)} /> : null}
    </AppShell>
  );
}
