import { buildServiceMapContent, openItemsFromEvaluations, type ServiceMapBuildInput } from "../service-map-content";
import { evaluateCategory } from "../readiness";
import { load } from "./helpers";

const input = (): ServiceMapBuildInput => ({
  locale: "es",
  project: { objective: "  Exportar   a EE. UU. ", destinations: ["us", "MX", "US"], timeWindow: "2027", productOrService: null, operatingEntity: "" },
  categories: [
    { categoryKey: "tax_accounting_audit", needs: [{ id: "n3", label: "Registro fiscal", priority: "low" }] },
    { categoryKey: "new:public_procurement", needs: [{ id: "n9", label: "Licitaciones" }] },
    { categoryKey: "logistics", needs: [{ id: "n2", label: "Transporte", priority: "medium" }, { id: "n1", label: "Almacén", priority: "high", state: "confirmed" }, { id: "n1", label: "dup" }] },
    { categoryKey: "new:other_thing", needs: [{ id: "n10", label: "Otra cosa" }] },
    { categoryKey: "strategic_advisory", needs: [{ id: "n4", label: "Estudio de mercado" }] },
  ],
  contextPinId: "pin-1",
  versions: { catalog: "c1", manifests: { logistics: "1.0.abc", _generic: "1.0.def" } },
});

describe("psm.v1 content", () => {
  it("is deterministic and independent of input order", () => {
    const a = buildServiceMapContent(input());
    const rev = input();
    rev.categories.reverse();
    expect(JSON.stringify(buildServiceMapContent(rev))).toBe(JSON.stringify(a));
  });
  it("orders groups by catalog order, merges all new:* into one neutral group placed last, and sorts items", () => {
    const c = buildServiceMapContent(input());
    expect(c.schema).toBe("psm.v1");
    expect(c.groups.map((g) => g.categoryKey)).toEqual(["tax_accounting_audit", "logistics", "strategic_advisory", "new:review"].sort((x, y) => order(x) - order(y)));
    const last = c.groups[c.groups.length - 1];
    expect(last?.kind).toBe("to_review");
    expect(last?.items.map((i) => i.id)).toEqual(["n9", "n10"]) // same priority: by label;
    const lg = c.groups.find((g) => g.categoryKey === "logistics");
    expect(lg?.items.map((i) => i.id)).toEqual(["n1", "n2"]); // priority, duplicates dropped
    expect(lg?.items[0]?.state).toBe("confirmed");
  });
  it("renders destinations in the locale, trims text and stores versions without showing them", () => {
    const c = buildServiceMapContent(input());
    expect(c.project).toEqual({ objective: "Exportar a EE. UU.", destinations: ["Estados Unidos", "México"], timeWindow: "2027", productOrService: null, operatingEntity: null });
    expect(c.versions.manifests).toEqual({ _generic: "1.0.def", logistics: "1.0.abc" });
    expect(c.contextPinId).toBe("pin-1");
    const rendered = JSON.stringify([c.project, c.groups.map((g) => [g.label, g.items.map((i) => i.label)])]);
    expect(rendered).not.toMatch(/new:|_generic|public_procurement/);
  });
  it("groups carry customer labels in EN and ES", () => {
    const en = buildServiceMapContent({ ...input(), locale: "en" });
    expect(en.groups.find((g) => g.categoryKey === "logistics")?.label).toBe("Logistics");
    expect(en.project.destinations).toEqual(["United States", "Mexico"]);
  });
  it("open items come from evaluations, critical first, deterministic", () => {
    const rows = [
      { categoryKey: "logistics", evaluation: evaluateCategory({ manifest: load("logistics"), facts: {}, countries: ["US"] }) },
      { categoryKey: "strategic_advisory", evaluation: evaluateCategory({ manifest: load("strategic_advisory"), facts: {}, countries: [] }) },
    ];
    const a = openItemsFromEvaluations("en", rows);
    expect(a.length).toBe(2);
    expect(a[0]).toMatch(/^Logistics: /);
    expect(openItemsFromEvaluations("en", [...rows].reverse())).toEqual(a);
    expect(openItemsFromEvaluations("es", rows)[0]).toMatch(/^Logística: /);
  });
});

import { categoryInfo } from "../categories";
function order(k: string): number {
  return k === "new:review" ? 1000 : categoryInfo(k).order;
}
