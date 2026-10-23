import { bundledCategoryManifest } from "../../manifest/bundled";
import { evaluateCategory } from "../../manifest/readiness";
import { MATERIAL_OVERLAY_KEY } from "../../manifest/material";
import type { FactMap } from "../../manifest/types";
import { deriveInherited } from "../category-inheritance";
import { deriveMaterial } from "../category-materiality";
import { materialSignals } from "../material-signals";
import { runPersona, type Persona } from "./harness";
import type { DiscoverySeedInput } from "../seed";

const NARRATIVE =
  "Somos una empresa portuguesa. Fuimos subcontratados por las empresas ganadoras de proyectos del sector energético en México y vamos a estar operando allá durante unos 2 a 3 años. Necesitamos constituir una entidad local, apoyo legal, fiscal, laboral, contratar gente, algunos directamente y otros por medio de un tercero, seguridad social, contabilidad y cumplimiento fiscal. La casa matriz en Portugal va a financiar la operación en México y habrá operaciones intercompañía.";
const SEED: DiscoverySeedInput = {
  locale: "es", destinationCodes: ["MX"], sector: "Energía", objective: "Establecer operaciones en México",
  operatingCountries: ["PT"], needs: [{ capabilityId: "company_incorporation_corporate_setup", label: "Constitución de la entidad", priority: "high" }],
};
const PERSONA: Persona = {
  opening: NARRATIVE,
  answers: {
    "entity.form": "Todavía no lo hemos decidido, queremos que nos asesoren.", "entity.funding_structure": "Sería un préstamo, aunque no está definido del todo.",
    "workforce.headcount": "Unas 60 personas en total.", "workforce.split": "Unas 20 directas y 40 subcontratadas.",
    "tax.intercompany": "Servicios de gestión de la matriz y venta de equipo a la filial.",
  },
  priority: "Primero la entidad local y la contratación. Lo fiscal puede esperar.", implied: "yes",
};

const manifestOf = (k: string) => bundledCategoryManifest(k)!;
const fieldsOf = (k: string) => new Map(manifestOf(k).fields.map((f) => [f.field_key, f]));
const A = (value: unknown, answerState: "ANSWERED" | "UNKNOWN" | "WITHHELD" | "EXPLICIT_NO" = "ANSWERED") => ({ value, answerState });

/** Everything the manifest generically requires for Fiscal, answered; only the material overlay can keep it from being ready. */
function genericTaxAnswers(extra: FactMap = {}): FactMap {
  return {
    tax_services_in_scope: A(["tax_registration"]), tax_registration_status: A("not_registered"), tax_fiscal_year_end: A("2026-12-31"),
    tax_accounting_framework: A("ifrs"), tax_parent_reporting_required: A(false), tax_has_intercompany_transactions: A(true),
    tax_intercompany_transactions: A([{ transaction_type: "services", counterparty_country: ["PT"] }]), ...extra,
  } as FactMap;
}

describe("materiality — readiness is material sufficiency for THIS project", () => {
  const run = runPersona("es", SEED, PERSONA);
  const frame = run.conv.frame;

  it("derives cross-cutting signals from what the client said (Portuguese parent, parent loan, intra-group services and goods)", () => {
    const keys = materialSignals(frame).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["foreign_parent", "parent_funding", "parent_loan", "intercompany_services", "intercompany_goods", "workforce_third_party"]));
  });

  it("an AI proposal is never a signal", () => {
    const f = JSON.parse(JSON.stringify(frame)) as typeof frame;
    for (const i of Object.values(f.items)) { i.provenance = "ai_understood"; i.status = "proposed"; }
    f.countries = f.countries.map((c) => ({ ...c, provenance: "ai_understood" as const }));
    expect(materialSignals(f)).toEqual([]);
  });

  it("Fiscal: a Portuguese parent with intra-group transactions makes TP documentation status and the agreement/value facts material", () => {
    const o = deriveMaterial(frame, "tax_accounting_audit");
    const fields = o.items.map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(["tax_transfer_pricing_documentation_status", "tax_intercompany_transactions", "tax_parent_reporting_required", "tax_accounting_framework"]));
    expect(o.items.find((i) => i.field === "tax_intercompany_transactions")!.subs).toEqual(expect.arrayContaining(["written_agreement", "expected_annual_value"]));
  });

  it("a parent loan is inherited as an intra-group financing transaction", () => {
    const tax = deriveInherited(frame, "tax_accounting_audit", fieldsOf("tax_accounting_audit") as never);
    const tx = tax.find((f) => f.fieldKey === "tax_intercompany_transactions")!.value as Array<{ transaction_type: string }>;
    expect(tx.map((x) => x.transaction_type)).toEqual(expect.arrayContaining(["services", "goods", "financing"]));
  });

  it("the generic manifest alone says Fiscal is ready; with the material overlay it is NOT until the material dimensions are explored", () => {
    const manifest = manifestOf("tax_accounting_audit");
    const generic = evaluateCategory({ manifest, facts: genericTaxAnswers(), countries: ["MX"] });
    expect(generic.ready).toBe(true); // the old rule: generic blocking fields complete

    const overlay = deriveMaterial(frame, "tax_accounting_audit");
    const facts = genericTaxAnswers({ [MATERIAL_OVERLAY_KEY]: A(overlay) });
    const ev = evaluateCategory({ manifest, facts, countries: ["MX"] });
    expect(ev.ready).toBe(false);
    expect(ev.critical.map((c) => c.itemKey)).toEqual(expect.arrayContaining(["material:tax_transfer_pricing_documentation_status", "material:tax_intercompany_transactions"]));
    expect(ev.nextFieldKey).toMatch(/tax_transfer_pricing_documentation_status|tax_intercompany_transactions/);
  });

  it("honest unknown satisfies a material dimension (it goes to the specialist as pending); exploring everything makes it ready", () => {
    const manifest = manifestOf("tax_accounting_audit");
    const overlay = deriveMaterial(frame, "tax_accounting_audit");
    const items = [{ transaction_type: "services", counterparty_country: ["PT"], expected_annual_value: A(null, "UNKNOWN"), written_agreement: A(null, "UNKNOWN") }];
    const facts = genericTaxAnswers({ [MATERIAL_OVERLAY_KEY]: A(overlay), tax_transfer_pricing_documentation_status: A(null, "UNKNOWN"), tax_intercompany_transactions: A(items), tax_parent_reporting_required: A(false) });
    const ev = evaluateCategory({ manifest, facts, countries: ["MX"] });
    expect(ev.critical.filter((c) => c.itemKey.startsWith("material:"))).toEqual([]);
    expect(ev.ready).toBe(true);
    expect(ev.pending.map((p) => p.fieldKey)).toContain("tax_transfer_pricing_documentation_status"); // visible to the specialist
  });

  it("the client's own 'no intercompany transactions' drops the premise", () => {
    const manifest = manifestOf("tax_accounting_audit");
    const overlay = deriveMaterial(frame, "tax_accounting_audit");
    const facts = genericTaxAnswers({ [MATERIAL_OVERLAY_KEY]: A(overlay), tax_has_intercompany_transactions: A(false, "EXPLICIT_NO"), tax_intercompany_transactions: undefined });
    const ev = evaluateCategory({ manifest, facts: facts as FactMap, countries: ["MX"] });
    expect(ev.critical.some((c) => c.itemKey === "material:tax_transfer_pricing_documentation_status")).toBe(false);
    expect(ev.critical.some((c) => c.itemKey === "material:tax_intercompany_transactions")).toBe(false);
  });

  it("a project without those signals gets no extra requirements (no checklist inflation)", () => {
    const empty = JSON.parse(JSON.stringify(frame)) as typeof frame;
    empty.items = {}; empty.countries = [];
    expect(deriveMaterial(empty, "tax_accounting_audit").items).toEqual([]);
  });
});

