/**
 * "Hallazgos para poner atención" — points the specialist (Sherpa / legal / tax / labor / customs) should look at.
 *
 * They EMERGE from the conversation (facts + the knowledge layer), they are deterministic (same facts -> same ids, no duplicates)
 * and they never conclude anything professional: a finding explains the issue, points to what is known and what is missing, and
 * hands the conclusion to the specialist (Level 3 of the knowledge model). Nothing here warns generically: every finding names the
 * client facts that support it (`basis`), and disappears when those facts change.
 */
import type { Finding, Frame, Specialty } from "./types";
import { probeByKey } from "./probes";

export interface FindingKnowledge {
  /** Source references (knowledge unit / registry ids) the specialist can open for a topic; provenance only, never a conclusion. */
  refsFor?: (topic: string) => string[];
}

const L = (es: string, en: string) => ({ es, en });
type V = Record<string, unknown> | null | undefined;

export function computeFindings(frame: Frame, now: string, knowledge: FindingKnowledge = {}): Finding[] {
  const out: Finding[] = [];
  const loc = frame.locale;
  const it = (k: string) => frame.items[k];
  const known = (k: string): boolean => it(k)?.status === "known";
  const val = <T = V,>(k: string): T | undefined => (known(k) ? (it(k)!.value as T) : undefined);
  const refs = (...topics: string[]): string[] => topics.flatMap((t) => knowledge.refsFor?.(t) ?? []);
  const add = (f: Omit<Finding, "at" | "status" | "knowledgeRefs"> & { topics?: string[] }): void => {
    const { topics, ...rest } = f;
    out.push({ ...rest, knowledgeRefs: refs(...(topics ?? [])), status: "open", at: now });
  };
  const disp = (k: string): string => it(k)?.display ?? "";
  const concept = (id: string): boolean => Boolean(frame.concepts[id]);

  // ---- labor
  const model = val<string>("workforce.model");
  const head = val<{ min: number; max: number }>("workforce.headcount");
  const headText = head ? (head.min === head.max ? `${head.min}` : `${head.min}–${head.max}`) : null;
  if (model === "mixed") {
    const split = it("workforce.split");
    add({
      id: "f:workforce_mixed", kind: "specialist_review", specialty: "labor",
      title: L("Revisar el esquema de personal directo y subcontratado", "Review the mix of direct and outsourced staff"),
      detail: L(
        `El cliente planea contratar parte del personal directamente y parte a través de un tercero${headText ? ` (alrededor de ${headText} personas en total)` : ""}${split?.status === "known" ? `; reparto indicado: ${split.display}` : "; el reparto aún no está definido"}. Un especialista laboral debe revisar la estructura, las obligaciones de cada parte y cómo se coordinan.`,
        `The client plans to hire part of the staff directly and part through a third party${headText ? ` (around ${headText} people in total)` : ""}${split?.status === "known" ? `; indicated split: ${split.display}` : "; the split is not defined yet"}. A labor specialist should review the structure, each party's obligations and how they fit together.`,
      ),
      basis: ["workforce.model", ...(split ? ["workforce.split"] : []), ...(head ? ["workforce.headcount"] : [])], topics: ["workforce_models", "social_security_employment"],
    });
  } else if (model === "outsourced") {
    add({
      id: "f:workforce_outsourced", kind: "specialist_review", specialty: "labor",
      title: L("Revisar la contratación de personal a través de terceros", "Review hiring staff through third parties"),
      detail: L(`El cliente planea operar con personal contratado por un tercero${headText ? ` (alrededor de ${headText} personas)` : ""}. Un especialista laboral debe revisar el esquema.`, `The client plans to operate with staff engaged by a third party${headText ? ` (around ${headText} people)` : ""}. A labor specialist should review the arrangement.`),
      basis: ["workforce.model"], topics: ["workforce_models"],
    });
  }
  if ((model === "direct" || model === "mixed") && head) {
    add({
      id: "f:direct_employment", kind: "specialist_review", specialty: "labor",
      title: L("Confirmar alta patronal, seguridad social y obligaciones del empleo directo", "Confirm employer registration, social security and direct-employment obligations"),
      detail: L(`Habrá personal contratado directamente por la entidad local (${headText} personas en total). El especialista laboral confirma el registro como empleador, la seguridad social y las prestaciones mínimas que aplican.`, `The local entity will employ staff directly (${headText} people in total). The labor specialist confirms employer registration, social security and the minimum benefits that apply.`),
      basis: ["workforce.model", "workforce.headcount"], topics: ["social_security_employment", "employment_benefits"],
    });
  }
  const ben = val<{ mode: string; items: string[] }>("workforce.benefits");
  if (ben?.mode === "above_minimum") {
    add({
      id: "f:benefits_above_minimum", kind: "specialist_review", specialty: "labor",
      title: L("Costear las prestaciones adicionales frente al mínimo de ley", "Cost the additional benefits against the legal minimum"),
      detail: L(`El cliente contempla prestaciones adicionales (${ben.items.join(", ") || disp("workforce.benefits")}). El especialista laboral indica el mínimo aplicable para comparar.`, `The client considers additional benefits (${ben.items.join(", ") || disp("workforce.benefits")}). The labor specialist states the applicable minimum for comparison.`),
      basis: ["workforce.benefits"], topics: ["employment_benefits"],
    });
  }
  const origin = val<string>("workforce.origin");
  if ((origin === "relocated" || origin === "both") && !frame.needs.some((n) => n.conceptIds.includes("immigration_mobility") && n.status !== "removed")) {
    add({
      id: "f:relocation_mobility", kind: "missing_information", specialty: "regulatory",
      title: L("Posible traslado de personal desde el país de origen", "Possible relocation of staff from the home country"),
      detail: L("Parte del personal se trasladaría desde el origen y no se ha pedido apoyo migratorio. Confirmar con el cliente si hace falta.", "Part of the staff would relocate from the home country and no immigration support has been requested. Confirm with the client whether it is needed."),
      basis: ["workforce.origin"],
    });
  }

  // ---- tax / corporate
  const funding = val<{ sources?: string[] }>("entity.funding");
  if (funding?.sources?.includes("parent")) {
    const st = val<string>("entity.funding_structure");
    const stText = st === "loan" ? "como préstamo" : st === "equity" ? "como aportación de capital" : st === "mixed" ? "como combinación de préstamo y capital" : "sin definir si será préstamo o aportación de capital";
    const stEn = st === "loan" ? "as a loan" : st === "equity" ? "as a capital contribution" : st === "mixed" ? "as a mix of loan and capital" : "with loan vs. capital contribution not yet defined";
    add({
      id: "f:parent_funding_tax", kind: "specialist_review", specialty: "tax",
      title: L("Revisar el financiamiento desde la casa matriz", "Review funding from the parent company"),
      detail: L(`La casa matriz financiaría la operación local, ${stText}. Un especialista fiscal debe revisar el tratamiento fiscal y contable de la estructura elegida.`, `The parent company would fund the local operation, ${stEn}. A tax specialist should review the tax and accounting treatment of the chosen structure.`),
      basis: ["entity.funding", ...(it("entity.funding_structure") ? ["entity.funding_structure"] : [])], topics: ["intercompany_funding", "transfer_pricing"],
    });
  }
  const ic = it("tax.intercompany");
  if (ic?.status === "known" || concept("transfer_pricing")) {
    const kinds = ((ic?.value as { kinds?: string[] } | null)?.kinds ?? []).filter((k) => k !== "unspecified");
    add({
      id: "f:intercompany", kind: "specialist_review", specialty: "tax",
      title: L("Documentar las operaciones entre partes relacionadas", "Document transactions between related parties"),
      detail: L(`Habrá operaciones con el grupo${kinds.length ? ` (${kinds.join(", ")})` : " (tipo por precisar)"}. El especialista fiscal revisa los requisitos de documentación y precios de transferencia.`, `There will be transactions with the group${kinds.length ? ` (${kinds.join(", ")})` : " (type to be specified)"}. The tax specialist reviews documentation and transfer pricing requirements.`),
      basis: [...(ic ? ["tax.intercompany"] : []), ...(concept("transfer_pricing") ? ["concept:transfer_pricing"] : [])], topics: ["transfer_pricing"],
    });
  }
  const form = it("entity.form");
  const formVal = form?.value as { kind?: string; label?: string | null } | null;
  if (frame.concepts.entity_setup && (form?.status === "undecided" || (form?.status === "known" && formVal?.kind === "company" && !formVal.label) || !form)) {
    if (form) {
      add({
        id: "f:entity_form_pending", kind: "decision_pending", specialty: "corporate",
        title: L("Forma societaria por definir", "Legal form still to be defined"),
        detail: L("El cliente necesita constituir una entidad local pero aún no define el tipo de entidad. Se necesita una recomendación del especialista corporativo antes de avanzar.", "The client needs to set up a local entity but has not defined the entity type. A corporate specialist's recommendation is needed before moving on."),
        basis: ["entity.form"], topics: ["entity_forms"],
      });
    }
  }
  const dur = val<{ minMonths: number; maxMonths: number }>("project.duration");
  if (frame.concepts.entity_setup && dur && dur.maxMonths <= 60) {
    add({
      id: "f:entity_temporary", kind: "specialist_review", specialty: "corporate",
      title: L("Estructura para una operación de duración limitada", "Structure for a limited-duration operation"),
      detail: L(`La operación durará ${disp("project.duration")}. El especialista corporativo evalúa qué estructura conviene y cómo se cerrará al terminar el proyecto.`, `The operation will last ${disp("project.duration")}. The corporate specialist evaluates which structure suits it and how it will be wound down at the end of the project.`),
      basis: ["project.duration"], topics: ["entity_forms"],
    });
  }

  // ---- customs
  if (frame.concepts.equipment_installation && frame.countries.some((c) => c.role === "origin" || c.role === "headquarters")) {
    add({
      id: "f:equipment_customs", kind: "specialist_review", specialty: "customs",
      title: L("Ingreso al país del equipo del proyecto", "Bringing the project equipment into the country"),
      detail: L("La operación instalará equipo del proyecto y parte podría provenir del extranjero. Confirmar origen del equipo y si ingresará de forma temporal o definitiva.", "The operation will install project equipment and part of it may come from abroad. Confirm the equipment's origin and whether it will enter temporarily or permanently."),
      basis: ["concept:equipment_installation"], topics: ["customs_temporary_import"],
    });
  }

  // ---- gaps and open decisions, from the probes themselves
  for (const item of Object.values(frame.items)) {
    const probe = probeByKey(item.key);
    if (!probe) continue;
    if (item.status === "unknown" || item.status === "withheld") {
      add({
        id: `f:missing:${item.key}`, kind: "missing_information",
        title: L(`Dato pendiente: ${probe.label.es}`, `Missing information: ${probe.label.en}`),
        detail: L(`El cliente ${item.status === "withheld" ? "prefirió no compartir" : "todavía no cuenta con"} este dato (${probe.label.es.toLowerCase()}). Se necesitará para dimensionar el servicio.`, `The client ${item.status === "withheld" ? "preferred not to share" : "does not have yet"} this information (${probe.label.en.toLowerCase()}). It will be needed to size the service.`),
        basis: [item.key],
      });
    } else if (item.status === "undecided" && item.key !== "entity.form") {
      add({
        id: `f:undecided:${item.key}`, kind: "decision_pending",
        title: L(`Decisión pendiente: ${probe.label.es}`, `Pending decision: ${probe.label.en}`),
        detail: L(`El cliente aún no ha decidido: ${probe.label.es.toLowerCase()}.`, `The client has not decided yet: ${probe.label.en.toLowerCase()}.`),
        basis: [item.key],
      });
    }
  }
  for (const n of frame.needs) {
    if (n.status === "removed") continue;
    if ((n.resolution === "unresolved" || n.resolution === "outcome" || n.resolution === "ambiguous") && !n.categoryKey) {
      add({
        id: `f:need:${n.id}`, kind: "unresolved_need",
        title: L(`Necesidad fuera del catálogo: ${n.text}`, `Need outside the catalog: ${n.text}`),
        detail: L(`El cliente mencionó «${n.quote ?? n.text}» y no corresponde a un servicio conocido. Conservar tal cual y revisar con el cliente.`, `The client mentioned “${n.quote ?? n.text}” and it does not match a known service. Keep it as stated and review with the client.`),
        basis: [n.id],
      });
    }
  }
  for (const c of Object.values(frame.items).filter((i) => i.status === "needs_review")) {
    add({
      id: `f:conflict:${c.key}`, kind: "inconsistency",
      title: L(`Información que no coincide: ${probeByKey(c.key)?.label.es ?? c.key}`, `Information that does not match: ${probeByKey(c.key)?.label.en ?? c.key}`),
      detail: L(`Lo que dijo el cliente no coincide con lo registrado en Discovery (${c.display}). Aclarar cuál aplica.`, `What the client said does not match Discovery (${c.display}). Clarify which one applies.`),
      basis: [c.key],
    });
  }
  if (frame.changedSinceDiscovery.length > 0) {
    add({
      id: "f:changed_since_discovery", kind: "assumption",
      title: L("Cambios respecto a Discovery", "Changes since Discovery"),
      detail: L(frame.changedSinceDiscovery.map((c) => `${probeByKey(c.key)?.label.es ?? c.key}: de «${c.from}» a «${c.to}»`).join("; "), frame.changedSinceDiscovery.map((c) => `${probeByKey(c.key)?.label.en ?? c.key}: from “${c.from}” to “${c.to}”`).join("; ")),
      basis: frame.changedSinceDiscovery.map((c) => c.key),
    });
  }

  void loc;
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

export type { Specialty };
