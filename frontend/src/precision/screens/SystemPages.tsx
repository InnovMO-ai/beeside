import { useI18n } from "../i18n";
import { Link } from "../state/router";
import { BareShell } from "../ui/Shell";
import { usePage } from "../ui/hooks";
import { Button, PageState } from "../ui/primitives";

export function RevokedPage() {
  const { t } = useI18n();
  usePage(t("revoked.title"), true);
  return <BareShell><PageState icon="lock" title={t("revoked.title")} body={t("revoked.body")} /></BareShell>;
}
export function NotFoundPage() {
  const { t } = useI18n();
  usePage(t("notfound.title"), true);
  return (
    <BareShell>
      <PageState icon="search" title={t("notfound.title")} body={t("notfound.body")}
        action={<Link to={{ name: "center" }} className="pz-btn pz-btn-primary"><span>{t("shell.backToCenter")}</span></Link>} />
    </BareShell>
  );
}
export function LoadErrorPage({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  usePage(t("error.title"), true);
  return <BareShell><PageState icon="alert" title={t("error.title")} body={t("error.body")} action={<Button icon="refresh" onClick={onRetry}>{t("error.retry")}</Button>} /></BareShell>;
}
/** In-layout error for one screen (the shell stays). */
export function InlineError({ onRetry, title, body }: { onRetry: () => void; title?: string; body?: string }) {
  const { t } = useI18n();
  return <PageState icon="alert" title={title ?? t("error.title")} body={body ?? t("error.body")} action={<Button icon="refresh" onClick={onRetry}>{t("error.retry")}</Button>} />;
}
