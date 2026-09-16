import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { makeT } from "./copy";
import { Identity } from "./screens/Identity";
import { TEST_BUNDLE } from "./test-fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderIdentity() {
  const onStarted = vi.fn();
  const onExistingEmail = vi.fn();
  render(<Identity bundle={TEST_BUNDLE} t={makeT(TEST_BUNDLE, "es")} locale="es" onStarted={onStarted} onExistingEmail={onExistingEmail} />);
  return { onStarted, onExistingEmail };
}

// The test bundle carries no identity copy, so fields are addressed by their stable ids.
function field(name: string): HTMLInputElement {
  return document.getElementById(`identity-${name}`) as HTMLInputElement;
}

function fill() {
  for (const [name, text] of [
    ["firstName", "Ana"],
    ["lastName", "Rivera"],
    ["company", "Northwind Manufacturing S.A. de C.V."],
    ["email", "ana.rivera@northwind-test.example"],
  ] as const) {
    fireEvent.change(field(name), { target: { value: text } });
  }
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("identity form", () => {
  it("never exposes the anti-abuse honeypot to a person or to assistive technology", () => {
    renderIdentity();
    // No respondent — sighted, keyboard or screen-reader — is ever offered this field.
    expect(screen.queryByLabelText(/reference code/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reference code/i)).not.toBeInTheDocument();
    const honeypot = document.getElementById("identity-reference-code") as HTMLInputElement;
    expect(honeypot).toBeTruthy();
    expect(honeypot.getAttribute("aria-hidden")).toBe("true");
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.autocomplete).toBe("off");
    expect(honeypot.closest(".honeypot")?.getAttribute("aria-hidden")).toBe("true");
    // Only the real fields are reachable by keyboard.
    expect(screen.getAllByRole("textbox").some((field) => field.id === "identity-reference-code")).toBe(false);
  });

  it("sends the anti-abuse signals with the identity, without showing them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "started", sessionToken: "session-token-value" }), { status: 201, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onStarted } = renderIdentity();

    fill();
    fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("session-token-value"));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ firstName: "Ana", lastName: "Rivera", email: "ana.rivera@northwind-test.example", acceptLegal: true, referenceCode: "" });
    expect(typeof body.formElapsedMs).toBe("number");
    expect(body.formElapsedMs as number).toBeGreaterThanOrEqual(0);
  });

  it("refuses to continue until the Privacy Policy and Terms are accepted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderIdentity();

    fireEvent.change(field("firstName"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));

    // Nothing is submitted, and the consent itself is marked invalid for assistive technology.
    await waitFor(() => expect(screen.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
