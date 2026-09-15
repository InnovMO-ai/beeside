import { Db } from "../db/database";
import { recordJourneyEvent } from "../fa/services/analytics";
import { FaError } from "../fa/services/errors";
import { FaDeps, localeOf } from "../fa/services/repository";

/**
 * Post-Snapshot feedback (Phase 12). The question and its 1–5 scale are frozen; the respondent may
 * add an optional comment. Feedback is offered only once the Snapshot exists and is accepted once
 * per project. The comment is stored only here: analytics receive the rating and whether a comment
 * was given, never its text.
 */

export const FEEDBACK_QUESTION_VERSION = "snapshot-feedback-v1";
export const FEEDBACK_COMMENT_MAX = 2000;
export type FeedbackChannel = "session" | "private_link";

export const FEEDBACK_COPY = {
  en: {
    question: "How useful was this experience in helping you think more clearly about your project?",
    scale_min: "Not useful",
    scale_max: "Very useful",
    comment_label: "Anything you'd like us to know?",
    optional: "Optional",
    submit: "Send feedback",
    thanks: "Thank you for your feedback.",
    rating_required: "Please choose a rating from 1 to 5.",
    error: "We couldn't save your feedback. Please try again.",
  },
  es: {
    question: "¿Qué tan útil fue esta experiencia para ayudarte a pensar con más claridad sobre tu proyecto?",
    scale_min: "Nada útil",
    scale_max: "Muy útil",
    comment_label: "¿Hay algo que quieras contarnos?",
    optional: "Opcional",
    submit: "Enviar comentarios",
    thanks: "Gracias por tus comentarios.",
    rating_required: "Elige una calificación del 1 al 5.",
    error: "No pudimos guardar tus comentarios. Inténtalo de nuevo.",
  },
} as const;

export interface FeedbackStatus {
  available: boolean;
  submitted: boolean;
  questionVersion: string;
  copy: typeof FEEDBACK_COPY;
}

export interface FeedbackInput {
  usefulness: number;
  comment: string | null;
}

export async function feedbackStatus(db: Db, projectId: string): Promise<FeedbackStatus> {
  const { rows } = await db.query<{ ready: boolean; submitted: boolean }>(
    `SELECT (p.assessment_state = 'COMPLETED_LOCKED' AND EXISTS (SELECT 1 FROM snapshot s WHERE s.project_id = p.project_id)) AS ready,
            EXISTS (SELECT 1 FROM snapshot_feedback f WHERE f.project_id = p.project_id) AS submitted
       FROM project p WHERE p.project_id = $1`,
    [projectId],
  );
  const row = rows[0];
  return { available: row?.ready === true, submitted: row?.submitted === true, questionVersion: FEEDBACK_QUESTION_VERSION, copy: FEEDBACK_COPY };
}

export function parseFeedbackInput(body: unknown): FeedbackInput {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const usefulness = b.usefulness;
  if (typeof usefulness !== "number" || !Number.isInteger(usefulness) || usefulness < 1 || usefulness > 5) {
    throw new FaError("INVALID_INPUT", "usefulness must be an integer from 1 to 5", { fields: ["usefulness"] });
  }
  let comment: string | null = null;
  if (b.comment !== undefined && b.comment !== null) {
    if (typeof b.comment !== "string") throw new FaError("INVALID_INPUT", "comment must be text", { fields: ["comment"] });
    // Control and formatting characters are removed (line breaks are kept) before storing the text.
    const cleaned = b.comment.replace(/[\p{Cc}\p{Cf}]/gu, (character) => (character === "\n" ? character : "")).trim();
    if (cleaned.length > FEEDBACK_COMMENT_MAX) throw new FaError("INVALID_INPUT", `comment must be at most ${FEEDBACK_COMMENT_MAX} characters`, { fields: ["comment"] });
    comment = cleaned === "" ? null : cleaned;
  }
  return { usefulness, comment };
}

export async function submitFeedback(deps: FaDeps, projectId: string, input: FeedbackInput, channel: FeedbackChannel): Promise<FeedbackStatus> {
  const now = deps.config.now();
  await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ interface_language: string }>(
      `SELECT pe.interface_language FROM project p JOIN person pe ON pe.person_id = p.created_by_person_id
        WHERE p.project_id = $1 FOR SHARE OF p`,
      [projectId],
    );
    const status = await feedbackStatus(tx, projectId);
    if (!rows[0] || !status.available) throw new FaError("NOT_APPLICABLE", "feedback is available once the Snapshot is ready");
    const language = localeOf(rows[0].interface_language);
    const inserted = await tx.query(
      `INSERT INTO snapshot_feedback (project_id, question_version, usefulness, comment, channel, interface_language, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id) DO NOTHING RETURNING feedback_id`,
      [projectId, FEEDBACK_QUESTION_VERSION, input.usefulness, input.comment, channel, language, now],
    );
    if (inserted.rows.length === 0) throw new FaError("ALREADY_SUBMITTED", "feedback was already received for this project");
    await recordJourneyEvent(tx, {
      eventType: "feedback_submitted",
      projectId,
      interfaceLanguage: language,
      properties: { usefulness: input.usefulness, comment_provided: input.comment !== null, channel },
    });
  });
  return feedbackStatus(deps.db, projectId);
}
