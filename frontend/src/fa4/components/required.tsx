import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';

/** What the screen knows after «Continue» was pressed with required inputs missing: which ones, and the message to show next to each. */
export interface ReqState { show: boolean; missing: ReadonlySet<string>; message: string }
export const ReqContext = createContext<ReqState>({ show: false, missing: new Set(), message: '' });
export interface ReqMark { k: string; label: string }

const FIELDS = 'input:not([type=hidden]),textarea,select,button';
const INVALIDABLE = 'input:not([type=hidden]):not([type=checkbox]),textarea,select,[role=radiogroup],[role=radio]';

/**
 * Marks ONE required block (a question). Nothing changes visually until «Continue» is pressed with that block incomplete; then it shows the message right under
 * the block, flags its controls as invalid (aria-invalid) and links them to the message (aria-describedby). `data-req` / `data-req-label` let the screen
 * find the first missing block and list what is missing. Controls built on <fieldset> carry the mark themselves (no extra wrapper: the layout rules that look at
 * sibling position, e.g. fieldset:first-of-type, must keep seeing the same structure).
 */
export function useReqBlock<E extends HTMLElement>(mark?: ReqMark) {
  const { show, missing, message } = useContext(ReqContext); const bad = !!mark && show && missing.has(mark.k);
  const ref = useRef<E>(null); const mid = useId();
  useEffect(() => {
    const root = ref.current; if (!root || !bad) return;
    const els = [...root.querySelectorAll<HTMLElement>(INVALIDABLE)];
    const prev = els.map((e) => e.getAttribute('aria-describedby'));
    els.forEach((e) => { e.setAttribute('aria-invalid', 'true'); e.setAttribute('aria-describedby', [e.getAttribute('aria-describedby'), mid].filter(Boolean).join(' ')); });
    return () => els.forEach((e, i) => { e.removeAttribute('aria-invalid'); if (prev[i]) e.setAttribute('aria-describedby', prev[i]!); else e.removeAttribute('aria-describedby'); });
  }, [bad, mid]);
  return {
    ref, bad,
    attrs: mark ? { 'data-req': mark.k, 'data-req-label': mark.label, 'data-req-bad': bad ? 'true' : undefined, className: bad ? 'req-bad' : undefined } : {},
    msg: bad ? <p id={mid} className="req-msg">{message}</p> : null,
  };
}

export function Req({ k, label, children }: { k: string; label: string; children: ReactNode }) {
  const r = useReqBlock<HTMLDivElement>({ k, label });
  return <div ref={r.ref} {...r.attrs}>{children}{r.msg}</div>;
}

/** Focus target for a missing block: its first form control (or the block itself). */
export function focusBlock(el: HTMLElement) {
  const target = el.querySelector<HTMLElement>(FIELDS) ?? el;
  if (target === el) el.tabIndex = -1;
  target.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: 'center', behavior: 'auto' });
}
