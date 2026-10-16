import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CategoryDto, CategoryProgressDto, KnowsPanelDto, ThreadDto, TurnDto, TurnResultDto, UnderstandingState } from "../api/dto";
import { useI18n } from "../i18n";
import { ApiFailure } from "../api/transport";
import { useSession } from "../state/app";
import { Link } from "../state/router";
import { useThread, waitStage, type Pending } from "../state/thread";
import { AppShell } from "../ui/Shell";
import { Icon } from "../ui/icons";
import { reducedMotion, usePage } from "../ui/hooks";
import { CategoryStatusChip, Meter, Skeleton, UnderstandingChip } from "../ui/primitives";
import { InlineError } from "./SystemPages";

// ---------------------------------------------------------------- pieces
function ConfirmCard({ turn, active, onAnswer }: { turn: TurnDto; active: boolean; onAnswer: (intent: "confirm" | "correct") => void }) {
  const c = turn.confirmCard!;
  return (
    <div className="pz-confirm" data-kind={c.kind} role="group" aria-label={c.title}>
      <span className="pz-eyebrow">{c.title}</span>
      <p className="pz-confirm-body">{c.body}</p>
      {active ? (
        <div className="pz-confirm-actions">
          <button type="button" className="pz-pill pz-pill-ink" onClick={() => onAnswer("confirm")}>{c.confirmLabel}</button>
          <button type="button" className="pz-pill" onClick={() => onAnswer("correct")}>{c.correctLabel}</button>
        </div>
      ) : null}
    </div>
  );
}

function TurnView({ turn, last, active, onConfirm, saved, notSaved }: { turn: TurnDto; last: boolean; active: boolean; onConfirm: (t: TurnDto, intent: "confirm" | "correct") => void; saved?: boolean; notSaved?: boolean }) {
  const { t } = useI18n();
  if (turn.role === "client") {
    if (!turn.text.trim()) return null; // never an empty bubble
    return (
      <div className="pz-turn pz-turn-client" data-turn-id={turn.id}>
        <span className="pz-turn-who" aria-hidden="true">{t("ws.you")}</span>
        <div className="pz-bubble"><span className="pz-sr">{t("ws.you")}: </span>{turn.text}</div>
        {notSaved ? <span className="pz-turn-meta pz-turn-warn"><Icon name="alert" size={14} />{t("ws.notSaved")}</span>
          : saved ? <span className="pz-turn-meta"><Icon name="check" size={14} />{t("shell.saved")}</span> : null}
      </div>
    );
  }
  return (
    <div className="pz-turn pz-turn-assistant" data-turn-id={turn.id} data-kind={turn.kind}>
      <span className="pz-turn-who">{t("ws.assistant")}</span>
      <p className="pz-turn-text">{turn.kind === "notice" ? <Icon name="info" size={16} className="pz-turn-ico" /> : null}{turn.text}</p>
      {turn.confirmCard ? <ConfirmCard turn={turn} active={active && last} onAnswer={(i) => onConfirm(turn, i)} /> : null}
      {turn.resourceOffer ? <ResourceLink offer={turn.resourceOffer} /> : null}
    </div>
  );
}

/**
 * An optional country guide offered in context ("Doing Business in Mexico"). The destination is Admin configuration, resolved from the API
 * (only for a guide offered to this project, only while active); nothing is hardcoded. Never blocks the conversation: if the guide is not
 * available the offer simply says so. A PDF gets "View guide" + "Download PDF"; a web page gets "View guide".
 */
