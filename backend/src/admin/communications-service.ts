import type { Locale, QuestionBankBundle } from "../fa/engine/bundle-types";
import type { SnapshotTemplateBundle } from "../snapshot/template";
import { fillTemplate } from "../fa/email/email-adapter";
import { BundleStore } from "../fa/services/bundle-store";
import { ConfigVersioningError, ConfigVersioningService, Queryable } from "../config-versioning/service";
import { EMAIL_TEMPLATES, isEmailTemplate, TemplateSource } from "../operations/email-outbox";

/**
 * The beeside Communications / email template layer (Level 2 MVP §7). Every template lives inside
 * the versioned question_bank or snapshot_template bundle (`emails.<key>`, see the sibling comment
 * in fa/email/email-adapter.ts) — there is no separate "templates" table. `communicationsOverview`
 * reads the two CURRENTLY PUBLISHED bundles and fills each template's placeholders with illustrative
 * sample values so an Admin/Supervisor can see roughly what a recipient sees, in both languages,
 * without needing a live project. `saveAndPublishTemplate` is the one write path, and it is NOT a
 * parallel configuration system: it patches only `emails.<key>.copy.<locale>` (and, optionally,
 * `emails.<key>.active`) onto a full clone of the current bundle, then drives that clone through the
 * exact same governed draft -> preview -> review -> publish sequence (config_create_draft ->
 * config_submit_for_preview -> config_record_review -> config_publish) that Configuration's generic
 * UI uses for every other versioned change — the DB's own change-kind classifier already treats copy
 * and email content as CONTENT, never LOGIC_SCHEMA, so this path can never touch questions, scoring,
 * canonical field definitions or branching: the merge only ever writes inside `emails.<key>`, and the
 * key must already both exist in the published bundle and be a template the outbox actually sends
 * (`isEmailTemplate`), so this can edit an existing template but never invent a new, unreachable one.
 */

const SAMPLE_VARIABLES: Record<string, string> = {
  preferred_name: "Alex",
  company_name: "Acme Manufacturing",
  access_until: "October 12, 2026",
  days_left: "5",
  recoverable_until: "October 28, 2026",
  retention_until: "November 16, 2026",
};

/** The only placeholders `prepare()` in operations/email-outbox.ts ever fills in — see SAMPLE_VARIABLES above. */
export const EMAIL_TEMPLATE_VARIABLES = Object.keys(SAMPLE_VARIABLES);

const REGISTRY_OF: Record<TemplateSource, "QUESTION_BANK" | "SNAPSHOT_TEMPLATE"> = {
  question_bank: "QUESTION_BANK",
  snapshot_template: "SNAPSHOT_TEMPLATE",
};
const TABLE_OF: Record<TemplateSource, string> = {
  question_bank: "question_bank_version",
  snapshot_template: "snapshot_template_version",
};

type EmailsEntry = { active?: boolean; copy: Record<string, { subject: string; body: string; cta: string; secondary_cta?: string }> };

export interface TemplatePreview {
  key: string;
  source: TemplateSource;
  /** false only when an Administrator has explicitly deactivated this template (see saveAndPublishTemplate). */
  active: boolean;
  /** `subject`/`body`/`cta`/`secondaryCta` are the RAW, editable template text (placeholders intact) —
   *  what saveAndPublishTemplate's `patch` should be pre-filled with. `preview` is the same text with
   *  SAMPLE_VARIABLES filled in, purely illustrative, never real project data. */
  locales: Partial<
    Record<
      Locale,
      { subject: string; body: string; cta: string; secondaryCta: string | null; preview: { subject: string; body: string; cta: string; secondaryCta: string | null } }
    >
  >;
}

export interface CommunicationsOverview {
  questionBankVersion: string | null;
  snapshotTemplateVersion: string | null;
  /** When each registry's current bundle was published — the templates' shared "updated" timestamp,
   *  since editing any one template publishes a new version of the whole bundle (see saveAndPublishTemplate). */
  questionBankPublishedAt: string | null;
  snapshotTemplatePublishedAt: string | null;
  templates: TemplatePreview[];
}

