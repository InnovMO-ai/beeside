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
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Projects", "Configuration", "Operations"]);

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
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Projects", "Configuration", "Operations", "Audit", "People"]);
    fireEvent.click(await screen.findByRole("button", { name: "Run email delivery" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/email_outbox/run"))).toBe(true));
    const write = calls.find((c) => c.url.endsWith("/email_outbox/run"));
    expect(write?.method).toBe("POST");
    expect(write?.headers["X-Beeside-Admin"]).toBe("1");
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
});
