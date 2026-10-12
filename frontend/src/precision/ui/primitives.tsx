import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { CategoryStatus, ItemState, SendStateDto, UnderstandingState } from "../api/dto";
import { useI18n } from "../i18n";
import { Icon } from "./icons";

type Variant = "primary" | "secondary" | "quiet" | "danger";
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; busy?: boolean; icon?: string; iconAfter?: string; block?: boolean }
export function Button({ variant = "primary", busy, icon, iconAfter, block, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button type="button" {...rest} disabled={disabled || busy} aria-busy={busy || undefined} className={`pz-btn pz-btn-${variant} ${block ? "pz-block" : ""} ${className ?? ""}`}>
      {icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
      {busy ? <span className="pz-spinner" aria-hidden="true" /> : iconAfter ? <Icon name={iconAfter} size={18} /> : null}
    </button>
  );
}

/** A status is always icon + text; colour only reinforces it. */
export function StatusChip({ icon, tone, children, title }: { icon: string; tone: string; children: ReactNode; title?: string }) {
  return <span className="pz-chip" data-tone={tone} title={title}><Icon name={icon} size={16} /><span>{children}</span></span>;
}

const CAT_SHAPES: Record<CategoryStatus, [string, string]> = {
  not_started: ["s-empty", "neutral"], in_progress: ["s-half", "active"], ready_for_review: ["s-review", "review"], confirmed: ["s-done", "ok"], sent: ["s-sent", "sent"],
};
export function CategoryStatusChip({ status, sendState }: { status: CategoryStatus; sendState?: SendStateDto }) {
  const { t } = useI18n();
  if (status === "confirmed" && sendState === "sending") return <StatusChip icon="s-pending" tone="pending">{t("status.sending")}</StatusChip>;
  if (status === "confirmed" && sendState === "failed") return <StatusChip icon="s-pending" tone="pending">{t("status.sendFailed")}</StatusChip>;
  const [icon, tone] = CAT_SHAPES[status];
  return <StatusChip icon={icon} tone={tone}>{t(`status.${status}`)}</StatusChip>;
}
/** Plain status line (glyph + text, no pill): used where a list row carries the state, e.g. the Center category table. */
export function StatusText({ icon, tone, children }: { icon: string; tone: string; children: ReactNode }) {
  return <span className="pz-st" data-tone={tone}><Icon name={icon} size={14} /><span>{children}</span></span>;
}
const CAT_TEXT: Record<CategoryStatus, [string, string]> = {
  not_started: ["s-empty", "neutral"], in_progress: ["s-half", "neutral"], ready_for_review: ["s-review", "ok"], confirmed: ["s-done", "ok"], sent: ["s-sent", "ok"],
};
export function CategoryStatusText({ status, sendState }: { status: CategoryStatus; sendState?: SendStateDto }) {
  const { t } = useI18n();
  if (status === "confirmed" && sendState === "sending") return <StatusText icon="s-pending" tone="attention">{t("status.sending")}</StatusText>;
  if (status === "confirmed" && sendState === "failed") return <StatusText icon="s-pending" tone="attention">{t("status.sendFailed")}</StatusText>;
  const [icon, tone] = CAT_TEXT[status];
  return <StatusText icon={icon} tone={tone}>{t(`status.${status}`)}</StatusText>;
}
const U_SHAPES: Record<UnderstandingState, [string, string]> = { not_started: ["s-empty", "neutral"], in_progress: ["s-half", "active"], ready_to_confirm: ["s-review", "review"], confirmed: ["s-done", "ok"] };
export function UnderstandingChip({ state }: { state: UnderstandingState }) {
  const { t } = useI18n();
  const [icon, tone] = U_SHAPES[state];
  return <StatusChip icon={icon} tone={tone}>{t(`ustate.${state}`)}</StatusChip>;
}
const I_SHAPES: Record<ItemState, [string, string]> = { confirmed: ["s-done", "ok"], assumed: ["s-assumed", "assumed"], pending: ["s-pending", "pending"], not_applicable: ["s-na", "neutral"] };
export function ItemStateChip({ state }: { state: ItemState }) {
  const { t } = useI18n();
  const [icon, tone] = I_SHAPES[state];
  return <StatusChip icon={icon} tone={tone}>{t(`item.${state}`)}</StatusChip>;
}

export function Meter({ pct, label }: { pct: number | null; label: string }) {
  const v = pct ?? 0;
  return (
    <div className="pz-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

export function Banner({ tone = "info", title, children, action, role }: { tone?: "info" | "note" | "warn" | "ok"; title?: string; children?: ReactNode; action?: ReactNode; role?: "status" | "alert" }) {
  return (
    <div className="pz-banner" data-tone={tone} role={role}>
      <Icon name={tone === "warn" ? "alert" : tone === "ok" ? "check" : "info"} size={20} />
      <div className="pz-banner-body">{title ? <strong>{title}</strong> : null}{children ? <p>{children}</p> : null}</div>
      {action ? <div className="pz-banner-action">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ lines = 3, label }: { lines?: number; label?: string }) {
  const { t } = useI18n();
  return (
    <div className="pz-skeleton" role="status" aria-live="polite" aria-label={label ?? t("shell.loading")}>
      {Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${88 - ((i * 17) % 40)}%` }} />)}
    </div>
  );
}

/** Accessible modal: focus moves in, Tab is trapped, Escape closes, focus returns to the opener. */
export function Dialog({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current!;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>("button, a[href], textarea, input, [tabindex]:not([tabindex='-1'])")).filter((n) => !n.hasAttribute("disabled"));
    (focusables()[0] ?? node).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    node.addEventListener("keydown", onKey);
    return () => { node.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [onClose]);
  return (
    <div className="pz-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pz-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <h2 id={titleId}>{title}</h2>
        <div className="pz-dialog-body">{children}</div>
        <div className="pz-dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

export function PageState({ title, body, action, icon = "info" }: { title: string; body?: string; action?: ReactNode; icon?: string }) {
  return (
    <section className="pz-pagestate">
      <span className="pz-pagestate-icon"><Icon name={icon} size={28} /></span>
      <h1 tabIndex={-1} data-autofocus>{title}</h1>
      {body ? <p>{body}</p> : null}
      {action ? <div className="pz-pagestate-action">{action}</div> : null}
    </section>
  );
}
