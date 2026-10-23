import { useRef, useState } from "react";
import { newKey } from "../api/client";
import type { CrpRequirementDto, CrpViewDto } from "../api/dto";
import { ApiFailure } from "../api/transport";
import { useI18n } from "../i18n";
import { failureKey, useSession } from "../state/app";
import { Link, useRouter } from "../state/router";
import { useResource } from "../state/resource";
import { DocShell } from "../ui/Shell";
import { Icon } from "../ui/icons";
import { usePage } from "../ui/hooks";
import { Banner, Button, Dialog, ItemStateChip, PageState, Skeleton, StatusChip } from "../ui/primitives";
import { InlineError } from "./SystemPages";

/** "Label: value" lines from the server become label/value rows; anything else is a plain full-width line. */
export function parseLine(l: string): { label: string; value: string } | null {
  const m = /^([^:]{1,40}):\s+(.+)$/.exec(l);
  return m ? { label: m[1], value: m[2] } : null;
}
export function LineRows({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <dl className={`pz-kvlist ${className ?? ""}`}>
      {lines.map((l) => {
        const kv = parseLine(l);
        return kv ? <div className="pz-kv" key={l}><dt>{kv.label}</dt><dd>{kv.value}</dd></div> : <div className="pz-kv pz-kv-full" key={l}><dd>{l}</dd></div>;
      })}
    </dl>
  );
}

function Requirement({ r }: { r: CrpRequirementDto }) {
  const { t } = useI18n();
  return (
    <li className="pz-req" data-state={r.state}>
      <div className="pz-req-label">{r.label}</div>
      <div className="pz-req-value">{r.value ? <span>{r.value}</span> : <span className="pz-muted">{t("crp.notAnswered")}</span>}</div>
      <div className="pz-req-meta">
        <ItemStateChip state={r.state} />
        {r.executionDependency ? <span className="pz-dep" title={t("crp.executionDependency.note")}><Icon name="lock" size={14} />{t("crp.executionDependency")}</span> : null}
      </div>
    </li>
  );
}

/** The CRP as a document: human-readable values, state per requirement, Pending Information always visible. Reused by Preview before Send and Sent. */
export function CrpBody({ view, compact }: { view: CrpViewDto; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`pz-docbody pz-crpbody ${compact ? "pz-compact" : ""}`}>
      {view.context.length && !compact ? (
        <section className="pz-docsec" aria-label={t("crp.context")}>
          <h3 className="pz-h3">{t("crp.context")}</h3>
          <LineRows lines={view.context} />
        </section>
      ) : null}
      {view.sections.map((s) => (
        <section className="pz-docsec" key={s.id} aria-label={s.title}>
          <h3 className="pz-h3">{s.title}</h3>
          <ul className="pz-reqs">{s.items.map((r) => <Requirement key={r.id} r={r} />)}</ul>
        </section>
      ))}
      {/* Open considerations: Pending Information stays a block of its own, never inside prose; the header link jumps here. */}
      <section className="pz-docsec pz-pendingbox" id={compact ? undefined : "pz-pending"} aria-label={t("crp.pending.title")} data-empty={view.pending.length === 0}>
        <h3 className="pz-h3">{t("crp.pending.title")}</h3>
        <p className="pz-muted pz-secnote">{view.pending.length ? t("crp.pending.body") : t("crp.pending.none")}</p>
        {view.pending.length ? <ul className="pz-reqs">{view.pending.map((r) => <Requirement key={`p-${r.id}`} r={r} />)}</ul> : null}
      </section>
      {view.requiredLater.length ? (
        <section className="pz-docsec" aria-label={t("crp.later.title")}>
          <h3 className="pz-h3">{t("crp.later.title")}</h3>
          <p className="pz-muted pz-secnote">{t("crp.later.body")}</p>
          <LineRows lines={view.requiredLater} />
        </section>
      ) : null}
    </div>
  );
}

type Action = "confirm" | "newVersion" | "changes";

