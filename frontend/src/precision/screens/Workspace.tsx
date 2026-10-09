import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CategoryDto, CategoryProgressDto, ThreadDto, TurnDto, TurnResultDto, UnderstandingState } from "../api/dto";
import { useI18n } from "../i18n";
import { useSession } from "../state/app";
import { Link } from "../state/router";
import { useThread, waitStage, type Pending } from "../state/thread";
import { AppShell } from "../ui/Shell";
import { Icon } from "../ui/icons";
import { reducedMotion, usePage } from "../ui/hooks";
import { Button, CategoryStatusChip, Meter, Skeleton, UnderstandingChip } from "../ui/primitives";
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
          <Button onClick={() => onAnswer("confirm")} icon="check">{c.confirmLabel}</Button>
          <Button variant="secondary" onClick={() => onAnswer("correct")}>{c.correctLabel}</Button>
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
        <div className="pz-bubble"><span className="pz-sr">{t("ws.you")}: </span>{turn.text}</div>
        {notSaved ? <span className="pz-turn-meta pz-turn-warn"><Icon name="alert" size={14} />{t("ws.notSaved")}</span>
          : saved ? <span className="pz-turn-meta"><Icon name="check" size={14} />{t("shell.saved")}</span> : null}
      </div>
    );
  }
  return (
    <div className="pz-turn pz-turn-assistant" data-turn-id={turn.id} data-kind={turn.kind}>
      <span className="pz-turn-who">{t("ws.assistant")}</span>
      <p className="pz-turn-text">{turn.text}</p>
      {turn.confirmCard ? <ConfirmCard turn={turn} active={active && last} onAnswer={(i) => onConfirm(turn, i)} /> : null}
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

function Composer({ disabled, busy, processing, note, onSend, taRef }: { disabled: boolean; busy: boolean; processing: boolean; note: ReactNode; onSend: (text: string) => void; taRef: React.RefObject<HTMLTextAreaElement> }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
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
        <Button type="submit" disabled={!value.trim() || busy} aria-label={t("ws.composer.send")} icon="send" className="pz-send">{t("ws.composer.send")}</Button>
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
  headerExtra?: (ctx: { meta: M | null; progress: CategoryProgressDto | null; uState: UnderstandingState | null }) => ReactNode;
  footerPanels?: (ctx: { meta: M | null; progress: CategoryProgressDto | null; uState: UnderstandingState | null; canWrite: boolean }) => ReactNode;
  closedNote?: (ctx: { meta: M | null; uState: UnderstandingState | null }) => ReactNode;
  unavailableState?: (meta: M) => ReactNode;
}

export function Workspace<M>(p: WorkspaceProps<M>) {
  const { t } = useI18n();
  const { canWrite: accessWrite, access } = useSession();
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
    const composer = ta.current?.closest("form");
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

  let body: ReactNode;
  if (th.res.error && !th.res.data) body = <InlineError onRetry={() => void th.res.reload()} title={t("ws.loadError.title")} body={t("ws.loadError.body")} />;
  else if (!th.res.data) body = <Skeleton lines={6} />;
  else if (p.unavailableState && p.unavailableState(th.res.data.meta)) body = p.unavailableState(th.res.data.meta);
  else body = (
    <>
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
      {th.pending && (th.pending.status === "ai_unavailable" || th.pending.status === "error") ? (
        <div className="pz-retry" role="alert">
          <Icon name="alert" size={20} />
          <div><strong>{t("ws.ai.title")}</strong><p>{t("ws.ai.body")}</p></div>
          <Button variant="secondary" icon="refresh" onClick={th.retry}>{t("ws.ai.retry")}</Button>
        </div>
      ) : null}
      {th.orphan && !th.pending ? (
        <div className="pz-retry" role="alert">
          <Icon name="alert" size={20} />
          <div><strong>{t("ws.ai.title")}</strong><p>{t("ws.ai.body")}</p></div>
          <Button variant="secondary" icon="refresh" onClick={th.resendOrphan}>{t("ws.ai.retry")}</Button>
        </div>
      ) : null}
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
  return (
    <AppShell>
      <div className="pz-ws">
        <header className="pz-wshead">
          <div className="pz-wshead-main">
            <span className="pz-eyebrow">{p.eyebrow}</span>
            <h1 className="pz-h2" tabIndex={-1} data-autofocus>{title}</h1>
          </div>
          {p.headerExtra?.({ meta, progress: th.progress, uState: th.uState })}
        </header>
        <div className="pz-wsbody">{body}</div>
        {showComposer ? <Composer disabled={!writable} busy={!!th.pending} processing={busy} note={closedNote} taRef={ta} onSend={(text) => send(text)} /> : null}
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
      headerExtra={({ uState }) => (uState ? <div className="pz-wshead-side"><UnderstandingChip state={uState} />
        {uState === "ready_to_confirm" || uState === "confirmed" ? <Link to={{ name: "serviceMap" }} className="pz-textlink">{t("ws.header.viewMap")}<Icon name="arrow-right" size={16} /></Link> : null}</div> : null)}
      closedNote={({ uState }) => (uState === "confirmed" ? t("ws.composer.understandingDone") : t("ws.composer.unavailable"))}
      footerPanels={({ uState }) => (uState === "ready_to_confirm" ? (
        <section className="pz-cta-panel" aria-labelledby="pz-cta-map">
          <h2 id="pz-cta-map" className="pz-h3">{t("ws.cta.map.title")}</h2><p>{t("ws.cta.map.body")}</p>
          <Link to={{ name: "serviceMap" }} className="pz-btn pz-btn-primary"><span>{t("ws.cta.map.button")}</span><Icon name="arrow-right" size={18} /></Link>
        </section>) : null)}
    />
  );
}

export function CategoryWorkspace({ id }: { id: string }) {
  const { t } = useI18n();
  const { client, refreshCenter } = useSession();
  return (
    <Workspace<CategoryDto>
      key={id} scope={`category:${id}`} eyebrow={t("ws.eyebrow.category")} title={(m) => m?.label ?? "…"}
      load={async () => { const c = await client.category(id); return { thread: c.thread, meta: c }; }}
      submit={(r) => client.categoryTurn(id, r)}
      onResult={() => void refreshCenter()}
      headerExtra={({ meta, progress }) => {
        const pr = progress ?? meta?.progress ?? null;
        if (!meta || !pr) return null;
        return (
          <div className="pz-wshead-side pz-wshead-cat">
            <div className="pz-progress">
              {pr.progressPct !== null ? <><Meter pct={pr.progressPct} label={t("ws.progress.captured", { pct: pr.progressPct })} /><span className="pz-pct">{t("ws.progress.captured", { pct: pr.progressPct })}</span></> : <span className="pz-muted">{t("ws.progress.none")}</span>}
              <CategoryStatusChip status={pr.status} sendState={meta.sendState} />
            </div>
            <Link to={{ name: "crp", id }} className="pz-textlink">{t("ws.header.viewCrp")}<Icon name="arrow-right" size={16} /></Link>
          </div>
        );
      }}
      closedNote={({ meta }) => (meta && (meta.status === "confirmed" || meta.status === "sent") ? <>{t("ws.composer.confirmedCategory")} <Link to={{ name: "crp", id }} className="pz-textlink">{t("ws.cta.crp.button")}</Link></> : t("ws.composer.unavailable"))}
      footerPanels={({ progress, canWrite }) => (canWrite && progress?.status === "ready_for_review" ? (
        <section className="pz-cta-panel" aria-labelledby="pz-cta-crp">
          <h2 id="pz-cta-crp" className="pz-h3">{t("ws.cta.crp.title")}</h2><p>{t("ws.cta.crp.body")}</p>
          <Link to={{ name: "crp", id }} className="pz-btn pz-btn-primary"><span>{t("ws.cta.crp.button")}</span><Icon name="arrow-right" size={18} /></Link>
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
      unavailableState={(m) => (m.available ? null : <p className="pz-muted pz-note-line">{t("ws.addService.unavailable")}</p>)}
      footerPanels={({ canWrite }) => (canWrite ? (
        <p className="pz-hint pz-hint-link"><Link to={{ name: "serviceMap" }} className="pz-textlink">{t("ws.header.viewMap")}<Icon name="arrow-right" size={16} /></Link></p>) : null)}
    />
  );
}