import { captureCrossCutting, crossCuttingFor } from "../cross-cutting";
import { knowsPanel } from "../knows-panel";
import { buildBriefing } from "../briefing";

describe("cross-cutting material facts and the 'what I already know' panel", () => {
  const run = runPersona("es", SEED, PERSONA);
  const frame = run.conv.frame;

  it("a material fact that no probe or category owns is kept with the client's own sentence and reaches the relevant categories", () => {
    const text = "Ya tenemos una filial en México que opera desde 2019. Vamos a asociarnos con un socio local para la operación. El tiempo corre.";
    const got = captureCrossCutting(text, [], "2026-10-15T00:00:00Z");
    expect(got.map((g) => g.kind).sort()).toEqual(["existing_presence", "partners"]);
    for (const g of got) expect(text).toContain(g.quote.replace(/…$/, ""));
    // restating the same kind is not another fact
    expect(captureCrossCutting(text, got, "2026-10-15T00:00:00Z")).toEqual([]);
    const f = JSON.parse(JSON.stringify(frame)) as typeof frame;
    f.crossCutting = got;
    expect(crossCuttingFor(f, "tax_accounting_audit").map((x) => x.kind)).toEqual(expect.arrayContaining(["existing_presence", "partners"]));
    expect(crossCuttingFor(f, "international_trade_customs")).toEqual([]);
    // they travel with the project and make the shareholder structure material in Legal
    expect(buildBriefing(f, "2026-10-15T00:00:00Z").context.join(" ")).toMatch(/filial en México/);
    expect(deriveMaterial(f, "corporate_legal_admin").items.map((i) => i.field)).toContain("legal_shareholder_structure");
  });

  it("nothing is captured from an AI proposal or from a topic word without a statement", () => {
    expect(captureCrossCutting("¿Qué es una filial? Quizá necesitemos un socio local.", [], "t")).toEqual([]);
  });

  it("the panel for Fiscal says what the project already knows, in 3-4 short client lines, with a correction path and no technical state", () => {
    const p = knowsPanel(frame, "tax_accounting_audit")!;
    expect(p.heading).toBe("Lo que ya sé de esta parte de tu proyecto");
    expect(p.lines.length).toBeGreaterThanOrEqual(3);
    expect(p.lines.length).toBeLessThanOrEqual(4);
    const all = p.lines.map((l) => l.text).join(" | ");
    expect(all).toMatch(/Portugal/);
    expect(all).toMatch(/matriz|grupo/i);
    expect(all).not.toMatch(/tax_|_status|material:|ANSWERED|%|\bprobe\b|n:|fr:/);
    for (const l of p.lines) { expect(l.text.length).toBeLessThanOrEqual(92); expect(l.correctPrompt).toMatch(/^Corrijo lo de «/); }
    expect(new Set(p.lines.map((l) => l.text.toLowerCase())).size).toBe(p.lines.length);
  });

  it("an AI-only frame says nothing", () => {
    const f = JSON.parse(JSON.stringify(frame)) as typeof frame;
    for (const i of Object.values(f.items)) { i.provenance = "ai_understood"; i.status = "proposed"; }
    f.countries = []; f.crossCutting = [];
    expect(knowsPanel(f, "tax_accounting_audit")).toBeNull();
  });
});
