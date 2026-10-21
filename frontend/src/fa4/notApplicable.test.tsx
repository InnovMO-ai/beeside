import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { journeyA, journeyB, journeyC, journeyNortica } from "@beeside/fa-public-engine/testing";
import { ResultScreen } from "./components/ResultScreen";
import { modelFor } from "./fa4.test-helpers";

afterEach(cleanup);
/** DSC-07 — «Temas que no aplican a tu proyecto»: topics only, never an unapproved reason (the model keeps its data; the YEV does not show the text). */
const REASONS = ["No abrirás oficina", "No tendrás espacio propio", "El proyecto no incluye vender allí", "No moverás bienes", "Presencia permanente",
  "You won't open an office", "You won't have premises of your own", "The project does not include selling there", "You won't move goods", "Permanent presence"];

describe("YEV «topics that don't apply»", () => {
  const cases = (loc: "es" | "en") => [journeyA(loc), journeyB(loc, "unknown"), journeyC(loc, "unknown"), journeyNortica(loc)].map(modelFor).filter((m) => m.destinations.some((d) => d.notApplicable.length > 0));
  it("the fixtures include cases with topics that do not apply (otherwise this test would prove nothing)", () => { expect(cases("es").length).toBeGreaterThan(0); });
  it.each([["es", "Temas que no aplican a tu proyecto"], ["en", "Topics that don't apply to your project"]] as const)("(%s) shows the approved heading and the topics, with NO reason text", (loc, heading) => {
    for (const m of cases(loc)) {
      const { container, unmount } = render(<ResultScreen model={m} locale={loc} />);
      expect(screen.getAllByText(heading).length).toBeGreaterThan(0);
      const names = m.destinations.flatMap((d) => d.notApplicable.flatMap((n) => n.fronts.map((f) => f.name[loc])));
      for (const n of names) expect(container.textContent).toContain(n);
      for (const r of REASONS) expect(container.textContent ?? "", r).not.toContain(r);
      expect(container.textContent).not.toContain(loc === "es" ? "No aplican, por lo que nos contaste" : "Not relevant, based on what you told us");
      unmount();
    }
  });
});
