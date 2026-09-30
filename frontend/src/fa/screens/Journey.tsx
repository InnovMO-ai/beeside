import { FormEvent, MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { track } from "../analytics";
import { api, ApiError } from "../api";
import { saveWithRetry, SaveStatus } from "../autosave";
import { ChangeMode, QuestionField } from "../components/QuestionField";
import { GroupedComposition } from "../components/GroupedComposition";
import { ReviewRecap } from "../components/ReviewRecap";
import { T } from "../copy";
import { Bundle, Locale, SessionView, StageId } from "../types";
import { isAnswered } from "../values";

interface JourneyProps {
  bundle: Bundle;
  t: T;
  locale: Locale;
  view: SessionView;
  countries: string[];
  flushRef: MutableRefObject<(() => Promise<void>) | null>;
  onView: (view: SessionView) => void;
  onSaveStatus: (status: SaveStatus) => void;
  onStageChange: (stage: StageId | null) => void;
  onCompleted: (view: SessionView) => void;
  onSessionLost: (error: ApiError) => void;
}

interface Position {
  stepId: string;
  questionIndex: number;
}

const TEXT_DEBOUNCE_MS = 800;

function initialPosition(view: SessionView): Position {
  const applicable = view.steps.filter((s) => s.applicable);
  const step = applicable.find((s) => s.id === view.currentStepId) ?? applicable[0];
  const firstOpen = step.questionIds.findIndex((id) => !isAnswered(view.answers[id]));
  return { stepId: step.id, questionIndex: Math.max(firstOpen, 0) };
}

function isSessionLoss(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 401 || error.status === 410);
}

/**
 * The assessment journey, autosaved as the client answers. Applicability is always the server's
 * (recomputed on every save), so branching and invalidation stay deterministic. Level 2 MVP: a step
 * with `layout: "grouped"` renders every one of its applicable questions on one screen at once
 * (GroupedComposition) instead of one question per screen; a `kind: "review"` step renders a
 * read-only recap of everything answered so far (ReviewRecap). Both are additive — a step with
 * neither still renders exactly as the original one-question-per-screen Journey always has.
 */
