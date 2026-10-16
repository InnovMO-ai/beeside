/**
 * ENTERPRISE SERVICES RAM — semantic proof. The prepared diagnostic knowledge must improve DEPTH without behaving like a questionnaire:
 * it reads several facts from one message, never asks what is known, deepens only the genuinely missing material items, connects with the
 * existing Fiscal / Transfer Pricing logic, draws no professional conclusion, exposes no provider wording and creates no catalog entry.
 */
import { bundledCategoryManifest } from "../../manifest/bundled";
import { deriveInherited } from "../category-inheritance";
import { CONCEPTS, conceptById } from "../concepts";
import { deriveMaterial } from "../category-materiality";
import { ENTERPRISE_DIMENSIONS, ENTERPRISE_DOCUMENT_HINTS, ENTERPRISE_PROBES } from "../enterprise-services";
import { probeState } from "../depth";
import { PROBES, questionCtx, viewOf } from "../probes";
import type { DiscoverySeedInput } from "../seed";
import { Conv, runPersona, type Persona } from "./harness";

const NARRATIVE =
  "Ya constituimos nuestra entidad en México y ahora necesitamos apoyo continuo de back-office: contabilidad, nómina y cumplimiento fiscal. Tenemos 35 empleados con nómina quincenal. Nuestra casa matriz en Portugal exige reportes IFRS cada mes. Facturamos en pesos y en dólares. Recibimos servicios de una empresa relacionada en el extranjero. Hoy la contabilidad la lleva otro proveedor.";

const SEED: DiscoverySeedInput = { locale: "es", destinationCodes: ["MX"], sector: "Servicios", objective: "Operar en México", operatingCountries: ["PT"], needs: [] };

const KNOWN_FROM_NARRATIVE = ["workforce.headcount", "workforce.model", "workforce.payroll_cadence", "reporting.group", "scale.currencies", "scale.foreign_vendors", "tax.intercompany", "accounting.setup"];

