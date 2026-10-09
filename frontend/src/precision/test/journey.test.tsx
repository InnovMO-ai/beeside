import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { boot, setupDom } from "./harness";
import { scan } from "./forbidden";

const WAIT = { timeout: 8000 };
setupDom();
vi.setConfig({ testTimeout: 30000 });
const h1 = (re: RegExp) => waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(re), WAIT);

const bodyHits = () => scan(document.body.textContent ?? "");

describe("session link", () => {
  it("shows a friendly page when there is no link", async () => {
    window.history.replaceState({}, "", "/precision/center");
    const { render } = await import("@testing-library/react");
    const { PrecisionApp } = await import("../PrecisionApp");
    const { createMockServer } = await import("../mock/mockTransport");
    const server = createMockServer({ persist: false, query: "" });
    render(<PrecisionApp transport={async () => server.transport} />);
    await h1(/Open Precision from your email/);
    expect(document.body.textContent).not.toMatch(/UNAUTHENTICATED|undefined|Error:/);
    expect(bodyHits()).toEqual([]);
  });

  it("shows the invalid or expired page without raw errors", async () => {
    window.history.replaceState({}, "", "/precision/center?code=expired&mock=latency:0");
    const { render } = await import("@testing-library/react");
    const { PrecisionApp } = await import("../PrecisionApp");
    const { createMockServer } = await import("../mock/mockTransport");
    const server = createMockServer({ persist: false, query: "?code=expired&mock=latency:0" });
    render(<PrecisionApp transport={async () => server.transport} />);
    await h1(/This link can't be used/);
    expect(document.body.textContent).not.toMatch(/401|UNAUTHENTICATED|undefined/);
  });
});

describe("first entry", () => {
  it("opens on the cover and continues to Precision Center", async () => {
    boot("/precision");
    await h1(/Your project, defined with precision/);
    expect(window.location.search).not.toContain("code="); // the one-time code leaves the address bar
    await userEvent.click(screen.getAllByRole("button", { name: /continue/i }).concat(screen.queryAllByRole("link", { name: /continue/i }))[0]);
    await waitFor(() => expect(window.location.pathname).toBe("/precision/center"), WAIT);
    expect(bodyHits()).toEqual([]);
  });
});

describe("Precision Center", () => {
  it("renders the journey, never shows Sherpa before one exists and offers help", async () => {
    boot("/precision/center", { mock: "preset:mapConfirmed" });
    await screen.findByRole("heading", { name: /Precision Center|your project/i }, WAIT);
    expect(await screen.findAllByText(/Logistics/, undefined, WAIT)).not.toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/sherpa/i);
    expect(screen.getAllByRole("link", { name: /help/i }).length).toBeGreaterThan(0);
    expect(bodyHits()).toEqual([]);
  });

  it("switches language at runtime and keeps product names", async () => {
    boot("/precision/center", { mock: "preset:mapConfirmed", locale: "en" });
    await screen.findByRole("heading", { level: 1 }, WAIT);
    const es = screen.getAllByRole("button", { name: /^ES$|español/i })[0];
    await userEvent.click(es);
    await waitFor(() => expect(document.documentElement.lang).toBe("es"), WAIT);
    expect(document.body.textContent).toMatch(/Precision Understanding/);
    expect(document.body.textContent).toMatch(/My Service Map/);
    expect(bodyHits()).toEqual([]);
  });
});

describe("documents", () => {
  it.each(["en", "es"] as const)("My Service Map, CRP, preview and sent pass the term scan (%s)", async (locale) => {
    const a = boot("/precision/service-map", { mock: "preset:understandingReady", locale });
    await screen.findByRole("heading", { level: 1 }, WAIT);
    await waitFor(() => expect(document.querySelectorAll(".pz-kv, .pz-groups, .pz-group").length).toBeGreaterThan(0), WAIT);
    expect(bodyHits()).toEqual([]);
    a.unmount();

    const b = boot("/precision/category/logistics/summary", { mock: "preset:logisticsReady", locale });
    await screen.findByRole("heading", { level: 1 }, WAIT);
    await waitFor(() => expect(document.body.textContent).toMatch(/Category Requirement Pack \(CRP\)/), WAIT);
    expect(bodyHits()).toEqual([]);
    b.unmount();

    const c = boot("/precision/category/logistics/preview", { mock: "preset:logisticsConfirmed", locale });
    await screen.findByRole("heading", { level: 1 }, WAIT);
    await waitFor(() => expect(document.body.textContent).toMatch(/Operation Hub/), WAIT);
    expect(bodyHits()).toEqual([]);
    c.unmount();

    boot("/precision/category/logistics/sent", { mock: "preset:sent", locale });
    await screen.findByRole("heading", { level: 1 }, WAIT);
    expect(bodyHits()).toEqual([]);
  });
});

