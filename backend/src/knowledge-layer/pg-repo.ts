/** Postgres implementations of the knowledge ports (migrations 0042/0043). Mirrors the in-memory reference semantics. */
import type { Db } from "../db/database";
import { fold } from "./text";
import { tokens } from "./memory-repo";
import type { CandidateStatus, CandidateStore, CandidateUpdate } from "./agent";
import type { CountryResource, CountryResourceRepository } from "./country-resources";
import { validateResource } from "./country-resources";
import { assertNormalized, demandId, opaqueRef, type DemandRepository, type DemandStatus, type KnowledgeDemand, type StoredDemand } from "./demand";
import type { KnowledgeDocument, KnowledgePassage, KnowledgeRepository, KnowledgeSource, RetrieveQuery } from "./types";

type Q = Pick<Db, "query">;

interface SourceRow { id: string; institution: string; domains: string[]; jurisdiction: string; topics: string[]; authority: string; roles: string[]; is_primary: boolean; cadence: string; risk: string; review_required: boolean; granularity: string; active: boolean; notes: string | null }
const toSource = (r: SourceRow): KnowledgeSource => ({
  id: r.id, institution: r.institution, domains: r.domains, jurisdiction: r.jurisdiction, topics: r.topics as KnowledgeSource["topics"], authority: r.authority as KnowledgeSource["authority"],
  roles: r.roles as KnowledgeSource["roles"], primary: r.is_primary, cadence: r.cadence as KnowledgeSource["cadence"], risk: r.risk as KnowledgeSource["risk"], reviewRequired: r.review_required,
  granularity: r.granularity as KnowledgeSource["granularity"], active: r.active, ...(r.notes ? { notes: r.notes } : {}),
});

interface DocRow { id: string; source_id: string; title: string; edition: string; version: number; published_at: string | null; effective_at: string | null; retrieved_at: Date; jurisdiction: string; topics: string[]; locator: string; content_hash: string; confidence: string; status: string; supersedes_id: string | null; superseded_by_id: string | null; language: string }
const toDoc = (r: DocRow): KnowledgeDocument => ({
  id: r.id, sourceId: r.source_id, title: r.title, edition: r.edition, version: r.version, ...(r.published_at ? { publishedAt: r.published_at } : {}), ...(r.effective_at ? { effectiveAt: r.effective_at } : {}),
  retrievedAt: r.retrieved_at.toISOString(), jurisdiction: r.jurisdiction, topics: r.topics as KnowledgeDocument["topics"], locator: r.locator, contentHash: r.content_hash,
  confidence: r.confidence as KnowledgeDocument["confidence"], status: r.status as KnowledgeDocument["status"], ...(r.supersedes_id ? { supersedesId: r.supersedes_id } : {}),
  ...(r.superseded_by_id ? { supersededById: r.superseded_by_id } : {}), language: r.language,
});

interface PassageRow { id: string; document_id: string; source_id: string; ordinal: number; text: string; location: string; topics: string[]; units: string[]; granularity: string; indicators: KnowledgePassage["indicators"] }
const toPassage = (r: PassageRow): KnowledgePassage => ({ id: r.id, documentId: r.document_id, sourceId: r.source_id, ordinal: r.ordinal, text: r.text, location: r.location, topics: r.topics as KnowledgePassage["topics"], units: r.units, granularity: r.granularity as KnowledgePassage["granularity"], indicators: r.indicators });

/** Safe tsquery from folded tokens: OR of word stems (no operators can come from client text). */
export const tsQueryOf = (text: string): string => [...new Set(tokens(text))].map((t) => t.replace(/[^a-z0-9]/g, "")).filter((t) => t.length > 2).join(" | ");

