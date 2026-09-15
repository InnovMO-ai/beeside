import { FormEvent, MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { track } from "../analytics";
import { api, ApiError } from "../api";
import { saveWithRetry, SaveStatus } from "../autosave";
import { ChangeMode, QuestionField } from "../components/QuestionField";
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
 * The assessment journey: one question per screen, autosaved as the client answers. Applicability
 * is always the server's (recomputed on every save), so branching and invalidation stay deterministic.
 */
export function Journey({ bundle, t, locale, view, countries, flushRef, onView, onSaveStatus, onStageChange, onCompleted, onSessionLost }: JourneyProps) {
  const [position, setPosition] = useState<Position>(() => initialPosition(view));
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [requiredError, setRequiredError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const viewRef = useRef(view);
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const stepStartedAt = useRef(Date.now());

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
  const questionIds = stepState.questionIds;
  const questionIndex = Math.min(position.questionIndex, Math.max(questionIds.length - 1, 0));
  const questionId = stepDef?.kind === "questions" ? questionIds[questionIndex] : undefined;
  const question = questionId ? bundle.questions.find((q) => q.id === questionId) : undefined;
  const stepPosition = applicableSteps.findIndex((s) => s.id === stepState.id);
  const canGoBack = questionIndex > 0 || stepPosition > 0;
  const currentValue = (id: string) => (id in drafts ? drafts[id] : view.answers[id]);

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
    if (!questionId || lastViewed.current.question === questionId) return;
    lastViewed.current.question = questionId;
    track({ type: "question_viewed", stepId: stepState.id, questionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  const go = (next: Position) => {
    if (next.stepId !== stepState.id) stepStartedAt.current = Date.now();
    setRequiredError(false);
    setFailure(false);
    setPosition(next);
  };

  const handleChange = (id: string, required: boolean, value: unknown, mode: ChangeMode) => {
    setDrafts((d) => ({ ...d, [id]: value }));
    setRequiredError(false);
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
        go(initialPosition(latest));
        return;
      }
      const ids = step.questionIds;
      const index = Math.min(questionIndex, Math.max(ids.length - 1, 0));
      const id = stepDef?.kind === "questions" ? ids[index] : undefined;
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

      const result = await saveWithRetry(() => api.completeStep(step.id, Date.now() - stepStartedAt.current));
      if (!result.ok) {
        if (isSessionLoss(result.error)) return onSessionLost(result.error);
        const missing = result.error instanceof ApiError ? result.error.details?.missing : undefined;
        if (Array.isArray(missing) && missing.length > 0) {
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
      const order = result.value.steps.filter((s) => s.applicable);
      const following = order[order.findIndex((s) => s.id === step.id) + 1];
      if (following) go({ stepId: following.id, questionIndex: 0 });
    } finally {
      setBusy(false);
    }
  }

  async function back() {
    await flush();
    if (questionIndex > 0) {
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
      {stepDef.kind === "transition" || !question ? (
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
          {t("common", "continue")}
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