export function Journey({ bundle, t, locale, view, countries, flushRef, onView, onSaveStatus, onStageChange, onCompleted, onSessionLost }: JourneyProps) {
  const [position, setPosition] = useState<Position>(() => initialPosition(view));
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [requiredError, setRequiredError] = useState(false);
  const [missingIds, setMissingIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const viewRef = useRef(view);
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const stepStartedAt = useRef(Date.now());
  // Set when a step is entered via an Edit link from Review (see ReviewRecap below); when the
  // edited step's Continue completes successfully, we return straight to Review instead of
  // advancing to the next step in the normal sequence (Design Freeze: "edit block -> save ->
  // automatically return to Review").
  const returnToReviewRef = useRef<string | null>(null);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const acceptView = (next: SessionView) => {
    viewRef.current = next;
    onView(next);
  };

  const enqueueSave = (questionId: string, value: unknown) => {
    queue.current = queue.current.then(async () => {
      onSaveStatus("saving");
      const result = await saveWithRetry(() => api.saveAnswer(questionId, value), { onRetry: () => onSaveStatus("retrying") });
      if (result.ok) {
        acceptView(result.value);
        onSaveStatus("saved");
        return;
      }
      if (isSessionLoss(result.error)) return onSessionLost(result.error);
      onSaveStatus("failed");
      track({ type: "save_failed", questionId, properties: { attempts: result.attempts } });
    });
    return queue.current;
  };

  const flush = useCallback(async () => {
    for (const [, entry] of [...pending.current]) {
      clearTimeout(entry.timer);
      entry.commit();
    }
    await queue.current;
  }, []);

  useEffect(() => {
    flushRef.current = flush;
    return () => {
      flushRef.current = null;
    };
  }, [flush, flushRef]);

  const applicableSteps = view.steps.filter((s) => s.applicable);
  const stepState = applicableSteps.find((s) => s.id === position.stepId) ?? applicableSteps.find((s) => s.id === view.currentStepId) ?? applicableSteps[0];
  const stepDef = bundle.steps.find((s) => s.id === stepState.id);
  const isGrouped = stepDef?.layout === "grouped";
  const isReview = stepDef?.kind === "review";
  const questionIds = stepState.questionIds;
  const questionIndex = Math.min(position.questionIndex, Math.max(questionIds.length - 1, 0));
  const questionId = !isGrouped && stepDef?.kind === "questions" ? questionIds[questionIndex] : undefined;
  const question = questionId ? bundle.questions.find((q) => q.id === questionId) : undefined;
  const stepPosition = applicableSteps.findIndex((s) => s.id === stepState.id);
  const canGoBack = (!isGrouped && questionIndex > 0) || stepPosition > 0;
  const currentValue = (id: string) => (id in drafts ? drafts[id] : view.answers[id]);
  const resolveFieldValue = (fieldKey: string) => {
    const q = bundle.questions.find((x) => x.field_key === fieldKey);
    return q ? currentValue(q.id) : undefined;
  };

  useEffect(() => {
    onStageChange(stepDef?.stage ?? null);
  }, [stepDef?.stage, onStageChange]);

  // Each new screen starts at the top, with focus on its heading for keyboard and screen-reader users.
  const headingRef = useRef<HTMLDivElement>(null);
  const firstScreen = useRef(true);
  useEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    headingRef.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    if (!/jsdom/i.test(navigator.userAgent)) window.scrollTo(0, 0);
  }, [stepState.id, questionId]);

  // Refs survive React's development double-invocation of effects, so each view is counted once.
  const lastViewed = useRef({ step: "", question: "" });
  useEffect(() => {
    if (lastViewed.current.step === stepState.id) return;
    lastViewed.current.step = stepState.id;
    track({ type: "step_viewed", stepId: stepState.id, interfaceLanguage: locale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepState.id]);

  useEffect(() => {
    // Grouped/review steps don't have a single "the" question on screen — skip per-question tracking.
    if (isGrouped || isReview || !questionId || lastViewed.current.question === questionId) return;
    lastViewed.current.question = questionId;
    track({ type: "question_viewed", stepId: stepState.id, questionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, isGrouped, isReview]);

  const go = (next: Position) => {
    if (next.stepId !== stepState.id) stepStartedAt.current = Date.now();
    setRequiredError(false);
    setMissingIds(new Set());
    setFailure(false);
    setPosition(next);
  };

  const handleChange = (id: string, required: boolean, value: unknown, mode: ChangeMode) => {
    setDrafts((d) => ({ ...d, [id]: value }));
    setRequiredError(false);
    setMissingIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    const normalized = typeof value === "string" && value.trim() === "" ? null : value;
    const previous = pending.current.get(id);
    if (previous) clearTimeout(previous.timer);
    pending.current.delete(id);
    const commit = () => {
      pending.current.delete(id);
      // A required answer cannot be cleared on the server; the empty draft still blocks Continue.
      if (normalized === null && required) return;
      void enqueueSave(id, normalized);
    };
    if (mode === "now") commit();
    else pending.current.set(id, { timer: setTimeout(commit, TEXT_DEBOUNCE_MS), commit });
  };

  async function next(event: FormEvent) {
    event.preventDefault();
    setFailure(false);
    setBusy(true);
    try {
      await flush();
      const latest = viewRef.current;
      const step = latest.steps.find((s) => s.id === stepState.id);
      if (!step || !step.applicable) {
        returnToReviewRef.current = null;
        go(initialPosition(latest));
        return;
      }
      const ids = step.questionIds;

      if (isGrouped) {
        const missing = ids.filter((qid) => {
          const q = bundle.questions.find((x) => x.id === qid);
          return q?.required && !isAnswered(qid in drafts ? drafts[qid] : latest.answers[qid]);
        });
        if (missing.length > 0) {
          setMissingIds(new Set(missing));
          setRequiredError(true);
          document.querySelector<HTMLElement>(`[data-question-id="${missing[0]}"] h2`)?.focus({ preventScroll: false });
          return;
        }
      } else if (stepDef?.kind === "questions") {
        const index = Math.min(questionIndex, Math.max(ids.length - 1, 0));
        const id = ids[index];
        if (id) {
          const q = bundle.questions.find((x) => x.id === id);
          if (q?.required && !isAnswered(id in drafts ? drafts[id] : latest.answers[id])) {
            setRequiredError(true);
            return;
          }
          if (index < ids.length - 1) {
            go({ stepId: step.id, questionIndex: index + 1 });
            return;
          }
        }
      }

      const result = await saveWithRetry(() => api.completeStep(step.id, Date.now() - stepStartedAt.current));
      if (!result.ok) {
        if (isSessionLoss(result.error)) return onSessionLost(result.error);
        const missing = result.error instanceof ApiError ? result.error.details?.missing : undefined;
        if (Array.isArray(missing) && missing.length > 0) {
          if (isGrouped) {
            setMissingIds(new Set(missing));
            setRequiredError(true);
            return;
          }
          const target = ids.findIndex((qid) => missing.includes(qid) || missing.includes(bundle.questions.find((x) => x.id === qid)?.field_key));
          go({ stepId: step.id, questionIndex: Math.max(target, 0) });
          setRequiredError(true);
          return;
        }
        if (result.error instanceof ApiError && result.error.code === "INCOMPLETE") {
          go(initialPosition(latest));
          return;
        }
        setFailure(true);
        return;
      }
      acceptView(result.value);
      if (result.value.status === "COMPLETED_LOCKED") {
        onCompleted(result.value);
        return;
      }
      if (returnToReviewRef.current) {
        const reviewStepId = returnToReviewRef.current;
        returnToReviewRef.current = null;
        go({ stepId: reviewStepId, questionIndex: 0 });
        return;
      }
      const order = result.value.steps.filter((s) => s.applicable);
      const following = order[order.findIndex((s) => s.id === step.id) + 1];
      if (following) go({ stepId: following.id, questionIndex: 0 });
    } finally {
      setBusy(false);
    }
  }

  async function back() {
    await flush();
    returnToReviewRef.current = null;
    if (!isGrouped && questionIndex > 0) {
      go({ stepId: stepState.id, questionIndex: questionIndex - 1 });
      return;
    }
    const order = viewRef.current.steps.filter((s) => s.applicable);
    const previous = order[order.findIndex((s) => s.id === stepState.id) - 1];
    if (!previous) return;
    track({ type: "step_back_navigated", stepId: previous.id });
    go({ stepId: previous.id, questionIndex: Math.max(previous.questionIds.length - 1, 0) });
  }

  if (!stepDef) return null;
  const stepCopy = stepDef.copy[locale] ?? stepDef.copy.en;

  return (
    <form className="content" onSubmit={next} noValidate>
      <div ref={headingRef} className="screen-heading">
        {isReview ? (
          <>
            <h1 className="step-title" tabIndex={-1} style={{ outline: "none" }}>
              {stepCopy.title}
            </h1>
            {stepCopy.intro && <p className="lead">{stepCopy.intro}</p>}
            <ReviewRecap bundle={bundle} locale={locale} t={t} view={view} currentValue={currentValue} onEditStep={(stepId) => { returnToReviewRef.current = stepState.id; go({ stepId, questionIndex: 0 }); }} />
          </>
        ) : isGrouped ? (
          <GroupedComposition
            bundle={bundle}
            questionIds={questionIds}
            locale={locale}
            t={t}
            countries={countries}
            view={view}
            currentValue={currentValue}
            resolveFieldValue={resolveFieldValue}
            missingIds={missingIds}
            onChange={handleChange}
            stepTitle={stepCopy.title}
            stepIntro={stepCopy.intro}
            noteFieldId={stepDef.note_field_id}
          />
        ) : stepDef.kind === "transition" || !question ? (
          <h1 className="transition-line" tabIndex={-1} style={{ outline: "none" }}>
            {stepCopy.title}
          </h1>
        ) : (
          <>
            <p className="step-title">{stepCopy.title}</p>
            {stepCopy.intro && questionIndex === 0 && <p className="lead">{stepCopy.intro}</p>}
            <QuestionField
              key={question.id}
              bundle={bundle}
              question={question}
              locale={locale}
              t={t}
              value={currentValue(question.id)}
              dynamicOptions={view.dynamicOptions[question.id]}
              countries={countries}
              showRequiredError={requiredError}
              onChange={(value, mode) => handleChange(question.id, question.required, value, mode)}
              resolveFieldValue={resolveFieldValue}
            />
          </>
        )}
      </div>
      {failure && (
        <p className="field-error" role="alert">
          {t("common", "generic_error")}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {isReview ? t("level2", "review_confirm") : t("common", "continue")}
        </button>
        {canGoBack && (
          <button type="button" className="button button-text" onClick={() => void back()} disabled={busy}>
            {t("common", "back")}
          </button>
        )}
      </div>
    </form>
  );
}
