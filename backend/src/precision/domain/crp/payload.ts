/**
 * The single Operation Hub payload builder. The Preview and the Send use THIS function over the same inputs, so no
 * hidden body can differ from what the client saw (Build Readiness E-3/E-4).
 *
 * Whitelist, not blacklist: the payload is assembled field by field from sanitized values. It carries:
 *   1. identity + project context from the CONFIRMED My Service Map snapshot (never the live view),
 *   2. the confirmed CRP (the immutable pack) as professional blocks,
 *   3. the allowed company context (the company display name),
 *   4. operational pending items ("Information required later") and Execution Dependency marks, inside the CRP.
 * It never carries conversation, prompts, person names, e-mail, FA provenance, documents, other projects' data, or any
 * manifest field key. The only identifiers are the opaque ones the contract names (company/project/workstream/crp ids,
 * category_key). The deterministic `delivery_id` and the absence of timestamps in the checksum keep the checksum stable
 * between Preview, Send, retries and the platform's read-back.
 */
import { createHash } from "node:crypto";
import type { Db } from "../../../db/database";
import { categoryInfo } from "../../manifest/categories";
import { OH_CONTRACT_VERSION, payloadChecksum, type OhHandoffPayload } from "../../ports/operation-hub";
import type { Locale } from "../../api/dto";
import { toStructured, type StructuredCrp } from "./content";
import {
  crpDeliveryKey,
  ledgerView,
  loadCompany,
  loadCurrentPack,
  loadCurrentSnapshot,
  type CategoryRow,
  type LedgerView,
  type PackRow,
  type SnapshotRow,
} from "./data";
import { CrpError } from "./errors";
import { packContent } from "./service";
import { sanitizeOrNull, sanitizeText } from "./sanitize";

export interface PayloadPsmItem { label: string; why: string | null; priority: string | null; timing: string | null; state: string }
export interface PayloadPsmCategory { category_key?: string; category_label: string; kind: string; items: PayloadPsmItem[] }
export interface PayloadPsm {
  psm_version: number;
  objectives: string[];
  destinations: string[];
  time_window: string | null;
  product_or_service: string | null;
  operating_entity: string | null;
  categories: PayloadPsmCategory[];
  open_items: string[];
  /** What Precision understood (additive; absent for projects understood by the generic engine). */
  understanding?: {
    /** Contract version of this block (additive and backward compatible; consumers ignore fields they do not know). */
    version: number;
    context: string[];
    facts: { label: string; value: string }[];
    pending: string[];
    findings: { title: string; detail: string; specialty: string | null }[];
  };
}

export interface Handoff {
  payload: OhHandoffPayload;
  checksum: string;
  key: string;
  category: CategoryRow;
  pack: PackRow;
  structured: StructuredCrp;
  psm: PayloadPsm;
  companyName: string;
  ledger: LedgerView;
  /** Language of the confirmed content (what is sent), which may differ from the viewer's current language. */
  contentLocale: Locale;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown, max = 500): string[] => arr(v).map((x) => sanitizeText(x, max)).filter(Boolean);
const PRIORITIES = new Set(["high", "medium", "low"]);
const STATES = new Set(["confirmed", "assumed", "pending", "not_applicable"]);

