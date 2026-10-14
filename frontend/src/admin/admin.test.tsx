import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { jsonResponse } from "../fa/test-fixtures";
import { AdminApp, parseAdminRoute } from "./AdminApp";

type Call = { url: string; method: string; headers: Record<string, string> };

function mockApi(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string> };
      calls.push(call);
      const key = Object.keys(routes).find((pattern) => url.startsWith(pattern));
      return key ? (routes[key] as (c: Call) => Response)(call) : jsonResponse({ error: "NOT_FOUND" }, 404);
    }),
  );
  return calls;
}

const SUPERVISOR = { email: "sup@beeside-ops.example", role: "SUPERVISOR", permissions: ["projects.read", "config.read", "operations.read"] };
const ADMIN = {
  email: "admin@beeside-ops.example",
  role: "ADMIN",
  permissions: ["projects.read", "config.read", "operations.read", "config.write", "config.publish", "operations.execute", "premium.manage", "audit.read", "admin_users.manage"],
};

beforeEach(() => window.history.replaceState(null, "", "/admin"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Control Center", () => {
  it("routes /admin paths without touching the respondent experience", () => {
    expect(parseAdminRoute("/admin")).toEqual({ name: "projects" });
    expect(parseAdminRoute("/admin/projects/abc/premium")).toEqual({ name: "project", id: "abc", tab: "premium" });
    expect(parseAdminRoute("/admin/audit/")).toEqual({ name: "audit" });
  });

  it("asks for an organization sign-in when there is no session, and explains a denied sign-in", async () => {
    window.history.replaceState(null, "", "/admin?login=denied");
    mockApi({ "/api/admin/me": () => jsonResponse({ error: "UNAUTHENTICATED" }, 401) });
    render(<AdminApp />);
    expect(await screen.findByRole("heading", { name: "Control Center" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("not authorized");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/api/admin/auth/login?returnTo=%2Fadmin");
  });

  it("shows a SUPERVISOR only review navigation and no operational actions", async () => {
    const calls = mockApi({
      "/api/admin/me": () => jsonResponse(SUPERVISOR),
      "/api/admin/projects?q=": () => jsonResponse({ results: [{ project_id: "p-1", company_name: "Northwind", first_name: "Ana", last_name: "Rivera", primary_email: "ana@northwind.example", assessment_state: "COMPLETED_LOCKED", premium_ever_activated: false, created_at: "2026-09-15T12:00:00Z" }] }),
      "/api/admin/projects/p-1/lifecycle": () =>
        jsonResponse({ policy: {}, lifecycle: { retention_basis: "LIFECYCLE_ORIGIN" }, emailDeliveries: [], privateLinks: [], extensions: [], transitions: [], journeyEvents: [], purge: null }),
      "/api/admin/operations/jobs": () => jsonResponse({ runs: [] }),
      "/api/admin/operations/email-deliveries": () => jsonResponse({ deliveries: [] }),
    });
    render(<AdminApp />);
    const nav = await screen.findByRole("navigation", { name: "Control Center" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Projects", "Configuration", "Communications", "Precision", "Operations"]);

    fireEvent.change(screen.getByLabelText("Search projects"), { target: { value: "north" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Northwind" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Lifecycle & email" }));
    expect(await screen.findByRole("heading", { name: "Milestones" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend private link" })).not.toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("button", { name: "Operations" }));
    expect(await screen.findByRole("heading", { name: "Scheduled jobs" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run / })).not.toBeInTheDocument();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("gives an ADMIN the operational actions, sending the CSRF header on writes", async () => {
    const calls = mockApi({
      "/api/admin/me": () => jsonResponse(ADMIN),
      "/api/admin/operations/jobs/email_outbox/run": () => jsonResponse({ status: "SUCCEEDED", stats: {} }),
      "/api/admin/operations/jobs": () => jsonResponse({ runs: [] }),
      "/api/admin/operations/email-deliveries": () => jsonResponse({ deliveries: [] }),
    });
    window.history.replaceState(null, "", "/admin/operations");
    render(<AdminApp />);
    const nav = await screen.findByRole("navigation", { name: "Control Center" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Projects", "Configuration", "Communications", "Precision", "Operations", "Audit", "People"]);
    fireEvent.click(await screen.findByRole("button", { name: "Run email delivery" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/email_outbox/run"))).toBe(true));
    const write = calls.find((c) => c.url.endsWith("/email_outbox/run"));
    expect(write?.method).toBe("POST");
    expect(write?.headers["X-Beeside-Admin"]).toBe("1");
  });

  it("previews email templates from the current bundles without offering to edit them", async () => {
    mockApi({
      "/api/admin/me": () => jsonResponse(SUPERVISOR),
      "/api/admin/communications/templates": () =>
        jsonResponse({
          questionBankVersion: "fa-qb-1.2.0",
          snapshotTemplateVersion: "st-1.0.0",
          templates: [
            {
              key: "resume_link",
              source: "question_bank",
              active: true,
              locales: {
                en: {
                  subject: "Your beeside assessment is saved",
                  body: "Your First Assessment is saved. You can continue exactly where you left off.",
                  cta: "Continue my assessment",
                  secondaryCta: null,
                },
              },
            },
          ],
        }),
    });
    window.history.replaceState(null, "", "/admin/communications");
    render(<AdminApp />);
    expect(await screen.findByRole("heading", { name: "Communications" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /resume_link/ })).toBeInTheDocument();
    expect(screen.getByText("Your First Assessment is saved. You can continue exactly where you left off.")).toBeInTheDocument();
    // The CTA is rendered as `<p><strong>CTA:</strong> {cta text}</p>` — two sibling text nodes under
    // one paragraph, not a single text node — so this matches on the paragraph's combined textContent
    // rather than requiring "CTA: Continue my assessment" to be one exact node (which it isn't).
    expect(
      screen.getByText((_content, element) => element?.tagName.toLowerCase() === "p" && element.textContent === "CTA: Continue my assessment"),
    ).toBeInTheDocument();
    expect(screen.getByText("Question bank fa-qb-1.2.0 · Snapshot template st-1.0.0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save|Publish|Edit|Deactivate|Activate/ })).not.toBeInTheDocument();
  });

  it("lets an ADMIN edit and publish an email template's raw copy, and deactivate it, through Communications", async () => {
    // The write route is registered before the read route: mockApi matches by URL prefix, so the
    // more specific path must come first or every write would be swallowed by the overview handler.
    const calls = mockApi({
      "/api/admin/me": () => jsonResponse(ADMIN),
      "/api/admin/communications/templates/question_bank/resume_link": () => jsonResponse({ version: "fa-qb-1.1.1", template: { key: "resume_link" } }),
      "/api/admin/communications/templates": () =>
        jsonResponse({
          questionBankVersion: "fa-qb-1.1.0",
          snapshotTemplateVersion: "st-1.0.0",
          templates: [
            {
              key: "resume_link",
              source: "question_bank",
              active: true,
              locales: {
                en: {
                  subject: "Your beeside assessment is saved",
                  body: "Hi {{preferred_name}}, your First Assessment is saved.",
                  cta: "Continue my assessment",
                  secondaryCta: null,
                  preview: { subject: "Your beeside assessment is saved", body: "Hi Alex, your First Assessment is saved.", cta: "Continue my assessment", secondaryCta: null },
                },
              },
            },
          ],
        }),
    });
    window.history.replaceState(null, "", "/admin/communications");
    render(<AdminApp />);
    expect(await screen.findByRole("heading", { name: "Communications" })).toBeInTheDocument();
    // The rendered (sample-filled) preview shows, not the raw placeholder text.
    expect(screen.getByText("Hi Alex, your First Assessment is saved.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const subjectField = screen.getByLabelText("Subject") as HTMLInputElement;
    const bodyField = screen.getByLabelText("Body") as HTMLTextAreaElement;
    // The edit form is pre-filled with the RAW text (placeholders intact), never the rendered sample.
    expect(subjectField.value).toBe("Your beeside assessment is saved");
    expect(bodyField.value).toBe("Hi {{preferred_name}}, your First Assessment is saved.");

    fireEvent.change(subjectField, { target: { value: "Your beeside assessment, saved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & publish" }));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/communications/templates/question_bank/resume_link"))).toBe(true));
    const write = calls.find((c) => c.url.endsWith("/communications/templates/question_bank/resume_link"));
    expect(write?.method).toBe("PUT");
    expect(write?.headers["X-Beeside-Admin"]).toBe("1");
    expect(await screen.findByText(/saved and published as fa-qb-1.1.1/)).toBeInTheDocument();

    // The button exposes the template's current active state programmatically, not just via its
    // own changing label — aria-pressed=true while the template is still active.
    expect(screen.getByRole("button", { name: "Deactivate" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith("/communications/templates/question_bank/resume_link")).length).toBe(2));
  });

  it("shows the immutable Snapshot without recording a respondent view", async () => {
    const calls = mockApi({
      "/api/admin/me": () => jsonResponse(SUPERVISOR),
      "/api/admin/projects/p-1/snapshot": () =>
        jsonResponse({
          snapshot: {
            snapshot_id: "s-1",
            generated_at: "2026-09-15T12:00:00Z",
            content: {
              schema_version: 1,
              kind: "expansion_snapshot",
              generated_at: "2026-09-15T12:00:00Z",
              deliverable_locale: "en",
              locales: {
                en: { eyebrow: "Your Expansion Snapshot", headline: "Your project, in perspective.", generatedOn: "Generated", summary: [], facts: [], counts: [], panels: [], immediatePriority: null, reconcile: null, decisionAhead: null, shapePlan: null, oneThing: null, capabilities: null, disclosure: { title: "About", text: "Text" } },
              },
            },
          },
        }),
    });
    window.history.replaceState(null, "", "/admin/projects/p-1/snapshot");
    render(<AdminApp />);
    expect(await screen.findByRole("heading", { level: 1, name: "Your project, in perspective." })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(calls.some((c) => c.url.includes("/api/fa/events"))).toBe(false);
  });
  const ALL_READ = ["projects.read", "config.read", "operations.read", "analytics.read"];
  const SUPER = { email: "super@beeside-ops.example", role: "SUPER_ADMIN", permissions: [...ALL_READ, "config.write", "config.publish", "operations.execute", "premium.manage", "audit.read", "admin_users.manage", "entitlement.manage", "entitlement.programs.manage", "privacy.manage"] };
  const GRANT = { grant_id: "g-1", source: "complimentary", company_id: null, program_id: null, starts_at: "2026-10-01T00:00:00Z", ends_at: "2099-12-31T00:00:00Z", terminated_at: null, approved_by_identity: "boss@beeside-ops.example", reason: "design partner" };
  const ENTITLEMENT = {
    projectId: "p-1",
    companyId: "c-1",
    entitlement: { premium_access_active: true, precision_access_mode: "FULL", effective_from: "2026-10-01T00:00:00Z", effective_until: "2099-12-31T00:00:00Z", premium_ended_at: null, readonly_until: null, revoked_at: null },
    sources: [{ source: "complimentary", source_ref: "g-1", starts_at: "2026-10-01T00:00:00Z", effective_end: "2099-12-31T00:00:00Z", closed: false, open_ended: false, clock_bound: true }],
    grants: [GRANT],
    privacy: { state: "open", reason_code: null, since: null },
    coveredUntil: "2099-12-31T00:00:00Z",
  };

  it("shows the Access tab with entitlement source, dates and approver, and lets an ADMIN extend and end a grant (no company/program/privacy controls)", async () => {
    const adminWithEntitlement = { ...ADMIN, permissions: [...ADMIN.permissions, "analytics.read", "entitlement.manage"] };
    const calls = mockApi({
      "/api/admin/me": () => jsonResponse(adminWithEntitlement),
      "/api/admin/projects/p-1/entitlement/grants": () => jsonResponse({ grant: {} }, 201),
      "/api/admin/entitlement/grants/g-1/extend": () => jsonResponse({ grant: {} }, 201),
      "/api/admin/entitlement/grants/g-1/terminate": () => jsonResponse({ grant: {} }),
      "/api/admin/entitlement/programs": () => jsonResponse({ programs: [{ program_id: "pr-1", code: "PROMO", name: "Launch", kind: "promotion", status: "active", grant_days: 30 }] }),
      "/api/admin/projects/p-1/entitlement": () => jsonResponse(ENTITLEMENT),
      "/api/admin/audit": () => jsonResponse({ events: [{ occurred_at: "2026-10-02T10:00:00Z", actor_type: "ADMIN_USER", actor: "a@x", action: "entitlement.grant_issued", outcome: "ALLOWED", details: {} }] }),
    });
    window.history.replaceState(null, "", "/admin/projects/p-1/access");
    render(<AdminApp />);
    expect(await screen.findByRole("heading", { name: "Premium access" })).toBeInTheDocument();
    expect(await screen.findByText("boss@beeside-ops.example")).toBeInTheDocument();
    expect(screen.getByText("design partner")).toBeInTheDocument();
    expect(await screen.findByText("entitlement.grant_issued")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Company-level grant/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Privacy and data state/ })).not.toBeInTheDocument();

    // grant
    fireEvent.change(screen.getByLabelText("Reason / approval", { selector: "input" }), { target: { value: "pilot" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/projects/p-1/entitlement/grants") && c.method === "POST")).toBe(true));

    // extend, with a reason
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    fireEvent.change(screen.getByLabelText("Extension reason"), { target: { value: "renewal agreed" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/grants/g-1/extend"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/grants/g-1/extend"))?.headers["X-Beeside-Admin"]).toBe("1");

    // end now
    fireEvent.click(await screen.findByRole("button", { name: "End now" }));
    fireEvent.change(screen.getByLabelText("Termination reason"), { target: { value: "customer request" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/grants/g-1/terminate"))).toBe(true));
  });

  it("gives a SUPER_ADMIN the company grant, privacy erasure with typed confirmation, programs and Admin-managed links", async () => {
    const calls = mockApi({
      "/api/admin/me": () => jsonResponse(SUPER),
      "/api/admin/projects/p-1/privacy/erasure": (c) =>
        c.method === "POST"
          ? jsonResponse({ result: { executed: true } })
          : jsonResponse({ plan: { eligible: true, policy_version: 2, would_delete: { precision_turn: 4, precision_fact: 0 }, external_followups: { external_references: 1 } }, runs: [] }),
      "/api/admin/companies/c-1/entitlement/grants": () => jsonResponse({ grant: {} }, 201),
      "/api/admin/entitlement/programs": () => jsonResponse({ programs: [] }),
      "/api/admin/projects/p-1/entitlement": () => jsonResponse(ENTITLEMENT),
      "/api/admin/audit": () => jsonResponse({ events: [] }),
    });
    window.history.replaceState(null, "", "/admin/projects/p-1/access");
    render(<AdminApp />);
    fireEvent.change(await screen.findByLabelText("Max projects"), { target: { value: "3" } });
    const company = screen.getByRole("heading", { name: /Company-level grant/ }).closest("form") as HTMLElement;
    fireEvent.change(within(company).getByLabelText("Reason / approval"), { target: { value: "group agreement" } });
    fireEvent.click(within(company).getByRole("button", { name: "Grant to company" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/companies/c-1/entitlement/grants"))).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    expect(await screen.findByText(/Eligible under policy v2/)).toBeInTheDocument();
    const erase = screen.getByRole("button", { name: "Erase personal data" });
    expect(erase).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type the project id to confirm"), { target: { value: "p-1" } });
    expect(erase).toBeEnabled();
    fireEvent.click(erase);
    await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/projects/p-1/privacy/erasure"))).toBeTruthy());
  });

  it("manages Precision links and routes: effective value and source per language, versioned save, reset", async () => {
    const entry = {
      key: "operation_hub_url",
      kind: "url",
      label: "Operation Hub",
      description: "Where the client continues.",
      effective: [{ locale: "en", value: "https://hub.example.test/p", source: "admin" }, { locale: "es", value: null, source: "unset" }],
      overrides: [{ locale: "*", value: "https://hub.example.test/p", version: 2, changedAt: "2026-10-01T00:00:00Z" }],
    };
    const calls = mockApi({
      "/api/admin/me": () => jsonResponse(SUPER),
      "/api/admin/precision/config/operation_hub_url": () => jsonResponse({ key: "operation_hub_url", locale: "*", version: 3 }),
      "/api/admin/precision/config": () => jsonResponse({ entries: [entry], locales: ["*", "en", "es"] }),
      "/api/admin/analytics/precision": () => jsonResponse({ stages: [], metrics: [], addService: {}, criticalItems: {}, awaitingProductLayer: [], fallback: {}, now: {}, period: {} }),
    });
    window.history.replaceState(null, "", "/admin/precision");
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole("tab", { name: "Links & routes" }));
    expect(await screen.findByText("https://hub.example.test/p (admin)")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Operation Hub value"), { target: { value: "https://hub.example.test/new" } });
    fireEvent.change(screen.getByLabelText("Operation Hub reason"), { target: { value: "new route" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")).toBeTruthy());
    fireEvent.click(await screen.findByRole("button", { name: /Reset All languages \(v2\)/ }));
    await waitFor(() => expect(calls.find((c) => c.method === "DELETE" && c.url.includes("locale=*"))).toBeTruthy());
  });

  it("shows Precision statistics (funnel, quality, commercial, catalog) to a read-only role, with no write controls", async () => {
    const supervisor = { ...SUPERVISOR, permissions: [...SUPERVISOR.permissions, "analytics.read"] };
    mockApi({
      "/api/admin/me": () => jsonResponse(supervisor),
      "/api/admin/analytics/precision/funnel": () => jsonResponse({ stages: [{ id: "opened", label: "Precision opened", projects: 10, ofOpened: 1, ofPrevious: null }, { id: "started", label: "Understanding started", projects: 6, ofOpened: 0.6, ofPrevious: 0.6 }] }),
      "/api/admin/analytics/precision/quality": () => jsonResponse({ clientTurns: 12, processQuestionRate: 0.25, addService: { started: 2, completed: 1 }, unknownLegitimateNeed: 1, crpChangeRequests: 0, criticalItems: { openRate: null }, serviceMapCorrected: 0, clientPriorityCaptured: 0, needsRouted: {}, turnClasses: {}, awaitingProductLayer: ["quality.noise_filtered"] }),
      "/api/admin/analytics/precision/ai": () => jsonResponse({ turns: 5, unavailableRate: 0, fallback: { turns: 0, rate: 0 } }),
      "/api/admin/analytics/precision/commercial": () => jsonResponse({ now: { byMode: { FULL: 2 }, bySource: {}, byPrivacy: {} }, period: { activations: 1 } }),
      "/api/admin/analytics/precision/catalog": () => jsonResponse({ metrics: [{ id: "x", label: "Noise filtered", family: "quality", definition: "d", status: "awaiting_product_layer" }] }),
    });
    window.history.replaceState(null, "", "/admin/precision");
    render(<AdminApp />);
    expect(await screen.findByText("Understanding started")).toBeInTheDocument();
    expect(await screen.findByText("25%")).toBeInTheDocument();
    expect(await screen.findByText("Awaiting product layer")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Privacy policy" })).not.toBeInTheDocument();
  });
  it("lists Operation Hub sends with status counts and internal codes, read-only", async () => {
    const supervisor = { ...SUPERVISOR, permissions: [...SUPERVISOR.permissions] };
    const calls = mockApi({
      "/api/admin/me": () => jsonResponse(supervisor),
      "/api/admin/precision/deliveries": () => jsonResponse({ counts: { failed: 1, delivered: 3 }, deliveries: [{ created_at: "2026-10-10T10:00:00Z", project_id: "p-9", kind: "crp", artifact_version: 2, status: "failed", attempt: 3, error_code: "UNAVAILABLE" }] }),
    });
    window.history.replaceState(null, "", "/admin/precision");
    render(<AdminApp />);
    expect(await screen.findByText("UNAVAILABLE")).toBeInTheDocument();
    expect(screen.getByText("p-9")).toBeInTheDocument();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});