describe("Enterprise Services RAM — several facts in one message, nothing asked twice", () => {
  it("reads every dimension the client volunteered, in one turn, without asking anything it already knows", () => {
    const c = new Conv("es", SEED);
    const r = c.say(NARRATIVE);
    const it = c.frame.items;
    expect(it["workforce.headcount"]).toMatchObject({ status: "known", value: { min: 35, max: 35 } });
    expect(it["workforce.model"]).toMatchObject({ status: "known", value: "direct" });
    expect(it["workforce.payroll_cadence"]).toMatchObject({ status: "known", value: { cadence: "biweekly" } });
    expect(it["reporting.group"]).toMatchObject({ status: "known", value: { frameworks: ["ifrs"], cadence: "monthly", toGroup: true } });
    expect(it["scale.currencies"]).toMatchObject({ status: "known", value: { invoice: ["MXN", "USD"] } });
    expect(it["scale.foreign_vendors"]).toMatchObject({ status: "known", value: { has: true, related: true, services: true } });
    expect(it["tax.intercompany"]).toMatchObject({ status: "known", value: { kinds: ["servicios entre empresas del grupo"] } });
    expect(it["accounting.setup"]?.display).toMatch(/otro proveedor/);
    // the quote that supports each fact is the client's own sentence
    expect(it["workforce.payroll_cadence"]!.quote).toMatch(/quincenal/i);
    expect(it["reporting.group"]!.quote).toMatch(/IFRS/);
    // none of them is the next question
    const next = (r.action as { probeKey?: string }).probeKey;
    expect(KNOWN_FROM_NARRATIVE).not.toContain(next);
    // the entity already exists: it is NOT treated as a need to set one up, and "casa matriz" alone is not a funding statement
    expect(c.frame.needs.some((n) => n.conceptIds.includes("entity_setup"))).toBe(false);
    expect(c.frame.needs.some((n) => n.conceptIds.includes("intercompany_funding"))).toBe(false);
    expect(c.frame.items["entity.funding_structure"]).toBeUndefined();
  });

  it("deepens only what is genuinely missing and material — never becomes a walk through every dimension", () => {
    const c = new Conv("es", SEED);
    c.say(NARRATIVE);
    const open = c.depth.openMaterial.map((s) => s.probe.key);
    // missing and material for taking over the back-office of an entity that already operates
    expect(open).toEqual(expect.arrayContaining(["scale.volume", "compliance.status"]));
    // volunteered dimensions are not open
    for (const k of KNOWN_FROM_NARRATIVE) expect(open).not.toContain(k);
    const persona: Persona = {
      opening: NARRATIVE,
      answers: {
        "workforce.benefits": "Solo las prestaciones de ley.",
        "scale.revenue": "Unos 2 millones de dólares al año.",
        "scale.volume": "Unas 120 facturas emitidas y 200 pagos al mes.",
        "compliance.status": "Lo fiscal y lo laboral está al corriente, pero la contabilidad tiene rezagos.",
      },
      priority: "Primero la contabilidad y la nómina.",
    };
    const run = runPersona("es", SEED, persona);
    expect(run.completed).toBe(true);
    const asked = run.conv.asked();
    for (const k of KNOWN_FROM_NARRATIVE) expect(asked).not.toContain(k); // nothing known is asked
    expect(new Set(asked).size).toBe(asked.length); // nothing asked twice
    expect(asked.length).toBeLessThanOrEqual(5); // a conversation, not the 11+ RAM dimensions in a row
    expect(asked).toEqual(expect.arrayContaining(["scale.volume", "compliance.status"]));
    // an answer that covers several dimensions fills them all at once
    expect(run.conv.frame.items["compliance.status"]).toMatchObject({ status: "known", value: { tax: "current", labor: "current", books: "behind" } });
    expect(run.conv.critical()).toEqual([]); // voice, tone, terminology, one question
  });

  it("a partial answer is deepened once on the missing part, not re-asked from scratch", () => {
    const c = new Conv("es", SEED);
    c.say("Ya constituimos nuestra entidad en México y necesitamos contabilidad. Nuestra casa matriz exige reportes bajo IFRS.");
    const before = c.frame.items["reporting.group"];
    expect(before).toMatchObject({ status: "known", value: { frameworks: ["ifrs"] } });
    expect(c.depth.statuses.find((s) => s.probe.key === "reporting.group")?.state).toBe("partial"); // framework known, periodicity missing
    c.say("Esos reportes son trimestrales.");
    expect(c.frame.items["reporting.group"]).toMatchObject({ value: { frameworks: ["ifrs"], cadence: "quarterly" } });
    expect(c.depth.statuses.find((s) => s.probe.key === "reporting.group")?.state).toBe("resolved");
  });

  it("is not triggered by projects it does not concern", () => {
    const setup = new Conv("es", SEED);
    setup.say("Queremos constituir una entidad local y necesitamos contabilidad.");
    const keys = setup.depth.statuses.map((s) => s.probe.key);
    expect(keys).not.toContain("compliance.status"); // a brand-new entity has no obligations to be late on
    expect(keys).not.toContain("workforce.payroll_cadence"); // no payroll need
    const none = new Conv("es", SEED);
    none.say("Queremos rentar una nave industrial en Nuevo León.");
    for (const k of ["compliance.status", "workforce.payroll_cadence", "reporting.group", "scale.currencies", "scale.foreign_vendors", "accounting.systems"]) {
      expect(none.depth.statuses.map((s) => s.probe.key)).not.toContain(k);
    }
  });

  it("a monthly report does not become a monthly payroll, and a stray 'pendiente' is not a compliance statement", () => {
    const c = new Conv("es", SEED);
    c.say("Ya constituimos nuestra entidad en México. Necesitamos nómina y contabilidad. Reportamos a la matriz bajo IFRS cada mes. Falta definir el proveedor, está pendiente de decidir.");
    expect(c.frame.items["workforce.payroll_cadence"]).toBeUndefined();
    expect(c.frame.items["compliance.status"]).toBeUndefined();
  });
});

