import { randomUUID } from "node:crypto";
import { asPerson, bootstrapAdmin, Conns, grantTo, openConns, Person } from "./kit";
import { freshKlDatabase } from "./env";

/** Escenario sintético: personas con cada rol, una institución y publicaciones aprobadas. Solo datos inventados. */
export interface World {
  k: Conns;
  admin: Person;
  editor: Person;
  editor2: Person;
  reviewer: Person;
  reviewer2: Person;
  editorial: Person;
  specialist: Person;
  close(): Promise<void>;
}

export async function buildWorld(): Promise<World> {
  await freshKlDatabase();
  const k = await openConns();
  const admin = await bootstrapAdmin(k.owner);
  const mk = async (label: string, role: string, opts: { editorial?: boolean; domains?: string[] } = {}) => {
    const p = await grantTo(k.app, admin, label, role, opts);
    await asPerson(k.app, p, () => k.app.query("SELECT 1"));
    return p;
  };
  const world: World = {
    k,
    admin,
    editor: await mk("editor", "KL_EDITOR"),
    editor2: await mk("editor2", "KL_EDITOR"),
    reviewer: await mk("reviewer", "KL_REVIEWER"),
    reviewer2: await mk("reviewer2", "KL_REVIEWER"),
    editorial: await mk("editorial", "KL_REVIEWER", { editorial: true }),
    specialist: await mk("specialist", "SPECIALIST_VALIDATOR", { domains: ["legal.mx"] }),
    close: () => k.closeAll(),
  };
  return world;
}

type Q = [string, unknown[]?];
/** Ejecuta varias consultas como `who` en una sola transacción certificada y devuelve la última fila. */
export async function run(w: World, who: Person, ...queries: Q[]): Promise<Record<string, unknown>[]> {
  return asPerson(w.k.app, who, async () => {
    let last: Record<string, unknown>[] = [];
    for (const [text, values] of queries) last = (await w.k.app.query(text, values)).rows;
    return last;
  });
}

export const one = async (w: World, who: Person, text: string, values: unknown[] = []): Promise<Record<string, unknown>> => (await run(w, who, [text, values]))[0] as Record<string, unknown>;

export interface SeedOptions {
  institutionKind?: string;
  authorityClass?: string;
  publicationKey?: string;
  risk?: "low" | "medium" | "high";
  permittedUse?: string;
}

/** Institución + publicación aprobada + indicador consumable. Devuelve las claves. */
export async function seedSource(w: World, o: SeedOptions = {}): Promise<{ institution: string; publication: string; indicator: string }> {
  const tag = randomUUID().slice(0, 6);
  const institution = `inst.${tag}`;
  const publication = o.publicationKey ?? `pub.${tag}`;
  const indicator = `ind_${tag}`;
  await run(w, w.editor, ["SELECT kl.propose_institution($1, 'Instituto Sintético', 'MX', $2, $3)", [institution, o.authorityClass ?? "A", o.institutionKind ?? "public"]]);
  await run(w, w.editor, [
    "SELECT kl.propose_publication($1, $2, 'Encuesta sintética', 'MX', ARRAY['labor'], 'https://datos.sintetico.example/enoe', $3, $4)",
    [publication, institution, o.permittedUse ?? "paraphrase_and_cite", o.risk ?? "low"],
  ]);
  await run(w, w.admin, ["SELECT kl.decide_publication($1, 'approve', 'sintético')", [publication]]);
  await run(w, w.editor, ["SELECT kl.register_indicator($1, 'Indicador sintético', 'Synthetic indicator', '%', 'lower_is_better', 'objective', $2, true)", [indicator, publication]]);
  return { institution, publication, indicator };
}

export interface StatInput {
  key: string;
  indicator: string;
  publication: string;
  geo?: string;
  period?: { label: string; start: string; end: string };
  value?: number | null;
  risk?: "low" | "medium" | "high";
  nextReviewAt?: string | null;
  validTo?: string | null;
  rank?: [number, number];
}

export function statContent(s: StatInput): Record<string, unknown> {
  const period = s.period ?? { label: "2026-T1", start: "2026-01-01", end: "2026-03-31" };
  const value = s.value === undefined ? 12.5 : s.value;
  return {
    indicator_key: s.indicator,
    geo_code: s.geo ?? "MX-GUA",
    period_label: period.label,
    period_start: period.start,
    period_end: period.end,
    period_confidence: "declared",
    value_numeric: value,
    value_status: value === null ? "not_available" : "value",
    display_es: value === null ? "n/d" : `${value} %`,
    display_en: value === null ? "n/a" : `${value}%`,
    unit_label: "%",
    publication_key: s.publication,
    locator: "hoja1!B2",
    ...(s.rank ? { rank_position: s.rank[0], rank_of: s.rank[1] } : {}),
  };
}

