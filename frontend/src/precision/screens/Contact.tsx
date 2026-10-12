import { useI18n } from "../i18n";
import { useSession } from "../state/app";
import { useResource } from "../state/resource";
import { Dialog, Button, Skeleton } from "../ui/primitives";
import { Icon } from "../ui/icons";

/**
 * Contact beeside = one e-mail address, always from configuration (never typed in a component). It reaches the interface
 * through the API (`contactEmail` in Help, `support` on pre-session pages); a missing address is shown as unavailable,
 * never as a dead link. No response time and no notification is promised.
 */
export function MailAction({ email, className }: { email: string; className?: string }) {
  const { t } = useI18n();
  return (
    <a className={`pz-btn pz-btn-secondary ${className ?? ""}`} href={`mailto:${email}`}>
      <Icon name="mail" size={18} />
      <span>{t("contact.email.cta")}</span>
    </a>
  );
}

/** The address itself (selectable text, also a mailto link) plus the action. */
export function ContactPanel({ email }: { email: string | null }) {
  const { t } = useI18n();
  if (!email) return <p className="pz-muted">{t("help.contact.unavailable")}</p>;
  return (
    <div className="pz-mailbox">
      <p className="pz-lead-sm">{t("contact.email.lead")}</p>
      <p className="pz-mailaddr"><a className="pz-textlink" href={`mailto:${email}`}>{email}</a></p>
      <MailAction email={email} />
    </div>
  );
}

/** Pre-session and error pages: the address is read from the public support endpoint; nothing is shown until it is known. */
export function SupportLine({ client }: { client: { support: () => Promise<{ email: string | null }> } }) {
  const { t, locale } = useI18n();
  const support = useResource(() => client.support(), [client, locale]);
  const email = support.data?.email ?? null;
  if (!email) return null;
  return (
    <p className="pz-supportline">{t("contact.email.line")} <a className="pz-textlink" href={`mailto:${email}`}>{email}</a></p>
  );
}

export function ContactDialog({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useI18n();
  const { client } = useSession();
  const help = useResource(() => client.help(), [client]);
  return (
    <Dialog title={title} onClose={onClose} actions={<Button variant="quiet" onClick={onClose}>{t("shell.close")}</Button>}>
      {help.loading ? <Skeleton lines={2} /> : <ContactPanel email={help.data?.contactEmail ?? null} />}
    </Dialog>
  );
}