function preview(key: string, source: TemplateSource, entry: EmailsEntry): TemplatePreview {
  const locales: TemplatePreview["locales"] = {};
  for (const [locale, copy] of Object.entries(entry.copy)) {
    locales[locale as Locale] = {
      subject: copy.subject,
      body: copy.body,
      cta: copy.cta,
      secondaryCta: copy.secondary_cta ?? null,
      preview: {
        subject: fillTemplate(copy.subject, SAMPLE_VARIABLES),
        body: fillTemplate(copy.body, SAMPLE_VARIABLES),
        cta: fillTemplate(copy.cta, SAMPLE_VARIABLES),
        secondaryCta: copy.secondary_cta ? fillTemplate(copy.secondary_cta, SAMPLE_VARIABLES) : null,
      },
    };
  }
  return { key, source, active: entry.active !== false, locales };
}

async function publishedAt(db: Queryable, table: string, version: string | null): Promise<string | null> {
  if (!version) return null;
  const { rows } = await db.query(`SELECT published_at FROM ${table} WHERE version = $1`, [version]);
  const row = rows[0] as { published_at: string | Date | null } | undefined;
  if (!row?.published_at) return null;
  return row.published_at instanceof Date ? row.published_at.toISOString() : row.published_at;
}

export async function communicationsOverview(db: Queryable, bundles: BundleStore, configService: ConfigVersioningService): Promise<CommunicationsOverview> {
  const current = await configService.currentVersions();
  const questionBankVersion = current.QUESTION_BANK;
  const snapshotTemplateVersion = current.SNAPSHOT_TEMPLATE;
  const templates: TemplatePreview[] = [];

  if (questionBankVersion) {
    const bundle = await bundles.byVersion(questionBankVersion);
    for (const [key, entry] of Object.entries(bundle.emails)) templates.push(preview(key, "question_bank", entry));
  }
  if (snapshotTemplateVersion) {
    const template = await bundles.templateByVersion(snapshotTemplateVersion);
    for (const [key, entry] of Object.entries(template.emails)) templates.push(preview(key, "snapshot_template", entry));
  }
  templates.sort((a, b) => a.key.localeCompare(b.key));

  const [questionBankPublishedAt, snapshotTemplatePublishedAt] = await Promise.all([
    publishedAt(db, TABLE_OF.question_bank, questionBankVersion),
    publishedAt(db, TABLE_OF.snapshot_template, snapshotTemplateVersion),
  ]);

  return { questionBankVersion, snapshotTemplateVersion, questionBankPublishedAt, snapshotTemplatePublishedAt, templates };
}

export interface TemplatePatch {
  locale: Locale;
  subject: string;
  body: string;
  cta: string;
  secondaryCta?: string | null;
  /** Omit to leave the template's active state unchanged. */
  active?: boolean;
}

export interface TemplateSaveResult {
  version: string;
  template: TemplatePreview;
}

function requiredText(value: unknown, field: string, maxLen: number): string {
  if (typeof value !== "string" || value.trim() === "") throw new ConfigVersioningError("VALIDATION_FAILED", `${field} must be a non-empty string`);
  if (value.length > maxLen) throw new ConfigVersioningError("VALIDATION_FAILED", `${field} must be ${maxLen} characters or fewer`);
  if (/[<>]/.test(value)) throw new ConfigVersioningError("VALIDATION_FAILED", `${field} may not contain "<" or ">"`);
  for (const match of value.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    if (!EMAIL_TEMPLATE_VARIABLES.includes(match[1] ?? "")) {
      throw new ConfigVersioningError("VALIDATION_FAILED", `${field} uses an unknown placeholder "{{${match[1]}}}" — allowed: ${EMAIL_TEMPLATE_VARIABLES.join(", ")}`);
    }
  }
  return value;
}

/** Bumps the trailing semver-shaped patch component: "fa-qb-1.1.0" -> "fa-qb-1.1.1", "st-1.0.0" -> "st-1.0.1". */
function nextVersion(current: string): string {
  const match = /^(.*?)(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) throw new ConfigVersioningError("VALIDATION_FAILED", `cannot derive a new version from "${current}"`);
  const [, prefix, major, minor, patch] = match;
  return `${prefix}${major}.${minor}.${Number(patch) + 1}`;
}

