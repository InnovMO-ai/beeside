import { useState } from "react";
import type { EntryDto } from "../api/dto";
import { useI18n, type DictKey } from "../i18n";
import { useSession } from "../state/app";
import { useRouter } from "../state/router";
import { BareShell } from "../ui/Shell";
import { usePage } from "../ui/hooks";
import { Button } from "../ui/primitives";

/** The four stages of the journey, named as everywhere else in the product. */
const STEPS: DictKey[] = ["nav.understanding", "nav.serviceMap", "center.cat.title", "center.oh.title"];

/** Calm, neutral wash used whenever there is no approved destination photograph: soft sky tones and a few very light shapes. No place or imagery cues. */
function NeutralWash() {
  return (
    <div className="pz-cover-wash" aria-hidden="true">
      <span className="pz-wash-a" /><span className="pz-wash-b" /><span className="pz-wash-c" />
    </div>
  );
}

export function CoverScreen({ entry }: { entry: EntryDto }) {
  const { t } = useI18n();
  const { client } = useSession();
  const { navigate } = useRouter();
  const [busy, setBusy] = useState(false);
  usePage(t("cover.title"), true);
  const cover = entry.cover;
  const dest = cover?.destinations ?? [];
  const photo = cover && cover.composition !== "neutral" && cover.image ? cover.image : null;
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try { await client.coverSeen(); } catch { /* marking the cover as seen never blocks access */ }
    navigate({ name: "center" });
  };
  return (
    <BareShell tone="cover">
      <div className="pz-cover-bg" data-photo={photo ? "true" : "false"}>
        {photo ? <img src={photo.url} alt={photo.altText} style={{ objectPosition: `${Math.round(photo.focal.x * 100)}% ${Math.round(photo.focal.y * 100)}%` }} /> : <NeutralWash />}
      </div>
      <section className="pz-cover">
        <div className="pz-cover-copy">
          <span className="pz-eyebrow">{t("cover.eyebrow")}</span>
          <h1 className="pz-cover-title" tabIndex={-1} data-autofocus>{t("cover.title")}</h1>
          <p className="pz-cover-body">{t("cover.body")}</p>
          {dest.length ? (
            <p className="pz-cover-dest"><span className="pz-eyebrow">{t("cover.destination")}</span>
              <span className="pz-cover-dest-list">{dest.map((d) => <span key={d.code}>{d.label}</span>)}</span></p>
          ) : null}
          <Button iconAfter="arrow-right" busy={busy} onClick={go} className="pz-cta-lg">{t("cover.continue")}</Button>
        </div>
        <section className="pz-process" aria-labelledby="pz-process-h">
          <h2 id="pz-process-h" className="pz-process-title">{t("center.journey")}</h2>
          <ol className="pz-process-list">
            {STEPS.map((k, i) => (
              <li key={k} className="pz-process-step" data-first={i === 0 ? "true" : undefined}>
                <span className="pz-process-row"><span className="pz-process-n" aria-hidden="true">{i + 1}</span><span className="pz-process-line" aria-hidden="true" /></span>
                <span className="pz-process-name"><span className="pz-sr">{t("center.step", { n: i + 1 })}. </span>{t(k)}</span>
              </li>
            ))}
          </ol>
        </section>
      </section>
    </BareShell>
  );
}
