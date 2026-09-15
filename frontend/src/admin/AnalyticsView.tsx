import { ReactNode, useEffect, useState } from "react";
import { AdminApiError, adminApi } from "./api";

/**
 * Analytics (Build Plan v1.1 Phase 12) — the operational view of the First Assessment journey:
 * funnel, journey health, friction, user feedback and operational metrics. Not corporate business
 * intelligence: every number is an aggregate, small segments are suppressed by the API, and no
 * answer content, name, email or company appears here.
 */

type Json = Record<string, unknown>;
type Tab = "funnel" | "journey-health" | "friction" | "feedback" | "operations";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "funnel", label: "Funnel" },
  { id: "journey-health", label: "Journey health" },
  { id: "friction", label: "Friction" },
  { id: "feedback", label: "User feedback" },
  { id: "operations", label: "Operational metrics" },
];

const SEGMENT_FIELDS: Array<{ name: string; label: string }> = [
  { name: "primaryGoal", label: "Primary goal" },
  { name: "entryMode", label: "Entry mode" },
  { name: "businessType", label: "Business type" },
  { name: "destinationStatus", label: "Market definition" },
  { name: "market", label: "Destination market" },
  { name: "capability", label: "Expected capability" },
];

const num = (value: unknown): string => (value === null || value === undefined ? "—" : typeof value === "number" ? String(value) : String(value));
const pct = (value: unknown): string => (typeof value === "number" ? `${Math.round(value * 1000) / 10}%` : "—");
const when = (value: unknown): string => (typeof value === "string" ? value.slice(0, 16).replace("T", " ") : "—");

