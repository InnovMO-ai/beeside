import { useState } from "react";
import type { CategoryCardDto, CenterDto, UnderstandingState } from "../api/dto";
import { useI18n, type DictKey } from "../i18n";
import { useSession } from "../state/app";
import { Link, type Route } from "../state/router";
import { AppShell } from "../ui/Shell";
import { Icon } from "../ui/icons";
import { usePage } from "../ui/hooks";
import { Button, CategoryStatusText, Meter, Skeleton, StatusText } from "../ui/primitives";
import { OhContactButton, OhContactDialog } from "./Contact";
import { InlineError } from "./SystemPages";

/** Where each category row leads, by status. */
export function categoryTarget(c: Pick<CategoryCardDto, "id" | "status" | "sendState">): { to: Route; cta: DictKey } {
  if (c.status === "sent") return { to: { name: "crp", id: c.id }, cta: "center.cat.cta.sent" };
  if (c.status === "confirmed") return { to: { name: "preview", id: c.id }, cta: c.sendState === "failed" ? "center.cat.cta.failed" : "center.cat.cta.confirmed" };
  if (c.status === "ready_for_review") return { to: { name: "crp", id: c.id }, cta: "center.cat.cta.ready_for_review" };
  return { to: { name: "category", id: c.id }, cta: c.status === "in_progress" ? "center.cat.cta.in_progress" : "center.cat.cta.not_started" };
}

type Next = { titleKey: DictKey; bodyKey: DictKey; to: Route | null; ctaKey: DictKey | null; label?: string; cat?: CategoryCardDto };
export function nextStep(c: CenterDto, canWrite = true): Next {
  const u: UnderstandingState = c.understanding.state;
  if (!canWrite) return { titleKey: "center.title.readOnly", bodyKey: "center.body.readOnly", to: null, ctaKey: null };
  if (u === "not_started" || u === "in_progress") return { titleKey: `center.title.${u}`, bodyKey: `center.body.${u}`, to: { name: "understanding" }, ctaKey: `center.u.cta.${u}` };
  if (u === "ready_to_confirm" || c.serviceMap.hasUnconfirmedChanges) return { titleKey: "center.title.ready_to_confirm", bodyKey: "center.body.ready_to_confirm", to: { name: "serviceMap" }, ctaKey: "center.sm.cta.review" };
  const order: CategoryCardDto["status"][] = ["in_progress", "ready_for_review", "confirmed", "not_started"];
  for (const s of order) {
    const hit = c.categories.find((k) => k.status === s);
    if (hit) { const tg = categoryTarget(hit); return { titleKey: "center.title.confirmed", bodyKey: "center.body.confirmed", to: tg.to, ctaKey: tg.cta, label: hit.label, cat: hit }; }
  }
  return { titleKey: "center.title.sentAll", bodyKey: "center.body.sentAll", to: null, ctaKey: null };
}

function CategoryRow({ c }: { c: CategoryCardDto }) {
  const { t, tn } = useI18n();
  const { canWrite } = useSession();
  // Read-only: nothing can be started or sent, so rows only offer to look at what exists.
  const tg = canWrite ? categoryTarget(c) : c.status === "not_started" ? null : { ...categoryTarget(c), cta: "center.cat.cta.sent" as DictKey };
  const showProgress = c.status !== "not_started" && c.progressPct !== null;
  // Nothing has been asked in a category that is Not started: its open and pending counts would read as work the client left undone.
  const asked = c.status !== "not_started";
  return (
    <li className="pz-catrow">
      <span className="pz-caticon"><Icon name={c.iconKey} size={20} /></span>
      <h3 className="pz-catname"><Link to={{ name: "category", id: c.id }}>{c.label}</Link></h3>
      <div className="pz-catprog">
        {showProgress ? (
          <>
            <Meter pct={c.progressPct} label={`${c.label}: ${t("center.cat.captured", { pct: c.progressPct ?? 0 })}`} />
            <span className="pz-pct" aria-hidden="true">{c.progressPct}%</span>
          </>
        ) : null}
      </div>
      <div className="pz-catstatus">
        {asked && c.criticalOpen > 0 ? <StatusText icon="diamond" tone="attention">{tn("center.cat.critical", c.criticalOpen)}</StatusText> : <CategoryStatusText status={c.status} sendState={c.sendState} />}
        {asked && c.pendingCount > 0 ? <span className="pz-hint">{tn("center.cat.pending", c.pendingCount)}</span> : null}
      </div>
      {tg ? <Link to={tg.to} className="pz-catgo" aria-label={`${t(tg.cta)}: ${c.label}`}><span className="pz-catgo-text">{t(tg.cta)}</span><Icon name="chevron-right" size={18} /></Link> : <span className="pz-catgo" aria-hidden="true" />}
    </li>
  );
}

