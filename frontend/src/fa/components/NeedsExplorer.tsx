import { T } from "../copy";
import { NEEDS_EXPLORER_TAXONOMY, needsLeafLabel } from "../needs-explorer-taxonomy";
import { Locale, NeedsMapDependency, NeedsMapStatus, NeedsMapValue, NEEDS_MAP_LIMITS, NEEDS_MAP_STATUSES } from "../types";

interface NeedsExplorerProps {
  locale: Locale;
  t: T;
  value: unknown;
  onChange: (value: NeedsMapValue) => void;
}

const EMPTY: NeedsMapValue = { selections: [], priorityRank: [], dependencies: [], blockerKeys: [] };

function asValue(value: unknown): NeedsMapValue {
  if (!value || typeof value !== "object") return EMPTY;
  const v = value as Partial<NeedsMapValue>;
  return {
    selections: Array.isArray(v.selections) ? v.selections : [],
    priorityRank: Array.isArray(v.priorityRank) ? v.priorityRank : [],
    dependencies: Array.isArray(v.dependencies) ? v.dependencies : [],
    blockerKeys: Array.isArray(v.blockerKeys) ? v.blockerKeys : [],
  };
}

const STATUS_COPY_KEY: Record<NeedsMapStatus, string> = {
  covered_internally: "needs_status_covered_internally",
  covered_by_provider: "needs_status_covered_by_provider",
  in_progress: "needs_status_in_progress",
  needs_resolution: "needs_status_needs_resolution",
  needs_confirmation: "needs_status_needs_confirmation",
};

/**
 * The Needs Explorer / PriorityRanker / DependencyMap flow as one continuous composition (Design
 * Specification, composition 5). Category selection and status are independent facts — selecting a
 * leaf is never itself a purchase signal (governing principle, needs-explorer-taxonomy.ts). Client
 * priority (`priorityRank`) and dependency-derived order (`dependencies`) are always shown and
 * edited separately, never silently reconciled with each other.
 *
 * Simplified from the full spec for this pass: reordering uses up/down buttons rather than drag-and-
 * drop (keyboard- and screen-reader-friendly by construction, at some cost to how "effortless" it
 * feels) and dependency-cycle prevention is server-side only (values.ts) — an invalid cycle surfaces
 * as the existing generic save-error message rather than being blocked inline before saving.
 */
