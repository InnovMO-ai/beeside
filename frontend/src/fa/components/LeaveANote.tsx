import { useState } from "react";
import { T } from "../copy";
import { ChangeMode } from "./QuestionField";

interface LeaveANoteProps {
  value: unknown;
  t: T;
  onChange: (value: string, mode: ChangeMode) => void;
}

/**
 * "Leave a note" affordance (Design Freeze, PRE-SNAPSHOT scope item 5): a small collapsed post-it
 * in the corner of a grouped composition screen, expanding into a plain optional textarea. The
 * underlying question is an ordinary optional `text` question (see StepDef.note_field_id /
 * question-bank-v2-1.ts's SECTION_NOTE_QUESTIONS) — this component only changes where it renders
 * relative to the section's own questions, never how the answer is saved or validated.
 */
export function LeaveANote({ value, t, onChange }: LeaveANoteProps) {
  const [open, setOpen] = useState(false);
  const text = typeof value === "string" ? value : "";
  const hasNote = text.trim().length > 0;

  if (!open) {
    return (
      <button type="button" className={`note-tab${hasNote ? " note-tab-filled" : ""}`} onClick={() => setOpen(true)}>
        {t("level2", hasNote ? "note_tab_filled" : "note_tab_empty")}
      </button>
    );
  }

  return (
    <div className="note-panel">
      <div className="note-panel-header">
        <span className="note-panel-title">{t("level2", "note_tab_empty")}</span>
        <button type="button" className="note-panel-close" aria-label={t("level2", "note_close")} onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      <textarea
        className="note-textarea"
        rows={4}
        placeholder={t("level2", "note_placeholder")}
        value={text}
        onChange={(event) => onChange(event.target.value, "debounced")}
      />
    </div>
  );
}
