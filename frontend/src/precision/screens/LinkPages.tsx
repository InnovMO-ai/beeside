import { useI18n } from "../i18n";
import { BareShell } from "../ui/Shell";
import { usePage } from "../ui/hooks";
import { Button, PageState, Skeleton } from "../ui/primitives";
import { SupportLine } from "./Contact";
import type { SupportDto } from "../api/dto";

export type LinkState = "exchanging" | "missing" | "invalid" | "network";

/** Session exchange / link landing: loading, then a friendly page when the link cannot be used. Never a raw error. */
export function LinkPage({ state, onRetry, client }: { state: LinkState; onRetry: () => void; client?: { support: () => Promise<SupportDto> } }) {
  const { t } = useI18n();
  const title = state === "exchanging" ? t("link.exchanging") : t(`link.${state}.title`);
  usePage(title, true);
  return (
    <BareShell>
      {state === "exchanging" ? (
        <div className="pz-center-stage"><h1 tabIndex={-1} data-autofocus className="pz-h2">{t("link.exchanging")}</h1><Skeleton lines={2} /></div>
      ) : (
        <PageState icon={state === "network" ? "refresh" : "lock"} title={t(`link.${state}.title`)} body={t(`link.${state}.body`)}
          action={state === "network" ? <Button onClick={onRetry} icon="refresh">{t("link.retry")}</Button> : undefined} />
      )}
      {state !== "exchanging" && client ? <SupportLine client={client} /> : null}
    </BareShell>
  );
}
