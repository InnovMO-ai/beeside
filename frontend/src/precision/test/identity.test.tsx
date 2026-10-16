import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { boot, setupDom } from "./harness";
import { initialsOf } from "../ui/Shell";

setupDom();
vi.setConfig({ testTimeout: 30000 });
const WAIT = { timeout: 8000 };

describe("user identity (bottom-left)", () => {
  it("initials come from the real name", () => {
    expect(initialsOf("Mariana Torres")).toBe("MT");
    expect(initialsOf("Ana María de la Cruz")).toBe("AC");
    expect(initialsOf("Madonna")).toBe("M");
    expect(initialsOf("  érika   núñez ")).toBe("ÉN");
    expect(initialsOf("")).toBe("");
  });

  it("shows initials, the Person's name and PREMIUM, never Plus", async () => {
    boot("/precision/center", { mock: "preset:mapConfirmed", locale: "en" });
    const group = await screen.findByRole("group", { name: "Your account" }, WAIT);
    expect(group).toHaveTextContent("MT");
    expect(group).toHaveTextContent("Mariana Torres");
    expect(group).toHaveTextContent("PREMIUM");
    expect(document.body.textContent).not.toMatch(/\bPlus\b/);
  });

  it("read-only access keeps the name but drops the PREMIUM label", async () => {
    boot("/precision/center", { mock: "preset:mapConfirmed,access:read_only" });
    const group = await screen.findByRole("group", { name: "Your account" }, WAIT);
    expect(group).toHaveTextContent("Mariana Torres");
    await waitFor(() => expect(group).not.toHaveTextContent("PREMIUM"));
  });
});
