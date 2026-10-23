import { FormEvent, useState } from "react";
import { adminApi, Permission } from "./api";
import { Json, KeyValues, Status, Table, errorMessage, formatWhen, text, useLoad } from "./ui";

/**
 * Access tab of a project (Precision V1.0 Admin): Premium entitlement status and where it comes from, grants (complimentary, sponsored,
 * company-level), extension / termination, privacy state and erasure, and the audit trail of this project. The API enforces every rule
 * again (roles, privilege escalation, scopes, privacy-over-commerce); this screen only shows what the role may attempt.
 */

const REASON_CODES = ["erasure_request", "legal_order", "contract_closure", "security_action", "other"];

function grantStatus(g: Json, now: number): string {
  if (g.terminated_at) return "terminated";
  const start = Date.parse(String(g.starts_at));
  const end = Date.parse(String(g.ends_at));
  if (now < start) return "scheduled";
  return now >= end ? "ended" : "active";
}

export function EntitlementTab({ id, can }: { id: string; can: (p: Permission) => boolean }) {
  const { data, error, reload } = useLoad(() => adminApi.entitlement(id), [id]);
  const [message, setMessage] = useState<string | null>(null);
  const act = (label: string, action: () => Promise<unknown>) => {
    setMessage(null);
    return action()
      .then(() => {
        setMessage(`${label}: done.`);
        reload();
      })
      .catch((e: unknown) => setMessage(`${label}: ${errorMessage(e)}`));
  };
  if (!data) return <Status data={data} error={error} />;
  const ent = data.entitlement as Json | null;
  const sources = data.sources as Json[];
  const grants = data.grants as Json[];
  const privacy = data.privacy as Json;
  const now = Date.now();
  const canGrant = can("entitlement.manage");
  const canProgram = can("entitlement.programs.manage");
  return (
    <div className="admin-grid">
      <div className="admin-card">
        <h2>Premium access</h2>
        <KeyValues
          items={[
            ["Access", ent ? (ent.premium_access_active ? "Active" : "Not active") : "No entitlement record"],
            ["Mode", text(ent?.precision_access_mode)],
            ["Effective from", formatWhen(ent?.effective_from)],
            ["Effective until", formatWhen(ent?.effective_until)],
            ["Read-only until", formatWhen(ent?.readonly_until)],
            ["Revoked at", formatWhen(ent?.revoked_at)],
            ["Covered until (a paid term starts after this)", formatWhen(data.coveredUntil)],
            ["Privacy / data state", `${text(privacy.state)}${privacy.reason_code ? ` · ${text(privacy.reason_code)}` : ""}`],
          ]}
        />
        {privacy.state !== "open" && <p className="admin-notice">Privacy overrides any commercial entitlement: while this project is blocked or anonymized, no access is granted.</p>}
      </div>

      <div className="admin-card admin-wide">
        <h2>Where access comes from</h2>
        <Table
          rows={sources}
          empty="No source currently applies."
          columns={[
            { label: "Source", render: (s) => text(s.source) },
            { label: "Reference", render: (s) => text(s.source_ref) },
            { label: "Starts", render: (s) => formatWhen(s.starts_at) },
            { label: "Ends", render: (s) => (s.open_ended ? "Open (follows the subscription)" : formatWhen(s.effective_end)) },
            { label: "State", render: (s) => (s.closed ? "Closed" : "Open") },
          ]}
        />
      </div>

      <div className="admin-card admin-wide">
        <h2>Grants and approvals</h2>
        <Table
          rows={grants}
          empty="No grants for this project."
          columns={[
            { label: "Source", render: (g) => `${text(g.source)}${g.program_code ? ` · ${text(g.program_code)}` : ""}` },
            { label: "Scope", render: (g) => (g.company_id ? `company · ${text(g.company_scope)}${g.max_projects ? ` · max ${text(g.max_projects)}` : ""}` : "project") },
            { label: "From → to", render: (g) => `${formatWhen(g.starts_at)} → ${formatWhen(g.ends_at)}` },
            { label: "Status", render: (g) => grantStatus(g, now) },
            { label: "Approved by", render: (g) => text(g.approved_by_identity) },
            { label: "Reason", render: (g) => text(g.reason) },
            {
              label: "Actions",
              render: (g) => {
                const status = grantStatus(g, now);
                if (!canGrant || status === "terminated") return "—";
                return <GrantActions grant={g} ended={status === "ended"} onAct={act} />;
              },
            },
          ]}
        />
        <p className="helper">Reasons are operator notes: never write personal data in them.</p>
      </div>

      {canGrant && <IssueGrant projectId={id} onAct={act} />}
      {canGrant && <SponsoredAccess projectId={id} onAct={act} />}
      {canProgram && <CompanyGrant companyId={String(data.companyId)} onAct={act} />}
      {message && <p role="status" className="admin-wide">{message}</p>}

      {can("privacy.manage") && <PrivacySection projectId={id} state={String(privacy.state)} onAct={act} />}
      {can("audit.read") && <ProjectAudit projectId={id} refreshKey={message} />}
    </div>
  );
}

