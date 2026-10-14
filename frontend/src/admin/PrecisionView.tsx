import { FormEvent, ReactNode, useState } from "react";
import { adminApi, Permission } from "./api";
import { Json, KeyValues, Status, Table, errorMessage, formatWhen, text, useLoad } from "./ui";

/**
 * "Precision" area of the Control Center (V1.0): statistics over the SAME event layer Tableau reads, sponsor / program management, the
 * Admin-managed Precision links and routes, and the privacy policy. Statistics are aggregates: no conversation text, no personal data.
 */

type Tab = "statistics" | "deliveries" | "programs" | "links" | "privacy";
const pct = (v: unknown): string => (typeof v === "number" ? `${Math.round(v * 1000) / 10}%` : "—");

export function PrecisionView({ can }: { can: (p: Permission) => boolean }) {
  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: "statistics", label: "Statistics", show: can("analytics.read") },
    { id: "deliveries", label: "Operation Hub sends", show: can("operations.read") },
    { id: "programs", label: "Programs & sponsors", show: can("projects.read") },
    { id: "links", label: "Links & routes", show: can("config.read") },
    { id: "privacy", label: "Privacy policy", show: can("privacy.manage") },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(visible[0]?.id ?? "statistics");
  return (
    <section aria-labelledby="precision-title">
      <h1 id="precision-title" className="admin-title">Precision</h1>
      <div className="admin-tabs" role="tablist">
        {visible.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "statistics" && <Statistics />}
        {tab === "deliveries" && <Deliveries />}
        {tab === "programs" && <ProgramsAndSponsors can={can} />}
        {tab === "links" && <LinksAndRoutes canWrite={can("config.write")} />}
        {tab === "privacy" && can("privacy.manage") && <PrivacyPolicy />}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------ statistics
function Statistics() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = (() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const s = p.toString();
    return s ? `?${s}` : "";
  })();
  const funnel = useLoad(() => adminApi.precisionMetrics("funnel", query), [query]);
  const quality = useLoad(() => adminApi.precisionMetrics("quality", query), [query]);
  const ai = useLoad(() => adminApi.precisionMetrics("ai", query), [query]);
  const commercial = useLoad(() => adminApi.precisionMetrics("commercial", query), [query]);
  const catalog = useLoad(() => adminApi.precisionMetrics("catalog", ""), []);
  const q = quality.data;
  const a = ai.data;
  const c = commercial.data;
  const dict = (v: unknown): Array<[string, ReactNode]> => Object.entries((v as Record<string, number>) ?? {}).map(([k, n]) => [k, String(n)]);
  return (
    <div className="admin-grid">
      <div className="admin-card admin-wide">
        <div className="admin-actions">
          <label>From <input className="input admin-inline" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To <input className="input admin-inline" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <p className="helper">Aggregates only, computed from the same views Tableau reads. A metric marked &quot;awaiting product layer&quot; is defined and wired but its behaviour is not built yet: it shows nothing instead of an approximation.</p>
      </div>

      <div className="admin-card admin-wide">
        <h2>Product funnel (projects that opened Precision in the range)</h2>
        <Status data={funnel.data} error={funnel.error} />
        {funnel.data && (
          <Table
            rows={funnel.data.stages as Json[]}
            columns={[
              { label: "Stage", render: (s) => text(s.label) },
              { label: "Projects", render: (s) => text(s.projects) },
              { label: "Of opened", render: (s) => pct(s.ofOpened) },
              { label: "Of previous stage", render: (s) => pct(s.ofPrevious) },
            ]}
          />
        )}
      </div>

      <div className="admin-card">
        <h2>Quality / AI experience</h2>
        <Status data={q} error={quality.error} />
        {q && (
          <KeyValues
            items={[
              ["Client turns", text(q.clientTurns)],
              ["Process-question rate", pct(q.processQuestionRate)],
              ["Add a Service started / completed", `${text((q.addService as Json).started)} / ${text((q.addService as Json).completed)}`],
              ["Unknown legitimate needs kept", text(q.unknownLegitimateNeed)],
              ["CRP correction requests", text(q.crpChangeRequests)],
              ["Critical items still open", pct((q.criticalItems as Json).openRate)],
              ["Service Map corrected", text(q.serviceMapCorrected)],
              ["Client priority captured", text(q.clientPriorityCaptured)],
              ...dict(q.needsRouted).map(([k, v]): [string, ReactNode] => [`Needs routed · ${k}`, v]),
              ...dict(q.turnClasses).map(([k, v]): [string, ReactNode] => [`Turn class · ${k}`, v]),
            ]}
          />
        )}
        {q && (q.awaitingProductLayer as string[]).length > 0 && <p className="helper">Awaiting the product layer: {(q.awaitingProductLayer as string[]).join(", ")}</p>}
      </div>

      <div className="admin-card">
        <h2>AI turns</h2>
        <Status data={a} error={ai.error} />
        {a && (
          <KeyValues
            items={[
              ["Turns", text(a.turns)],
              ["AI unavailable", pct(a.unavailableRate)],
              ["Fallback used", `${text((a.fallback as Json).turns)} (${pct((a.fallback as Json).rate)})`],
            ]}
          />
        )}
      </div>

      <div className="admin-card admin-wide">
        <h2>Commercial</h2>
        <Status data={c} error={commercial.error} />
        {c && (
          <>
            <KeyValues
              items={[
                ...dict((c.now as Json).byMode).map(([k, v]): [string, ReactNode] => [`Now · access ${k}`, v]),
                ...dict((c.now as Json).bySource).map(([k, v]): [string, ReactNode] => [`Now · source ${k}`, v]),
                ...dict((c.now as Json).byPrivacy).map(([k, v]): [string, ReactNode] => [`Now · privacy ${k}`, v]),
                ...Object.entries(c.period as Json)
                  .filter(([, v]) => typeof v === "number")
                  .map(([k, v]): [string, ReactNode] => [`Period · ${k}`, String(v)]),
              ]}
            />
          </>
        )}
      </div>

      <div className="admin-card admin-wide">
        <h2>Metric catalog</h2>
        <Status data={catalog.data} error={catalog.error} />
        {catalog.data && (
          <Table
            rows={catalog.data.metrics as Json[]}
            columns={[
              { label: "Metric", render: (m) => text(m.label) },
              { label: "Family", render: (m) => text(m.family) },
              { label: "Definition", render: (m) => text(m.definition) },
              { label: "Status", render: (m) => (m.status === "live" ? "Live" : "Awaiting product layer") },
            ]}
          />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ programs and sponsors
const PROGRAM_KINDS = ["promotion", "trial", "partner", "sponsored"];
const SPONSOR_KINDS = ["government", "agency", "chamber", "accelerator", "corporate", "other"];

function ProgramsAndSponsors({ can }: { can: (p: Permission) => boolean }) {
  const programs = useLoad(() => adminApi.programs(), []);
  const sponsors = useLoad(() => adminApi.sponsors(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const manage = can("entitlement.programs.manage");
  const act = (label: string, action: () => Promise<unknown>) => {
    setMessage(null);
    return action()
      .then(() => {
        setMessage(`${label}: done.`);
        programs.reload();
        sponsors.reload();
      })
      .catch((e: unknown) => setMessage(`${label}: ${errorMessage(e)}`));
  };
  return (
    <div className="admin-grid">
      <div className="admin-card admin-wide">
        <h2>Programs and promotions</h2>
        <Status data={programs.data} error={programs.error} />
        {programs.data && (
          <Table
            rows={programs.data.programs}
            empty="No programs yet."
            columns={[
              { label: "Code", render: (p) => <button type="button" className="button button-text" onClick={() => setSelected(String(p.program_id))}>{text(p.code)}</button> },
              { label: "Name", render: (p) => text(p.name) },
              { label: "Kind", render: (p) => text(p.kind) },
              { label: "Sponsor", render: (p) => text(p.sponsor_name) },
              { label: "Days", render: (p) => text(p.grant_days) },
              { label: "Window", render: (p) => `${formatWhen(p.starts_at)} → ${formatWhen(p.ends_at)}` },
              { label: "Used", render: (p) => `${text(p.redemptions)}${p.max_redemptions ? ` / ${text(p.max_redemptions)}` : ""}` },
              { label: "Status", render: (p) => text(p.status) },
              {
                label: "Actions",
                render: (p) =>
                  manage ? (
                    <div className="admin-actions">
                      {p.status === "draft" && <button type="button" className="button button-text" onClick={() => void act("Activate", () => adminApi.activateProgram(String(p.program_id)))}>Activate</button>}
                      {p.status === "active" && <button type="button" className="button button-text" onClick={() => void act("Close", () => adminApi.closeProgram(String(p.program_id)))}>Close</button>}
                    </div>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        )}
        {message && <p role="status">{message}</p>}
      </div>
      {selected && <ProgramDetail id={selected} canManage={manage} onAct={act} />}
      <div className="admin-card admin-wide">
        <h2>Sponsors</h2>
        <Status data={sponsors.data} error={sponsors.error} />
        {sponsors.data && (
          <Table
            rows={sponsors.data.sponsors}
            empty="No sponsors yet."
            columns={[
              { label: "Name", render: (s) => text(s.name) },
              { label: "Kind", render: (s) => text(s.kind) },
              { label: "Country", render: (s) => text(s.country) },
              { label: "Status", render: (s) => text(s.status) },
            ]}
          />
        )}
      </div>
      {manage && <NewSponsor onAct={act} />}
      {manage && <NewProgram sponsors={sponsors.data?.sponsors ?? []} onAct={act} />}
    </div>
  );
}

type ActFn = (label: string, action: () => Promise<unknown>) => Promise<unknown>;

function ProgramDetail({ id, canManage, onAct }: { id: string; canManage: boolean; onAct: ActFn }) {
  const { data, error, reload } = useLoad(() => adminApi.program(id), [id]);
  const [company, setCompany] = useState("");
  if (!data) return <Status data={data} error={error} />;
  const program = data.program as Json;
  return (
    <div className="admin-card admin-wide">
      <h2>{text(program.code)} · detail</h2>
      <KeyValues
        items={[
          ["Agreement / reference", text(program.agreement_ref)],
          ["Markets", text(program.market_scope)],
          ["Eligibility", text(program.eligibility)],
          ["Eligible companies", text(program.eligible_companies)],
        ]}
      />
      <Table
        rows={data.grants as Json[]}
        empty="No redemptions yet."
        columns={[
          { label: "Grant", render: (g) => text(g.grant_id) },
          { label: "From → to", render: (g) => `${formatWhen(g.starts_at)} → ${formatWhen(g.ends_at)}` },
          { label: "Ended early", render: (g) => formatWhen(g.terminated_at) },
        ]}
      />
      {canManage && program.eligibility === "listed" && (
        <form
          className="admin-actions"
          onSubmit={(event) => {
            event.preventDefault();
            void onAct("Add eligible company", () => adminApi.addEligibleCompany(id, company)).then(() => {
              setCompany("");
              reload();
            });
          }}
        >
          <input className="input" placeholder="Company id" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company id" />
          <button type="submit" className="button button-secondary" disabled={!company.trim()}>Add eligible company</button>
        </form>
      )}
    </div>
  );
}

function NewSponsor({ onAct }: { onAct: ActFn }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("other");
  const [country, setCountry] = useState("");
  return (
    <form
      className="admin-card"
      aria-labelledby="new-sponsor-title"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onAct("Create sponsor", () => adminApi.createSponsor({ name, kind, ...(country ? { country } : {}) })).then(() => setName(""));
      }}
    >
      <h2 id="new-sponsor-title">New sponsor</h2>
      <div className="admin-form-row">
        <label>Name <input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Kind <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>{SPONSOR_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        <label>Country <input className="input" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)} /></label>
      </div>
      <button type="submit" className="button button-primary" disabled={!name.trim()}>Create sponsor</button>
    </form>
  );
}

function NewProgram({ sponsors, onAct }: { sponsors: Json[]; onAct: ActFn }) {
  const [f, setF] = useState({ code: "", name: "", kind: "promotion", sponsorId: "", agreementRef: "", markets: "", grantDays: "30", startsAt: "", endsAt: "", maxRedemptions: "", eligibility: "open", reason: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ready = f.code.trim() && f.name.trim() && f.startsAt && f.endsAt && f.reason.trim() && Number(f.grantDays) > 0 && (f.kind !== "sponsored" || f.sponsorId);
  return (
    <form
      className="admin-card admin-wide"
      aria-labelledby="new-program-title"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onAct("Create program", () =>
          adminApi.createProgram({
            code: f.code,
            name: f.name,
            kind: f.kind,
            ...(f.sponsorId ? { sponsorId: f.sponsorId } : {}),
            ...(f.agreementRef ? { agreementRef: f.agreementRef } : {}),
            ...(f.markets ? { marketScope: f.markets.split(",").map((m) => m.trim()).filter(Boolean) } : {}),
            grantDays: Number(f.grantDays),
            startsAt: new Date(f.startsAt).toISOString(),
            endsAt: new Date(f.endsAt).toISOString(),
            ...(f.maxRedemptions ? { maxRedemptions: Number(f.maxRedemptions) } : {}),
            eligibility: f.eligibility,
            reason: f.reason,
          }),
        );
      }}
    >
      <h2 id="new-program-title">New program or promotion</h2>
      <p className="helper">Created as a draft. Activating it is a separate, audited step.</p>
      <div className="admin-form-row">
        <label>Code <input className="input" value={f.code} onChange={set("code")} /></label>
        <label>Name <input className="input" value={f.name} onChange={set("name")} /></label>
        <label>Kind <select className="select" value={f.kind} onChange={set("kind")}>{PROGRAM_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        <label>Sponsor <select className="select" value={f.sponsorId} onChange={set("sponsorId")}><option value="">—</option>{sponsors.map((s) => <option key={String(s.sponsor_id)} value={String(s.sponsor_id)}>{text(s.name)}</option>)}</select></label>
        <label>Agreement reference <input className="input" value={f.agreementRef} onChange={set("agreementRef")} /></label>
        <label>Markets (ISO codes, comma separated) <input className="input" value={f.markets} onChange={set("markets")} /></label>
      </div>
      <div className="admin-form-row">
        <label>Access days <input className="input" type="number" min={1} value={f.grantDays} onChange={set("grantDays")} /></label>
        <label>Starts <input className="input" type="datetime-local" value={f.startsAt} onChange={set("startsAt")} /></label>
        <label>Ends <input className="input" type="datetime-local" value={f.endsAt} onChange={set("endsAt")} /></label>
        <label>Max redemptions <input className="input" type="number" min={1} value={f.maxRedemptions} onChange={set("maxRedemptions")} /></label>
        <label>Eligibility <select className="select" value={f.eligibility} onChange={set("eligibility")}><option value="open">Open</option><option value="listed">Listed companies only</option></select></label>
        <label>Reason / approval <input className="input" value={f.reason} onChange={set("reason")} /></label>
      </div>
      <button type="submit" className="button button-primary" disabled={!ready}>Create draft</button>
    </form>
  );
}

// ------------------------------------------------------------------------------------------ links and routes
const LOCALE_LABEL: Record<string, string> = { "*": "All languages", en: "English", es: "Español" };

function LinksAndRoutes({ canWrite }: { canWrite: boolean }) {
  const { data, error, reload } = useLoad(() => adminApi.precisionConfig(), []);
  if (!data) return <Status data={data} error={error} />;
  return (
    <div className="admin-grid">
      <p className="helper admin-wide">
        What clients see is resolved as: value set here (language-specific, then all languages) → deployment setting → shipped default. Changes create a new version; resetting returns to the layer below. The Operation Hub link has no default: until set, it is not shown.
      </p>
      {data.entries.map((entry) => (
        <ConfigEntry key={String(entry.key)} entry={entry} canWrite={canWrite} locales={data.locales} onChanged={reload} />
      ))}
    </div>
  );
}

function ConfigEntry({ entry, canWrite, locales, onChanged }: { entry: Json; canWrite: boolean; locales: string[]; onChanged: () => void }) {
  const [locale, setLocale] = useState("*");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const key = String(entry.key);
  const effective = entry.effective as Array<{ locale: string; value: string | null; source: string }>;
  const overrides = entry.overrides as Array<{ locale: string; value: string; version: number }>;
  const run = (label: string, action: () => Promise<unknown>) => {
    setMessage(null);
    action()
      .then(() => {
        setMessage(`${label}: done.`);
        setValue("");
        setReason("");
        onChanged();
      })
      .catch((e: unknown) => setMessage(`${label}: ${errorMessage(e)}`));
  };
  return (
    <div className="admin-card">
      <h2>{text(entry.label)}</h2>
      <p className="helper">{text(entry.description)}</p>
      <KeyValues items={effective.map((e): [string, ReactNode] => [LOCALE_LABEL[e.locale] ?? e.locale, e.value ? `${e.value} (${e.source})` : "Not set"])} />
      {canWrite && (
        <>
          <div className="admin-form-row">
            <label>
              Applies to
              <select className="select" value={locale} onChange={(e) => setLocale(e.target.value)} aria-label={`${text(entry.label)} language`}>
                {locales.map((l) => <option key={l} value={l}>{LOCALE_LABEL[l] ?? l}</option>)}
              </select>
            </label>
            <label>
              {entry.kind === "email" ? "Email address" : "https address or /path"}
              <input className="input" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`${text(entry.label)} value`} />
            </label>
            <label>
              Reason
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`${text(entry.label)} reason`} />
            </label>
          </div>
          <div className="admin-actions">
            <button type="button" className="button button-primary" disabled={!value.trim() || !reason.trim()} onClick={() => run("Save", () => adminApi.setPrecisionConfig(key, { locale, value, reason }))}>Save new version</button>
            {overrides.map((o) => (
              <button key={o.locale} type="button" className="button button-text" onClick={() => run("Reset", () => adminApi.resetPrecisionConfig(key, o.locale))}>
                {`Reset ${LOCALE_LABEL[o.locale] ?? o.locale} (v${o.version})`}
              </button>
            ))}
          </div>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ privacy policy
function PrivacyPolicy() {
  const { data, error, reload } = useLoad(() => adminApi.privacyPolicy(), []);
  const [days, setDays] = useState("");
  const [retain, setRetain] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  if (!data) return <Status data={data} error={error} />;
  const policy = data.policy;
  return (
    <div className="admin-grid">
      <div className="admin-card admin-wide">
        <h2>Internal data-retention policy</h2>
        <p className="helper">
          This is the INTERNAL retention rule that gates personal-data erasure. It is separate from the client access window (read-only access after Premium ends). It must be confirmed by Privacy / Legal before it is approved here: nothing is erased without an approved policy, and nothing is scheduled.
        </p>
        {policy ? (
          <KeyValues
            items={[
              ["Version", text(policy.version)],
              ["Minimum days after access is blocked", text(policy.min_days_after_block)],
              ["Legal acceptance record", policy.retain_legal_acceptance ? "Kept" : "Erased"],
              ["Approved", formatWhen(policy.approved_at)],
            ]}
          />
        ) : (
          <p className="admin-notice">No approved policy. Erasure is blocked.</p>
        )}
      </div>
      <form
        className="admin-card admin-wide"
        aria-labelledby="approve-policy-title"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          adminApi
            .approvePrivacyPolicy({ minDaysAfterBlock: Number(days), retainLegalAcceptance: retain })
            .then(() => {
              setMessage("Policy approved.");
              reload();
            })
            .catch((e: unknown) => setMessage(errorMessage(e)));
        }}
      >
        <h2 id="approve-policy-title">Approve a policy</h2>
        <div className="admin-form-row">
          <label>Minimum days after block <input className="input" type="number" min={0} max={3650} value={days} onChange={(e) => setDays(e.target.value)} /></label>
          <label><input type="checkbox" checked={retain} onChange={(e) => setRetain(e.target.checked)} /> Keep the legal acceptance record</label>
        </div>
        <button type="submit" className="button button-primary" disabled={days === "" || Number.isNaN(Number(days))}>Approve policy</button>
        {message && <p role="status">{message}</p>}
      </form>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ Operation Hub sends
function Deliveries() {
  const [status, setStatus] = useState("");
  const { data, error } = useLoad(() => adminApi.precisionDeliveries(status), [status]);
  return (
    <div className="admin-card">
      <h2>Sends to Operation Hub</h2>
      <p className="helper">Latest state of each delivery. A failed send is retried by the client; here you only see it. Internal codes, no content.</p>
      <label>
        Status
        <select className="select admin-inline" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
          <option value="queued">In progress</option>
        </select>
      </label>
      <Status data={data} error={error} />
      {data && (
        <>
          <KeyValues items={Object.entries(data.counts).map(([k, n]): [string, ReactNode] => [k, String(n)])} />
          <Table
            rows={data.deliveries}
            empty="No deliveries."
            columns={[
              { label: "When", render: (d) => formatWhen(d.created_at) },
              { label: "Project", render: (d) => <code>{text(d.project_id)}</code> },
              { label: "Kind", render: (d) => text(d.kind) },
              { label: "Version", render: (d) => text(d.artifact_version) },
              { label: "Status", render: (d) => text(d.status) },
              { label: "Attempt", render: (d) => text(d.attempt) },
              { label: "Internal code", render: (d) => text(d.error_code) },
            ]}
          />
        </>
      )}
    </div>
  );
}