describe("Enterprise Services RAM — cross-cutting connection and boundaries", () => {
  it("connects with the existing Fiscal / Transfer Pricing logic: related-party services make the TP documentation status material, no duplicate question", () => {
    const c = new Conv("es", SEED);
    c.say(NARRATIVE);
    const overlay = deriveMaterial(c.frame, "tax_accounting_audit");
    const fields = overlay.items.map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(["tax_has_intercompany_transactions", "tax_transfer_pricing_documentation_status"]));
    // and the related-party services did not become a request for Transfer Pricing the client never made
    expect(c.frame.needs.some((n) => n.conceptIds.includes("transfer_pricing"))).toBe(false);
  });

  it("carries into the category: the group's reporting and headcount are inherited, so the category conversation does not ask them again", () => {
    const c = new Conv("es", SEED);
    c.say(NARRATIVE);
    const fieldsOf = (key: string) => new Map(bundledCategoryManifest(key)!.fields.map((f) => [f.field_key, f]));
    const tax = Object.fromEntries(deriveInherited(c.frame, "tax_accounting_audit", fieldsOf("tax_accounting_audit") as never).map((f) => [f.fieldKey, f]));
    expect(tax.tax_parent_reporting_required?.value).toBe(true);
    expect(tax.tax_parent_reporting_framework?.value).toBe("ifrs");
    expect(tax.tax_has_intercompany_transactions?.value).toBe(true);
    const hr = Object.fromEntries(deriveInherited(c.frame, "people_payroll_employment", fieldsOf("people_payroll_employment") as never).map((f) => [f.fieldKey, f]));
    expect(hr.hr_employment_model?.value).toBe("direct_entity");
    expect(hr.hr_employee_population_breakdown?.value).toEqual([{ headcount: 35, country: ["MX"] }]);
  });

  it("draws no tax or legal conclusion: it only records what the client states, and every assistant text is clean", () => {
    const c = new Conv("es", SEED);
    c.say(NARRATIVE);
    c.say("Tenemos una auditoría abierta del SAT del 2023 y algunas declaraciones atrasadas.");
    expect(c.frame.items["compliance.status"]).toMatchObject({ value: { openReview: true } });
    const spoken = c.transcript.map((t) => t.bot).join(" ");
    expect(spoken).not.toMatch(/incumpl|infraccion|infracción|multa|sancion|sanción|debes pagar|ilegal|evasi|riesgo de/i);
    expect(c.critical()).toEqual([]);
  });

  it("does not create catalog entries: needs the catalog cannot place keep their category and no service, and follow the existing unmapped route", () => {
    for (const id of ["electronic_invoicing", "accounts_payable"]) {
      const def = conceptById(id)!;
      expect(def.kind).toBe("need");
      expect(def.category).toBe("tax_accounting_audit");
      expect(def.services ?? []).toEqual([]);
    }
    const c = new Conv("es", SEED);
    c.say("Necesitamos facturación electrónica y administración de cuentas por pagar en México.");
    const need = c.frame.needs.filter((n) => n.conceptIds.some((x) => ["electronic_invoicing", "accounts_payable"].includes(x)));
    expect(need).toHaveLength(2);
    for (const n of need) expect(n.serviceKeys).toEqual([]);
  });

  it("carries no provider wording: dimensions, questions, labels and reasons are neutral", () => {
    const text = JSON.stringify([ENTERPRISE_DIMENSIONS, ENTERPRISE_DOCUMENT_HINTS]);
    const view = viewOf(new Conv("es", SEED).frame);
    const spoken = ENTERPRISE_PROBES.flatMap((p) => [p.label.es, p.label.en, p.why.es, p.why.en, p.question({ ...questionCtx(view, "es") }), p.question({ ...questionCtx(view, "en") })]).join(" | ");
    for (const t of [text, spoken]) {
      expect(t).not.toMatch(/\bGT\b|\bSSGT\b|grant thornton|\bBPS\b|independen(?:ce|cia) (?:del|of the) (?:auditor|provider|proveedor)/i);
    }
  });

  it("documents are suggested, never requested: no probe asks for a file or an upload", () => {
    for (const p of ENTERPRISE_PROBES) {
      for (const loc of ["es", "en"] as const) {
        const q = p.question(questionCtx(viewOf(new Conv(loc, SEED).frame), loc));
        expect(q).not.toMatch(/adjunt|sube |cargue|upload|attach|env[ií]a(?:me)? (?:el|la|los|las) (?:document|archivo)/i);
      }
    }
    expect(ENTERPRISE_DIMENSIONS.find((d) => d.id === "K")!.mode).toBe("recommend_only");
  });
});