type Act = (label: string, action: () => Promise<unknown>) => Promise<unknown>;

function GrantActions({ grant, ended, onAct }: { grant: Json; ended: boolean; onAct: Act }) {
  const [mode, setMode] = useState<"extend" | "terminate" | null>(null);
  const [days, setDays] = useState("30");
  const [reason, setReason] = useState("");
  const id = String(grant.grant_id);
  const programGrant = Boolean(grant.program_id);
  return (
    <div className="admin-actions">
      {mode === null && (
        <>
          {!programGrant && <button type="button" className="button button-text" onClick={() => setMode("extend")}>Extend</button>}
          {!ended && <button type="button" className="button button-text" onClick={() => setMode("terminate")}>End now</button>}
        </>
      )}
      {mode !== null && (
        <>
          {mode === "extend" && <input className="input admin-inline" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days to add" />}
          <input className="input" placeholder="Reason (no personal data)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={mode === "extend" ? "Extension reason" : "Termination reason"} />
          <button
            type="button"
            className="button button-primary"
            disabled={!reason.trim()}
            onClick={() =>
              void onAct(mode === "extend" ? "Extend" : "End grant", () => (mode === "extend" ? adminApi.extendGrant(id, { days: Number(days), reason }) : adminApi.terminateGrant(id, reason))).then(() => setMode(null))
            }
          >
            Confirm
          </button>
          <button type="button" className="button button-text" onClick={() => setMode(null)}>Cancel</button>
        </>
      )}
    </div>
  );
}

function IssueGrant({ projectId, onAct }: { projectId: string; onAct: Act }) {
  const [source, setSource] = useState<"complimentary" | "manual">("complimentary");
  const [days, setDays] = useState("30");
  const [reason, setReason] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onAct("Grant", () => adminApi.issueGrant(projectId, { source, days: Number(days), reason, requestId: crypto.randomUUID() })).then(() => setReason(""));
  };
  return (
    <form className="admin-card" onSubmit={submit} aria-labelledby="grant-title">
      <h2 id="grant-title">Grant complimentary access</h2>
      <p className="helper">Individual exception for this project. Long grants need an elevated approver (the API decides).</p>
      <div className="admin-form-row">
        <label>
          Type
          <select className="select" value={source} onChange={(e) => setSource(e.target.value as "complimentary" | "manual")}>
            <option value="complimentary">Complimentary</option>
            <option value="manual">Manual (agreed outside the system)</option>
          </select>
        </label>
        <label>
          Days
          <input className="input" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label>
          Reason / approval
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <button type="submit" className="button button-primary" disabled={!reason.trim() || !Number(days)}>Grant access</button>
    </form>
  );
}

function SponsoredAccess({ projectId, onAct }: { projectId: string; onAct: Act }) {
  const { data } = useLoad(() => adminApi.programs(), []);
  const [programId, setProgramId] = useState("");
  const [market, setMarket] = useState("");
  const active = (data?.programs ?? []).filter((p) => p.status === "active");
  return (
    <form
      className="admin-card"
      aria-labelledby="sponsored-title"
      onSubmit={(event) => {
        event.preventDefault();
        void onAct("Sponsored access", () => adminApi.redeemProgram(programId, { projectId, ...(market ? { market: market.toUpperCase() } : {}) }));
      }}
    >
      <h2 id="sponsored-title">Grant sponsored / promotional access</h2>
      <p className="helper">Applies the program&apos;s own terms (window, market, quota, eligibility). The operator does not choose them.</p>
      <div className="admin-form-row">
        <label>
          Program
          <select className="select" value={programId} onChange={(e) => setProgramId(e.target.value)}>
            <option value="">Select an active program</option>
            {active.map((p) => (
              <option key={String(p.program_id)} value={String(p.program_id)}>{`${text(p.code)} · ${text(p.name)} (${text(p.kind)}, ${text(p.grant_days)} days)`}</option>
            ))}
          </select>
        </label>
        <label>
          Destination market (if the program is market-scoped)
          <input className="input" value={market} maxLength={2} onChange={(e) => setMarket(e.target.value)} />
        </label>
      </div>
      <button type="submit" className="button button-primary" disabled={!programId}>Apply program</button>
    </form>
  );
}

