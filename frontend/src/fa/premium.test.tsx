import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PremiumSource, PremiumTransition } from "./components/PremiumTransition";
import { makeT } from "./copy";
import { ResumeLink } from "./screens/ResumeLink";
import { jsonResponse, TEST_BUNDLE } from "./test-fixtures";
import { LinkChoices, PremiumActivationResult, PremiumContent, PremiumCopy, PremiumStatus, RenderedSnapshot, SnapshotView } from "./types";

const COPY: PremiumCopy = {
  transition: {
    eyebrow: "What comes next",
    headline: "You have the picture. Now let’s add precision.",
    body: "Continue with beeside Premium to validate what matters most.",
    continue_cta: "Continue with Premium",
    explore_cta: "Explore Premium",
    explore_helper: "Not ready yet? See examples.",
    new_tab: "(opens in a new tab)",
  },
  consideration: {
    eyebrow: "beeside Premium",
    title: "What changes when you continue with beeside",
    intro: "Premium builds on your Snapshot.",
    pillars: ["AI-assisted Precision RFI", "Your Sherpa", "Specialized strategic advisory", "Operation Hub", "Trusted local ecosystem"].map((title, i) => ({ key: `p${i}`, title, body: `${title} body` })),
    outcomes_title: "What the connected ecosystem lets you do",
    outcomes: ["Protect management time", "Make better-informed decisions"],
    candidate_line: "Expand your business. Not your workload.",
    next_cta: "See how activation works",
    back: "Back to my Snapshot",
  },
  activation: {
    title: "Before you activate Premium",
    points: ["You don’t restart discovery."],
    terms_prefix: "I accept the",
    terms_label: "Terms & Conditions",
    terms_required: "Please accept the Terms & Conditions to continue.",
    activate_cta: "Activate Premium",
    reactivate_cta: "Reactivate Premium",
    back: "Back",
    error: "We couldn’t register your request.",
  },
  result: { pending_title: "Your Premium request is registered", pending_body: "beeside will confirm.", active_title: "Premium is active for this project", active_body: "Precision begins." },
  status: {
    active_title: "Your Premium project is active",
    active_body: "Your project continues in Premium.",
    scheduled_body: "Premium stays active until {{until}}.",
    lapsed_title: "Your Premium access has ended",
    lapsed_body: "You can reactivate Premium for this same project.",
    pending_title: "Your Premium request is registered",
    pending_body: "beeside will confirm your activation.",
  },
};
const CONTENT: PremiumContent = {
  version: "premium-content-1.0.0",
  previewRoomUrl: "https://www.beeside.you/preview",
  termsUrl: "https://www.beeside.you/termsandconditions",
  copy: { en: COPY, es: COPY },
};

function status(overrides: Partial<PremiumStatus> = {}): PremiumStatus {
  return {
    available: true, everActivated: false, accessActive: false, subscriptionStatus: null, accessUntil: null, pendingRequest: null,
    canActivate: true, canReactivate: false, previewRoomUrl: CONTENT.previewRoomUrl, termsUrl: CONTENT.termsUrl, ...overrides,
  };
}