describe("Enterprise Services RAM — structure", () => {
  it("maps A–L, every referenced probe exists, and the probes live in the one Understanding structure (no second module)", () => {
    expect(ENTERPRISE_DIMENSIONS.map((d) => d.id)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);
    const keys = new Set(PROBES.map((p) => p.key));
    for (const d of ENTERPRISE_DIMENSIONS) for (const k of d.probes) expect(keys.has(k)).toBe(true);
    for (const p of ENTERPRISE_PROBES) expect(PROBES).toContain(p);
    expect(CONCEPTS.length).toBeGreaterThan(30);
  });

  it("each new probe has the same shape as the existing ones: client-language question, a reason, one question mark", () => {
    for (const loc of ["es", "en"] as const) {
      const ctx = questionCtx(viewOf(new Conv(loc, SEED).frame), loc);
      for (const p of ENTERPRISE_PROBES) {
        const q = p.question(ctx);
        expect((q.match(/\?/g) ?? []).length).toBe(1);
        expect(p.why[loc].length).toBeGreaterThan(20);
      }
    }
  });

  it("works in English with the same behaviour", () => {
    const c = new Conv("en", { ...SEED, locale: "en" });
    c.say("We already set up our entity in Mexico and need ongoing accounting, payroll and tax compliance. We have 35 employees on biweekly payroll. Our parent company requires IFRS reports every month. We invoice in pesos and in dollars. Our accounting is currently handled by another provider.");
    expect(c.frame.items["workforce.payroll_cadence"]).toMatchObject({ value: { cadence: "biweekly" } });
    expect(c.frame.items["reporting.group"]).toMatchObject({ value: { frameworks: ["ifrs"], cadence: "monthly" } });
    expect(c.frame.items["scale.currencies"]).toMatchObject({ value: { invoice: ["MXN", "USD"] } });
    expect(c.critical()).toEqual([]);
  });
});

