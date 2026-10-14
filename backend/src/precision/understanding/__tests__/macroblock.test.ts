/**
 * Core-product macroblock behaviours that are pure: fact freshness, client edits of the frame, the briefing's hygiene gate,
 * need labels on the map, and the regressions found while integrating.
 */
import { Conv, NOW } from "./harness";
import { refreshFromDiscovery } from "../freshness";
import { editFrame } from "../edit";
import { buildBriefing, briefingHygiene, sanitizeBriefing } from "../briefing";
import { residualWords, classifyPhrase } from "../need-explorer";
import { planFrameMap, labelOf } from "../../domain/frame-map";
import { listCategoryKeys } from "../../manifest";
import type { DiscoverySeedInput } from "../seed";

const SEED: DiscoverySeedInput = {
  pinId: "pin-1", locale: "es", destinationCodes: ["MX"], sector: "Café", objective: "Exportar café colombiano a México", timeframe: "2027-03",
  operatingCountries: ["CO"], needs: [{ capabilityId: "CAP_HIVE_IL_3PL", label: "Logística de terceros", priority: "high" }],
};
const CATALOG = new Set(listCategoryKeys());

describe("fact freshness", () => {
  it("a value Discovery still owns is updated and the change is recorded", () => {
    const c = new Conv("es", SEED);
    const r = refreshFromDiscovery(c.frame, { ...SEED, pinId: "pin-2", timeframe: "2027-09" }, NOW);
    expect(r.frame.items["project.timeframe"]?.value).toBe("2027-09");
    expect(r.frame.changedSinceDiscovery.some((x) => x.key === "project.timeframe")).toBe(true);
    expect(r.frame.discoveryPinId).toBe("pin-2");
    expect(r.asks).toEqual([]);
  });

  it("what the client said here is never silently overwritten: it becomes ONE question, worded for Discovery's newer value", () => {
    const c = new Conv("es", SEED);
    c.frame.items["project.timeframe"] = { key: "project.timeframe", value: "2027-05", display: "mayo de 2027", status: "known", provenance: "client_stated", interpretive: "observed", quote: "mayo de 2027", at: NOW };
    const mine = c.frame.items["project.timeframe"];
    const r = refreshFromDiscovery(c.frame, { ...SEED, pinId: "pin-2", timeframe: "2028-01" }, NOW);
    expect(r.frame.items["project.timeframe"]?.value).toBe(mine?.value);
    expect(r.frame.pendingConflicts.find((x) => x.key === "project.timeframe")).toMatchObject({ source: "discovery" });
  });

  it("is idempotent for the same pin, and does not reopen anything when nothing changed", () => {
    const c = new Conv("es", SEED);
    const a = refreshFromDiscovery(c.frame, { ...SEED }, NOW);
    expect(a.changed).toEqual([]);
    expect(refreshFromDiscovery(a.frame, { ...SEED }, NOW).changed).toEqual([]);
  });

  it("needs: removed in Discovery -> removed here; a new one is added; what the client added here stays", () => {
    const c = new Conv("es", SEED);
    c.say("También necesitamos marketing.");
    const r = refreshFromDiscovery(c.frame, { ...SEED, pinId: "pin-2", needs: [{ capabilityId: "CAP_HIVE_FI_TAX", label: "Impuestos y contabilidad", priority: "medium" }] }, NOW);
    expect(r.frame.needs.find((n) => n.id === "n:disc:CAP_HIVE_IL_3PL")?.status).toBe("removed");
    expect(r.frame.needs.some((n) => n.id === "n:disc:CAP_HIVE_FI_TAX")).toBe(true);
    expect(r.frame.needs.some((n) => n.conceptIds.includes("marketing") && n.status !== "removed")).toBe(true);
  });

  it("a material change after the checkpoint reopens it", () => {
    const c = new Conv("es", SEED);
    c.frame.checkpoint = { offered: true, accepted: true };
    const r = refreshFromDiscovery(c.frame, { ...SEED, pinId: "pin-2", objective: "Abrir una bodega en México" }, NOW);
    expect(r.frame.checkpoint.accepted).toBe(false);
  });
});