function source(current: PremiumStatus) {
  const activate = vi.fn<[boolean], Promise<PremiumActivationResult>>(async () => ({
    outcome: { kind: "pending_confirmation" },
    status: status({ canActivate: false, pendingRequest: { kind: "activation", requestedAt: "2026-09-15T12:00:00Z" } }),
  }));
  const premium: PremiumSource = { loadContent: async () => CONTENT, loadStatus: async () => current, activate };
  return { ...premium, activate };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ accepted: 1 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PremiumTransition", () => {
  it("offers the two post-Snapshot paths without a price", async () => {
    render(<PremiumTransition locale="en" source={source(status())} />);
    expect(await screen.findByRole("heading", { level: 2, name: "You have the picture. Now let’s add precision." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Premium" })).toBeInTheDocument();
    const preview = screen.getByRole("link", { name: /Explore Premium/ });
    expect(preview).toHaveAttribute("href", "https://www.beeside.you/preview");
    expect(preview).toHaveAttribute("target", "_blank");
    expect(preview.getAttribute("rel")).toContain("noopener");
    expect(document.body.textContent).not.toMatch(/\$|price|USD|MXN|unlock/i);
  });

  it("walks through consideration and activation, requiring the Terms before registering the request", async () => {
    const premium = source(status());
    render(<PremiumTransition locale="en" source={premium} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue with Premium" }));

    expect(screen.getByRole("heading", { level: 2, name: "What changes when you continue with beeside" })).toHaveFocus();
    for (const pillar of COPY.consideration.pillars) expect(screen.getByRole("heading", { level: 3, name: pillar.title })).toBeInTheDocument();
    expect(screen.getByText("Expand your business. Not your workload.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "See how activation works" }));
    expect(screen.getByRole("heading", { level: 2, name: "Before you activate Premium" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Terms & Conditions/ })).toHaveAttribute("href", "https://www.beeside.you/termsandconditions");

    fireEvent.click(screen.getByRole("button", { name: "Activate Premium" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please accept the Terms & Conditions to continue.");
    expect(premium.activate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Activate Premium" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Your Premium request is registered" })).toBeInTheDocument();
    expect(premium.activate).toHaveBeenCalledWith(true);
  });

  it("shows the Premium state instead of the offer once the project is active", async () => {
    render(<PremiumTransition locale="en" source={source(status({ everActivated: true, accessActive: true, canActivate: false, subscriptionStatus: "CANCELLATION_SCHEDULED", accessUntil: "2026-10-15T12:00:00Z" }))} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Your Premium project is active" })).toBeInTheDocument();
    expect(screen.getByText(/Premium stays active until October 15, 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Premium" })).not.toBeInTheDocument();
  });

  it("offers reactivation of the same project when Premium access has ended", async () => {
    const premium = source(status({ everActivated: true, canActivate: false, canReactivate: true, subscriptionStatus: "PREMIUM_INACTIVE" }));
    render(<PremiumTransition locale="en" source={premium} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Your Premium access has ended" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reactivate Premium" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Reactivate Premium" }));
    await waitFor(() => expect(premium.activate).toHaveBeenCalledWith(true));
  });

  it("renders nothing before the First Assessment is complete or when Premium cannot load", async () => {
    const unavailable = source(status({ available: false, canActivate: false }));
    const { container } = render(<PremiumTransition locale="en" source={unavailable} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const broken: PremiumSource = { loadContent: async () => CONTENT, loadStatus: async () => Promise.reject(new Error("offline")), activate: vi.fn() };
    const second = render(<PremiumTransition locale="en" source={broken} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(second.container).toBeEmptyDOMElement();
  });
});

describe("ResumeLink for a completed project", () => {
  const rendered: RenderedSnapshot = {
    eyebrow: "Your Expansion Snapshot", headline: "Your project, in perspective.", generatedOn: "Generated on September 15, 2026", summary: [], facts: [], counts: [], panels: [],
    immediatePriority: null, reconcile: null, decisionAhead: null, shapePlan: null, oneThing: null, capabilities: null,
    disclosure: { title: "About this Snapshot", text: "Based on what you shared." },
  };
  const snapshotView: SnapshotView = {
    snapshotId: "snap-1", generatedAt: "2026-09-15T12:00:00Z",
    content: { schema_version: 1, kind: "expansion_snapshot", generated_at: "2026-09-15T12:00:00Z", deliverable_locale: "en", locales: { en: rendered, es: rendered } },
  };

  function mount(premium: LinkChoices["premium"], premiumStatus: PremiumStatus) {
    const choices: LinkChoices = { companyName: "Northwind", interfaceLanguage: "en", canContinue: false, canRecover: false, closed: false, completed: true, anotherProjectInMind: false, accessUntil: null, premium };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/links/open")) return jsonResponse(choices);
        if (url.endsWith("/links/snapshot")) return jsonResponse(snapshotView);
        if (url.endsWith("/links/premium")) return jsonResponse(premiumStatus);
        if (url.endsWith("/premium/content")) return jsonResponse(CONTENT);
        return jsonResponse({ accepted: 0 });
      }),
    );
    render(<ResumeLink bundle={TEST_BUNDLE} t={makeT(TEST_BUNDLE, "en")} locale="en" token="resume-token-0123456789abcdef" onLocale={() => undefined} onSession={async () => undefined} />);
  }

  it("never activated: Snapshot, the Premium offer and the separate new-project options", async () => {
    mount({ everActivated: false, accessActive: false }, status());
    expect(await screen.findByRole("button", { name: "Continue with Premium" })).toBeInTheDocument();
    expect(document.querySelector(".snapshot-next")).not.toBeNull();
  });

  it("lapsed Premium: Snapshot and reactivation of the same project, without a new-project prompt", async () => {
    mount({ everActivated: true, accessActive: false }, status({ everActivated: true, canActivate: false, canReactivate: true, subscriptionStatus: "PREMIUM_INACTIVE" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Your Premium access has ended" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Your project, in perspective." })).toBeInTheDocument();
    expect(document.querySelector(".snapshot-next")).toBeNull();
  });
});
