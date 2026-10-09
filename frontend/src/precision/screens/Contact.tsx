import { useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { failureKey, useSession } from "../state/app";
import { ApiFailure } from "../api/transport";
import { Banner, Button, Dialog } from "../ui/primitives";

const MAX = 2000;

export function ContactForm({ onSent, autoFocus }: { onSent?: () => void; autoFocus?: boolean }) {
  const { t } = useI18n();
  const { client, noteAccessFailure } = useSession();
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    if (!text.trim()) { setProblem(t("help.contact.empty")); ref.current?.focus(); return; }
    if (text.length > MAX) { setProblem(t("help.contact.tooLong")); ref.current?.focus(); return; }
    setProblem(null); setState("sending");
    try { await client.contact({ message: text.trim() }); setState("sent"); setText(""); onSent?.(); }
    catch (err) {
      const f = err instanceof ApiFailure ? err : null;
      if (f) noteAccessFailure(f);
      setProblem(f ? t(failureKey(f)) : t("error.generic")); setState("error");
    }
  };
  if (state === "sent") return <Banner tone="ok" role="status">{t("help.contact.sent")}</Banner>;
  return (
    <form className="pz-form" onSubmit={submit} noValidate>
      <label htmlFor={id} className="pz-label">{t("help.contact.label")}</label>
      <textarea id={id} ref={ref} className="pz-textarea" rows={5} value={text} maxLength={MAX + 200} autoFocus={autoFocus}
        aria-invalid={problem ? true : undefined} aria-describedby={problem ? `${id}-e` : undefined} onChange={(e) => setText(e.target.value)} />
      {problem ? <p id={`${id}-e`} className="pz-field-error" role="alert">{problem}</p> : null}
      <div className="pz-form-actions"><Button type="submit" busy={state === "sending"} icon="send">{t("help.contact.send")}</Button></div>
    </form>
  );
}

export function ContactDialog({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog title={title} onClose={onClose} actions={<Button variant="quiet" onClick={onClose}>{t("shell.close")}</Button>}>
      <ContactForm autoFocus />
    </Dialog>
  );
}