describe("client edits of the frame", () => {
  const frame = () => { const c = new Conv("es", SEED); c.say("Necesitamos marketing y contabilidad."); return c.frame; };
  it("remove / restore", () => {
    const f = frame();
    const id = f.needs.find((n) => n.conceptIds.includes("marketing"))!.id;
    const gone = editFrame(f, { op: "remove", needId: id }, NOW, CATALOG);
    expect(gone.frame.needs.find((n) => n.id === id)?.status).toBe("removed");
    expect(planFrameMap(gone.frame).removed.length).toBeGreaterThan(0);
    expect(editFrame(gone.frame, { op: "restore", needId: id }, NOW, CATALOG).frame.needs.find((n) => n.id === id)?.status).toBe("proposed");
  });
  it("the priority is the client's: it replaces any earlier rank of the same need", () => {
    const f = frame();
    const id = f.needs.find((n) => n.conceptIds.includes("accounting"))!.id;
    const a = editFrame(f, { op: "priority", needId: id, rank: "top" }, NOW, CATALOG).frame;
    const b = editFrame(a, { op: "priority", needId: id, rank: "can_wait" }, NOW, CATALOG).frame;
    expect(b.priority.groups.flatMap((g) => g.subjects.map((s) => [s, g.rank]))).toEqual([[id, "can_wait"]]);
    expect(planFrameMap(b).needs.find((p) => p.need.id === `fr:${id}`)?.need.priority).toBe("low");
  });
  it("rewording re-reads the new words; a meta-command or an object is not a service", () => {
    const f = frame();
    const id = f.needs.find((n) => n.conceptIds.includes("marketing"))!.id;
    const ok = editFrame(f, { op: "rename", needId: id, text: "Nómina y alta patronal" }, NOW, CATALOG);
    expect(ok.ok).toBe(true);
    expect(ok.frame.needs.find((n) => n.id === id)?.categoryKey).toBe("people_payroll_employment");
    expect(editFrame(f, { op: "rename", needId: id, text: "4 plumones" }, NOW, CATALOG)).toMatchObject({ ok: false, reason: "not_a_service" });
    expect(editFrame(f, { op: "move", needId: id, categoryKey: "not_a_category" }, NOW, CATALOG).ok).toBe(false);
    expect(editFrame(f, { op: "remove", needId: "n:nope" }, NOW, CATALOG)).toMatchObject({ ok: false, reason: "unknown_need" });
  });
});

describe("Service Map lines and placement", () => {
  it("a need heard inside a long paragraph is shown by its clean name, never as a slice of the paragraph", () => {
    const c = new Conv("es", SEED);
    c.say("Somos una empresa portuguesa. Necesitamos constituir una entidad local, apoyo legal, fiscal, laboral, contratar gente, seguridad social, contabilidad y cumplimiento fiscal.");
    for (const p of planFrameMap(c.frame).needs) {
      expect(p.need.label.length).toBeLessThanOrEqual(80);
      expect(p.need.label).not.toMatch(/[.;]/);
    }
    expect(planFrameMap(c.frame).needs.map((p) => p.need.label.toLowerCase()).join(" | ")).toMatch(/entidad/);
  });
  it("a legitimate need the catalog cannot place is held under a possible new service, in the client's words; an outcome or an ambiguous word is not a service yet", () => {
    const c = new Conv("es", SEED);
    c.say("Necesitamos una certificación orgánica para nuestro café.");
    const plan = planFrameMap(c.frame);
    expect(plan.needs.every((p) => CATALOG.has(p.categoryKey) || p.categoryKey.startsWith("new:"))).toBe(true);
    const amb = new Conv("es", { ...SEED, needs: [] });
    amb.say("Necesitamos un almacén.");
    expect(planFrameMap(amb.frame).needs.some((p) => /almac/i.test(p.need.label))).toBe(false);
  });
  it("labelOf keeps what is already clean", () => {
    const c = new Conv("es", SEED);
    expect(planFrameMap(c.frame).needs[0]?.need.label).toBe("Logística de terceros");
    void labelOf;
  });
});

describe("need-first phrase handling", () => {
  it.each([["marketing", "known"], ["servicios de marketing", "known"], ["almacén", "ambiguous"], ["cadena de frío", "attribute"], ["quiero agregar más servicios", "meta"], ["4 plumones", "goods_item"], ["un sillón", "goods_item"]])("%s -> %s", (t, kind) => {
    expect(classifyPhrase(t).kind).toBe(kind);
  });
  it("the phrase IS the need only when nothing else is left unexplained", () => {
    expect(residualWords("marketing", ["marketing"])).toEqual([]);
    expect(residualWords("servicios de marketing", ["marketing"])).toEqual([]);
    expect(residualWords("marketing para licitaciones gubernamentales", ["marketing"]).length).toBeGreaterThan(0);
  });
  it("'seguridad social' is not a location criterion (regression)", () => {
    const c = new Conv("es", { ...SEED, needs: [] });
    c.say("Queremos escoger dónde instalarnos en México. Necesitamos seguridad social y contratar 50 personas.");
    const crit = c.frame.items["location.criteria"];
    expect(crit?.value ?? []).not.toContain("security");
  });
});

describe("briefing hygiene gate", () => {
  it("the briefing of a worked-through conversation is clean and carries depth", () => {
    const c = new Conv("es", SEED);
    c.say("Somos subcontratados por empresas ganadoras de proyectos de energía. Vamos a operar 2 a 3 años. Habrá unas 60 personas, 20 directas y 40 subcontratadas.");
    const b = sanitizeBriefing(buildBriefing(c.frame, NOW));
    expect(briefingHygiene(b)).toEqual([]);
    expect(b.facts.map((f) => f.value).join(" ")).toMatch(/60/);
  });
  it("conversational debris never passes", () => {
    const dirty = { context: ["¿Qué más necesitas?", "Gracias, entendido", "**negrita**", "n:disc:CAP_X", "Todavía no lo sé", "Hablar con el Sherpa"], facts: [{ label: "Personal", value: "" }], pending: [], findings: [] };
    expect(briefingHygiene(dirty).length).toBeGreaterThanOrEqual(6);
    const clean = sanitizeBriefing(dirty);
    expect(clean.context).toEqual([]);
    expect(clean.facts).toEqual([]);
  });
});