describe("send", () => {
  it("sends once even when the button is clicked repeatedly, then shows the confirmation", async () => {
    const { server } = boot("/precision/category/logistics/preview", { mock: "preset:logisticsConfirmed" });
    const send = await screen.findByRole("button", { name: /Send to Operation Hub/ }, WAIT);
    fireEvent.click(send); fireEvent.click(send); fireEvent.click(send);
    await waitFor(() => expect(window.location.pathname).toMatch(/\/sent$/), { timeout: 15000 });
    expect(server.control.stats().sendCalls).toBe(1);
    await h1(/Sent to Operation Hub/);
  }, 20000);

  it("recovers from a stale preview by refreshing it", async () => {
    const { server } = boot("/precision/category/logistics/preview", { mock: "preset:logisticsConfirmed" });
    await screen.findByRole("button", { name: /Send to Operation Hub/ }, WAIT);
    server.control.inject("preview_stale");
    await userEvent.click(screen.getByRole("button", { name: /Send to Operation Hub/ }));
    expect(await screen.findByText(/Something changed after you opened this preview/, undefined, WAIT)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/PREVIEW_STALE|409/);
  }, 20000);

  it("shows a calm failure with retry when Operation Hub does not accept, and never a raw error", async () => {
    const { server } = boot("/precision/category/logistics/preview", { mock: "preset:logisticsConfirmed", locale: "en" });
    await screen.findByRole("button", { name: /Send to Operation Hub/ }, WAIT);
    server.control.inject("oh_fail");
    await userEvent.click(screen.getByRole("button", { name: /Send to Operation Hub/ }));
    expect(await screen.findByText(/We couldn't complete the send/, undefined, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/oh_fail|TEMPORARILY|undefined/);
    expect(bodyHits()).toEqual([]);
  }, 20000);
});

describe("access", () => {
  it("read-only: banner and no write actions", async () => {
    boot("/precision/category/logistics/preview", { mock: "preset:logisticsConfirmed,access:read_only" });
    await screen.findByRole("heading", { level: 1 }, WAIT);
    await waitFor(() => expect(document.body.textContent).toMatch(/Your Premium plan ended/), WAIT);
    await waitFor(() => expect(document.body.textContent).toMatch(/Operation Hub/), WAIT);
    const send = screen.queryByRole("button", { name: /^Send to Operation Hub$/ });
    expect(send === null || send.hasAttribute("disabled") || send.getAttribute("aria-disabled") === "true").toBe(true);
    expect(document.body.textContent).toMatch(/can't send it right now/);
  });

  it("revoked: a dedicated page and no data", async () => {
    boot("/precision/center", { mock: "access:revoked" });
    await h1(/Your access to Precision ended/);
    expect(document.body.textContent).not.toMatch(/Northwind/);
    expect(bodyHits()).toEqual([]);
  });

  it("unknown address: a friendly 404", async () => {
    boot("/precision/nope", { mock: "preset:mapConfirmed" });
    await h1(/We can't find that page/);
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
    expect(bodyHits()).toEqual([]);
  });
});

describe("conversation", () => {
  it("answers a quick reply and keeps the thread; AI unavailable keeps the answer and retries", async () => {
    const { server } = boot("/precision/understanding");
    const yes = await screen.findByRole("button", { name: /Yes, that is right/ }, WAIT);
    server.control.inject("ai_unavailable");
    await userEvent.click(yes);
    expect(await screen.findByText(/I'm having trouble continuing the conversation/, undefined, { timeout: 10000 })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ai_unavailable|undefined|Error/);
    await userEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(screen.queryByText(/I'm having trouble continuing/)).not.toBeInTheDocument(), { timeout: 10000 });
    const log = screen.getByRole("log");
    expect(within(log).getAllByText(/./).length).toBeGreaterThan(2);
    expect(bodyHits()).toEqual([]);
  }, 30000);
});
