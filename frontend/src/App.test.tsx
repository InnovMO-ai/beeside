import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useRef, useState } from "react";
import { App } from "./App";
import { ApiError } from "./fa/api";
import { saveWithRetry } from "./fa/autosave";
import { makeT } from "./fa/copy";
import { QuestionField } from "./fa/components/QuestionField";
import { Journey } from "./fa/screens/Journey";
import { jsonResponse, TEST_BUNDLE, testView } from "./fa/test-fixtures";
import { SessionView } from "./fa/types";
import { searchCountries, timingParts, timingValue, toggleMulti } from "./fa/values";

type FetchCall = { url: string; method: string; body: unknown };

function mockFetch(handler: (call: FetchCall) => Response) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("answer helpers", () => {
  it("keeps 'Not sure' mutually exclusive and preserves canonical order", () => {
    const order = ["banking", "insurance", "not_sure"];
    expect(toggleMulti(["insurance"], "banking", true, ["not_sure"], order)).toEqual(["banking", "insurance"]);
    expect(toggleMulti(["banking", "insurance"], "not_sure", true, ["not_sure"], order)).toEqual(["not_sure"]);
    expect(toggleMulti(["not_sure"], "banking", true, ["not_sure"], order)).toEqual(["banking"]);
    expect(toggleMulti(["banking"], "banking", false, ["not_sure"], order)).toEqual([]);
  });

  it("builds timing answers only when complete, and round-trips them", () => {
    const empty = { date: "", month: "", monthYear: "", quarter: "", quarterYear: "" };
    expect(timingValue("month", { ...empty, month: "03" })).toBeNull();
    expect(timingValue("month", { ...empty, month: "03", monthYear: "2027" })).toEqual({ precision: "month", value: "2027-03" });
    expect(timingValue("quarter", { ...empty, quarter: "2", quarterYear: "2027" })).toEqual({ precision: "quarter", value: "2027-Q2" });
    expect(timingValue("not_sure", empty)).toEqual({ precision: "not_sure", value: null });
    expect(timingParts({ precision: "quarter", value: "2027-Q2" })).toMatchObject({ quarter: "2", quarterYear: "2027" });
  });

  it("finds countries by localized, accent-insensitive name", () => {
    expect(searchCountries(["MX", "US", "CA"], "mexico", "es", [])).toEqual(["MX"]);
    expect(searchCountries(["MX", "US", "CA"], "can", "en", [])).toEqual(["CA"]);
    expect(searchCountries(["MX", "US"], "mex", "en", ["MX"])).toEqual([]);
  });

  it("retries server failures but never a refused (4xx) save", async () => {
    const sleep = () => Promise.resolve();
    let calls = 0;
    const flaky = await saveWithRetry(async () => {
      calls += 1;
      if (calls < 3) throw new ApiError(503, "NOT_READY");
      return "ok";
    }, { sleep });
    expect(flaky).toEqual({ ok: true, value: "ok" });
    expect(calls).toBe(3);

    let refused = 0;
    const result = await saveWithRetry(async () => {
      refused += 1;
      throw new ApiError(409, "NOT_APPLICABLE");
    }, { sleep });
    expect(result.ok).toBe(false);
    expect(refused).toBe(1);
  });
});

describe("App", () => {
  it("opens on the Welcome screen with copy from the published question bank", async () => {
    mockFetch((call) => (call.url.endsWith("/bundles/current") ? jsonResponse({ version: "fa-qb-1.0.0", bundle: TEST_BUNDLE }) : jsonResponse({ accepted: 1 })));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Your expansion starts with a clearer picture." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "beeside" })).toBeInTheDocument();
  });

  it("shows an unavailable state, never the identity form, where the First Assessment API is not enabled", async () => {
    mockFetch(() => new Response("<!doctype html><html></html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    render(<App />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("removes a private resume token from the address bar before opening it", async () => {
    window.history.replaceState(null, "", "/resume/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
    const calls = mockFetch((call) => {
      if (call.url.endsWith("/bundles/current")) return jsonResponse({ version: "fa-qb-1.0.0", bundle: TEST_BUNDLE });
      if (call.url.endsWith("/links/open")) return jsonResponse({ error: "NOT_FOUND" }, 404);
      return jsonResponse({});
    });
    render(<App />);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/links/open"))).toBe(true));
    expect(window.location.pathname).toBe("/");
    expect(calls.find((c) => c.url.endsWith("/links/open"))?.body).toEqual({ token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" });
  });
});

function JourneyHarness({ initial }: { initial: SessionView }) {
  const [view, setView] = useState(initial);
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  return (
    <Journey
      bundle={TEST_BUNDLE}
      t={makeT(TEST_BUNDLE, "en")}
      locale="en"
      view={view}
      countries={[]}
      flushRef={flushRef}
      onView={setView}
      onSaveStatus={() => undefined}
      onStageChange={() => undefined}
      onCompleted={() => undefined}
      onSessionLost={() => undefined}
    />
  );
}

describe("Journey", () => {
  it("asks for a required answer calmly, autosaves the choice, then moves to the next question", async () => {
    const calls = mockFetch((call) => {
      if (call.method === "PUT") return jsonResponse(testView({ answers: { G1: (call.body as { value: unknown }).value } }));
      return jsonResponse({ accepted: 1 });
    });
    render(<JourneyHarness initial={testView()} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please answer to continue.");

    fireEvent.click(screen.getByRole("radio", { name: "Not sure yet" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/session/answers/G1"))).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ value: "not_sure" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: /What could affect your plan\?/ })).toBeInTheDocument();
  });

  it("resumes at the first unanswered question, completes the step and continues to the next applicable step", async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith("/steps/goal/complete")) return jsonResponse(testView({ currentStepId: "business_transition", lastCompletedStepId: "goal", answers: { G1: "enter_market" } }));
      return jsonResponse({ accepted: 1 });
    });
    render(<JourneyHarness initial={testView({ answers: { G1: "enter_market" } })} />);
    expect(screen.getByRole("heading", { name: /What could affect your plan\?/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Now your business." })).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/steps/goal/complete"))).toBe(true);
  });
});

describe("QuestionField", () => {
  const t = makeT(TEST_BUNDLE, "en");

  it("adds the best country match with Enter and removes it from the chips", () => {
    const onChange = vi.fn();
    const question = { id: "P1", field_key: "fa.project.target_markets", type: "country_list" as const, required: true, copy: { en: { title: "Which country?" }, es: { title: "¿Qué país?" } } };
    const { rerender } = render(
      <QuestionField bundle={TEST_BUNDLE} question={question} locale="en" t={t} value={null} countries={["MX", "US", "CA"]} showRequiredError={false} onChange={onChange} />,
    );
    const input = screen.getByRole("combobox", { name: "Which country?" });
    fireEvent.change(input, { target: { value: "mex" } });
    expect(screen.getByRole("button", { name: "Mexico" })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["MX"], "now");

    rerender(<QuestionField bundle={TEST_BUNDLE} question={question} locale="en" t={t} value={["MX"]} countries={["MX", "US", "CA"]} showRequiredError={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "country_remove Mexico" }));
    expect(onChange).toHaveBeenLastCalledWith(null, "now");
  });

  it("never marks a 'Not sure' answer as an error and keeps it exclusive", () => {
    const onChange = vi.fn();
    const question = TEST_BUNDLE.questions[1];
    render(<QuestionField bundle={TEST_BUNDLE} question={question} locale="en" t={t} value={["banking"]} countries={[]} showRequiredError={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Not sure" }));
    expect(onChange).toHaveBeenLastCalledWith(["not_sure"], "now");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
