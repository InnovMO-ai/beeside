import { useEffect, useRef, useState, type MouseEvent } from "react";
import { newKey } from "../api/client";
import type { ServiceMapCorrectionRequest, ServiceMapDto, ServiceMapGroupDto, ServiceMapItemDto, ServiceMapViewDto } from "../api/dto";
import { ApiFailure } from "../api/transport";
import { useI18n } from "../i18n";
import { failureKey, useSession } from "../state/app";
import { Link } from "../state/router";
import { useResource } from "../state/resource";
import { DocShell } from "../ui/Shell";
import { Icon } from "../ui/icons";
import { reducedMotion, usePage } from "../ui/hooks";
import { Banner, Button, Dialog, ItemStateChip, PageState, Skeleton, StatusChip } from "../ui/primitives";
import { InlineError } from "./SystemPages";

function Priority({ level }: { level: NonNullable<ServiceMapItemDto["priority"]> }) {
  const { t } = useI18n();
  const n = level === "high" ? 3 : level === "medium" ? 2 : 1;
  return (
    <span className="pz-priority" data-level={level}>
      <span className="pz-bars" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} data-on={i <= n} />)}</span>
      <span>{t(`priority.${level}`)}</span>
    </span>
  );
}

function groupTitle(g: ServiceMapGroupDto, t: ReturnType<typeof useI18n>["t"]): string {
  return g.kind === "to_review" ? t("sm.group.to_review") : g.label;
}

/** Edit hook handed to the map body when the client may correct it (live view, write access). */
export interface MapEditor { onEdit: (it: ServiceMapItemDto, group: ServiceMapGroupDto) => void }

function MapItem({ it, group, editor }: { it: ServiceMapItemDto; group?: ServiceMapGroupDto; editor?: MapEditor }) {
  const { t } = useI18n();
  return (
    <li className="pz-item">
      <div className="pz-item-main">
        <strong>{it.label}</strong>
        {it.why ? <p className="pz-muted">{it.why}</p> : null}
      </div>
      <div className="pz-item-meta">
        {it.priority ? <Priority level={it.priority} /> : null}
        {it.timing ? <span className="pz-timing"><span className="pz-sr">{t("sm.timing")}: </span>{it.timing}</span> : null}
        <ItemStateChip state={it.state} />
        {editor && group ? <button type="button" className="pz-textlink pz-noprint pz-item-edit" onClick={() => editor.onEdit(it, group)} aria-label={t("sm.edit.aria", { label: it.label })}>{t("sm.edit")}</button> : null}
      </div>
    </li>
  );
}

/** Section ids for the Contents rail of My Service Map. */
export const MAP_SECTIONS = { summary: "pz-sec-summary", services: "pz-sec-services", open: "pz-sec-open" } as const;