/** "Next step" card: where to continue, driven by nextStep(). */
function ContinueCard({ c, next }: { c: CenterDto; next: Next }) {
  const { t, tn } = useI18n();
  if (!next.to || !next.ctaKey) return null;
  const cat = next.cat;
  const title = cat ? cat.label : next.to.name === "serviceMap" ? t("nav.serviceMap") : t("nav.understanding");
  return (
    <section className="pz-continue" aria-labelledby="pz-continue-h" data-icon={cat ? "true" : undefined}>
      {cat ? <span className="pz-continue-icon"><Icon name={cat.iconKey} size={24} /></span> : null}
      <div className="pz-continue-main">
        <span className="pz-eyebrow">{t("center.next")}</span>
        <h2 id="pz-continue-h" className="pz-continue-title">{title}</h2>
        <p className="pz-continue-sub">
          {cat ? <CategoryStatusText status={cat.status} sendState={cat.sendState} />
            : next.to.name === "serviceMap" ? <span>{c.serviceMap.hasUnconfirmedChanges ? t("center.sm.changes") : t("ustate.ready_to_confirm")}</span>
            : <StatusText icon={c.understanding.state === "in_progress" ? "s-half" : "s-empty"} tone="neutral">{t(`ustate.${c.understanding.state}`)}</StatusText>}
          {cat && cat.status !== "not_started" && cat.criticalOpen > 0 ? <StatusText icon="diamond" tone="attention">{tn("center.cat.critical", cat.criticalOpen)}</StatusText> : null}
          {cat && cat.status !== "not_started" && cat.pendingCount > 0 ? <span className="pz-hint">{tn("center.cat.pending", cat.pendingCount)}</span> : null}
        </p>
      </div>
      <Link to={next.to} className="pz-btn pz-btn-primary pz-continue-cta"><span>{t(next.ctaKey)}</span>{next.label ? <span className="pz-sr"> · {next.label}</span> : null}<Icon name="arrow-right" size={18} /></Link>
    </section>
  );
}

function SummaryStrip({ c }: { c: CenterDto }) {
  const { t, date } = useI18n();
  const u = c.understanding.state;
  const sm = c.serviceMap;
  const ready = c.categories.filter((k) => k.status === "ready_for_review");
  const smDone = !!sm.confirmedAt;
  return (
    <section className="pz-summary" aria-labelledby="pz-summary-h">
      <h2 id="pz-summary-h" className="pz-sr">{t("center.journey")}</h2>
      <div className="pz-sumcell">
        <span className="pz-sumlabel">{t("nav.understanding")}</span>
        <strong className="pz-sumvalue">{u === "confirmed" ? <StatusText icon="s-done" tone="ok">{t(`ustate.${u}`)}</StatusText> : t(`ustate.${u}`)}</strong>
        <span className="pz-sumsub pz-sumsub-long">{t("center.u.desc")}</span>
        <Link to={{ name: "understanding" }} className="pz-textlink">{t(`center.u.cta.${u}`)}<Icon name="arrow-right" size={14} /></Link>
      </div>
      <div className="pz-sumcell">
        <span className="pz-sumlabel">{t("nav.serviceMap")}</span>
        <strong className="pz-sumvalue">{smDone ? <StatusText icon="s-done" tone="ok">{t("ustate.confirmed")}</StatusText> : sm.available ? t("ustate.ready_to_confirm") : t("ustate.not_started")}</strong>
        <span className="pz-sumsub">{!sm.available ? t("center.sm.locked") : smDone ? (sm.hasUnconfirmedChanges ? t("center.sm.changes") : t("center.sm.confirmed", { date: date(sm.confirmedAt) })) : t("center.sm.available")}</span>
        {sm.available ? <Link to={{ name: "serviceMap" }} className="pz-textlink">{smDone && !sm.hasUnconfirmedChanges ? t("center.sm.cta.open") : t("center.sm.cta.review")}<Icon name="arrow-right" size={14} /></Link> : null}
      </div>
      <div className="pz-sumcell">
        <span className="pz-sumlabel">{t("crp.eyebrow")}</span>
        {c.categories.length ? (
          <>
            <strong className="pz-sumvalue">{ready.length}<span className="pz-sumunit"> · {t("status.ready_for_review")}</span></strong>
            <span className="pz-sumsub">{ready.length ? ready.map((k) => k.label).join(", ") : "\u00a0"}</span>
            {ready.length ? <Link to={{ name: "crp", id: ready[0].id }} className="pz-textlink" aria-label={`${t("center.cat.cta.ready_for_review")}: ${ready[0].label}`}>{t("center.cat.cta.ready_for_review")}<Icon name="arrow-right" size={14} /></Link> : null}
          </>
        ) : (
          <>
            <strong className="pz-sumvalue">{t("ustate.not_started")}</strong>
            <span className="pz-sumsub">{t("center.cat.locked")}</span>
          </>
        )}
      </div>
    </section>
  );
}