async function freeVersion(db: Queryable, table: string, base: string): Promise<string> {
  let candidate = nextVersion(base);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE version = $1`, [candidate]);
    if (rows.length === 0) return candidate;
    candidate = nextVersion(candidate);
  }
  throw new ConfigVersioningError("CONFLICT", `could not find a free version after "${base}"`);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The one governed write path for Communications. Loads the CURRENTLY PUBLISHED bundle for the
 * template's registry (never the code's build-time bundle, which could be stale against whatever an
 * earlier Communications edit already published), applies the patch to only that one template's
 * `copy.<locale>` (and `active`, if given), and publishes the result as a new version through the
 * real config-versioning gate — draft, preview, an auto-recorded APPROVED content review (this
 * class of change is never LOGIC_SCHEMA, so there is nothing for a second reviewer to approve that
 * the gate itself doesn't already verify), then publish. Every step is the same DB function the
 * generic Configuration UI calls, so version history, `config_version_event` audit rows and
 * ADMIN-only enforcement all apply exactly as they do there — an Administrator's identity and the
 * publish timestamp are recorded by that same mechanism, not duplicated here.
 */
export async function saveAndPublishTemplate(
  db: Queryable,
  bundles: BundleStore,
  configService: ConfigVersioningService,
  actorAdminId: string,
  source: TemplateSource,
  key: string,
  patch: TemplatePatch,
): Promise<TemplateSaveResult> {
  if (patch.locale !== "en" && patch.locale !== "es") throw new ConfigVersioningError("VALIDATION_FAILED", "locale must be en or es");
  if (!isEmailTemplate(key) || EMAIL_TEMPLATES[key].source !== source) {
    throw new ConfigVersioningError("NOT_FOUND", `${source}/${key} is not a known email template`);
  }
  const subject = requiredText(patch.subject, "subject", 200);
  const body = requiredText(patch.body, "body", 2000);
  const cta = requiredText(patch.cta, "cta", 80);
  const secondaryCta = patch.secondaryCta ? requiredText(patch.secondaryCta, "secondaryCta", 80) : undefined;
  if (secondaryCta && source === "snapshot_template") {
    throw new ConfigVersioningError("VALIDATION_FAILED", "snapshot_template email templates do not support a secondary CTA");
  }

  const current = await configService.currentVersions();
  const currentVersion = source === "question_bank" ? current.QUESTION_BANK : current.SNAPSHOT_TEMPLATE;
  if (!currentVersion) throw new ConfigVersioningError("NOT_FOUND", `${source} has no published version yet`);

  const registry = REGISTRY_OF[source];
  const table = TABLE_OF[source];
  const version = await freeVersion(db, table, currentVersion);
  const activeEntry = (existingActive: boolean | undefined): { active?: boolean } => ({
    ...(typeof existingActive === "boolean" ? { active: existingActive } : {}),
    ...(typeof patch.active === "boolean" ? { active: patch.active } : {}),
  });

  // Branched (rather than handled through one polymorphic bundle variable) so each branch keeps the
  // exact shape its own registry's `emails` type allows — question_bank's copy carries an optional
  // `secondary_cta`, snapshot_template's never does.
  let savedEntry: EmailsEntry;
  if (source === "question_bank") {
    const bundle = await bundles.byVersion(currentVersion);
    const existing = bundle.emails[key];
    if (!existing) throw new ConfigVersioningError("NOT_FOUND", `${key} is not in the published ${source} bundle`);
    const nextConfig: QuestionBankBundle = deepClone(bundle);
    const nextEntry = { ...activeEntry(existing.active), copy: { ...existing.copy, [patch.locale]: { subject, body, cta, ...(secondaryCta ? { secondary_cta: secondaryCta } : {}) } } };
    nextConfig.emails[key] = nextEntry;
    await configService.createDraft(registry, version, nextConfig, actorAdminId);
    savedEntry = nextEntry;
  } else {
    const bundle = await bundles.templateByVersion(currentVersion);
    const existing = bundle.emails[key];
    if (!existing) throw new ConfigVersioningError("NOT_FOUND", `${key} is not in the published ${source} bundle`);
    const nextConfig: SnapshotTemplateBundle = deepClone(bundle);
    const nextEntry = { ...activeEntry(existing.active), copy: { ...existing.copy, [patch.locale]: { subject, body, cta } } };
    nextConfig.emails[key] = nextEntry;
    await configService.createDraft(registry, version, nextConfig, actorAdminId);
    savedEntry = nextEntry;
  }

  await configService.submitForPreview(registry, version, actorAdminId);
  await configService.recordReview(registry, version, actorAdminId, {
    decision: "APPROVED",
    diffReviewed: true,
    notes: `Communications template edit: ${source}/${key} (${patch.locale})`,
  });
  await configService.publish(registry, version, actorAdminId);

  return { version, template: preview(key, source, savedEntry) };
}
