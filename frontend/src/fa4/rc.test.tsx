import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactDialog } from "./components/HelpContact";
import { ApiError, confirmSend, track } from "./api";

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Hablar con beeside", () => {
  const prefill = { name: "Lucía", company: "Nórtica Envases", email: "lucia@nortica.example" };
  it("never claims the message was sent before the server confirms; a failed send can be retried with the SAME request id", async () => {
    const ids: string[] = [];
    let ok = false;
    const onSend = vi.fn(async (p: { clientRequestId: string }) => { ids.push(p.clientRequestId); return ok; });
    HTMLDialogElement.prototype.showModal ||= function () { this.setAttribute("open", ""); };
    render(<ContactDialog locale="es" prefill={prefill} onSend={onSend as never} onClose={() => undefined} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Mensaje"), "Hola, quiero hablar de la logística");
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(/Recibimos tu mensaje/)).toBeNull();
    ok = true;
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    await screen.findByText(/Recibimos tu mensaje/);
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  });
  it("the Help link opens the canonical Help Center in a new tab", async () => {
    const { TopActions } = await import("./components/HelpContact");
    render(<TopActions locale="es" helpScreen="cover" helpFlags={{ E: false, F: false, J: true, P: true, stabilization: false }} saveSlot={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Ayuda" }));
    const link = screen.getAllByRole("link", { name: /Necesito ayuda/ })[0] as HTMLAnchorElement;
    expect(link.href).toBe("https://www.beeside.you/helpcenter"); expect(link.target).toBe("_blank"); expect(link.rel).toContain("noopener");
    fireEvent.click(link);
  });
});

describe("confirmSend (queued ≠ sent)", () => {
  const stub = (states: string[]) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ state: states.shift() ?? "pending" }), { status: 200, headers: { "Content-Type": "application/json" } })));
  it("pending → resolves `sent` only once the status endpoint confirms", async () => {
    stub(["pending", "sent"]);
    const r = await confirmSend(Promise.resolve({ state: "pending" as const, email: "a***@b.c" }), "resume", { intervalMs: 1, timeoutMs: 500 });
    expect(r.state).toBe("sent");
  });
  it("pending → failed throws; pending forever throws; neither is ever reported as sent", async () => {
    stub(["failed"]);
    await expect(confirmSend(Promise.resolve({ state: "pending" as const }), "result", { intervalMs: 1, timeoutMs: 100 })).rejects.toBeInstanceOf(ApiError);
    stub([]);
    await expect(confirmSend(Promise.resolve({ state: "pending" as const }), "result", { intervalMs: 1, timeoutMs: 20 })).rejects.toBeInstanceOf(ApiError);
    await expect(confirmSend(Promise.resolve({ state: "pending" as const }), null)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("event capture", () => {
  it("sends a random per-tab visit id and a closed vocabulary — no email, no free text", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    track("visit"); track("step_viewed", { step: "identity" });
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    const bodies = f.mock.calls.map((c) => JSON.parse((c as unknown as [string, { body: string }])[1].body));
    expect(bodies[0].visitId).toMatch(/^[0-9a-f-]{36}$/); expect(bodies[0].visitId).toBe(bodies[1].visitId);
    expect(JSON.stringify(bodies)).not.toMatch(/@|lucia/i);
  });
});