export function NeedsExplorer({ locale, t, value, onChange }: NeedsExplorerProps) {
  const current = asValue(value);
  const selectedByKey = new Map(current.selections.map((s) => [s.key, s]));
  const atSelectionLimit = current.selections.length >= NEEDS_MAP_LIMITS.maxSelections;
  const atRankLimit = current.priorityRank.length >= NEEDS_MAP_LIMITS.maxPriorityRank;

  const commit = (next: NeedsMapValue) => onChange(next);

  const toggleLeaf = (key: string, checked: boolean) => {
    if (checked) {
      if (atSelectionLimit) return;
      commit({ ...current, selections: [...current.selections, { key, status: "needs_confirmation" }] });
    } else {
      commit({
        ...current,
        selections: current.selections.filter((s) => s.key !== key),
        priorityRank: current.priorityRank.filter((k) => k !== key),
        dependencies: current.dependencies.filter((d) => d.key !== key && d.dependsOn !== key),
        blockerKeys: current.blockerKeys.filter((k) => k !== key),
      });
    }
  };

  const setStatus = (key: string, status: NeedsMapStatus) => {
    commit({ ...current, selections: current.selections.map((s) => (s.key === key ? { ...s, status } : s)) });
  };

  const toggleRanked = (key: string, ranked: boolean) => {
    if (ranked) {
      if (atRankLimit) return;
      commit({ ...current, priorityRank: [...current.priorityRank, key] });
    } else {
      commit({
        ...current,
        priorityRank: current.priorityRank.filter((k) => k !== key),
        dependencies: current.dependencies.filter((d) => d.key !== key),
        blockerKeys: current.blockerKeys.filter((k) => k !== key),
      });
    }
  };

  const move = (key: string, direction: -1 | 1) => {
    const index = current.priorityRank.indexOf(key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.priorityRank.length) return;
    const next = [...current.priorityRank];
    [next[index], next[target]] = [next[target], next[index]];
    commit({ ...current, priorityRank: next });
  };

  const toggleBlocker = (key: string, checked: boolean) => {
    commit({ ...current, blockerKeys: checked ? [...current.blockerKeys, key] : current.blockerKeys.filter((k) => k !== key) });
  };

  const updateDependency = (key: string, patch: Partial<NeedsMapDependency>) => {
    const existing = current.dependencies.find((d) => d.key === key);
    const base: NeedsMapDependency = existing ?? { key, dependsOn: null, owner: null, approvalRequired: false, approvalFrom: null };
    const next = { ...base, ...patch };
    commit({ ...current, dependencies: current.dependencies.filter((d) => d.key !== key).concat([next]) });
  };

  return (
    <div className="needs-explorer">
      <p className="helper">{t("level2", "needs_explorer_intro")}</p>
      {atSelectionLimit && <p className="helper">{t("level2", "needs_limit_reached").replace("{{max}}", String(NEEDS_MAP_LIMITS.maxSelections))}</p>}

      {NEEDS_EXPLORER_TAXONOMY.map((group) => (
        <fieldset key={group.key} className="needs-group" style={{ marginTop: "1.25rem" }}>
          <legend style={{ fontWeight: 600 }}>{group.label[locale] ?? group.label.en}</legend>
          <div className="options">
            {group.leaves.map((leaf) => {
              const selection = selectedByKey.get(leaf.key);
              const isSelected = !!selection;
              return (
                <div key={leaf.key}>
                  <label className="option" data-selected={isSelected}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!isSelected && atSelectionLimit}
                      onChange={(e) => toggleLeaf(leaf.key, e.target.checked)}
                    />
                    <span>{leaf.label[locale] ?? leaf.label.en}</span>
                  </label>
                  {selection && (
                    <div className="field" style={{ margin: "0.4rem 0 0.75rem var(--indent)" }}>
                      <label htmlFor={`status-${leaf.key}`} style={{ fontWeight: 400 }}>
                        {t("level2", "needs_status_label")}
                      </label>
                      <select
                        id={`status-${leaf.key}`}
                        className="select"
                        value={selection.status}
                        onChange={(e) => setStatus(leaf.key, e.target.value as NeedsMapStatus)}
                      >
                        {NEEDS_MAP_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {t("level2", STATUS_COPY_KEY[status])}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      {current.selections.length > 0 && (
        <div className="needs-priority" style={{ marginTop: "2rem" }}>
          <h2 className="question-title" style={{ fontSize: "1.1rem" }}>
            {t("level2", "priority_rank_title")}
          </h2>
          <p className="helper">{t("level2", "priority_rank_intro")}</p>
          <ul className="chips" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
            {current.priorityRank.map((key, index) => (
              <li key={key} className="chip" style={{ justifyContent: "space-between" }}>
                <span>
                  {index + 1}. {needsLeafLabel(key, locale)}
                </span>
                <span style={{ display: "flex", gap: "0.35rem" }}>
                  <button type="button" aria-label={t("level2", "priority_move_up")} onClick={() => move(key, -1)} disabled={index === 0}>
                    ↑
                  </button>
                  <button type="button" aria-label={t("level2", "priority_move_down")} onClick={() => move(key, 1)} disabled={index === current.priorityRank.length - 1}>
                    ↓
                  </button>
                  <button type="button" aria-label={t("level2", "priority_remove_from_rank")} onClick={() => toggleRanked(key, false)}>
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="options" style={{ marginTop: "0.75rem" }}>
            {current.selections
              .filter((s) => !current.priorityRank.includes(s.key))
              .map((s) => (
                <button key={s.key} type="button" className="button button-text" disabled={atRankLimit} onClick={() => toggleRanked(s.key, true)}>
                  + {needsLeafLabel(s.key, locale)}
                </button>
              ))}
          </div>
        </div>
      )}

      {current.priorityRank.length > 0 && (
        <div className="needs-blockers" style={{ marginTop: "2rem" }}>
          <h2 className="question-title" style={{ fontSize: "1.1rem" }}>
            {t("level2", "blockers_title")}
          </h2>
          <p className="helper">{t("level2", "blockers_helper")}</p>
          <div className="options">
            {current.priorityRank.map((key) => (
              <label key={key} className="option" data-selected={current.blockerKeys.includes(key)}>
                <input type="checkbox" checked={current.blockerKeys.includes(key)} onChange={(e) => toggleBlocker(key, e.target.checked)} />
                <span>{needsLeafLabel(key, locale)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {current.priorityRank.length > 1 && (
        <div className="needs-dependencies" style={{ marginTop: "2rem" }}>
          <h2 className="question-title" style={{ fontSize: "1.1rem" }}>
            {t("level2", "dependencies_title")}
          </h2>
          <p className="helper">{t("level2", "dependencies_helper")}</p>
          {current.priorityRank.map((key) => {
            const dep = current.dependencies.find((d) => d.key === key);
            return (
              <div key={key} className="needs-dependency-row" style={{ margin: "1rem 0", paddingLeft: "0.25rem" }}>
                <p style={{ fontWeight: 500, margin: "0 0 0.4rem" }}>{needsLeafLabel(key, locale)}</p>
                <div className="field">
                  <label htmlFor={`dep-${key}`} style={{ fontWeight: 400 }}>
                    {t("level2", "dependency_depends_on")}
                  </label>
                  <select id={`dep-${key}`} className="select" value={dep?.dependsOn ?? ""} onChange={(e) => updateDependency(key, { dependsOn: e.target.value || null })}>
                    <option value="">{t("level2", "dependency_none")}</option>
                    {current.priorityRank
                      .filter((k) => k !== key)
                      .map((k) => (
                        <option key={k} value={k}>
                          {needsLeafLabel(k, locale)}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="two-col" style={{ marginTop: "0.5rem" }}>
                  <div className="field">
                    <label htmlFor={`owner-${key}`}>{t("level2", "dependency_owner")}</label>
                    <input
                      id={`owner-${key}`}
                      className="input"
                      type="text"
                      placeholder={t("level2", "dependency_owner_placeholder")}
                      value={dep?.owner ?? ""}
                      onChange={(e) => updateDependency(key, { owner: e.target.value.trim() === "" ? null : e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label className="option" data-selected={dep?.approvalRequired === true} style={{ marginTop: "1.6rem" }}>
                      <input type="checkbox" checked={dep?.approvalRequired === true} onChange={(e) => updateDependency(key, { approvalRequired: e.target.checked })} />
                      <span>{t("level2", "dependency_approval_required")}</span>
                    </label>
                  </div>
                </div>
                {dep?.approvalRequired && (
                  <div className="field" style={{ marginTop: "0.5rem" }}>
                    <label htmlFor={`approval-${key}`}>{t("level2", "dependency_approval_from")}</label>
                    <input
                      id={`approval-${key}`}
                      className="input"
                      type="text"
                      value={dep?.approvalFrom ?? ""}
                      onChange={(e) => updateDependency(key, { approvalFrom: e.target.value.trim() === "" ? null : e.target.value })}
                    />
                  </div>
                )}
              </div>
            );
          })}
          <p className="helper">{t("level2", "needs_context_note")}</p>
        </div>
      )}
    </div>
  );
}