export function createPgKnowledgeRepository(db: Db): KnowledgeRepository {
  return {
    async upsertSource(s) {
      await db.query(
        `INSERT INTO knowledge_source (id, institution, domains, jurisdiction, topics, authority, roles, is_primary, cadence, risk, review_required, granularity, active, notes, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
         ON CONFLICT (id) DO UPDATE SET institution = EXCLUDED.institution, domains = EXCLUDED.domains, jurisdiction = EXCLUDED.jurisdiction, topics = EXCLUDED.topics, authority = EXCLUDED.authority,
           roles = EXCLUDED.roles, is_primary = EXCLUDED.is_primary, cadence = EXCLUDED.cadence, risk = EXCLUDED.risk, review_required = EXCLUDED.review_required, granularity = EXCLUDED.granularity,
           active = EXCLUDED.active, notes = EXCLUDED.notes, updated_at = now()`,
        [s.id, s.institution, s.domains, s.jurisdiction, s.topics, s.authority, s.roles, s.primary, s.cadence, s.risk, s.reviewRequired, s.granularity, s.active, s.notes ?? null],
      );
    },
    async getSource(id) {
      const r = (await db.query<SourceRow>("SELECT * FROM knowledge_source WHERE id = $1", [id])).rows[0];
      return r ? toSource(r) : null;
    },
    async listSources(f) {
      const r = await db.query<SourceRow>("SELECT * FROM knowledge_source WHERE ($1::boolean IS NULL OR active = $1) AND ($2::text IS NULL OR jurisdiction = $2) ORDER BY id", [f?.active ?? null, f?.jurisdiction ?? null]);
      return r.rows.map(toSource);
    },
    async insertDocument(d, passages) {
      await db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO knowledge_document (id, source_id, title, edition, version, published_at, effective_at, retrieved_at, jurisdiction, topics, locator, content_hash, confidence, status, language)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [d.id, d.sourceId, d.title, d.edition, d.version, d.publishedAt ?? null, d.effectiveAt ?? null, d.retrievedAt, d.jurisdiction, d.topics, d.locator, d.contentHash, d.confidence, d.status, d.language],
        );
        for (const p of passages) {
          await tx.query(
            "INSERT INTO knowledge_passage (id, document_id, source_id, ordinal, text, location, topics, units, granularity, indicators) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",
            [p.id, p.documentId, p.sourceId, p.ordinal, p.text, p.location, p.topics, p.units, p.granularity, JSON.stringify(p.indicators)],
          );
        }
      });
    },
    async getDocument(id) {
      const r = (await db.query<DocRow>("SELECT * FROM knowledge_document WHERE id = $1", [id])).rows[0];
      return r ? toDoc(r) : null;
    },
    async listDocuments(f) {
      const r = await db.query<DocRow>("SELECT * FROM knowledge_document WHERE ($1::text IS NULL OR source_id = $1) AND ($2::text IS NULL OR status = $2) ORDER BY source_id, title, version", [f?.sourceId ?? null, f?.status ?? null]);
      return r.rows.map(toDoc);
    },
    async markSuperseded(oldId, newId) {
      await db.transaction(async (tx) => {
        await tx.query("UPDATE knowledge_document SET status = 'superseded', superseded_by_id = $2 WHERE id = $1", [oldId, newId]);
        await tx.query("UPDATE knowledge_document SET supersedes_id = $1 WHERE id = $2 AND supersedes_id IS NULL", [oldId, newId]);
      });
    },
    async listPassages(documentId) {
      const r = await db.query<PassageRow>("SELECT id, document_id, source_id, ordinal, text, location, topics, units, granularity, indicators FROM knowledge_passage WHERE document_id = $1 ORDER BY ordinal", [documentId]);
      return r.rows.map(toPassage);
    },
    async getPassage(id) {
      const p = (await db.query<PassageRow>("SELECT id, document_id, source_id, ordinal, text, location, topics, units, granularity, indicators FROM knowledge_passage WHERE id = $1", [id])).rows[0];
      if (!p) return null;
      const d = (await db.query<DocRow>("SELECT * FROM knowledge_document WHERE id = $1", [p.document_id])).rows[0];
      return d ? { passage: toPassage(p), doc: toDoc(d) } : null;
    },
    async search(q: RetrieveQuery) {
      const tsq = tsQueryOf(q.text ?? "");
      const topics = q.topics ?? [];
      const units = (q.units ?? []).map(fold);
      const res = await db.query<PassageRow & { score: number } & { d: DocRow }>(
        `SELECT p.id, p.document_id, p.source_id, p.ordinal, p.text, p.location, p.topics, p.units, p.granularity, p.indicators,
                (CASE WHEN $1 = '' THEN 0 ELSE ts_rank(p.tsv, to_tsquery('spanish', $1)) END
                 + 0.5 * (SELECT count(*) FROM unnest(p.topics) t WHERE t = ANY($2::text[]))
                 + 0.6 * (SELECT count(*) FROM unnest(p.units) u WHERE knowledge_fold(u) = ANY($3::text[])))::float8 AS score,
                to_jsonb(d.*) AS d
           FROM knowledge_passage p
           JOIN knowledge_document d ON d.id = p.document_id
           JOIN knowledge_source s ON s.id = d.source_id
          WHERE s.active AND d.status <> 'withdrawn' AND ($4::boolean OR d.status = 'active')
            AND ($5::text IS NULL OR d.jurisdiction = $5)
            AND ($6::text[] IS NULL OR s.authority = ANY($6::text[]))
            AND ( ($1 <> '' AND p.tsv @@ to_tsquery('spanish', $1))
               OR (cardinality($2::text[]) > 0 AND p.topics && $2::text[])
               OR (cardinality($3::text[]) > 0 AND EXISTS (SELECT 1 FROM unnest(p.units) u WHERE knowledge_fold(u) = ANY($3::text[]))) )
          ORDER BY score DESC, p.ordinal
          LIMIT $7`,
        [tsq, topics, units, q.includeSuperseded ?? false, q.jurisdiction ?? null, q.authorities ?? null, (q.limit ?? 8) * 3],
      );
      return res.rows.map((r) => {
        const d = r.d as unknown as Record<string, unknown>;
        const doc: KnowledgeDocument = toDoc({ ...(d as unknown as DocRow), retrieved_at: new Date(String(d.retrieved_at)) });
        return { passage: toPassage(r), doc, score: r.score };
      });
    },
  };
}

