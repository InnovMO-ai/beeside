import { useEffect, useState } from "react";
import { ExpansionSnapshot } from "../components/ExpansionSnapshot";
import { FeedbackSource, SnapshotFeedback } from "../components/SnapshotFeedback";
import { PremiumSource, PremiumTransition } from "../components/PremiumTransition";
import { T } from "../copy";
import { Bundle, Locale, SnapshotView } from "../types";
import { Completion } from "./SimpleScreens";

interface SnapshotScreenProps {
  bundle: Bundle;
  t: T;
  locale: Locale;
  load: () => Promise<SnapshotView>;
  /** Called once with the deliverable language chosen by the respondent. */
  onLocale: (locale: Locale) => void;
  anotherProjectInMind: boolean;
  onStartAnother?: () => Promise<void>;
  /** Phase 9: the post-Snapshot Premium transition for this same project. */
  premium?: PremiumSource;
  /** Phase 12: the post-Snapshot feedback question, always after the Snapshot itself. */
  feedback?: FeedbackSource;
}

/** Loads the immutable Snapshot and shows it in the respondent's deliverable language first. */
export function SnapshotScreen({ bundle, t, locale, load, onLocale, anotherProjectInMind, onStartAnother, premium, feedback }: SnapshotScreenProps) {
  const [snapshot, setSnapshot] = useState<SnapshotView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    load()
      .then((result) => {
        if (!active) return;
        setSnapshot(result);
        onLocale(result.content.deliverable_locale);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <p className="content" role="alert">
        {t("common", "generic_error")}
      </p>
    );
  }
  if (!snapshot) {
    return (
      <p className="content" role="status">
        {t("common", "loading")}
      </p>
    );
  }
  return (
    <>
      <ExpansionSnapshot snapshot={snapshot} locale={locale} />
      {premium && <PremiumTransition locale={locale} source={premium} />}
      {feedback && <SnapshotFeedback locale={locale} source={feedback} />}
      {anotherProjectInMind && onStartAnother && <Completion bundle={bundle} t={t} anotherProjectInMind onStartAnother={onStartAnother} intro={false} />}
    </>
  );
}