export function CenterScreen() {
  const { t } = useI18n();
  const { center, canWrite } = useSession();
  const [sherpa, setSherpa] = useState(false);
  const c = center.data;
  const next = c ? nextStep(c, canWrite) : null;
  usePage(t("nav.center"), !!c);
  const place = c ? [c.project.destinations.map((d) => d.label).join(", "), c.project.sector].filter(Boolean).join(" · ") : "";
  return (
    <AppShell>
      {!c ? (center.error ? <InlineError onRetry={() => void center.reload()} /> : <div className="pz-page"><Skeleton lines={5} /></div>) : (
        <div className="pz-page pz-centerpage">
          <header className="pz-pagehead pz-centerhead">
            <span className="pz-eyebrow">{t("center.eyebrow")}</span>
            <h1 className="pz-h1" tabIndex={-1} data-autofocus>{t(next!.titleKey)}</h1>
            <p className="pz-lead">{t(next!.bodyKey)}</p>
            {place ? <p className="pz-projectline"><span>{t("center.projectFor")}</span><span aria-hidden="true">·</span><span>{place}</span></p> : null}
          </header>

          <ContinueCard c={c} next={next!} />
          <SummaryStrip c={c} />

          <section aria-labelledby="pz-cats-h" className="pz-cats">
            <div className="pz-cats-head">
              <h2 id="pz-cats-h" className="pz-h2">{t("center.cat.title")}</h2>
              <p className="pz-hint">{c.categories.length ? t("center.cat.help") : t("center.cat.locked")}</p>
            </div>
            {c.categories.length ? <ul className="pz-cattable">{c.categories.map((k) => <CategoryRow key={k.id} c={k} />)}</ul> : null}
          </section>

          <div className="pz-bands">
            {c.operationHub.state !== "hidden" ? (
              <section className="pz-band pz-band-oh" aria-labelledby="pz-oh-h">
                <div>
                  <h2 id="pz-oh-h" className="pz-band-title">{t("center.oh.title")}</h2>
                  <p className="pz-muted" role="status">{c.operationHub.state === "pending_access" ? t("center.oh.pending") : t("center.oh.enter")}</p>
                </div>
                <div className="pz-band-actions">
                  {c.operationHub.state === "enter" && c.operationHub.url ? <a className="pz-btn pz-btn-primary" href={c.operationHub.url}><span>{t("center.oh.go")}</span><Icon name="external" size={18} /></a> : null}
                  <OhContactButton contact={c.operationHub.contact} onOpen={() => setSherpa(true)} />
                </div>
              </section>
            ) : null}

            {c.addService.available ? (
              <section className="pz-band" aria-labelledby="pz-add-h">
                <div><h2 id="pz-add-h" className="pz-band-title">{t("center.add.title")}</h2><p className="pz-muted">{t("center.add.body")}</p></div>
                <Link to={{ name: "addService" }} className="pz-btn pz-btn-secondary"><Icon name="plus" size={16} /><span>{t("center.add.cta")}</span></Link>
              </section>
            ) : null}

            <section className="pz-band pz-band-help" aria-labelledby="pz-help-h">
              <div><h2 id="pz-help-h" className="pz-band-title">{t("center.help.title")}</h2><p className="pz-muted">{t("center.help.body")}</p></div>
              <Link to={{ name: "help" }} className="pz-btn pz-btn-quiet"><Icon name="help" size={18} /><span>{t("center.help.cta")}</span></Link>
            </section>
          </div>
        </div>
      )}
      {sherpa && c?.operationHub.contact ? <OhContactDialog contact={c.operationHub.contact} onClose={() => setSherpa(false)} /> : null}
    </AppShell>
  );
}