function Rows({ title, columns, rows }: { title: string; columns: Array<{ label: string; render: (row: Json) => ReactNode }>; rows: Json[] }) {
  return (
    <div className="admin-card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="helper">Nothing to show for this range.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>{columns.map((c) => <th key={c.label} scope="col">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>{columns.map((c) => <td key={c.label}>{c.render(row)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metrics({ title, items }: { title: string; items: Array<[string, ReactNode]> }) {
  return (
    <div className="admin-card">
      <h2>{title}</h2>
      <dl className="admin-kv">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AnalyticsView() {
  const [tab, setTab] = useState<Tab>("funnel");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [segment, setSegment] = useState<Record<string, string>>({});
  const [data, setData] = useState<Json | null>(null);
  const [comments, setComments] = useState<Json[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = () => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    for (const [key, value] of Object.entries(segment)) if (value) params.set(key, value);
    const text = params.toString();
    return text ? `?${text}` : "";
  };

  useEffect(() => {
    let active = true;
    setError(null);
    setData(null);
    setComments(null);
    const search = query();
    adminApi
      .analytics(tab, search)
      .then((result) => active && setData(result))
      .catch((e: unknown) => active && setError(e instanceof AdminApiError ? `${e.code}${e.detail ? `: ${e.detail}` : ""}` : "Something went wrong."));
    if (tab === "feedback") {
      adminApi
        .feedbackComments(search)
        .then((result) => active && setComments(result.comments))
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, from, to, JSON.stringify(segment)]);

  const suppressed = data?.suppressed === true;

  return (
    <section aria-labelledby="analytics-title">
      <h1 id="analytics-title" className="admin-title">Analytics</h1>
      <div className="admin-card">
        <div className="admin-actions">
          <label>
            From <input className="input admin-inline" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To <input className="input admin-inline" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {SEGMENT_FIELDS.map((field) => (
            <label key={field.name}>
              {field.label}{" "}
              <input
                className="input admin-inline"
                value={segment[field.name] ?? ""}
                placeholder="all"
                onChange={(e) => setSegment({ ...segment, [field.name]: e.target.value.trim() })}
                aria-label={field.label}
              />
            </label>
          ))}
        </div>
        <p className="helper">Default range: the last 30 days. Segments with fewer than five projects are not shown.</p>
      </div>

      <nav className="admin-tabs" aria-label="Analytics views">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {!data && !error && <p role="status">Loading…</p>}
      {suppressed && <p className="helper">Fewer than five projects match this range and segment: numbers are suppressed.</p>}

      {data && tab === "funnel" && !suppressed && (
        <>
          <Metrics
            title="Funnel"
            items={[
              ["Entered (anonymous)", num((data.anonymous as Json | null)?.entered)],
              ["Started (anonymous)", num((data.anonymous as Json | null)?.started)],
              ["Identity completed", num((data.projects as Json).identity_completed)],
              ["Finish Later", num((data.projects as Json).finish_later)],
              ["Resumed", num((data.projects as Json).resumed)],
              ["Completed", num((data.projects as Json).completed)],
              ["Snapshot viewed", num((data.projects as Json).snapshot_viewed)],
              ["Preview Room opened", num((data.projects as Json).preview_room_clicked)],
              ["Premium CTA", num((data.projects as Json).premium_interest)],
              ["Premium requested", num((data.projects as Json).premium_requested)],
              ["Premium activated", num((data.projects as Json).premium_activated)],
              ["Feedback answered", num((data.projects as Json).feedback_submitted)],
            ]}
          />
          <Metrics
            title="Conversion"
            items={Object.entries(data.rates as Json).map(([key, value]) => [key.replace(/_/g, " "), pct(value)] as [string, ReactNode])}
          />
        </>
      )}

      {data && tab === "journey-health" && !suppressed && (
        <>
          <Metrics
            title="Outcomes"
            items={Object.entries(data.outcomes as Json).map(([key, value]) => [
              key.replace(/([A-Z])/g, " $1").toLowerCase(),
              key.endsWith("Rate") ? pct(value) : num(value),
            ] as [string, ReactNode])}
          />
          <Metrics title="Time to complete" items={Object.entries(data.timing as Json).map(([key, value]) => [key.replace(/([A-Z])/g, " $1").toLowerCase(), num(value)] as [string, ReactNode])} />
          <Metrics
            title="Finish Later and resume"
            items={Object.entries(data.resume as Json).map(([key, value]) => [key.replace(/([A-Z])/g, " $1").toLowerCase(), key.endsWith("Rate") ? pct(value) : num(value)] as [string, ReactNode])}
          />
          <Rows
            title="Access extensions and recovery"
            rows={(data.extensions as Json[]) ?? []}
            columns={[
              { label: "Reason", render: (r) => String(r.reason) },
              { label: "Days", render: (r) => num(r.days) },
              { label: "After expiry", render: (r) => (r.afterExpiry ? "Recovery" : "Extension") },
              { label: "Projects", render: (r) => num(r.projects) },
            ]}
          />
          <Metrics title="Lifecycle" items={Object.entries(data.lifecycle as Json).map(([key, value]) => [key.replace(/([A-Z])/g, " $1").toLowerCase(), num(value)] as [string, ReactNode])} />
        </>
      )}

      {data && tab === "friction" && !suppressed && (
        <>
          <Rows
            title="Where abandoned assessments stopped"
            rows={(data.dropOffByStep as Json[]) ?? []}
            columns={[
              { label: "Last confirmed step", render: (r) => String(r.stepId) },
              { label: "Projects", render: (r) => num(r.projects) },
            ]}
          />
          <Rows
            title="Questions answered “Not sure”"
            rows={(data.questions as Json[]) ?? []}
            columns={[
              { label: "Question", render: (r) => String(r.questionId) },
              { label: "Answered", render: (r) => num(r.answered) },
              { label: "Not sure", render: (r) => num(r.notSure) },
              { label: "Rate", render: (r) => pct(r.notSureRate) },
            ]}
          />
          <Rows
            title="Time per step"
            rows={(data.steps as Json[]) ?? []}
            columns={[
              { label: "Step", render: (r) => String(r.stepId) },
              { label: "Median minutes", render: (r) => num(r.medianMinutes) },
              { label: "Confirmations", render: (r) => num(r.completions) },
            ]}
          />
          <Metrics
            title="Signals"
            items={Object.entries(data.signals as Json).map(([key, value]) => [key.replace(/([A-Z])/g, " $1").toLowerCase(), num(value)] as [string, ReactNode])}
          />
        </>
      )}

      {data && tab === "feedback" && (
        <>
          <Metrics
            title="How useful was the experience?"
            items={[
              ["Responses", num(data.responses)],
              ["Completed assessments", num(data.completed)],
              ["Response rate", pct(data.responseRate)],
              ["Average (1–5)", num(data.average)],
            ]}
          />
          <Rows
            title="Distribution"
            rows={(data.distribution as Json[]) ?? []}
            columns={[
              { label: "Rating", render: (r) => `${num(r.value)} ${r.value === 1 ? "(not useful)" : r.value === 5 ? "(very useful)" : ""}` },
              { label: "Responses", render: (r) => num(r.responses) },
            ]}
          />
          <Rows
            title="Comments"
            rows={comments ?? []}
            columns={[
              { label: "When", render: (r) => when(r.submitted_at) },
              { label: "Rating", render: (r) => num(r.usefulness) },
              { label: "Comment", render: (r) => <span className="admin-comment">{String(r.comment ?? "")}</span> },
              { label: "Project", render: (r) => <code>{String(r.project_id ?? "").slice(0, 8)}</code> },
            ]}
          />
        </>
      )}

      {data && tab === "operations" && (
        <>
          <Rows
            title="Email delivery"
            rows={(data.email as Json[]) ?? []}
            columns={[
              { label: "Template", render: (r) => String(r.template) },
              { label: "Status", render: (r) => <span className="admin-badge">{String(r.status)}</span> },
              { label: "Deliveries", render: (r) => num(r.deliveries) },
              { label: "Avg attempts", render: (r) => num(r.avg_attempts) },
            ]}
          />
          <Rows
            title="Jobs"
            rows={(data.jobs as Json[]) ?? []}
            columns={[
              { label: "Job", render: (r) => String(r.job_name) },
              { label: "Last run", render: (r) => when(r.last_run_at) },
              { label: "Last success", render: (r) => when(r.last_success_at) },
              { label: "Failures", render: (r) => num(r.failures) },
              { label: "Abandoned", render: (r) => num(r.abandoned) },
            ]}
          />
          <Rows
            title="Integration deliveries"
            rows={(data.integrations as Json[]) ?? []}
            columns={[
              { label: "Destination", render: (r) => String(r.destination) },
              { label: "Status", render: (r) => <span className="admin-badge">{String(r.status)}</span> },
              { label: "Deliveries", render: (r) => num(r.deliveries) },
              { label: "Oldest pending", render: (r) => when(r.oldest_pending) },
            ]}
          />
          <Rows
            title="Rate limiting (last 24 hours)"
            rows={(data.rateLimits as Json[]) ?? []}
            columns={[
              { label: "Policy", render: (r) => String(r.policy) },
              { label: "Windows over limit", render: (r) => num(r.windows_over_limit) },
              { label: "Requests refused", render: (r) => num(r.refused) },
            ]}
          />
          <Metrics
            title="Retention"
            items={[
              ["Purged in range", num((data.retention as Json).purgedInRange)],
              ["Due for purge", num((data.retention as Json).dueForPurge)],
              ["Held by a pending Premium request", num((data.retention as Json).heldByPendingPremiumRequest)],
              ["Oldest pending Premium request (days)", num((data.retention as Json).oldestPendingPremiumRequestDays)],
            ]}
          />
        </>
      )}
    </section>
  );
}
