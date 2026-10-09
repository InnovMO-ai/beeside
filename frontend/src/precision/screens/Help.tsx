import { useI18n, type DictKey } from "../i18n";
import { useSession } from "../state/app";
import { useResource } from "../state/resource";
import { AppShell } from "../ui/Shell";
import { Icon } from "../ui/icons";
import { usePage } from "../ui/hooks";
import { Skeleton } from "../ui/primitives";
import { ContactForm } from "./Contact";
import { InlineError } from "./SystemPages";

const FAQ = [1, 2, 3, 4, 5, 6] as const;

export function HelpScreen() {
  const { t, locale } = useI18n();
  const { client } = useSession();
  const help = useResource(() => client.help(), [client, locale]);
  usePage(t("help.title"), true);
  return (
    <AppShell>
      <article className="pz-page pz-help">
        <header className="pz-pagehead">
          <span className="pz-eyebrow">{t("help.eyebrow")}</span>
          <h1 className="pz-h1" tabIndex={-1} data-autofocus>{t("help.title")}</h1>
          <p className="pz-lead">{t("help.lead")}</p>
        </header>
        <section className="pz-faq" aria-label={t("help.title")}>
          {FAQ.map((n) => (
            <details key={n} className="pz-faq-item">
              <summary><span>{t(`help.faq.${n}.q` as DictKey)}</span><Icon name="chevron-down" size={18} /></summary>
              <p>{t(`help.faq.${n}.a` as DictKey)}</p>
            </details>
          ))}
        </section>
        {help.data?.helpCenterUrl ? (
          <p className="pz-help-link"><a className="pz-textlink" href={help.data.helpCenterUrl}>{t("help.center.cta")}<Icon name="external" size={16} /></a></p>
        ) : null}
        <section className="pz-contact">
          <h2 className="pz-h2">{t("help.contact.title")}</h2>
          {help.loading ? <Skeleton lines={3} /> : help.error && !help.data ? <InlineError onRetry={() => void help.reload()} />
            : help.data?.contactAvailable === false ? <p className="pz-muted">{t("help.contact.unavailable")}</p> : <ContactForm />}
        </section>
      </article>
    </AppShell>
  );
}
