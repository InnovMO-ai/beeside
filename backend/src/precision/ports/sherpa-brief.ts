import type { OhHandoffPayload } from "./operation-hub";

/**
 * Sherpa brief — a plain-text rendering of the canonical handoff payload, for a person to read.
 *
 * It is a pure function of the payload (platform-agnostic): same payload => same text, so it never changes the delivery checksum
 * (the checksum covers the structured payload, not this text). It adds nothing: every line is a field the whitelisted payload already
 * carries, so it cannot reveal more than the payload does. Adapters decide where to put it.
 */

type Json = Record<string, unknown>;
const o = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const COPY = {
  en: {
    project: "PROJECT",
    workstream: "WORKSTREAM",
    firstSend: "First send",
    update: "Client Requirements Pack",
    frame: "PROJECT FRAME (confirmed Service Map",
    objective: "Objective",
    destinations: "Destination(s)",
    window: "Time window",
    product: "Product or service",
    entity: "Operating entity",
    services: "Services in the map",
    open: "Open items",
    crp: "CLIENT REQUIREMENTS",
    context: "Context",
    pending: "PENDING",
    later: "INFORMATION REQUIRED LATER",
    dependency: "needed before execution",
    contextOnly: "context only, not for the provider RFI",
    confidential: "confidential-eligible, check before sharing",
    missing: "Missing",
    why: "why",
    priority: "priority",
    timing: "timing",
    state: { confirmed: "confirmed", assumed: "assumed", pending: "pending", not_applicable: "not applicable" } as Record<string, string>,
  },
  es: {
    project: "PROYECTO",
    workstream: "FRENTE DE TRABAJO",
    firstSend: "Primer envío",
    update: "Paquete de requerimientos del cliente",
    frame: "MARCO DEL PROYECTO (Mapa de Servicios confirmado",
    objective: "Objetivo",
    destinations: "Destino(s)",
    window: "Ventana de tiempo",
    product: "Producto o servicio",
    entity: "Entidad operadora",
    services: "Servicios en el mapa",
    open: "Puntos abiertos",
    crp: "REQUERIMIENTOS DEL CLIENTE",
    context: "Contexto",
    pending: "PENDIENTE",
    later: "INFORMACIÓN REQUERIDA MÁS ADELANTE",
    dependency: "necesario antes de ejecutar",
    contextOnly: "solo contexto, no va al RFI del proveedor",
    confidential: "puede ser confidencial, revisar antes de compartir",
    missing: "Falta",
    why: "por qué",
    priority: "prioridad",
    timing: "momento",
    state: { confirmed: "confirmado", assumed: "supuesto", pending: "pendiente", not_applicable: "no aplica" } as Record<string, string>,
  },
} as const;

function itemLines(it: Json, c: (typeof COPY)["en"] | (typeof COPY)["es"]): string[] {
  const label = s(it.label);
  const value = s(it.value);
  const flags: string[] = [c.state[s(it.state)] ?? s(it.state)];
  if (it.execution_dependency === true) flags.push(c.dependency);
  if (it.visibility === "context_only") flags.push(c.contextOnly);
  if (it.visibility === "confidential") flags.push(c.confidential);
  const out = [`- ${label}${value ? `: ${value.replace(/\n/g, "; ")}` : ""} [${flags.join("; ")}]`];
  for (const e of a(it.entries)) if (s(e)) out.push(`    · ${s(e)}`);
  for (const m of a(it.missing)) if (s(m)) out.push(`    ${c.missing}: ${s(m)}`);
  return out;
}

export function psmLines(psm: Json, c: (typeof COPY)["en"] | (typeof COPY)["es"]): string[] {
  const out: string[] = [];
  const line = (k: string, v: string): void => {
    if (v) out.push(`${k}: ${v}`);
  };
  line(c.objective, a(psm.objectives).map(s).filter(Boolean).join("; "));
  line(c.destinations, a(psm.destinations).map(s).filter(Boolean).join(", "));
  line(c.window, s(psm.time_window));
  line(c.product, s(psm.product_or_service));
  line(c.entity, s(psm.operating_entity));
  const cats = a(psm.categories).map(o);
  if (cats.length > 0) {
    out.push(`${c.services}:`);
    for (const cat of cats) {
      out.push(`  ${s(cat.category_label)}`);
      for (const i of a(cat.items).map(o)) {
        const extra = [
          s(i.why) ? `${c.why}: ${s(i.why)}` : "",
          s(i.priority) ? `${c.priority}: ${s(i.priority)}` : "",
          s(i.timing) ? `${c.timing}: ${s(i.timing)}` : "",
        ].filter(Boolean);
        out.push(`   - ${s(i.label)} [${c.state[s(i.state)] ?? s(i.state)}]${extra.length ? ` (${extra.join("; ")})` : ""}`);
      }
    }
  }
  const open = a(psm.open_items).map(s).filter(Boolean);
  if (open.length > 0) {
    out.push(`${c.open}:`);
    for (const x of open) out.push(`  - ${x}`);
  }
  return out;
}

/** Brief for a CRP / first-send delivery. */
export function sherpaBrief(payload: OhHandoffPayload): string {
  const structured = o(payload.artifact.structured);
  const c = COPY[structured.language === "es" ? "es" : "en"];
  const psm = o(o(payload.project_context).psm);
  const out: string[] = [];
  out.push(`${c.project}: ${s(o(payload.company_context).display_name)}`);
  out.push(`${c.workstream}: ${s(payload.workstream.category_label)} · ${payload.contract.kind === "first_send" ? c.firstSend : c.update} v${payload.artifact.crp_version}`);
  out.push("");
  out.push(`${c.frame} v${payload.provenance.psm_version})`);
  out.push(...psmLines(psm, c));
  out.push("");
  out.push(`${c.crp}: ${s(structured.title)}`);
  const context = a(structured.context).map(s).filter(Boolean);
  if (context.length > 0) {
    out.push(`${c.context}:`);
    for (const x of context) out.push(`  - ${x}`);
  }
  for (const sec of a(structured.sections).map(o)) {
    out.push("");
    out.push(s(sec.title).toUpperCase());
    for (const it of a(sec.items).map(o)) out.push(...itemLines(it, c));
  }
  const pending = a(structured.pending).map(o);
  if (pending.length > 0) {
    out.push("");
    out.push(c.pending);
    for (const it of pending) out.push(...itemLines(it, c));
  }
  const later = a(structured.required_later).map(s).filter(Boolean);
  if (later.length > 0) {
    out.push("");
    out.push(c.later);
    for (const x of later) out.push(`- ${x}`);
  }
  return out.join("\n");
}

/** Brief for the Project Overview task (the confirmed Service Map alone). */
export function overviewBrief(input: { companyName: string; psmVersion: number; psm: Json; language?: "en" | "es" }): string {
  const c = COPY[input.language === "es" ? "es" : "en"];
  return [`${c.project}: ${input.companyName}`, "", `${c.frame} v${input.psmVersion})`, ...psmLines(input.psm, c)].join("\n");
}

/** Picks the right brief for a payload: a Service Map update has no CRP, everything else is a CRP / first send. */
export function briefFor(payload: OhHandoffPayload): string {
  if (payload.contract.kind === "psm_update") {
    const lang = o(payload.artifact.structured).language;
    return overviewBrief({
      companyName: s(o(payload.company_context).display_name),
      psmVersion: payload.provenance.psm_version,
      psm: o(o(payload.project_context).psm),
      ...(lang === "es" ? { language: "es" as const } : {}),
    });
  }
  return sherpaBrief(payload);
}
