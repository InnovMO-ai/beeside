import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import logo from "../assets/beeside-logo.png";
import { ExpansionSnapshot } from "../fa/components/ExpansionSnapshot";
import type { SnapshotView } from "../fa/types";
import { AnalyticsView } from "./AnalyticsView";
import { AdminApiError, AdminRole, Me, Permission, REGISTRIES, RegistrySlug, adminApi } from "./api";

/**
 * beeside Control Center (Build Plan v1.1 Phase 10) — an internal operations surface, not a CRM and
 * not Operation Hub. Navigation and actions are shown according to the signed-in role, but every
 * permission is enforced again by the API; historical records and client answers are read-only.
 */

type Json = Record<string, unknown>;
type ProjectTab = "overview" | "answers" | "snapshot" | "internal" | "premium" | "lifecycle";
type Route =
  | { name: "projects" }
  | { name: "project"; id: string; tab: ProjectTab }
  | { name: "config" }
  | { name: "analytics" }
  | { name: "operations" }
  | { name: "audit" }
  | { name: "people" };

const TABS: Array<{ id: ProjectTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "answers", label: "Answers" },
  { id: "snapshot", label: "Snapshot" },
  { id: "internal", label: "Internal Assessment" },
  { id: "premium", label: "Premium" },
  { id: "lifecycle", label: "Lifecycle & email" },
];

export function parseAdminRoute(pathname: string): Route {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean).slice(1);
  if (parts[0] === "projects" && parts[1]) {
    const tab = TABS.find((t) => t.id === parts[2])?.id ?? "overview";
    return { name: "project", id: parts[1], tab };
  }
  if (parts[0] === "config" || parts[0] === "analytics" || parts[0] === "operations" || parts[0] === "audit" || parts[0] === "people") return { name: parts[0] };
  return { name: "projects" };
}

function pathOf(route: Route): string {
  if (route.name === "project") return `/admin/projects/${route.id}/${route.tab}`;
  return `/admin/${route.name}`;
}

const text = (value: unknown): string => (value === null || value === undefined || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));

export function formatWhen(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "—";
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;
}

function errorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === "FORBIDDEN") return "Your role does not allow this action.";
    return error.detail ? `${error.code}: ${error.detail}` : error.code;
  }
  return "Something went wrong.";
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    load()
      .then((result) => active && setData(result))
      .catch((e: unknown) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}

function Status({ data, error }: { data: unknown; error: string | null }) {
  if (error) return <p className="admin-error" role="alert">{error}</p>;
  if (!data) return <p role="status">Loading…</p>;
  return null;
}

function Table({ columns, rows, empty = "Nothing to show." }: { columns: Array<{ label: string; render: (row: Json) => ReactNode }>; rows: Json[]; empty?: string }) {
  if (rows.length === 0) return <p className="helper">{empty}</p>;
  return (
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
  );
}

