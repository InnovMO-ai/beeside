import { useEffect, useRef, useState } from "react";
import type { CrpViewDto, PreviewBlockDto, PreviewDto, SendResultDto, ServiceMapViewDto } from "../api/dto";
import { ApiFailure } from "../api/transport";
import { useI18n } from "../i18n";
import { useSession } from "../state/app";
import { Link, useRouter } from "../state/router";
import { useResource } from "../state/resource";
import { DocShell } from "../ui/Shell";
import { Icon } from "../ui/icons";
import { usePage } from "../ui/hooks";
import { Banner, Button, PageState, Skeleton, StatusChip } from "../ui/primitives";
import { ContactDialog } from "./Contact";
import { CrpBody } from "./Crp";
import { ServiceMapBody } from "./ServiceMap";
import { InlineError } from "./SystemPages";

function Block({ b }: { b: PreviewBlockDto }) {
  const { t } = useI18n();
  const title = b.id === "project" || b.id === "service_map" || b.id === "crp" || b.id === "context" ? (b.title || t(`pv.block.${b.id}`)) : b.title;
  const view = b.view;
  return (
    <section className="pz-pvblock" aria-label={title}>
      <h2 className="pz-h3">{title}</h2>
      {b.lines.length ? <ul className="pz-bullets">{b.lines.map((l) => <li key={l}>{l}</li>)}</ul> : null}
      {view && "groups" in view ? <ServiceMapBody view={view as ServiceMapViewDto} compact /> : null}
      {view && "sections" in view ? <CrpBody view={view as CrpViewDto} compact /> : null}
    </section>
  );
}

type FailAction = NonNullable<SendResultDto["clientAction"]>;