// Source reconciliation (normalised source content, text only): minimal corrections found by contrasting the RAM with it.
describe("Enterprise Services RAM — source reconciliation corrections", () => {
  const BASE = "Ya constituimos nuestra entidad en México y necesitamos contabilidad, nómina y cumplimiento fiscal. Tenemos 35 empleados con nómina quincenal. ";

  it("keeps the accounting system and the payroll system apart (or recognises that they are the same one)", () => {
    const a = new Conv("es", SEED);
    a.say(BASE + "Usamos CONTPAQi para la contabilidad y Aspel NOI para la nómina.");
    expect(a.frame.items["accounting.systems"]).toMatchObject({ status: "known", value: { systems: ["CONTPAQi"], payroll: ["Aspel"] } });
    expect(a.frame.items["accounting.systems"]!.display).toMatch(/Contabilidad: CONTPAQi; nómina: Aspel/);
    const b = new Conv("es", SEED);
    b.say(BASE + "Llevamos la contabilidad y la nómina en SAP.");
    expect(b.frame.items["accounting.systems"]).toMatchObject({ value: { systems: ["SAP"], payroll: ["SAP"] } });
    const d = new Conv("es", SEED);
    d.say(BASE + "Llevamos la contabilidad en QuickBooks y la nómina en Aspel.");
    expect(d.frame.items["accounting.systems"]).toMatchObject({ value: { systems: ["QuickBooks"], payroll: ["Aspel"] } });
  });

  it("a payroll system alone does not answer which system keeps the books", () => {
    const c = new Conv("es", SEED);
    c.say(BASE + "La nómina la corremos en Aspel NOI.");
    const item = c.frame.items["accounting.systems"];
    expect(item?.value).toMatchObject({ systems: [], payroll: ["Aspel"] });
    expect(probeState(PROBES.find((p) => p.key === "accounting.systems")!, item, viewOf(c.frame))).toBe("partial"); // still open: which system keeps the books?
  });

  it("captures every volume figure given at once (invoices and payments), not only the first", () => {
    const c = new Conv("es", SEED);
    c.say(BASE + "Emitimos unas 120 facturas al mes y hacemos 200 pagos al mes.");
    const v = String(c.frame.items["scale.volume"]?.value);
    expect(v).toMatch(/120 facturas/);
    expect(v).toMatch(/200 pagos/);
  });

  it("reads known discrepancies in the current books (neutral wording, no criticism of the incumbent, no conclusion)", () => {
    const c = new Conv("es", SEED);
    c.say(BASE + "La contabilidad actual tiene diferencias y errores en la balanza, hay que regularizar el ejercicio anterior.");
    expect(c.frame.items["compliance.status"]).toMatchObject({ status: "known", value: { books: "behind" } });
    expect(JSON.stringify(c.frame.items["compliance.status"])).not.toMatch(/incumpl|infraccion|sancion|multa|culp/i);
  });

  it("a natural answer that names where the foreign vendors are is understood and asked only once", () => {
    const run = runPersona("es", SEED, {
      opening: "Ya constituimos nuestra entidad en México y necesitamos contabilidad y administración de cuentas por pagar.",
      answers: { "scale.foreign_vendors": "De Alemania, servicios de TI y licencias." },
      priority: "Contabilidad.",
    });
    expect(run.conv.asked().filter((k) => k === "scale.foreign_vendors")).toHaveLength(1);
    expect(run.conv.frame.items["scale.foreign_vendors"]).toMatchObject({ status: "known", value: { has: true, services: true, countries: ["DE"] } });
  });

  it("confidentiality is captured only when the client raises it, as a plain fact: no NDA flow, no catalog entry, never asked", () => {
    const quiet = new Conv("es", SEED);
    quiet.say(BASE);
    expect((quiet.frame.crossCutting ?? []).map((x) => x.kind)).not.toContain("confidentiality");
    const raised = new Conv("es", SEED);
    raised.say(BASE + "Para este trabajo necesitamos un acuerdo de confidencialidad.");
    expect((raised.frame.crossCutting ?? []).map((x) => x.kind)).toContain("confidentiality");
    expect(raised.frame.needs.some((n) => n.conceptIds.some((id) => /nda|confiden/i.test(id)))).toBe(false);
    expect(CONCEPTS.some((c) => /nda|confiden/i.test(c.id))).toBe(false);
    expect(PROBES.some((p) => /confiden|nda/i.test(p.key))).toBe(false);
  });

  it("the document hints stay recommendations: neutral names, none requested by any probe", () => {
    expect(ENTERPRISE_DOCUMENT_HINTS.map((d) => d.id)).toEqual(expect.arrayContaining(["trial_balance", "financial_statements", "annual_filings", "reporting_examples", "delivery_calendar", "chart_of_accounts"]));
    for (const p of ENTERPRISE_PROBES) for (const loc of ["es", "en"] as const) expect(p.question(questionCtx(viewOf(new Conv(loc, SEED).frame), loc))).not.toMatch(/sub[ei]|adjunt|upload|attach|documento/i);
  });
});