function KeyValues({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="admin-kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------------------------------ app
export function AdminApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [phase, setPhase] = useState<"loading" | "signed_out" | "ready" | "unavailable">("loading");
  const [route, setRoute] = useState<Route>(() => parseAdminRoute(window.location.pathname));

  useEffect(() => {
    adminApi
      .me()
      .then((result) => {
        setMe(result);
        setPhase("ready");
      })
      .catch((error: unknown) => setPhase(error instanceof AdminApiError && error.status === 401 ? "signed_out" : "unavailable"));
    const onPop = () => setRoute(parseAdminRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.history.pushState(null, "", pathOf(next));
    setRoute(next);
  }, []);

  if (phase === "loading") return <p className="admin-page" role="status">Loading…</p>;
  if (phase === "unavailable") return <p className="admin-page" role="alert">The Control Center is not available.</p>;
  if (phase === "signed_out" || !me) return <SignIn />;

  const can = (p: Permission) => me.permissions.includes(p);
  const nav: Array<{ route: Route; label: string; show: boolean }> = [
    { route: { name: "projects" }, label: "Projects", show: can("projects.read") },
    { route: { name: "config" }, label: "Configuration", show: can("config.read") },
    { route: { name: "analytics" }, label: "Analytics", show: can("analytics.read") },
    { route: { name: "operations" }, label: "Operations", show: can("operations.read") },
    { route: { name: "audit" }, label: "Audit", show: can("audit.read") },
    { route: { name: "people" }, label: "People", show: can("admin_users.manage") },
  ];
  const active = route.name === "project" ? "projects" : route.name;

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-brand">
          <img src={logo} alt="beeside" className="admin-logo" />
          <span>Control Center</span>
        </div>
        <nav aria-label="Control Center">
          <ul className="admin-nav">
            {nav.filter((n) => n.show).map((n) => (
              <li key={n.label}>
                <button type="button" aria-current={active === n.route.name ? "page" : undefined} onClick={() => navigate(n.route)}>
                  {n.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="admin-user">
          <span>{me.email}</span>
          <span className="admin-badge" data-role={me.role}>{me.role}</span>
          <button
            type="button"
            className="button button-text"
            onClick={() => {
              void adminApi.logout().finally(() => {
                setMe(null);
                setPhase("signed_out");
              });
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="admin-page">
        {route.name === "projects" && <ProjectsView onOpen={(id) => navigate({ name: "project", id, tab: "overview" })} />}
        {route.name === "project" && <ProjectView id={route.id} tab={route.tab} can={can} onTab={(tab) => navigate({ ...route, tab })} onBack={() => navigate({ name: "projects" })} />}
        {route.name === "config" && <ConfigView can={can} />}
        {route.name === "analytics" && can("analytics.read") && <AnalyticsView />}
        {route.name === "operations" && <OperationsView can={can} />}
        {route.name === "audit" && can("audit.read") && <AuditView />}
        {route.name === "people" && can("admin_users.manage") && <PeopleView />}
      </main>
    </div>
  );
}

function SignIn() {
  const outcome = new URLSearchParams(window.location.search).get("login");
  const message =
    outcome === "denied"
      ? "This account is not authorized to use the Control Center."
      : outcome === "failed"
        ? "Sign-in could not be completed. Please try again."
        : outcome === "unavailable"
          ? "The identity provider is not available right now."
          : null;
  return (
    <section className="admin-page admin-signin" aria-labelledby="signin-title">
      <img src={logo} alt="beeside" className="admin-logo" />
      <h1 id="signin-title" className="display">Control Center</h1>
      <p className="lead">Sign in with your organization account. Access is limited to provisioned Admins and Supervisors.</p>
      {message && <p className="admin-error" role="alert">{message}</p>}
      <a className="button button-primary" href={adminApi.loginUrl(window.location.pathname.startsWith("/admin") ? window.location.pathname : "/admin")}>
        Sign in
      </a>
    </section>
  );
}

// ------------------------------------------------------------------------------------ projects
function ProjectsView({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Json[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    adminApi
      .searchProjects(query)
      .then((r) => setResults(r.results))
      .catch((e: unknown) => setError(errorMessage(e)));
  };
  return (
    <section aria-labelledby="projects-title">
      <h1 id="projects-title" className="admin-title">Projects</h1>
      <form className="admin-search" onSubmit={search} role="search">
        <label htmlFor="project-search" className="visually-hidden">Search projects</label>
        <input id="project-search" className="input" placeholder="Company, person, email or id" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="button button-primary">Search</button>
      </form>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {results && (
        <Table
          rows={results}
          empty="No projects match."
          columns={[
            { label: "Company", render: (r) => <button type="button" className="admin-link" onClick={() => onOpen(String(r.project_id))}>{text(r.company_name)}</button> },
            { label: "Person", render: (r) => `${text(r.first_name)} ${text(r.last_name)}` },
            { label: "Email", render: (r) => text(r.primary_email) },
            { label: "Assessment", render: (r) => <span className="admin-badge">{text(r.assessment_state)}</span> },
            { label: "Premium", render: (r) => (r.premium_access_active ? "Active" : r.premium_ever_activated ? "Lapsed" : "Never") },
            { label: "Started", render: (r) => formatWhen(r.created_at) },
          ]}
        />
      )}
    </section>
  );
}

function ProjectView({ id, tab, can, onTab, onBack }: { id: string; tab: ProjectTab; can: (p: Permission) => boolean; onTab: (t: ProjectTab) => void; onBack: () => void }) {
  return (
    <section aria-labelledby="project-title">
      <button type="button" className="button button-text" onClick={onBack}>← Projects</button>
      <h1 id="project-title" className="admin-title">Project <code>{id}</code></h1>
      <div className="admin-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "overview" && <OverviewTab id={id} />}
        {tab === "answers" && <AnswersTab id={id} />}
        {tab === "snapshot" && <SnapshotTab id={id} />}
        {tab === "internal" && <InternalTab id={id} />}
        {tab === "premium" && <PremiumTab id={id} canManage={can("premium.manage")} />}
        {tab === "lifecycle" && <LifecycleTab id={id} canExecute={can("operations.execute")} />}
      </div>
    </section>
  );
}

function OverviewTab({ id }: { id: string }) {
  const { data, error } = useLoad(() => adminApi.project(id), [id]);
  if (!data) return <Status data={data} error={error} />;
  const p = data.project as Json;
  const derived = data.derived as Json;
  const policy = data.lifecyclePolicy as Json;
  return (
    <div className="admin-grid">
      <div className="admin-card">
        <h2>Assessment</h2>
        <KeyValues
          items={[
            ["State", <span className="admin-badge" key="s">{text(p.assessment_state)}</span>],
            ["Versions", `${text(p.question_bank_version)} · ${text(p.rules_engine_version)} · ${text(p.snapshot_template_version)}`],
            ["Last completed step", text(p.last_completed_step)],
            ["Started", formatWhen(p.created_at)],
            ["Completed", formatWhen(p.completed_at)],
          ]}
        />
      </div>
      <div className="admin-card">
        <h2>Company & person</h2>
        <KeyValues
          items={[
            ["Company", text(p.company_name)],
            ["Website", text(p.company_website)],
            ["Person", `${text(p.first_name)} ${text(p.last_name)}`],
            ["Email", text(p.primary_email)],
            ["Languages", `interface ${text(p.interface_language)} · interaction ${text(p.preferred_interaction_language)} · deliverable ${text(p.preferred_deliverable_language)}`],
          ]}
        />
      </div>
      <div className="admin-card">
        <h2>Access & retention</h2>
        <KeyValues
          items={[
            ["Access open", derived.accessOpen ? "Yes" : "No"],
            ["Recoverable", derived.recoverable ? "Yes" : "No"],
            ["Access window started", formatWhen(p.access_window_started_at)],
            ["Access until", formatWhen(p.access_expires_at)],
            ["Maximum access", formatWhen(p.access_max_until)],
            ["Temporary retention until", `${formatWhen(p.retention_until)} (${text(p.retention_basis)})`],
            ["Temporary retention applies", derived.temporaryRetentionApplies ? "Yes — Premium never activated" : "No — Premium was activated"],
            ["Calendar", `${text(policy.source)}: ${text(policy.initialAccessDays)} days, reminder day ${text(policy.reminderDay)}, recovery day ${text(policy.recoveryEmailDay)}, max day ${text(policy.maxAccessDay)}, retention day ${text(policy.temporaryRetentionDay)}`],
          ]}
        />
      </div>
      <div className="admin-card">
        <h2>Premium & Precision</h2>
        <KeyValues
          items={[
            ["Premium ever activated", p.premium_ever_activated ? `Yes (${formatWhen(p.premium_first_activated_at)})` : "No"],
            ["Premium access now", p.premium_access_active ? "Active" : "Inactive"],
            ["Precision", `${text(p.precision_state)} ${p.precision_started_at ? `(${formatWhen(p.precision_started_at)})` : ""}`],
          ]}
        />
      </div>
      <div className="admin-card">
        <h2>Legal acceptance</h2>
        <Table
          rows={data.legalAcceptances as Json[]}
          columns={[
            { label: "Document", render: (r) => text(r.document) },
            { label: "URL shown", render: (r) => (r.document_url ? text(r.document_url) : "Pending definition") },
            { label: "Configuration", render: (r) => text(r.question_bank_version) },
            { label: "Accepted", render: (r) => formatWhen(r.accepted_at) },
          ]}
        />
      </div>
      {Boolean(data.purge) && (
        <div className="admin-card">
          <h2>Temporary retention purge</h2>
          <pre className="admin-json">{JSON.stringify(data.purge, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function AnswersTab({ id }: { id: string }) {
  const { data, error } = useLoad(() => adminApi.answers(id), [id]);
  if (!data) return <Status data={data} error={error} />;
  return (
    <div>
      <p className="admin-notice">Read-only. Client answers are never edited from the Control Center.</p>
      {(data.steps as Json[]).map((step) => (
        <div key={String(step.stepId)} className="admin-card">
          <h2>{text(step.title)}</h2>
          <Table
            rows={step.questions as Json[]}
            columns={[
              { label: "Question", render: (q) => text(q.title) },
              { label: "Answer", render: (q) => (q.answered ? <code>{text(q.value)}</code> : <span className="helper">Not answered</span>) },
              { label: "Answered", render: (q) => formatWhen(q.answeredAt) },
              { label: "Versions", render: (q) => text(q.versions) },
            ]}
          />
        </div>
      ))}
    </div>
  );
}

function SnapshotTab({ id }: { id: string }) {
  const { data, error } = useLoad(() => adminApi.snapshot(id), [id]);
  if (!data) return <Status data={data} error={error} />;
  const snapshot = data.snapshot as { snapshot_id: string; generated_at: string; content: SnapshotView["content"] } | null;
  if (!snapshot) return <p className="helper">No Snapshot — the First Assessment is not complete (or its data was purged).</p>;
  return (
    <div className="admin-snapshot">
      <p className="admin-notice">Immutable historical Snapshot generated {formatWhen(snapshot.generated_at)}.</p>
      <ExpansionSnapshot snapshot={{ snapshotId: snapshot.snapshot_id, generatedAt: snapshot.generated_at, content: snapshot.content }} locale={snapshot.content.deliverable_locale} recordView={false} />
    </div>
  );
}

function InternalTab({ id }: { id: string }) {
  const { data, error } = useLoad(() => adminApi.internalAssessment(id), [id]);
  if (!data) return <Status data={data} error={error} />;
  const record = data.internalAssessment as Json | null;
  if (!record) return <p className="helper">No Internal Assessment — the First Assessment is not complete (or its data was purged).</p>;
  const content = record.content as Json;
  const summary = content.executive_summary as Record<string, string> | undefined;
  return (
    <div className="admin-grid">
      <div className="admin-card admin-wide">
        <h2>Executive summary</h2>
        <p>{summary?.en ?? text(summary)}</p>
        <p className="helper">Generated {formatWhen(record.generated_at)} · {text(record.rules_engine_version)} · {text(record.snapshot_template_version)}</p>
      </div>
      <div className="admin-card admin-wide">
        <h2>Precision focus</h2>
        <ol className="plain-list">
          {(data.precisionFocus as Json[]).map((item, i) => (
            <li key={i}>
              <strong>{text(item.kind)}</strong> — <code>{JSON.stringify(item)}</code>
            </li>
          ))}
        </ol>
      </div>
      <div className="admin-card admin-wide">
        <h2>Findings</h2>
        <Table
          rows={data.findings as Json[]}
          columns={[
            { label: "Area", render: (f) => text(f.area_name) },
            { label: "Status", render: (f) => <span className="admin-badge">{text(f.status)}</span> },
            { label: "Signal", render: (f) => text(f.signal_strength) },
            { label: "Client reason", render: (f) => text(f.reason_client) },
            { label: "Internal reason", render: (f) => text(f.reason_internal) },
            { label: "Rule", render: (f) => <code>{text(f.rule_triggered)}</code> },
          ]}
        />
      </div>
      <div className="admin-card">
        <h2>Priority alignment</h2>
        <pre className="admin-json">{JSON.stringify(data.priorityAlignment, null, 2)}</pre>
      </div>
      <div className="admin-card">
        <h2>Capabilities</h2>
        <Table
          rows={data.capabilities as Json[]}
          columns={[
            { label: "Rank", render: (c) => text(c.rank) },
            { label: "Capability", render: (c) => text(c.category_name) },
            { label: "In Snapshot", render: (c) => (c.included_in_snapshot ? "Yes" : "No") },
          ]}
        />
      </div>
      <div className="admin-card">
        <h2>Precision handoff package</h2>
        <pre className="admin-json">{data.handoffPackage ? JSON.stringify(data.handoffPackage, null, 2) : "Not generated (Premium never activated)."}</pre>
      </div>
    </div>
  );
}

function toIso(local: string): string | undefined {
  return local ? new Date(local).toISOString() : undefined;
}

function PremiumTab({ id, canManage }: { id: string; canManage: boolean }) {
  const { data, error, reload } = useLoad(() => adminApi.premium(id), [id]);
  const [eventType, setEventType] = useState("premium_activated");
  const [requestId, setRequestId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  if (!data) return <Status data={data} error={error} />;
  const status = data.status as Json;
  const requests = data.activationRequests as Json[];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    adminApi
      .recordSubscriptionEvent(id, { eventType, requestId: requestId || undefined, periodStart: toIso(periodStart), periodEnd: toIso(periodEnd) })
      .then((result) => {
        setMessage(`Recorded: ${text(result.subscriptionStatus)}${result.duplicate ? " (already recorded)" : ""}`);
        reload();
      })
      .catch((e: unknown) => setMessage(errorMessage(e)));
  };
  return (
    <div className="admin-grid">
      <div className="admin-card">
        <h2>Status</h2>
        <KeyValues
          items={[
            ["Ever activated", status.everActivated ? "Yes" : "No"],
            ["Access active", status.accessActive ? "Yes" : "No"],
            ["Subscription", text(status.subscriptionStatus)],
            ["Access until (scheduled cancellation)", formatWhen(status.accessUntil)],
            ["Operation Hub access", (data.operationHub as Json).accessActive ? "Enabled" : "Disabled"],
          ]}
        />
      </div>
      <div className="admin-card admin-wide">
        <h2>Activation requests</h2>
        <Table
          rows={requests}
          columns={[
            { label: "Kind", render: (r) => text(r.kind) },
            { label: "Status", render: (r) => text(r.status) },
            { label: "Requested", render: (r) => formatWhen(r.requested_at) },
            { label: "Terms", render: (r) => text(r.terms_url) },
            { label: "Checkout", render: (r) => text(r.checkout_adapter) },
          ]}
        />
      </div>
      <div className="admin-card admin-wide">
        <h2>Subscriptions & events</h2>
        <Table
          rows={data.subscriptions as Json[]}
          columns={[
            { label: "Status", render: (s) => text(s.status) },
            { label: "Period", render: (s) => `${formatWhen(s.current_period_start)} → ${formatWhen(s.current_period_end)}` },
            { label: "Cancellation requested", render: (s) => formatWhen(s.cancellation_requested_at) },
            { label: "Ended", render: (s) => formatWhen(s.ended_at) },
          ]}
        />
        <Table
          rows={data.events as Json[]}
          columns={[
            { label: "Event", render: (e) => text(e.event_type) },
            { label: "When", render: (e) => formatWhen(e.occurred_at) },
            { label: "Source", render: (e) => text(e.source) },
          ]}
        />
      </div>
      {canManage && (
        <form className="admin-card admin-wide" onSubmit={submit} aria-labelledby="manual-event-title">
          <h2 id="manual-event-title">Record a subscription event</h2>
          <p className="helper">No payment provider is connected: beeside confirms activations manually. Enter the paid period exactly as agreed — nothing is assumed.</p>
          <div className="admin-form-row">
            <label>
              Event
              <select className="select" value={eventType} onChange={(e) => setEventType(e.target.value)}>
                <option value="premium_activated">premium_activated</option>
                <option value="premium_reactivated">premium_reactivated</option>
                <option value="cancellation_requested">cancellation_requested</option>
                <option value="subscription_period_ended">subscription_period_ended</option>
              </select>
            </label>
            <label>
              Confirms request
              <select className="select" value={requestId} onChange={(e) => setRequestId(e.target.value)}>
                <option value="">—</option>
                {requests.filter((r) => r.status === "REQUESTED").map((r) => (
                  <option key={String(r.request_id)} value={String(r.request_id)}>{`${text(r.kind)} · ${formatWhen(r.requested_at)}`}</option>
                ))}
              </select>
            </label>
            <label>
              Period start
              <input className="input" type="datetime-local" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </label>
            <label>
              Period end
              <input className="input" type="datetime-local" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </label>
          </div>
          <button type="submit" className="button button-primary">Record event</button>
          {message && <p role="status">{message}</p>}
        </form>
      )}
    </div>
  );
}

function LifecycleTab({ id, canExecute }: { id: string; canExecute: boolean }) {
  const { data, error, reload } = useLoad(() => adminApi.lifecycle(id), [id]);
  const [message, setMessage] = useState<string | null>(null);
  if (!data) return <Status data={data} error={error} />;
  const lifecycle = (data.lifecycle as Json | null) ?? {};
  return (
    <div className="admin-grid">
      <div className="admin-card">
        <h2>Milestones</h2>
        <KeyValues
          items={[
            ["Identity completed", formatWhen(lifecycle.identity_completed_at)],
            ["Last activity", formatWhen(lifecycle.last_activity_at)],
            ["Reminder sent", formatWhen(lifecycle.reminder_day10_sent_at)],
            ["Recovery email sent", formatWhen(lifecycle.recovery_email_sent_at)],
            ["Retention until", `${formatWhen(lifecycle.retention_until)} (${text(lifecycle.retention_basis)})`],
          ]}
        />
        {canExecute && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setMessage(null);
              adminApi
                .resendPrivateLink(id)
                .then(() => {
                  setMessage("A new private link was sent to the respondent's own email address.");
                  reload();
                })
                .catch((e: unknown) => setMessage(errorMessage(e)));
            }}
          >
            Resend private link
          </button>
        )}
        {message && <p role="status">{message}</p>}
      </div>
      <div className="admin-card admin-wide">
        <h2>Email deliveries</h2>
        <Table
          rows={data.emailDeliveries as Json[]}
          columns={[
            { label: "Template", render: (d) => text(d.template) },
            { label: "Status", render: (d) => <span className="admin-badge">{text(d.status)}</span> },
            { label: "Attempts", render: (d) => `${text(d.attempts)}/${text(d.max_attempts)}` },
            { label: "Created", render: (d) => formatWhen(d.created_at) },
            { label: "Sent", render: (d) => formatWhen(d.sent_at) },
            { label: "Note", render: (d) => text(d.cancel_reason ?? d.last_error) },
          ]}
        />
      </div>
      <div className="admin-card">
        <h2>Private links</h2>
        <Table
          rows={data.privateLinks as Json[]}
          columns={[
            { label: "Kind", render: (t) => text(t.kind) },
            { label: "Issued", render: (t) => formatWhen(t.created_at) },
            { label: "Valid until", render: (t) => formatWhen(t.expires_at) },
            { label: "State", render: (t) => (t.active ? "Active" : t.revoked_at ? "Replaced/revoked" : "Expired") },
          ]}
        />
      </div>
      <div className="admin-card">
        <h2>Extensions</h2>
        <Table
          rows={data.extensions as Json[]}
          columns={[
            { label: "Days", render: (x) => text(x.requested_days) },
            { label: "Reason", render: (x) => text(x.reason) },
            { label: "New access until", render: (x) => formatWhen(x.new_expires_at) },
            { label: "Recovery", render: (x) => (x.was_expired ? "Yes" : "No") },
          ]}
        />
      </div>
      <div className="admin-card admin-wide">
        <h2>State history</h2>
        <Table
          rows={data.transitions as Json[]}
          columns={[
            { label: "From", render: (t) => text(t.from_state) },
            { label: "To", render: (t) => text(t.to_state) },
            { label: "When", render: (t) => formatWhen(t.occurred_at) },
          ]}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------- configuration
function ConfigView({ can }: { can: (p: Permission) => boolean }) {
  const [registry, setRegistry] = useState<RegistrySlug>("question-bank");
  const [selected, setSelected] = useState<string | null>(null);
  const current = useLoad(() => adminApi.currentConfig(), []);
  const versions = useLoad(() => adminApi.versions(registry), [registry]);
  return (
    <section aria-labelledby="config-title">
      <h1 id="config-title" className="admin-title">Configuration</h1>
      <p className="helper">Draft → Preview → Review → Publish. Content changes need an approval; logic or schema changes also need an explicit diff review. Projects stay on the versions they started with.</p>
      <div className="admin-tabs" role="tablist">
        {REGISTRIES.map((r) => (
          <button
            key={r.slug}
            type="button"
            role="tab"
            aria-selected={r.slug === registry}
            onClick={() => {
              setRegistry(r.slug);
              setSelected(null);
            }}
          >
            {r.label} <span className="helper">({text(current.data?.[r.key])})</span>
          </button>
        ))}
      </div>
      <Status data={versions.data} error={versions.error} />
      {versions.data && (
        <Table
          rows={versions.data}
          columns={[
            { label: "Version", render: (v) => <button type="button" className="admin-link" onClick={() => setSelected(String(v.version))}>{text(v.version)}</button> },
            { label: "Status", render: (v) => <span className="admin-badge">{text(v.status)}{v.is_current ? " · current" : ""}</span> },
            { label: "Change", render: (v) => text(v.change_kind) },
            { label: "Published", render: (v) => formatWhen(v.published_at) },
          ]}
        />
      )}
      {selected && (
        <VersionDetail
          key={`${registry}:${selected}`}
          registry={registry}
          version={selected}
          can={can}
          onChanged={(next) => {
            versions.reload();
            current.reload();
            if (next) setSelected(next);
          }}
        />
      )}
    </section>
  );
}

function VersionDetail({ registry, version, can, onChanged }: { registry: RegistrySlug; version: string; can: (p: Permission) => boolean; onChanged: (next?: string) => void }) {
  const { data, error, reload } = useLoad(() => adminApi.version(registry, version), [registry, version]);
  const [draftName, setDraftName] = useState("");
  const [json, setJson] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [diffReviewed, setDiffReviewed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (data) setJson(JSON.stringify(data.config, null, 2));
  }, [data]);
  if (!data) return <Status data={data} error={error} />;

  const act = (label: string, action: () => Promise<unknown>, next?: string) => {
    setMessage(null);
    action()
      .then(() => {
        setMessage(`${label}: done.`);
        reload();
        onChanged(next);
      })
      .catch((e: unknown) => setMessage(`${label}: ${errorMessage(e)}`));
  };
  const parsed = (): unknown => JSON.parse(json);
  const status = String(data.status);

  return (
    <div className="admin-card admin-version">
      <h2>{version}</h2>
      <KeyValues
        items={[
          ["Status", `${status}${data.is_current ? " (current)" : ""}`],
          ["Change kind", text(data.change_kind)],
          ["Content hash", text(data.content_hash)],
          ["Base version", text(data.base_version)],
        ]}
      />
      <details>
        <summary>Differences against the current version</summary>
        <pre className="admin-json">{JSON.stringify(data.diff_against_current, null, 2)}</pre>
      </details>
      <details>
        <summary>Reviews and history</summary>
        <pre className="admin-json">{JSON.stringify({ reviews: data.reviews, events: data.events }, null, 2)}</pre>
      </details>
      <label className="field">
        <span className="label">Bundle (JSON)</span>
        <textarea className="textarea admin-code" value={json} readOnly={!(can("config.write") && status === "DRAFT")} onChange={(e) => setJson(e.target.value)} />
      </label>
      {message && <p role="status">{message}</p>}

      {can("config.write") && (
        <div className="admin-actions">
          <input className="input" placeholder="New version name" value={draftName} onChange={(e) => setDraftName(e.target.value)} aria-label="New version name" />
          <button type="button" className="button button-secondary" disabled={!draftName} onClick={() => act("New draft", () => adminApi.createDraft(registry, draftName, parsed()), draftName)}>
            New draft from this bundle
          </button>
          {status === "DRAFT" && (
            <>
              <button type="button" className="button button-secondary" onClick={() => act("Save draft", () => adminApi.updateDraft(registry, version, parsed()))}>Save draft</button>
              <button type="button" className="button button-primary" onClick={() => act("Submit for preview", () => adminApi.preview(registry, version))}>Submit for preview</button>
            </>
          )}
          {status === "PREVIEW" && (
            <>
              <input className="input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
              <button type="button" className="button button-text" disabled={!reason} onClick={() => act("Return to draft", () => adminApi.returnToDraft(registry, version, reason))}>Return to draft</button>
            </>
          )}
        </div>
      )}
      {can("config.publish") && status === "PREVIEW" && (
        <div className="admin-actions">
          <label className="check">
            <input type="checkbox" checked={diffReviewed} onChange={(e) => setDiffReviewed(e.target.checked)} />
            <span>I reviewed the logic/schema differences</span>
          </label>
          <input className="input" placeholder="Review notes" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Review notes" />
          <button type="button" className="button button-secondary" onClick={() => act("Approve", () => adminApi.review(registry, version, { decision: "APPROVED", diffReviewed, notes }))}>Approve</button>
          <button type="button" className="button button-text" onClick={() => act("Reject", () => adminApi.review(registry, version, { decision: "REJECTED", diffReviewed, notes }))}>Reject</button>
          <button type="button" className="button button-primary" onClick={() => act("Publish", () => adminApi.publish(registry, version))}>Publish</button>
        </div>
      )}
      {can("config.publish") && status === "PUBLISHED" && !data.is_current && (
        <div className="admin-actions">
          <input className="input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for making current" />
          <button type="button" className="button button-secondary" disabled={!reason} onClick={() => act("Make current", () => adminApi.setCurrent(registry, version, reason))}>Make current</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------- operations
function OperationsView({ can }: { can: (p: Permission) => boolean }) {
  const [status, setStatus] = useState("");
  const deliveries = useLoad(() => adminApi.deliveries(status), [status]);
  const runs = useLoad(() => adminApi.jobRuns(), []);
  const [message, setMessage] = useState<string | null>(null);
  const act = (label: string, action: () => Promise<unknown>) => {
    setMessage(null);
    action()
      .then(() => {
        setMessage(`${label}: done.`);
        deliveries.reload();
        runs.reload();
      })
      .catch((e: unknown) => setMessage(`${label}: ${errorMessage(e)}`));
  };
  const execute = can("operations.execute");
  return (
    <section aria-labelledby="ops-title">
      <h1 id="ops-title" className="admin-title">Operations</h1>
      {message && <p role="status">{message}</p>}
      <div className="admin-card">
        <h2>Scheduled jobs</h2>
        <p className="helper">Jobs run automatically in the worker; running one here is optional and audited.</p>
        {execute && (
          <div className="admin-actions">
            <button type="button" className="button button-secondary" onClick={() => act("Email delivery", () => adminApi.runJob("email_outbox"))}>Run email delivery</button>
            <button type="button" className="button button-secondary" onClick={() => act("Access lifecycle", () => adminApi.runJob("access_lifecycle"))}>Run access lifecycle</button>
            <button
              type="button"
              className="button button-text"
              onClick={() => {
                if (window.confirm("Purge the client data of expired free First Assessments now?")) act("Temporary retention", () => adminApi.runJob("temporary_retention"));
              }}
            >
              Run temporary retention
            </button>
          </div>
        )}
        <Status data={runs.data} error={runs.error} />
        {runs.data && (
          <Table
            rows={runs.data.runs}
            columns={[
              { label: "Job", render: (r) => text(r.job_name) },
              { label: "Trigger", render: (r) => text(r.trigger) },
              { label: "Status", render: (r) => <span className="admin-badge">{text(r.status)}</span> },
              { label: "Started", render: (r) => formatWhen(r.started_at) },
              { label: "Result", render: (r) => <code>{text(r.error ?? r.stats)}</code> },
            ]}
          />
        )}
      </div>
      <div className="admin-card">
        <h2>Email deliveries</h2>
        <label>
          Status{" "}
          <select className="select admin-inline" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {["PENDING", "SENDING", "SENT", "FAILED", "DEAD", "CANCELLED"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <Status data={deliveries.data} error={deliveries.error} />
        {deliveries.data && (
          <Table
            rows={deliveries.data.deliveries}
            columns={[
              { label: "Template", render: (d) => text(d.template) },
              { label: "Status", render: (d) => <span className="admin-badge">{text(d.status)}</span> },
              { label: "Attempts", render: (d) => `${text(d.attempts)}/${text(d.max_attempts)}` },
              { label: "Created", render: (d) => formatWhen(d.created_at) },
              { label: "Note", render: (d) => text(d.cancel_reason ?? d.last_error) },
              {
                label: "Actions",
                render: (d) =>
                  execute ? (
                    <span className="admin-actions">
                      {(d.status === "FAILED" || d.status === "DEAD") && <button type="button" className="button button-text" onClick={() => act("Retry", () => adminApi.retryDelivery(String(d.delivery_id)))}>Retry</button>}
                      {(d.status === "PENDING" || d.status === "FAILED") && <button type="button" className="button button-text" onClick={() => act("Cancel", () => adminApi.cancelDelivery(String(d.delivery_id)))}>Cancel</button>}
                    </span>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        )}
      </div>
    </section>
  );
}

function AuditView() {
  const { data, error } = useLoad(() => adminApi.audit(), []);
  return (
    <section aria-labelledby="audit-title">
      <h1 id="audit-title" className="admin-title">Audit</h1>
      <Status data={data} error={error} />
      {data && (
        <Table
          rows={data.events}
          columns={[
            { label: "When", render: (e) => formatWhen(e.occurred_at) },
            { label: "Actor", render: (e) => (e.actor_type === "SYSTEM" ? "System" : text(e.actor)) },
            { label: "Action", render: (e) => <code>{text(e.action)}</code> },
            { label: "Outcome", render: (e) => <span className="admin-badge" data-outcome={String(e.outcome)}>{text(e.outcome)}</span> },
            { label: "Target", render: (e) => text(e.target_type ? `${e.target_type} ${e.target_id ?? ""}` : null) },
            { label: "Details", render: (e) => <code>{text(e.details)}</code> },
          ]}
        />
      )}
    </section>
  );
}

function PeopleView() {
  const { data, error, reload } = useLoad(() => adminApi.adminUsers(), []);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("SUPERVISOR");
  const [message, setMessage] = useState<string | null>(null);
  const act = (label: string, action: () => Promise<unknown>) => {
    setMessage(null);
    action()
      .then(() => {
        setMessage(`${label}: done.`);
        reload();
      })
      .catch((e: unknown) => setMessage(`${label}: ${errorMessage(e)}`));
  };
  return (
    <section aria-labelledby="people-title">
      <h1 id="people-title" className="admin-title">People</h1>
      <p className="helper">Only provisioned people can sign in, through the organization identity provider. Technical identities never sign in.</p>
      <form
        className="admin-actions admin-card"
        onSubmit={(event) => {
          event.preventDefault();
          act("Provision", () => adminApi.provisionAdmin(email, role));
        }}
      >
        <input className="input" type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Work email" />
        <select className="select admin-inline" value={role} onChange={(e) => setRole(e.target.value as AdminRole)} aria-label="Role">
          <option value="SUPERVISOR">SUPERVISOR</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <button type="submit" className="button button-primary" disabled={!email}>Provision</button>
      </form>
      {message && <p role="status">{message}</p>}
      <Status data={data} error={error} />
      {data && (
        <Table
          rows={data.users}
          columns={[
            { label: "Email", render: (u) => text(u.email) },
            { label: "Role", render: (u) => text(u.role) },
            { label: "Sign-in", render: (u) => (u.loginEnabled ? (u.identityBound ? "Enabled · bound" : "Enabled · first sign-in pending") : "Technical (never)") },
            { label: "Active", render: (u) => (u.active ? "Yes" : "No") },
            { label: "Last sign-in", render: (u) => formatWhen(u.lastLoginAt) },
            {
              label: "Actions",
              render: (u) =>
                u.loginEnabled ? (
                  <span className="admin-actions">
                    <button type="button" className="button button-text" onClick={() => act("Role", () => adminApi.updateAdmin(String(u.adminUserId), { role: u.role === "ADMIN" ? "SUPERVISOR" : "ADMIN" }))}>
                      Make {u.role === "ADMIN" ? "SUPERVISOR" : "ADMIN"}
                    </button>
                    <button type="button" className="button button-text" onClick={() => act("Access", () => adminApi.updateAdmin(String(u.adminUserId), { active: !u.active }))}>
                      {u.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </span>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      )}
    </section>
  );
}
