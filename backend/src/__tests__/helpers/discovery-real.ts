import { randomUUID } from "node:crypto";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { journeyC } from "@beeside/fa-public-engine/testing";
import {
  Answers, RESOLUTION_SCHEMA_VERSION, RULES_VERSION, SOURCE_SCHEMA_VERSION, buildResolutionSnapshot, buildSourceSnapshot, buildYourExpansionView, resolveAll,
} from "@beeside/fa-public-engine";
import type { Db } from "../../db/database";
import { deliverResult } from "../../fa4/service";
import { loadPublishedCatalog, seedCatalogIfEmpty, sealResult } from "../../fa4/repository";

/**
 * REAL Discovery output for tests: a project is written the way Discovery stores it (`fa4_project`) and DELIVERED by Discovery's own
 * `deliverResult` (deterministic engine + published catalog -> sealed, immutable envelope). Nothing here knows the Precision contract;
 * the reader under test gets it only through the canonical function Discovery publishes.
 */
export function portugueseEnergyAnswers(email = `pt.${randomUUID().slice(0, 8)}@verify.example`): Answers {
  const a: Answers = JSON.parse(JSON.stringify(journeyC("es")));
  a.identity = { name: "Inês", company: "Empresa Portuguesa", email, role: "Diretora de Operações Internacionais", decider: "shared", termsAccepted: true, privacyAcknowledged: true };
  a.company = { hasExistingBusiness: true, sector: "Servicios de ingeniería y montaje para proyectos de energía", size: "51-250", operatesIn: ["PT"] };
  a.destinations = { list: [{ iso: "MX" }], open: false, sameInAll: null };
  a.components = [{
    id: "c1", destinations: ["MX"], description: "apoyar proyectos del sector energético ganados por otras empresas, instalando parte del equipo de los proyectos",
    activities: ["operate", "hire"], withWhat: ["services"], presence: "own_onsite", permanence: "temporary", durationMonths: 30,
    existing: "nothing", sellsTo: "companies", ownBrand: null, location: "undecided", carries: ["people", "equipment"],
  }];
  a.reasons = ["contract"]; a.reasonText = "Fuimos subcontratados por las empresas ganadoras de proyectos del sector energético en México.";
  a.decision = "in_progress"; a.startWhen = "6m"; a.externalDate = { has: false };
  a.scale = { c1: { proxy: "duration", text: "unos 2 a 3 años", declined: false } };
  a.regulated = "unknown";
  a.fronts = {};
  for (const f of ["FR_LEGAL_TAX", "FR_RECRUITMENT", "FR_EMPLOYMENT", "FR_BANKING", "FR_INSURANCE"]) a.fronts[`MX|${f}`] = { marked: true };
  a.fronts["MX|FR_LEGAL_TAX"]!.critical = true;
  a.addedNeeds = [];
  a.cargoRoute = { MX: "both" };
  a.supportValues = ["single_contact", "coordination"]; a.supportWords = ""; a.keepWords = "la dirección técnica de los proyectos";
  a.context = { success: "arrancar operaciones en México a tiempo y cumplir con los contratos", constraints: "", description: "", experience: "", unknowns: "", personalNeed: false };
  return a;
}

export async function deliverDiscovery(db: Db, answers: Answers, now = new Date()): Promise<{ projectId: string; resultId: string }> {
  await seedCatalogIfEmpty(db, SEED_CATALOG);
  const projectId = (await db.query<{ project_id: string }>(
    "INSERT INTO fa4_project (email, locale, step_key, answers) VALUES ($1, $2, 'review', $3::jsonb) RETURNING project_id", [answers.identity.email, answers.locale, JSON.stringify(answers)],
  )).rows[0]!.project_id;
  const d = await deliverResult(db, projectId, now);
  return { projectId, resultId: d.resultId };
}

/** A RE-RUN: Discovery seals a NEW result for the same project from changed answers (history is append-only: the old result stays). */
export async function redeliverDiscovery(db: Db, projectId: string, change: (a: Answers) => void, now = new Date()): Promise<string> {
  return db.transaction(async (tx) => {
    const answers = (await tx.query<{ answers: Answers }>("SELECT answers FROM fa4_project WHERE project_id = $1", [projectId])).rows[0]!.answers;
    change(answers);
    const catalog = await loadPublishedCatalog(tx);
    const resolution = resolveAll(answers, catalog);
    const model = buildYourExpansionView(answers, catalog, now, resolution);
    const sealed = await sealResult(tx, projectId, model, {
      catalogVersion: catalog.version, rulesVersion: RULES_VERSION, sourceSchemaVersion: SOURCE_SCHEMA_VERSION, sourceSnapshot: buildSourceSnapshot(answers),
      resolutionSchemaVersion: RESOLUTION_SCHEMA_VERSION, resolutionSnapshot: buildResolutionSnapshot(resolution),
    });
    return sealed.resultId;
  });
}