function CompanyGrant({ companyId, onAct }: { companyId: string; onAct: Act }) {
  const [source, setSource] = useState<"complimentary" | "manual" | "partner">("complimentary");
  const [scope, setScope] = useState<"current_projects" | "projects_created_in_period">("current_projects");
  const [days, setDays] = useState("30");
  const [maxProjects, setMaxProjects] = useState("1");
  const [reason, setReason] = useState("");
  return (
    <form
      className="admin-card admin-wide"
      aria-labelledby="company-grant-title"
      onSubmit={(event) => {
        event.preventDefault();
        void onAct("Company grant", () => adminApi.issueCompanyGrant(companyId, { source, companyScope: scope, days: Number(days), maxProjects: Number(maxProjects), reason }));
      }}
    >
      <h2 id="company-grant-title">Company-level grant (explicit scope)</h2>
      <p className="helper">Covers other projects of this project&apos;s company. Premium is project-first: a company grant is never open-ended.</p>
      <div className="admin-form-row">
        <label>
          Type
          <select className="select" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="complimentary">Complimentary</option>
            <option value="manual">Manual</option>
            <option value="partner">Partner</option>
          </select>
        </label>
        <label>
          Scope
          <select className="select" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="current_projects">Projects that exist today</option>
            <option value="projects_created_in_period">Projects created during the grant</option>
          </select>
        </label>
        <label>
          Days
          <input className="input" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label>
          Max projects
          <input className="input" type="number" min={1} value={maxProjects} onChange={(e) => setMaxProjects(e.target.value)} />
        </label>
        <label>
          Reason / approval
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <button type="submit" className="button button-primary" disabled={!reason.trim() || !Number(days) || !Number(maxProjects)}>Grant to company</button>
    </form>
  );
}

function PrivacySection({ projectId, state, onAct }: { projectId: string; state: string; onAct: Act }) {
  const [reasonCode, setReasonCode] = useState("other");
  const [plan, setPlan] = useState<{ plan: Json; runs: Json[] } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loadPlan = () => {
    setError(null);
    adminApi.erasurePlan(projectId).then(setPlan).catch((e: unknown) => setError(errorMessage(e)));
  };
  const p = plan?.plan;
  return (
    <div className="admin-card admin-wide" role="region" aria-labelledby="privacy-title">
      <h2 id="privacy-title">Privacy and data state (SUPER_ADMIN)</h2>
      <p className="helper">Blocking access is reversible. Erasure is not: it needs an approved policy, a blocked project past the policy window and no running paid term — the database refuses otherwise. Commercial and audit records stay by design.</p>
      <div className="admin-form-row">
        <label>
          Reason
          <select className="select" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
            {REASON_CODES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <button type="button" className="button button-primary" disabled={state !== "open"} onClick={() => void onAct("Block access", () => adminApi.recordPrivacyEvent(projectId, { event: "access_blocked", reasonCode }))}>Block access</button>
        <button type="button" className="button button-text" disabled={state !== "blocked"} onClick={() => void onAct("Restore access", () => adminApi.recordPrivacyEvent(projectId, { event: "access_restored", reasonCode }))}>Restore access</button>
      </div>
      <h3>Erasure</h3>
      <button type="button" className="button button-text" onClick={loadPlan}>Run dry run</button>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {p && (
        <>
          {p.eligible ? (
            <>
              <p className="admin-notice">Eligible under policy v{text(p.policy_version)}. Rows that would be erased:</p>
              <KeyValues items={Object.entries((p.would_delete as Record<string, number>) ?? {}).filter(([, n]) => n > 0).map(([k, n]): [string, string] => [k, String(n)])} />
              <p className="helper">External copies (Operation Hub / ClickUp): {text((p.external_followups as Json | undefined)?.external_references ?? 0)} reference(s) need a manual follow-up.</p>
              <label>
                Type the project id to confirm
                <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </label>
              <button type="button" className="button button-primary" disabled={confirm !== projectId} onClick={() => void onAct("Erasure", () => adminApi.executeErasure(projectId, confirm)).then(loadPlan)}>Erase personal data</button>
            </>
          ) : (
            <p className="admin-notice">Not eligible: {text(p.reason)}</p>
          )}
        </>
      )}
      {plan && <Table rows={plan.runs} empty="No erasure runs." columns={[
        { label: "When", render: (r) => formatWhen(r.created_at) },
        { label: "Outcome", render: (r) => `${text(r.outcome)}${r.refusal_reason ? ` · ${text(r.refusal_reason)}` : ""}` },
        { label: "Policy", render: (r) => text(r.policy_version) },
      ]} />}
    </div>
  );
}

function ProjectAudit({ projectId, refreshKey }: { projectId: string; refreshKey: string | null }) {
  const { data, error } = useLoad(() => adminApi.audit(projectId), [projectId, refreshKey]);
  return (
    <div className="admin-card admin-wide">
      <h2>Audit history</h2>
      <Status data={data} error={error} />
      {data && (
        <Table
          rows={data.events}
          columns={[
            { label: "When", render: (e) => formatWhen(e.occurred_at) },
            { label: "Actor", render: (e) => (e.actor_type === "SYSTEM" ? "System" : text(e.actor)) },
            { label: "Action", render: (e) => <code>{text(e.action)}</code> },
            { label: "Outcome", render: (e) => text(e.outcome) },
            { label: "Details", render: (e) => <code>{text(e.details)}</code> },
          ]}
        />
      )}
    </div>
  );
}