/** The document body, reused by My Service Map and by Preview before Send (compact: label/value rows inside a numbered block). */
export function ServiceMapBody({ view, compact, editor }: { view: ServiceMapViewDto; compact?: boolean; editor?: MapEditor }) {
  const { t } = useI18n();
  const s = view.summary;
  const Row = ({ label, value }: { label: string; value: string | null }) => (
    <div className="pz-kv"><dt>{label}</dt><dd>{value ?? <span className="pz-muted">{t("sm.notCaptured")}</span>}</dd></div>
  );
  return (
    <div className={`pz-docbody pz-mapbody ${compact ? "pz-compact" : ""}`}>
      {/* compact = inside Preview before Send, whose first block already lists the project facts */}
      {!compact ? (
        <section className="pz-docsec pz-mapsummary" id={MAP_SECTIONS.summary} aria-label={t("sm.summary")}>
          <h3 className="pz-h3 pz-sr">{t("sm.summary")}</h3>
          <dl className="pz-kvlist">
            <Row label={t("sm.objective")} value={s.objective} />
            <Row label={t("sm.destinations")} value={s.destinations.length ? s.destinations.map((d) => d.label).join(", ") : null} />
            <Row label={t("sm.timeWindow")} value={s.timeWindow} />
            <Row label={t("sm.product")} value={s.productOrService} />
          </dl>
        </section>
      ) : null}
      <section className="pz-docsec pz-services" id={compact ? undefined : MAP_SECTIONS.services} aria-label={t("sm.services")}>
        <h3 className="pz-h3">{t("sm.services")}</h3>
        <div className="pz-groups">
          {view.groups.map((g) => (
            <div className="pz-group" key={`${g.kind}-${g.label}`}>
              <span className="pz-group-icon" aria-hidden="true"><Icon name={g.iconKey} size={compact ? 18 : 22} /></span>
              <div className="pz-group-main">
                <div className="pz-group-head">
                  <h4 className="pz-h4 pz-group-title"><span>{groupTitle(g, t)}</span></h4>
                  {g.categoryId && !compact ? <Link to={{ name: "category", id: g.categoryId }} className="pz-textlink pz-noprint">{t("sm.viewCategory")}<Icon name="arrow-right" size={14} /></Link> : null}
                </div>
                {g.kind === "to_review" ? <p className="pz-muted pz-group-note">{t("sm.group.to_review.note")}</p> : null}
                <ul className="pz-items">{g.items.map((it) => <MapItem key={it.id} it={it} group={g} editor={editor} />)}</ul>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="pz-docsec pz-open" id={compact ? undefined : MAP_SECTIONS.open} aria-label={t("sm.openItems")}>
        <h3 className="pz-h3">{t("sm.openItems")}</h3>
        {view.openItems.length ? <ul className="pz-bullets">{view.openItems.map((o) => <li key={o}>{o}</li>)}</ul> : <p className="pz-muted">{t("sm.openItems.none")}</p>}
      </section>
    </div>
  );
}

/** A correction without its idempotency key (the screen adds it). */
type CorrectionOp = ServiceMapCorrectionRequest extends infer T ? (T extends { requestKey: string } ? Omit<T, "requestKey"> : never) : never;
type Priority3 = "high" | "medium" | "low" | "none";

/** Correct one need: its wording, its priority, the reason it is on the map, the group it sits in — or remove it. Each change is the client's decision, applied as stated. */
function EditDialog({ item, group, targets, onClose, onApply }: {
  item: ServiceMapItemDto; group: ServiceMapGroupDto; targets: { id: string; label: string }[];
  onClose: () => void; onApply: (ops: CorrectionOp[]) => Promise<string | null>;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(item.label);
  const [why, setWhy] = useState(item.why ?? "");
  const [priority, setPriority] = useState<Priority3>(item.priority ?? "none");
  const [to, setTo] = useState("");
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const others = targets.filter((x) => x.label !== group.label);
  const ops = (): CorrectionOp[] => {
    const out: CorrectionOp[] = [];
    if (label.trim() && label.trim() !== item.label) out.push({ op: "rename", itemId: item.id, text: label.trim() });
    if (why.trim() !== (item.why ?? "") && why.trim()) out.push({ op: "set_why", itemId: item.id, text: why.trim() });
    if (priority !== (item.priority ?? "none")) out.push({ op: "set_priority", itemId: item.id, priority: priority === "none" ? null : priority });
    if (to) out.push({ op: "move", itemId: item.id, toGroupId: to });
    return out;
  };
  const apply = async (list: CorrectionOp[]) => {
    if (busy || list.length === 0) { if (!busy) onClose(); return; }
    setBusy(true); setProblem(null);
    const err = await onApply(list);
    setBusy(false);
    if (err) setProblem(err); else onClose();
  };
  return (
    <Dialog title={t("sm.edit.title")} onClose={() => !busy && onClose()}
      actions={removing
        ? <><Button variant="quiet" onClick={() => setRemoving(false)} disabled={busy}>{t("shell.cancel")}</Button><Button busy={busy} onClick={() => void apply([{ op: "remove", itemId: item.id }])}>{t("sm.edit.removeConfirm")}</Button></>
        : <><Button variant="quiet" onClick={onClose} disabled={busy}>{t("shell.cancel")}</Button><Button busy={busy} onClick={() => void apply(ops())}>{t("sm.edit.save")}</Button></>}>
      {removing ? (
        <p>{t("sm.edit.removeBody", { label: item.label })}</p>
      ) : (
        <div className="pz-editform">
          <label className="pz-editfield"><span>{t("sm.edit.label")}</span><input value={label} maxLength={160} onChange={(e) => setLabel(e.target.value)} /></label>
          <label className="pz-editfield"><span>{t("sm.edit.why")}</span><textarea rows={3} value={why} maxLength={400} onChange={(e) => setWhy(e.target.value)} /></label>
          <label className="pz-editfield"><span>{t("sm.edit.priority")}</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority3)}>
              <option value="high">{t("priority.high")}</option><option value="medium">{t("priority.medium")}</option><option value="low">{t("priority.low")}</option><option value="none">{t("sm.edit.priority.none")}</option>
            </select>
          </label>
          {others.length ? (
            <label className="pz-editfield"><span>{t("sm.edit.move")}</span>
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">{t("sm.edit.move.keep", { group: group.kind === "to_review" ? t("sm.group.to_review") : group.label })}</option>
                {others.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
          ) : null}
          <button type="button" className="pz-textlink pz-edit-remove" onClick={() => setRemoving(true)}>{t("sm.edit.remove")}</button>
        </div>
      )}
      {problem ? <p className="pz-field-error" role="alert">{problem}</p> : null}
    </Dialog>
  );
}

/** Contents rail (desktop only): anchors to the sections that exist, the one being read in violet. */
function Rail() {
  const { t } = useI18n();
  const items = [
    { id: MAP_SECTIONS.summary, label: t("sm.summary") },
    { id: MAP_SECTIONS.services, label: t("sm.services") },
    { id: MAP_SECTIONS.open, label: t("sm.openItems") },
  ];
  const [active, setActive] = useState<string>(items[0].id);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      let cur = items[0].id;
      for (const i of items) {
        const el = document.getElementById(i.id);
        if (el && el.getBoundingClientRect().top <= 140) cur = i.id;
      }
      // At the very bottom the last section is the one being read even if it is short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = items[items.length - 1].id;
      setActive(cur);
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) window.cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    setActive(id);
  };
  return (
    <nav className="pz-rail pz-noprint" aria-label={t("sm.contents")}>
      <div className="pz-rail-in">
      <span className="pz-rail-title" aria-hidden="true">{t("sm.contents")}</span>
      <ul>
        {items.map((i) => (
          <li key={i.id}><a href={`#${i.id}`} aria-current={active === i.id ? "location" : undefined} onClick={(e) => go(e, i.id)}>{i.label}</a></li>
        ))}
      </ul>
      </div>
    </nav>
  );
}

export function ServiceMapScreen() {
  const { t, date } = useI18n();
  const { client, canWrite, access, refreshCenter, noteAccessFailure } = useSession();
  const res = useResource(() => client.serviceMap(), [client]);
  const [tab, setTab] = useState<"confirmed" | "live" | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [justConfirmed, setJustConfirmed] = useState(false);
  const [editing, setEditing] = useState<{ item: ServiceMapItemDto; group: ServiceMapGroupDto } | null>(null);
  const requestKey = useRef(newKey("sm"));
  const sm: ServiceMapDto | null = res.data;
  const notReady = res.error?.code === "NOT_READY";
  usePage(t("nav.serviceMap"), !!sm || !!res.error);

  const view = !sm ? null : (tab ?? (sm.confirmed && !sm.hasUnconfirmedChanges ? "confirmed" : "live")) === "confirmed" && sm.confirmed ? sm.confirmed : sm.live;
  const showingConfirmed = !!sm && !!sm.confirmed && view === sm.confirmed;

  const confirm = async () => {
    if (busy) return;
    setBusy(true); setProblem(null);
    try {
      const r = await client.confirmServiceMap({ requestKey: requestKey.current });
      res.setData(r.serviceMap);
      requestKey.current = newKey("sm");
      setDialog(false); setJustConfirmed(true); setTab("confirmed");
      void refreshCenter();
    } catch (e) {
      const f = e instanceof ApiFailure ? e : null;
      if (f) noteAccessFailure(f);
      setProblem(t(f ? failureKey(f) : "error.generic"));
    } finally { setBusy(false); }
  };

  /** Applies the client's corrections one after another (each is its own idempotent request); returns a message when one fails. */
  const applyCorrections = async (ops: CorrectionOp[]): Promise<string | null> => {
    try {
      for (const op of ops) {
        const r = await client.correctServiceMap({ ...op, requestKey: newKey("smc") } as ServiceMapCorrectionRequest);
        res.setData(r.serviceMap);
      }
      setJustConfirmed(false); setTab("live");
      void refreshCenter();
      return null;
    } catch (e) {
      const f = e instanceof ApiFailure ? e : null;
      if (f) noteAccessFailure(f);
      return t(f ? failureKey(f) : "error.generic");
    }
  };
  const editor: MapEditor | undefined = sm && canWrite && sm.canWrite && !showingConfirmed ? { onEdit: (item, group) => setEditing({ item, group }) } : undefined;

  let content;
  if (res.loading) content = <Skeleton lines={8} />;
  else if (notReady) content = <PageState icon="doc" title={t("sm.unavailable.title")} body={t("sm.unavailable.body")} action={<Link to={{ name: "understanding" }} className="pz-btn pz-btn-primary"><span>{t("sm.toUnderstanding")}</span></Link>} />;
  else if (!sm || !view) content = <InlineError onRetry={() => void res.reload()} />;
  else content = (
    <div className="pz-mapwrap">
      <Rail />
      <article className="pz-doc pz-doc-map" aria-labelledby="pz-doc-h">
        {justConfirmed ? <Banner tone="ok" role="status" title={t("sm.confirmed.title")}>{t("sm.confirmed.body")}</Banner> : null}
        <header className="pz-dochead">
          <span className="pz-eyebrow">{t("sm.eyebrow")}</span>
          <div className="pz-dochead-row">
            <h1 id="pz-doc-h" className="pz-h1" tabIndex={-1} data-autofocus>{view.title}</h1>
            <div className="pz-actionbar pz-docactions pz-noprint">
              <Button variant="secondary" icon="print" onClick={() => window.print()}>{t("shell.print")}</Button>
              {sm.canConfirm && canWrite && !showingConfirmed ? <Button iconAfter="check" onClick={() => { setProblem(null); setDialog(true); }}>{t("sm.confirm.cta")}</Button> : null}
            </div>
          </div>
          <div className="pz-docmeta">
            {showingConfirmed && sm.confirmed
              ? <StatusChip icon="s-done" tone="ok">{t("sm.state.confirmed", { date: date(sm.confirmed.confirmedAt) })}</StatusChip>
              : <StatusChip icon="s-review" tone="review">{t("sm.state.draft")}</StatusChip>}
            <span className="pz-muted">{t("sm.asOf", { date: date(view.asOf) })}</span>
          </div>
          {sm.confirmed && sm.hasUnconfirmedChanges ? (
            <div className="pz-tabs pz-noprint" role="group" aria-label={t("sm.eyebrow")}>
              <button type="button" aria-pressed={!showingConfirmed} onClick={() => setTab("live")}>{t("sm.tab.live")}</button>
              <button type="button" aria-pressed={showingConfirmed} onClick={() => setTab("confirmed")}>{t("sm.tab.confirmed")}</button>
            </div>
          ) : null}
        </header>
        {!showingConfirmed && sm.live.changesSinceConfirmed.length ? (
          <section className="pz-changes" aria-label={t("sm.changes")}>
            <h2 className="pz-h3">{t("sm.changes")}</h2>
            <ul>{sm.live.changesSinceConfirmed.map((c) => <li key={c.text}><strong>{t(`sm.change.${c.kind}`)}:</strong> {c.text}</li>)}</ul>
          </section>
        ) : null}
        <ServiceMapBody view={view} {...(editor ? { editor } : {})} />
        <footer className="pz-docfoot">
          {showingConfirmed ? <p className="pz-docnote">{t("sm.immutable")}</p> : null}
          {access.mode === "READ_ONLY" ? <p className="pz-docnote">{t("sm.readOnly")}</p> : null}
          <Link to={{ name: "center" }} className="pz-btn pz-btn-quiet pz-noprint"><span>{t("sm.toCenter")}</span></Link>
        </footer>
      </article>
    </div>
  );
  return (
    <DocShell back={{ name: "center" }} backLabel={t("shell.backToCenter")}>
      {content}
      {editing && sm ? <EditDialog item={editing.item} group={editing.group} targets={sm.moveTargets ?? []} onClose={() => setEditing(null)} onApply={applyCorrections} /> : null}
      {dialog ? (
        <Dialog title={t("sm.confirm.title")} onClose={() => !busy && setDialog(false)}
          actions={<><Button variant="quiet" onClick={() => setDialog(false)} disabled={busy}>{t("shell.cancel")}</Button><Button busy={busy} onClick={confirm}>{t("sm.confirm.button")}</Button></>}>
          <p>{t("sm.confirm.body")}</p><p className="pz-muted">{t("sm.confirm.note")}</p>
          {problem ? <p className="pz-field-error" role="alert">{problem}</p> : null}
        </Dialog>
      ) : null}
    </DocShell>
  );
}