/** Whitelist projection of a `psm.v1` snapshot content. */
export function toPayloadPsm(snapshot: SnapshotRow): PayloadPsm {
  const c = obj(snapshot.content);
  const project = obj(c.project);
  const categories: PayloadPsmCategory[] = arr(c.groups).map((g) => {
    const go = obj(g);
    const key = typeof go.categoryKey === "string" ? go.categoryKey : "";
    const kind = typeof go.kind === "string" && ["category", "strategic_advisory", "ecosystem_development", "to_review"].includes(go.kind) ? go.kind : "category";
    const out: PayloadPsmCategory = {
      category_label: sanitizeText(go.label, 200),
      kind,
      items: arr(go.items).map((i) => {
        const io = obj(i);
        return {
          label: sanitizeText(io.label, 300),
          why: sanitizeOrNull(io.why, 600),
          priority: typeof io.priority === "string" && PRIORITIES.has(io.priority) ? io.priority : null,
          timing: sanitizeOrNull(io.timing, 200),
          state: typeof io.state === "string" && STATES.has(io.state) ? io.state : "pending",
        };
      }),
    };
    if (key && !key.startsWith("new:") && kind !== "to_review") out.category_key = key;
    return out;
  });
  const objective = sanitizeOrNull(project.objective, 1000);
  const u = obj(c.understanding);
  const SPECIALTIES = new Set(["legal", "tax", "labor", "customs", "regulatory", "corporate", "finance"]);
  const understanding = {
    version: typeof u.version === "number" && Number.isInteger(u.version) && u.version >= 1 ? u.version : 1,
    context: strs(u.context, 400).slice(0, 8),
    facts: arr(u.facts).map((f) => ({ label: sanitizeText(obj(f).label, 120), value: sanitizeText(obj(f).value, 240) })).filter((f) => f.label && f.value).slice(0, 30),
    pending: strs(u.pending, 200).slice(0, 20),
    findings: arr(u.findings)
      .map((f) => ({ title: sanitizeText(obj(f).title, 200), detail: sanitizeText(obj(f).detail, 600), specialty: typeof obj(f).specialty === "string" && SPECIALTIES.has(obj(f).specialty as string) ? (obj(f).specialty as string) : null }))
      .filter((f) => f.title && f.detail)
      .slice(0, 12),
  };
  const hasU = understanding.context.length + understanding.facts.length + understanding.pending.length + understanding.findings.length > 0;
  return {
    psm_version: snapshot.version,
    objectives: objective ? [objective] : [],
    destinations: strs(project.destinations, 120),
    time_window: sanitizeOrNull(project.timeWindow, 200),
    product_or_service: sanitizeOrNull(project.productOrService, 500),
    operating_entity: sanitizeOrNull(project.operatingEntity, 300),
    categories,
    open_items: strs(c.openItems, 300),
    ...(hasU ? { understanding } : {}),
  };
}

function deliveryId(key: string): string {
  const h = createHash("sha256").update(`delivery:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Packs and confirmation of the category's CURRENT pack, or NOT_READY. Lifecycle is checked by the callers that need it. */
export async function loadConfirmedPack(db: Db, category: CategoryRow): Promise<PackRow> {
  const pack = await loadCurrentPack(db, category);
  if (!pack || !pack.confirmedAt) throw new CrpError("NOT_READY");
  return pack;
}

/**
 * Builds the canonical payload for the category's confirmed pack. `requireCompleted` (default true) also demands that the
 * category is currently confirmed (not being versioned). Throws NOT_READY when there is no confirmed pack or no confirmed
 * My Service Map.
 */
export async function buildHandoff(db: Db, category: CategoryRow, now: Date, opts: { requireCompleted?: boolean } = {}): Promise<Handoff> {
  const pack = await loadConfirmedPack(db, category);
  if (opts.requireCompleted !== false && category.lifecycle !== "completed") throw new CrpError("NOT_READY");
  const snapshot = await loadCurrentSnapshot(db, category.projectId);
  const company = await loadCompany(db, category.projectId);
  if (!snapshot || !company) throw new CrpError("NOT_READY");

  const content = packContent(pack);
  const structured = toStructured(content);
  const psm = toPayloadPsm(snapshot);
  const key = crpDeliveryKey(category.projectId, pack.id, pack.version);
  const ledger = await ledgerView(db, category.projectId, key);
  const kind: OhHandoffPayload["contract"]["kind"] = ledger.firstDeliveredKey === null || ledger.firstDeliveredKey === key ? "first_send" : "crp";
  const info = categoryInfo(category.categoryKey);
  const contentLocale: Locale = structured.language;
  const companyName = sanitizeText(company.name, 200);

  const payload: OhHandoffPayload = {
    contract: { oh_contract_version: OH_CONTRACT_VERSION, delivery_id: deliveryId(key), idempotency_key: key, kind, sent_at: now.toISOString() },
    identity: { company_id: company.companyId, project_id: category.projectId },
    company_context: { display_name: companyName },
    project_context: { psm: psm as unknown as Record<string, unknown> },
    workstream: {
      workstream_id: category.instanceId,
      category_key: category.categoryKey,
      category_label: sanitizeText(info.label[contentLocale], 200),
      crp_kind: structured.crp_kind,
    },
    artifact: { crp_id: pack.id, crp_artifact_id: `${pack.id}:${pack.version}`, crp_version: pack.version, structured: structured as unknown as Record<string, unknown> },
    provenance: {
      psm_version: snapshot.version,
      psm_confirmed_at: snapshot.confirmedAt.toISOString(),
      crp_version: pack.version,
      crp_created_at: pack.generatedAt.toISOString(),
      oh_contract_version: OH_CONTRACT_VERSION,
    },
  };
  return { payload, checksum: payloadChecksum(payload), key, category, pack, structured, psm, companyName, ledger, contentLocale };
}
