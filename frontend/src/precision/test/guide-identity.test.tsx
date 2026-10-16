import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import type { ResourceLinkDto } from "../api/dto";
import { ApiFailure } from "../api/transport";
import { I18nProvider } from "../i18n";
import { setupDom } from "./harness";

let current: (id: string) => Promise<ResourceLinkDto> = async () => { throw new Error("unset"); };
vi.mock("../state/app", async (orig) => {
  const real = await orig<typeof import("../state/app")>();
  return { ...real, useSession: () => ({ client: { resource: (id: string) => current(id) } }) };
});
import { ResourceLink } from "../screens/Workspace";

setupDom();
vi.setConfig({ testTimeout: 30000 });
const wrap = (n: ReactNode, locale: "en" | "es" = "en") => render(<I18nProvider initial={locale}>{n}</I18nProvider>);
const dto = (ref: string, format: "pdf" | "web"): ResourceLinkDto => ({ id: "r1", title: "Doing Business in Mexico", kind: "url", ref, format });

describe("country guide offer (Doing Business)", () => {
  it("a PDF guide offers View guide and Download PDF, both from the configured destination", async () => {
    current = async () => dto("https://files.example/guides/doing-business-mx.pdf", "pdf");
    wrap(<ResourceLink offer={{ id: "r1", title: "Doing Business in Mexico" }} />);
    const view = await screen.findByRole("link", { name: /View guide/ });
    const dl = screen.getByRole("link", { name: /Download PDF/ });
    expect(view).toHaveAttribute("href", "https://files.example/guides/doing-business-mx.pdf");
    expect(view).toHaveAttribute("target", "_blank");
    expect(view.getAttribute("rel")).toMatch(/noopener/);
    expect(dl).toHaveAttribute("href", "https://files.example/guides/doing-business-mx.pdf");
    expect(dl).toHaveAttribute("download");
    expect(screen.getByText("Doing Business in Mexico")).toBeInTheDocument();
  });

  it("a web guide offers only View guide", async () => {
    current = async () => dto("https://example.org/guide", "web");
    wrap(<ResourceLink offer={{ id: "r1", title: "Doing Business in Mexico" }} />);
    await screen.findByRole("link", { name: /View guide/ });
    expect(screen.queryByRole("link", { name: /Download PDF/ })).toBeNull();
  });

  it("Spanish labels", async () => {
    current = async () => dto("https://files.example/g.pdf", "pdf");
    wrap(<ResourceLink offer={{ id: "r1", title: "Hacer negocios en México" }} />, "es");
    await screen.findByRole("link", { name: /Ver guía/ });
    expect(screen.getByRole("link", { name: /Descargar PDF/ })).toBeInTheDocument();
  });

  it("an unavailable guide says so and never blocks; an unsafe destination is never linked", async () => {
    current = async () => { throw new ApiFailure("http", 404, "NOT_FOUND", false); };
    const a = wrap(<ResourceLink offer={{ id: "r1", title: "x" }} />);
    await screen.findByText(/no longer available/);
    a.unmount();
    current = async () => dto("http://insecure.example/g.pdf", "pdf");
    wrap(<ResourceLink offer={{ id: "r1", title: "x" }} />);
    await screen.findByText(/no longer available/);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