export function createPgCandidateStore(db: Q): CandidateStore {
  return {
    async save(c, data) {
      await db.query(
        `INSERT INTO knowledge_candidate (id, source_id, status, candidate, data, detected_at, decided_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6, CASE WHEN $3 IN ('approved','rejected','auto_applied') THEN now() END)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, candidate = EXCLUDED.candidate, data = COALESCE(EXCLUDED.data, knowledge_candidate.data),
           decided_at = CASE WHEN EXCLUDED.status IN ('approved','rejected','auto_applied') THEN COALESCE(knowledge_candidate.decided_at, now()) ELSE knowledge_candidate.decided_at END`,
        [c.id, c.sourceId, c.status, JSON.stringify(c), data ?? null, c.detectedAt],
      );
    },
    async get(id) {
      const r = (await db.query<{ candidate: CandidateUpdate; status: CandidateStatus; data: Buffer | null }>("SELECT candidate, status, data FROM knowledge_candidate WHERE id = $1", [id])).rows[0];
      return r ? { candidate: { ...r.candidate, status: r.status }, ...(r.data ? { data: r.data } : {}) } : null;
    },
    async list(status) {
      const r = await db.query<{ candidate: CandidateUpdate; status: CandidateStatus }>("SELECT candidate, status FROM knowledge_candidate WHERE ($1::text IS NULL OR status = $1) ORDER BY detected_at", [status ?? null]);
      return r.rows.map((x) => ({ ...x.candidate, status: x.status }));
    },
  };
}

interface ResRow { id: string; country_code: string; title: string; language: string; version: string; destination_kind: "url" | "document"; destination_ref: string; active: boolean; effective_at: string | null; updated_at: string; topic: string | null; section: string | null }
const toRes = (r: ResRow): CountryResource => ({ id: r.id, countryCode: r.country_code, title: r.title, language: r.language, version: r.version, destination: { kind: r.destination_kind, ref: r.destination_ref }, active: r.active, ...(r.effective_at ? { effectiveAt: r.effective_at } : {}), updatedAt: r.updated_at, ...(r.topic ? { topic: r.topic } : {}), ...(r.section ? { section: r.section } : {}) });

export function createPgCountryResources(db: Q): CountryResourceRepository {
  return {
    async list(f) {
      const r = await db.query<ResRow>("SELECT * FROM country_resource WHERE ($1::text IS NULL OR country_code = $1) AND (NOT $2::boolean OR active) ORDER BY title, updated_at DESC", [f?.countryCode ?? null, f?.activeOnly ?? false]);
      return r.rows.map(toRes);
    },
    async get(id) {
      const r = (await db.query<ResRow>("SELECT * FROM country_resource WHERE id = $1", [id])).rows[0];
      return r ? toRes(r) : null;
    },
    async upsert(res) {
      const e = validateResource(res);
      if (e.length) throw new Error(e.join("; "));
      await db.query(
        `INSERT INTO country_resource (id, country_code, title, language, version, destination_kind, destination_ref, active, effective_at, updated_at, topic, section) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET country_code = EXCLUDED.country_code, title = EXCLUDED.title, language = EXCLUDED.language, version = EXCLUDED.version, destination_kind = EXCLUDED.destination_kind,
           destination_ref = EXCLUDED.destination_ref, active = EXCLUDED.active, effective_at = EXCLUDED.effective_at, updated_at = EXCLUDED.updated_at, topic = EXCLUDED.topic, section = EXCLUDED.section`,
        [res.id, res.countryCode, res.title, res.language, res.version, res.destination.kind, res.destination.ref, res.active, res.effectiveAt ?? null, res.updatedAt, res.topic ?? null, res.section ?? null],
      );
    },
  };
}