/** Crea unidad + versión de una estadística y la publica con un revisor distinto del autor. Devuelve el id de versión. */
export async function publishStat(w: World, s: StatInput): Promise<string> {
  await run(w, w.editor, ["SELECT kl.create_unit($1, 'statistic', 'MX', $2, $3, ARRAY['logistics'], ARRAY[]::text[], ARRAY[]::text[], 'provisional-1', $4)", [s.key, s.geo ?? "MX-GUA", s.indicator, s.risk ?? "low"]]);
  const created = await one(w, w.editor, "SELECT kl.create_version($1, 'team', NULL, 'new_period', 'paraphrase_and_cite', ARRAY[]::text[], ARRAY[]::text[], now(), $2, $3, false, NULL, $4::jsonb) AS v", [
    s.key, s.validTo ?? null, s.nextReviewAt ?? null, JSON.stringify(statContent(s)),
  ]);
  const id = created.v as string;
  await run(w, w.editor, ["SELECT kl.submit_version($1)", [id]]);
  await run(w, w.reviewer, ["SELECT kl.approve_version($1)", [id]]);
  return id;
}

export interface CardInput {
  key: string;
  risk?: "low" | "medium" | "high";
  cardType?: string;
  publication?: string;
  topic?: string;
  titleEs?: string;
  bodyEs?: string;
  claimsEs?: string[];
  variantEn?: { title: string; body: string; claims?: string[] } | null;
  country?: string;
  specialistCategory?: string;
}

export async function createCardVersion(w: World, c: CardInput, who: Person = w.editor): Promise<{ versionId: string; unitKey: string }> {
  await run(w, who, ["SELECT kl.create_unit($1, 'card', $2, NULL, $3, ARRAY['logistics'], ARRAY[]::text[], ARRAY[]::text[], 'provisional-1', $4)", [c.key, c.country ?? "MX", c.topic ?? "logistics.rail", c.risk ?? "low"]]);
  const content = {
    card_type: c.cardType ?? "context",
    title_es: c.titleEs ?? "Ficha sintética",
    body_es: c.bodyEs ?? "Contenido sintético de prueba.",
    claims_es: c.claimsEs ?? ["Afirmación sintética de prueba."],
    primary_source_publication_key: c.publication ?? null,
  };
  const row = await one(w, who, "SELECT kl.create_version($1, 'team', NULL, 'new_period', 'paraphrase_and_cite', ARRAY['Límite sintético'], ARRAY['Synthetic limit'], now(), NULL, NULL, false, $4, $2::jsonb, $3::jsonb) AS v", [
    c.key, JSON.stringify(content), c.variantEn === null ? null : JSON.stringify(c.variantEn ?? { title: "Synthetic card", body: "Synthetic test content.", claims: ["Synthetic test claim."] }), c.specialistCategory ?? null,
  ]);
  return { versionId: row.v as string, unitKey: c.key };
}

export async function publishCard(w: World, c: CardInput, approveEn = true): Promise<string> {
  const { versionId } = await createCardVersion(w, c);
  await run(w, w.editor, ["SELECT kl.submit_version($1)", [versionId]]);
  const to = (await one(w, w.reviewer, "SELECT kl.approve_version($1) AS s", [versionId])).s;
  if (approveEn && c.variantEn !== null) await run(w, w.reviewer, ["SELECT kl.approve_variant($1, 'en')", [versionId]]);
  if (to !== "published" && to !== "awaiting_validation") throw new Error(`estado inesperado ${String(to)}`);
  return versionId;
}

// ------------------------------------------------------------------------------------------------ capa TypeScript
import { Pool } from "pg";
import { AttestedPrincipal } from "../db/attested-tx";
import { roleUrl } from "./env";

export const attestedOf = (p: Person, role: "ADMIN" | "SUPERVISOR" = "ADMIN"): AttestedPrincipal => ({ adminUserId: p.id, email: p.email, role, sessionId: randomUUID() });

export function pools(): { app: Pool; reader: Pool; knowledge: Pool; agent: Pool; closeAll(): Promise<void> } {
  const mk = (role: "kl_app" | "kl_reader_precision" | "kl_knowledge" | "kl_agent") => new Pool({ connectionString: roleUrl(role), max: 3 });
  const set = { app: mk("kl_app"), reader: mk("kl_reader_precision"), knowledge: mk("kl_knowledge"), agent: mk("kl_agent") };
  return { ...set, closeAll: async () => void (await Promise.all(Object.values(set).map((p) => p.end()))) };
}