export function ResourceLink({ offer }: { offer: { id: string; title: string } }) {
  const { t } = useI18n();
  const { client } = useSession();
  const [res, setRes] = useState<{ ref: string; format: "pdf" | "web" } | "gone" | null>(null);
  useEffect(() => {
    let alive = true;
    client.resource(offer.id).then(
      (r) => { if (alive) setRes(r.kind === "url" && /^https:\/\//.test(r.ref) ? { ref: r.ref, format: r.format === "pdf" ? "pdf" : "web" } : "gone"); },
      (e: unknown) => { if (alive && e instanceof ApiFailure) setRes("gone"); },
    );
    return () => { alive = false; };
  }, [client, offer.id]);
  if (res === "gone") return <div className="pz-resource"><span className="pz-muted" role="status">{t("ws.resource.gone")}</span></div>;
  if (!res) return null;
  return (
    <div className="pz-resource" role="group" aria-label={offer.title}>
      <span className="pz-resource-title">{offer.title}</span>
      <a className="pz-textlink" href={res.ref} target="_blank" rel="noopener noreferrer">{t("ws.resource.view")}<span className="pz-sr"> — {offer.title} {t("shell.newTab")}</span><Icon name="arrow-right" size={14} /></a>
      {res.format === "pdf" ? <a className="pz-textlink" href={res.ref} download rel="noopener noreferrer">{t("ws.resource.download")}<span className="pz-sr"> — {offer.title}</span></a> : null}
    </div>
  );
}

/** "Lo que ya sé de esta parte de tu proyecto": what the project already established for this category, in the client's words, correctable in place. */
function KnowsPanel({ panel, canCorrect, onCorrect }: { panel: KnowsPanelDto; canCorrect: boolean; onCorrect: (prompt: string) => void }) {
  const wide = (): boolean => { try { return typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 900px)").matches; } catch { return true; } };
  // Desktop shows it open; on mobile it is one quiet line that opens on demand (it never pushes the conversation off the screen).
  const [open, setOpen] = useState<boolean>(wide);
  return (
    <section className="pz-knows" aria-labelledby="pz-knows-h" data-open={open || undefined}>
      <button type="button" className="pz-knows-head" aria-expanded={open} aria-controls="pz-knows-body" onClick={() => setOpen((o) => !o)}>
        <h2 id="pz-knows-h" className="pz-knows-title">{panel.heading}</h2>
        <Icon name="arrow-right" size={16} className="pz-knows-chev" />
      </button>
      <div id="pz-knows-body" className="pz-knows-body" hidden={!open}>
        <ul className="pz-knows-list">
          {panel.lines.map((l) => (
            <li key={l.id} className="pz-knows-line">
              <span className="pz-knows-text">{l.text}</span>
              {canCorrect ? <button type="button" className="pz-textlink pz-knows-fix" aria-label={`${panel.correctLabel}: ${l.text}`} onClick={() => onCorrect(l.correctPrompt)}>{panel.correctLabel}</button> : null}
            </li>
          ))}
        </ul>
        <p className="pz-knows-hint">{panel.hint}</p>
      </div>
    </section>
  );
}

function RetryPanel({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="pz-retry" role="alert">
      <Icon name="alert" size={18} />
      <div className="pz-retry-body">
        <strong>{t("ws.ai.title")}</strong>
        <p>{t("ws.ai.body")}</p>
        <button type="button" className="pz-retry-btn" onClick={onRetry}>{t("ws.ai.retry")}<Icon name="arrow-right" size={16} /></button>
      </div>
    </div>
  );
}

function WaitRow({ pending }: { pending: Pending }) {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(id); }, []);
  const stage = waitStage(now - pending.startedAt);
  return (
    <div className="pz-wait" role="status" aria-live="polite" data-stage={stage}>
      <span className="pz-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{t(`ws.wait.${stage}`)}</span>
    </div>
  );
}

function Composer({ value, setValue, disabled, busy, processing, note, onSend, taRef }: { value: string; setValue: (v: string) => void; disabled: boolean; busy: boolean; processing: boolean; note: ReactNode; onSend: (text: string) => void; taRef: React.RefObject<HTMLTextAreaElement> }) {
  const { t } = useI18n();
  const submit = () => { const v = value.trim(); if (!v || busy || disabled) return; setValue(""); onSend(v); };
  useEffect(() => {
    const el = taRef.current; if (!el) return;
    el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value, taRef]);
  if (disabled) return <div className="pz-composer pz-composer-off"><p className="pz-composer-note">{note}</p></div>;
  return (
    <form className="pz-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label htmlFor="pz-msg" className="pz-sr">{t("ws.composer.label")}</label>
      <div className="pz-composer-row">
        <textarea id="pz-msg" ref={taRef} rows={1} className="pz-msg" value={value} placeholder={t("ws.composer.placeholder")} readOnly={busy}
          aria-describedby="pz-msg-hint" onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        <button type="submit" className="pz-send" disabled={!value.trim() || busy} aria-label={t("ws.composer.send")}><Icon name="arrow-right" size={18} className="pz-send-ico" /></button>
      </div>
      <p id="pz-msg-hint" className="pz-hint">{processing ? t("ws.composer.processing") : busy ? "\u00a0" : t("ws.composer.hint")}</p>
    </form>
  );
}

// ---------------------------------------------------------------- generic workspace
interface WorkspaceProps<M> {
  scope: string;
  eyebrow: string;
  title: (meta: M | null, thread: ThreadDto | null) => string;
  load: () => Promise<{ thread: ThreadDto | null; meta: M }>;
  submit: (req: Parameters<ReturnType<typeof useSession>["client"]["understandingTurn"]>[0]) => Promise<TurnResultDto>;
  onResult?: (r: TurnResultDto) => void;
  unavailable?: (meta: M) => boolean;
  /** Category glyph shown before the title (from the DTO's iconKey), when there is one. */
  icon?: (meta: M | null) => string | null;
  /** Quiet context right after the title (progress, critical items). */
  headerLead?: (ctx: { meta: M | null; progress: CategoryProgressDto | null; uState: UnderstandingState | null }) => ReactNode;
  /** Right side of the header strip (status, link to the document). */
  headerExtra?: (ctx: { meta: M | null; progress: CategoryProgressDto | null; uState: UnderstandingState | null }) => ReactNode;
  /** The eyebrow is quiet context; some surfaces would only repeat the title, so it stays for screen readers only. */
  eyebrowVisible?: boolean;
  footerPanels?: (ctx: { meta: M | null; progress: CategoryProgressDto | null; uState: UnderstandingState | null; canWrite: boolean }) => ReactNode;
  closedNote?: (ctx: { meta: M | null; uState: UnderstandingState | null }) => ReactNode;
  /** Quiet context above the conversation; `correct` puts a prepared correction in the composer. */
  topPanel?: (ctx: { meta: M | null; canWrite: boolean; correct: (prompt: string) => void }) => ReactNode;
  unavailableState?: (meta: M) => ReactNode;
}

export function Workspace<M>(p: WorkspaceProps<M>) {
  const { t } = useI18n();
  const { canWrite: accessWrite, access } = useSession();
  // The typed draft lives here, not in the composer: switching language reloads the thread and must not cost the client their words.
  const [draft, setDraft] = useState("");
  useEffect(() => { setDraft(""); }, [p.scope]);
  const th = useThread<M>({ scope: p.scope, load: p.load, submit: p.submit, onResult: p.onResult });
  const meta = th.res.data?.meta ?? null;
  const thread = th.res.data?.thread ?? null;
  const writable = accessWrite && (thread?.canWrite ?? false);
  const busy = !!th.pending && th.pending.status !== "ai_unavailable" && th.pending.status !== "error";
  const bottom = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const title = p.title(meta, thread);
  usePage(title, !!thread || !!(th.res.data && p.unavailableState?.(th.res.data.meta)));

  const last = th.turns[th.turns.length - 1];
  const optimistic: TurnDto | null = th.pending && !th.pending.serverSeen
    ? { id: `local:${th.pending.key}`, role: "client", kind: "message", text: th.pending.display, createdAt: new Date(th.pending.startedAt).toISOString() } : null;
  const all = optimistic ? [...th.turns, optimistic] : th.turns;

  useEffect(() => {
    // Not scrollIntoView: that also moves the Tab starting point, so the first Tab would land in the composer instead of "Skip to main content".
    const el = bottom.current; if (!el) return;
    const composer = ta.current?.closest("form") ?? el.closest(".pz-ws")?.querySelector(".pz-composer"); // also the closed-composer note, which is pinned too
    const limit = composer ? composer.getBoundingClientRect().top : window.innerHeight;
    const delta = el.getBoundingClientRect().bottom - limit + 16;
    if (delta <= 0) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && !(/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
    const opts: ScrollToOptions = { top: delta, behavior: reducedMotion() ? "auto" : "smooth" };
    if (scroller) scroller.scrollBy?.(opts); else window.scrollBy?.(opts);
  }, [all.length, th.pending?.status, th.blocked]);

  const lastAssistantQuick = !th.pending && writable && last?.role === "assistant" ? last.quickReplies : undefined;
  const send = (text: string, extra: { quickReply?: { value: string; intent: import("../api/dto").QuickReplyIntent }; confirm?: { token: string; intent: "confirm" | "correct" } } = {}) => {
    th.submit(text, extra);
    window.setTimeout(() => ta.current?.focus(), 0);
  };

  const correct = (prompt: string) => { setDraft(prompt); window.setTimeout(() => { const el = ta.current; if (!el) return; el.focus(); el.setSelectionRange?.(prompt.length, prompt.length); }, 0); };

  let body: ReactNode;
  if (th.res.error && !th.res.data) body = <InlineError level={2} onRetry={() => void th.res.reload()} title={t("ws.loadError.title")} body={t("ws.loadError.body")} />;
  else if (!th.res.data) body = <Skeleton lines={6} />;
  else if (p.unavailableState && p.unavailableState(th.res.data.meta)) body = p.unavailableState(th.res.data.meta);
  else body = (
    <>
      {p.topPanel?.({ meta, canWrite: writable, correct })}
      <div className="pz-thread" role="log" aria-live="polite" aria-relevant="additions" aria-label={t("ws.thread")}>
        {all.length === 0 ? <p className="pz-muted">{t("ws.empty")}</p> : null}
        {all.map((turn, i) => (
          <TurnView key={turn.id} turn={turn} last={i === all.length - 1} active={writable && !th.pending}
            saved={turn.role === "client" && i === all.length - 1 && !!th.pending && th.pending.status !== "offline"}
            notSaved={turn.role === "client" && i === all.length - 1 && th.pending?.status === "offline" && !th.pending.serverSeen}
            onConfirm={(tt, intent) => { const c = tt.confirmCard!; send(intent === "confirm" ? c.confirmLabel : c.correctLabel, { confirm: { token: c.token, intent } }); }} />
        ))}
        {th.pending?.status === "processing" ? <WaitRow pending={th.pending} /> : null}
        {th.blocked ? <div className="pz-turn pz-turn-assistant"><span className="pz-turn-who">{t("ws.assistant")}</span><p className="pz-turn-text">{t("ws.blocked")}</p></div> : null}
      </div>
      {th.pending && (th.pending.status === "ai_unavailable" || th.pending.status === "error") ? <RetryPanel onRetry={th.retry} /> : null}
      {th.orphan && !th.pending ? <RetryPanel onRetry={th.resendOrphan} /> : null}
      {lastAssistantQuick && lastAssistantQuick.length ? (
        <div className="pz-quick" role="group" aria-label={t("ws.quick")}>
          {lastAssistantQuick.map((q) => (
            <button key={q.value} type="button" className="pz-quickbtn" data-intent={q.intent} onClick={() => send(q.label, { quickReply: { value: q.value, intent: q.intent } })}>{q.label}</button>
          ))}
        </div>
      ) : null}
      {p.footerPanels?.({ meta, progress: th.progress, uState: th.uState, canWrite: writable })}
      <div ref={bottom} className="pz-bottom" aria-hidden="true" />
    </>
  );

  const readOnlyAccess = access.mode === "READ_ONLY";
  const closedNote: ReactNode = readOnlyAccess ? t("ws.composer.readOnly") : p.closedNote?.({ meta, uState: th.uState }) ?? t("ws.composer.unavailable");
  const showComposer = !!th.res.data && !(p.unavailableState && p.unavailableState(th.res.data.meta));
  const iconName = p.icon?.(meta) ?? null;
  const sideExtra = p.headerExtra?.({ meta, progress: th.progress, uState: th.uState });
  return (
    <AppShell>
      <div className="pz-ws">
        <header className="pz-wshead">
          <div className="pz-wshead-main">
            {iconName ? <Icon name={iconName} size={22} className="pz-wshead-icon" /> : null}
            <h1 className="pz-wstitle" tabIndex={-1} data-autofocus>{title}</h1>
            {p.eyebrow && p.eyebrow !== title ? <span className={p.eyebrowVisible === false ? "pz-sr" : "pz-wsmeta"}>{p.eyebrow}</span> : null}
            {p.headerLead?.({ meta, progress: th.progress, uState: th.uState })}
          </div>
          {sideExtra ? <div className="pz-wshead-side">{sideExtra}</div> : null}
        </header>
        <div className="pz-wsbody">{body}</div>
        {showComposer ? <Composer value={draft} setValue={setDraft} disabled={!writable} busy={!!th.pending} processing={busy} note={closedNote} taRef={ta} onSend={(text) => send(text)} /> : null}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------- the three surfaces
export function UnderstandingScreen() {
  const { t } = useI18n();
  const { client, refreshCenter } = useSession();
  return (
    <Workspace<null>
      scope="understanding" eyebrow={t("ws.eyebrow.understanding")} title={(_m, th) => th?.title ?? t("nav.understanding")}
      load={async () => ({ thread: await client.understanding(), meta: null })}
      submit={(r) => client.understandingTurn(r)}
      onResult={() => void refreshCenter()}
      headerExtra={({ uState }) => (uState ? <>
        <UnderstandingChip state={uState} />
        {uState === "ready_to_confirm" || uState === "confirmed" ? <Link to={{ name: "serviceMap" }} className="pz-textlink">{t("ws.header.viewMap")}<Icon name="arrow-right" size={16} /></Link> : null}
      </> : null)}
      closedNote={({ uState }) => (uState === "confirmed" ? t("ws.composer.understandingDone") : t("ws.composer.unavailable"))}
      footerPanels={({ uState }) => (uState === "ready_to_confirm" ? (
        <section className="pz-cta-panel" aria-labelledby="pz-cta-map">
          <h2 id="pz-cta-map" className="pz-cta-title">{t("ws.cta.map.title")}</h2><p>{t("ws.cta.map.body")}</p>
          <Link to={{ name: "serviceMap" }} className="pz-textlink pz-cta-link"><span>{t("ws.cta.map.button")}</span><Icon name="arrow-right" size={16} /></Link>
        </section>) : null)}
    />
  );
}

export function CategoryWorkspace({ id }: { id: string }) {
  const { t, tn } = useI18n();
  const { client, refreshCenter } = useSession();
  return (
    <Workspace<CategoryDto>
      key={id} scope={`category:${id}`} eyebrow={t("ws.eyebrow.category")} eyebrowVisible={false} title={(m) => m?.label ?? "…"}
      load={async () => { const c = await client.category(id); return { thread: c.thread, meta: c }; }}
      submit={(r) => client.categoryTurn(id, r)}
      onResult={() => void refreshCenter()}
      icon={(m) => m?.iconKey ?? null}
      topPanel={({ meta, canWrite, correct }) => (meta?.knows && meta.knows.lines.length > 0 ? <KnowsPanel panel={meta.knows} canCorrect={canWrite} onCorrect={correct} /> : null)}
      headerLead={({ meta, progress }) => {
        const pr = progress ?? meta?.progress ?? null;
        if (!meta || !pr) return null;
        return (
          <div className="pz-wsprog">
            {pr.progressPct !== null
              ? <><Meter pct={pr.progressPct} label={t("ws.progress.captured", { pct: pr.progressPct })} /><span className="pz-pct">{t("ws.progress.captured", { pct: pr.progressPct })}</span></>
              : <span className="pz-wsmeta">{t("ws.progress.none")}</span>}
            {pr.criticalOpen > 0 ? <span className="pz-crit"><span className="pz-diamond" aria-hidden="true" />{tn("center.cat.critical", pr.criticalOpen)}</span> : null}
          </div>
        );
      }}
      headerExtra={({ meta, progress }) => {
        const pr = progress ?? meta?.progress ?? null;
        if (!meta || !pr) return null;
        return (
          <>
            <CategoryStatusChip status={pr.status} sendState={meta.sendState} />
            <Link to={{ name: "crp", id }} className="pz-textlink">{t("ws.header.viewCrp")}<Icon name="arrow-right" size={16} /></Link>
          </>
        );
      }}
      closedNote={({ meta }) => (meta && (meta.status === "confirmed" || meta.status === "sent") ? <>{t("ws.composer.confirmedCategory")} <Link to={{ name: "crp", id }} className="pz-textlink">{t("ws.cta.crp.button")}</Link></> : t("ws.composer.unavailable"))}
      footerPanels={({ progress, canWrite }) => (canWrite && progress?.status === "ready_for_review" ? (
        <section className="pz-cta-panel" aria-labelledby="pz-cta-crp">
          <h2 id="pz-cta-crp" className="pz-cta-title">{t("ws.cta.crp.title")}</h2><p>{t("ws.cta.crp.body")}</p>
          <Link to={{ name: "crp", id }} className="pz-textlink pz-cta-link"><span>{t("ws.cta.crp.button")}</span><Icon name="arrow-right" size={16} /></Link>
        </section>) : null)}
    />
  );
}

export function AddServiceScreen() {
  const { t } = useI18n();
  const { client, refreshCenter } = useSession();
  return (
    <Workspace<{ available: boolean }>
      scope="add_service" eyebrow={t("ws.eyebrow.add_service")} title={() => t("nav.addService")}
      load={async () => { const a = await client.addService(); return { thread: a.thread, meta: { available: a.available } }; }}
      submit={(r) => client.addServiceTurn(r)}
      onResult={(r) => { void refreshCenter(); void r; }}
      unavailableState={(m) => (m.available ? null : <p className="pz-wsnote">{t("ws.addService.unavailable")}</p>)}
      footerPanels={({ canWrite }) => (canWrite ? (
        <p className="pz-wslink"><Link to={{ name: "serviceMap" }} className="pz-textlink">{t("ws.header.viewMap")}<Icon name="arrow-right" size={16} /></Link></p>) : null)}
    />
  );
}
