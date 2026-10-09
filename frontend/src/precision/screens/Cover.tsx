import { useState } from "react";
import type { EntryDto } from "../api/dto";
import { useI18n } from "../i18n";
import { useSession } from "../state/app";
import { useRouter } from "../state/router";
import { BareShell } from "../ui/Shell";
import { usePage } from "../ui/hooks";
import { Button } from "../ui/primitives";

/** Meridians and orbits: a neutral brand composition that implies no place, used whenever there is no approved photograph. */
function NeutralArt() {
  const radii = [90, 150, 215, 285, 360, 440, 525];
  return (
    <svg className="pz-cover-art" viewBox="0 0 600 760" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width="600" height="760" fill="var(--pz-cover-bg)" />
      <g fill="none" stroke="var(--pz-cover-line)" strokeWidth="1.2">
        {radii.map((r, i) => <circle key={r} cx="470" cy="560" r={r} opacity={0.18 + i * 0.07} />)}
        <path d="M470 560L-40 120M470 560L120 -40M470 560L640 -40M470 560L-40 420" opacity=".22" />
        <path d="M140 560a330 330 0 0 1 330-330" stroke="var(--pz-cover-accent)" strokeWidth="2.4" opacity=".95" />
      </g>
      <circle cx="470" cy="230" r="7" fill="var(--pz-cover-dot)" />
      <circle cx="470" cy="230" r="16" fill="none" stroke="var(--pz-cover-dot)" strokeWidth="1.2" opacity=".6" />
    </svg>
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
        <div className="pz-cover-visual">
          {photo ? <img src={photo.url} alt={photo.altText} style={{ objectPosition: `${Math.round(photo.focal.x * 100)}% ${Math.round(photo.focal.y * 100)}%` }} /> : <NeutralArt />}
        </div>
      </section>
    </BareShell>
  );
}