export function CrpScreen({ id }: { id: string }) {
  const { t, date } = useI18n();
  const { client, canWrite, access, center, refreshCenter, noteAccessFailure } = useSession();
  const { navigate } = useRouter();
  const res = useResource(() => client.crp(id), [client, id]);
  const [dialog, setDialog] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [justConfirmed, setJustConfirmed] = useState(false);
  const key = useRef(newKey("crp"));
  const v = res.data;
  usePage(v?.title ?? t("crp.eyebrow"), !!v || !!res.error);

  const run = async (a: Action) => {
    if (busy) return;
    setBusy(true); setProblem(null);
    try {
      if (a === "confirm") { await client.crpConfirm(id, { requestKey: key.current }); key.current = newKey("crp"); setJustConfirmed(true); await res.reload(); }
      else if (a === "changes") { await client.crpRequestChanges(id); navigate({ name: "category", id }); }
      else { await client.crpNewVersion(id); navigate({ name: "category", id }); }
      setDialog(null);
      void refreshCenter();
    } catch (e) {
      const f = e instanceof ApiFailure ? e : null;
      if (f) { noteAccessFailure(f); if (f.code === "NOT_READY" || f.code === "CONFLICT") void res.reload(); }
      setProblem(t(f ? failureKey(f) : "error.generic"));
    } finally { setBusy(false); }
  };

  const card = center.data?.categories.find((k) => k.id === id);
  const stateChip = !v ? null : v.state === "confirmed"
    ? <StatusChip icon="s-done" tone="ok">{t("crp.state.confirmed", { date: date(v.confirmedAt) })}</StatusChip>
    : v.state === "ready_for_review" ? <StatusChip icon="s-review" tone="review">{t("crp.state.ready_for_review")}</StatusChip>
      : <StatusChip icon="s-half" tone="active">{t("crp.state.draft")}</StatusChip>;
  const stateWord = !v ? "" : v.state === "confirmed" ? t("crp.state.confirmed", { date: date(v.confirmedAt) }) : v.state === "ready_for_review" ? t("crp.state.ready_for_review") : t("crp.state.draft");

  let content;
  if (res.loading) content = <Skeleton lines={9} />;
  else if (!v) content = res.error?.status === 404 ? <PageState icon="search" title={t("notfound.title")} body={t("notfound.body")} action={<Link to={{ name: "center" }} className="pz-btn pz-btn-primary"><span>{t("shell.backToCenter")}</span></Link>} /> : <InlineError onRetry={() => void res.reload()} />;
  else content = (
    <article className="pz-doc pz-doc-crp" aria-labelledby="pz-doc-h">
      {justConfirmed && v.state === "confirmed" ? <Banner tone="ok" role="status" title={t("crp.confirmed.title")}>{t("crp.confirmed.body")}</Banner> : null}
      <header className="pz-dochead">
        <span className="pz-eyebrow">{t("crp.eyebrow")} · {stateWord}</span>
        <div className="pz-doctitle">
          <span className="pz-titleicon" aria-hidden="true"><Icon name={card?.iconKey ?? v.categoryId} size={28} /></span>
          <h1 id="pz-doc-h" className="pz-h1" tabIndex={-1} data-autofocus>{v.title}</h1>
        </div>
        <div className="pz-docmeta">
          {stateChip}
          {v.state === "confirmed" ? <span className="pz-muted">{t("crp.readOnlyLabel")}</span> : null}
          {v.pending.length ? <a className="pz-textlink pz-noprint" href="#pz-pending">{t(`center.cat.pending.${v.pending.length === 1 ? "one" : "other"}`, { n: v.pending.length })}</a> : null}
          <button type="button" className="pz-textlink pz-noprint" onClick={() => window.print()}><Icon name="print" size={16} />{t("shell.print")}</button>
        </div>
        {v.state === "draft" ? <p className="pz-doclead">{t("crp.draftNote")}</p> : null}
      </header>
      <CrpBody view={v} />
      {access.mode === "READ_ONLY" ? <p className="pz-docnote">{t("crp.readOnly")}</p> : null}
      <section className="pz-panel pz-noprint" data-plain={v.state === "draft" || undefined} aria-label={v.state === "confirmed" ? t("crp.preview") : t("crp.confirm.title")}>
        {v.state === "ready_for_review" ? <div className="pz-panel-text"><h2 className="pz-h3">{t("crp.confirm.title")}</h2><p>{t("crp.confirm.body")}</p></div> : null}
        {v.state === "confirmed" ? <div className="pz-panel-text"><h2 className="pz-h3">{t("crp.preview")}</h2><p>{t("crp.newVersion.note")}</p></div> : null}
        <div className="pz-actionbar">
          {v.state === "draft" ? <Link to={{ name: "category", id }} className="pz-btn pz-btn-primary"><span>{t("crp.continue")}</span><Icon name="arrow-right" size={18} /></Link> : null}
          {v.state === "confirmed" ? <Link to={{ name: "category", id }} className="pz-btn pz-btn-quiet"><span>{t("crp.toCategory")}</span></Link> : null}
          {v.canRequestChanges && canWrite ? <Button variant="secondary" onClick={() => { setProblem(null); setDialog("changes"); }}>{t("crp.requestChanges")}</Button> : null}
          {v.canConfirm && canWrite ? <Button iconAfter="check" onClick={() => { setProblem(null); setDialog("confirm"); }}>{t("crp.confirm.cta")}</Button> : null}
          {v.canStartNewVersion && canWrite ? <Button variant="secondary" onClick={() => { setProblem(null); setDialog("newVersion"); }}>{t("crp.newVersion")}</Button> : null}
          {v.state === "confirmed" ? <Link to={{ name: "preview", id }} className="pz-btn pz-btn-primary"><span>{t("crp.preview")}</span><Icon name="arrow-right" size={18} /></Link> : null}
        </div>
      </section>
    </article>
  );
  const copy: Record<Action, { title: string; body: string; button: string }> = {
    confirm: { title: t("crp.confirm.title"), body: t("crp.confirm.body"), button: t("crp.confirm.button") },
    changes: { title: t("crp.changes.title"), body: t("crp.changes.body"), button: t("crp.requestChanges") },
    newVersion: { title: t("crp.newVersion"), body: t("crp.newVersion.note"), button: t("crp.newVersion") },
  };
  return (
    <DocShell back={v?.state === "confirmed" ? { name: "center" } : { name: "category", id }} backLabel={v?.state === "confirmed" ? t("shell.backToCenter") : t("crp.toCategory")}>
      {content}
      {dialog ? (
        <Dialog title={copy[dialog].title} onClose={() => !busy && setDialog(null)}
          actions={<><Button variant="quiet" onClick={() => setDialog(null)} disabled={busy}>{t("shell.cancel")}</Button><Button busy={busy} onClick={() => void run(dialog)}>{copy[dialog].button}</Button></>}>
          <p>{copy[dialog].body}</p>
          {problem ? <p className="pz-field-error" role="alert">{problem}</p> : null}
        </Dialog>
      ) : null}
    </DocShell>
  );
}