interface DemandRow { id: string; country: string; topic: string; subtopic: string; category_key: string | null; service_key: string | null; info_type: string; coverage: string; disposition: string; reason: string; boundary: string | null; status: string; decision_note: string | null; first_seen_at: Date; last_seen_at: Date; occurrences: string | number; projects: string | number }
const toDemand = (r: DemandRow): StoredDemand => ({
  id: r.id, country: r.country, topic: r.topic as StoredDemand["topic"], subtopic: r.subtopic, categoryKey: r.category_key, serviceKey: r.service_key, infoType: r.info_type as StoredDemand["infoType"],
  coverage: r.coverage as StoredDemand["coverage"], disposition: r.disposition as StoredDemand["disposition"], reason: r.reason as StoredDemand["reason"], boundary: r.boundary as StoredDemand["boundary"],
  status: r.status as DemandStatus, decisionNote: r.decision_note, occurrences: Number(r.occurrences), projects: Number(r.projects), firstSeenAt: r.first_seen_at.toISOString(), lastSeenAt: r.last_seen_at.toISOString(),
});
const DEMAND_SELECT = `SELECT d.*, (SELECT count(*) FROM knowledge_demand_event e WHERE e.demand_id = d.id) AS occurrences, (SELECT count(DISTINCT e.project_ref) FROM knowledge_demand_event e WHERE e.demand_id = d.id) AS projects FROM knowledge_demand d`;

/** Postgres demand registry. Recurrence is derived from the event table; `status` is written only by `decide`. */
export function createPgDemandRepository(db: Q): DemandRepository {
  return {
    async register(d: KnowledgeDemand, ref, now) {
      assertNormalized(d);
      const id = demandId(d);
      await db.query(
        `INSERT INTO knowledge_demand (id, country, topic, subtopic, category_key, service_key, info_type, coverage, disposition, reason, boundary, first_seen_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) ON CONFLICT (id) DO NOTHING`,
        [id, d.country, d.topic, d.subtopic, d.categoryKey, d.serviceKey, d.infoType, d.coverage, d.disposition, d.reason, d.boundary, now],
      );
      const ev = await db.query("INSERT INTO knowledge_demand_event (demand_id, project_ref, turn_ref, seen_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [id, opaqueRef("p", ref.projectId), opaqueRef("t", ref.turnKey), now]);
      if ((ev.rowCount ?? 0) > 0) await db.query("UPDATE knowledge_demand SET last_seen_at = GREATEST(last_seen_at, $2) WHERE id = $1", [id, now]);
      return toDemand((await db.query<DemandRow>(`${DEMAND_SELECT} WHERE d.id = $1`, [id])).rows[0]!);
    },
    async list(f) {
      const r = await db.query<DemandRow>(
        `${DEMAND_SELECT} WHERE ($1::text IS NULL OR d.country = $1) AND ($2::text IS NULL OR d.topic = $2) AND ($3::text IS NULL OR d.status = $3) ORDER BY 18 DESC, 17 DESC, d.id`,
        [f?.country ?? null, f?.topic ?? null, f?.status ?? null],
      );
      return r.rows.map(toDemand).filter((x) => x.occurrences >= (f?.minOccurrences ?? 0));
    },
    async get(id) {
      const r = (await db.query<DemandRow>(`${DEMAND_SELECT} WHERE d.id = $1`, [id])).rows[0];
      return r ? toDemand(r) : null;
    },
    async decide(id, status, note, now) {
      const u = await db.query("UPDATE knowledge_demand SET status = $2, decision_note = $3, decided_at = $4 WHERE id = $1", [id, status, note, now]);
      if ((u.rowCount ?? 0) === 0) throw new Error(`unknown demand ${id}`);
      return toDemand((await db.query<DemandRow>(`${DEMAND_SELECT} WHERE d.id = $1`, [id])).rows[0]!);
    },
  };
}