export function PreviewScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { client, canWrite, access, refreshCenter, noteAccessFailure } = useSession();
  const { navigate } = useRouter();
  const res = useResource(() => client.preview(id), [client, id]);
  const [sending, setSending] = useState(false);
  const [stale, setStale] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [failed, setFailed] = useState<FailAction | null>(null);
  const [contact, setContact] = useState(false);
  const [long, setLong] = useState(false);
  const lock = useRef(false);
  const failedRef = useRef<HTMLElement | null>(null);
  // A failure appears below the fold on a phone (the action bar is sticky): bring it into view so it is never missed.
  useEffect(() => { if (failed) failedRef.current?.scrollIntoView?.({ block: "center" }); }, [failed]);
  const p: PreviewDto | null = res.data;
  usePage(t("pv.eyebrow"), !!p || !!res.error);

  const serverSending = p?.sendState === "sending";
  // While the server is sending, poll its state; never claim Sent until it says so.
  useEffect(() => {
    if (!serverSending) { setLong(false); return; }
    const started = Date.now();
    let n = 0;
    const tick = () => { n++; setLong(Date.now() - started > 15000); void res.reload(); timer = window.setTimeout(tick, Math.min(1500 + n * 500, 5000)); };
    let timer = window.setTimeout(tick, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSending]);
  useEffect(() => {
    if (p?.sendState === "sent") { void refreshCenter(); navigate({ name: "sent", id }, { replace: true }); }
    // A failure found on load (reload, another tab) keeps the server's own category: a non-retryable one never offers "Try again".
    if (p?.sendState === "failed" && failed === null) setFailed(p.clientAction ?? (p.retryable === false ? "needs_attention" : "try_again_later"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.sendState]);

  const send = async () => {
    if (!p || lock.current) return;           // duplicate-click protection; the server also treats the same checksum as one send
    lock.current = true; setSending(true); setStale(false); setSendError(false); setFailed(null);
    try {
      const r = await client.send(id, { previewChecksum: p.previewChecksum });
      if (r.state === "sent") { void refreshCenter(); navigate({ name: "sent", id }, { replace: true }); return; }
      if (r.state === "failed" || r.state === "blocked") { setFailed(r.clientAction ?? "try_again_later"); void res.reload(); return; }
      await res.reload();                       // sending: the poll above takes over
    } catch (e) {
      const f = e instanceof ApiFailure ? e : null;
      if (f?.code === "PREVIEW_STALE") { setStale(true); await res.reload(); }
      else if (f?.code === "ACTIVATION_PENDING_RETRY_FIRST") setFailed("first_send_required");
      else if (f?.code === "PRECISION_READ_ONLY" || f?.code === "PRECISION_REVOKED") { noteAccessFailure(f); await res.reload(); }
      else if (f?.code === "NOT_READY") await res.reload();
      else setSendError(true);
    } finally { lock.current = false; setSending(false); }
  };

  let content;
  if (res.loading) content = <Skeleton lines={9} />;
  else if (res.error?.code === "NOT_READY") content = <PageState icon="doc" title={t("pv.eyebrow")} body={t("pv.notReady")} action={<Link to={{ name: "crp", id }} className="pz-btn pz-btn-primary"><span>{t("pv.back")}</span></Link>} />;
  else if (!p) content = <InlineError onRetry={() => void res.reload()} />;
  else {
    const busy = sending || serverSending;
    content = (
      <article className="pz-doc" aria-labelledby="pz-doc-h">
        <header className="pz-dochead">
          <span className="pz-eyebrow">{t("pv.eyebrow")}</span>
          <h1 id="pz-doc-h" className="pz-h1" tabIndex={-1} data-autofocus>{t("pv.title")}</h1>
          <p className="pz-lead">{t("pv.body")}</p>
          {p.firstSend ? <p className="pz-note">{t("pv.first")}</p> : null}
        </header>
        {stale ? <Banner tone="warn" role="alert" title={t("pv.stale.title")}>{t("pv.stale.body")}</Banner> : null}
        {sendError ? <Banner tone="warn" role="alert">{t("pv.sendError")}</Banner> : null}
        {failed ? (
          <section className="pz-failed" role="alert" aria-labelledby="pz-failed-h" ref={failedRef}>
            <Icon name="alert" size={24} />
            <div>
              <h2 id="pz-failed-h" className="pz-h3">{t("failed.title")}</h2>
              <p>{t(`failed.body.${failed}`)}</p>
              <div className="pz-failed-actions">
                {failed === "try_again_later" && p.canSend ? <Button icon="refresh" busy={sending} onClick={() => void send()}>{t("failed.retry")}</Button> : null}
                {failed === "first_send_required" ? <Link to={{ name: "center" }} className="pz-btn pz-btn-primary"><span>{t("failed.toCenter")}</span></Link> : null}
                <Button variant="secondary" onClick={() => setContact(true)}>{t("failed.contact")}</Button>
              </div>
            </div>
          </section>
        ) : null}
        {serverSending ? <Banner tone="info" role="status" title={t("pv.status.sending")}>{long ? t("pv.sendingLong") : undefined}</Banner> : null}
        {p.blocks.map((b) => <Block key={b.id} b={b} />)}
        {p.notSent.length ? (
          <section className="pz-pvblock pz-notsent" aria-label={t("pv.notSent.title")}>
            <h2 className="pz-h3">{t("pv.notSent.title")}</h2>
            <ul className="pz-bullets">{p.notSent.map((n) => <li key={n}>{n}</li>)}</ul>
          </section>
        ) : null}
        {access.mode === "READ_ONLY" ? <p className="pz-note pz-docnote">{t("pv.readOnly")}</p> : null}
        {!p.canSend && !serverSending && access.mode === "FULL" && !failed ? <p className="pz-note pz-docnote">{t("pv.cannotSend")}</p> : null}
        <footer className="pz-actionbar">
          <Link to={{ name: "crp", id }} className="pz-btn pz-btn-secondary"><span>{t("pv.back")}</span></Link>
          {canWrite ? <Button iconAfter="send" busy={busy} disabled={!p.canSend || busy} onClick={() => void send()}>{busy ? t("pv.sending") : t("pv.send")}</Button> : null}
        </footer>
      </article>
    );
  }
  return (
    <DocShell back={{ name: "crp", id }} backLabel={t("pv.back")}>
      {content}
      {contact ? <ContactDialog title={t("failed.contact")} onClose={() => setContact(false)} /> : null}
    </DocShell>
  );
}

export function SentScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { center } = useSession();
  const { navigate } = useRouter();
  const c = center.data;
  const card = c?.categories.find((k) => k.id === id);
  usePage(t("sent.title"), !!c);
  useEffect(() => { if (c && card && card.sendState !== "sent") navigate({ name: "preview", id }, { replace: true }); }, [c, card, id, navigate]);
  const oh = c?.operationHub;
  const [sherpa, setSherpa] = useState(false);
  return (
    <DocShell back={{ name: "center" }} backLabel={t("shell.backToCenter")}>
      {!c ? <Skeleton lines={5} /> : (
        <section className="pz-doc pz-sent" aria-labelledby="pz-doc-h">
          <span className="pz-sent-mark"><Icon name="check" size={30} /></span>
          <span className="pz-eyebrow">{t("sent.eyebrow")}</span>
          <h1 id="pz-doc-h" className="pz-h1" tabIndex={-1} data-autofocus>{t("sent.title")}</h1>
          {card ? <p><StatusChip icon="s-sent" tone="sent">{card.label}</StatusChip></p> : null}
          <p className="pz-lead">{t("sent.body")}</p>
          {oh && oh.state !== "hidden" ? (
            <div className="pz-note" role="status">{oh.state === "pending_access" ? t("sent.pending") : t("sent.enter")}</div>
          ) : null}
          <p className="pz-muted">{t("sent.update")}</p>
          <div className="pz-actionbar pz-actionbar-flat">
            <Link to={{ name: "center" }} className="pz-btn pz-btn-primary"><span>{t("sent.toCenter")}</span><Icon name="arrow-right" size={18} /></Link>
            {oh?.state === "enter" && oh.url ? <a className="pz-btn pz-btn-secondary" href={oh.url}><span>{t("center.oh.go")}</span><Icon name="external" size={18} /></a> : null}
            {oh?.contactSherpa ? <Button variant="secondary" onClick={() => setSherpa(true)}>{t("center.oh.contactSherpa")}</Button> : null}
            <Link to={{ name: "crp", id }} className="pz-btn pz-btn-quiet"><span>{t("ws.cta.crp.button")}</span></Link>
          </div>
        </section>
      )}
      {sherpa ? <ContactDialog title={t("center.oh.contactSherpa")} onClose={() => setSherpa(false)} /> : null}
    </DocShell>
  );
}
