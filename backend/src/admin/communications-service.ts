import type { Locale } from "../fa/engine/bundle-types";
import { fillTemplate } from "../fa/email/email-adapter";
import { BundleStore } from "../fa/services/bundle-store";
import { ConfigVersioningService } from "../config-versioning/service";

/**
 * Read-only preview of the beeside Communications / email template layer (Level 2 MVP §7). Every
 * template lives inside the versioned question_bank or snapshot_template bundle (`emails.<key>`,
 * see report-copy.ts's sibling comment in email-adapter.ts) — there is no separate "templates" table
 * and no separate write path here. This view only reads the two CURRENTLY PUBLISHED bundles and
 * fills each template's placeholders with illustrative sample values so an Admin/Supervisor can see
 * roughly what a recipient sees, in both languages, without needing a live project. Changing a
 * template's actual copy still goes through Configuration's governed draft -> preview -> review ->
 * publish flow for the owning registry (question-bank or snapshot-template) — the same mechanism
 * already used for every other piece of versioned content, so this view can never become a parallel,
 * ungoverned CMS for product copy.
 */

const SAMPLE_VARIABLES: Record<string, string> = {
  preferred_name: "Alex",
  company_name: "Acme Manufacturing",
  access_until: "October 12, 2026",
  days_left: "5",
  recoverable_until: "October 28, 2026",
  retention_until: "November 16, 2026",
};

export interface TemplatePreview {
  key: string;
  source: "question_bank" | "snapshot_template";
  /** True while this key is still a valid send target in the source's current bundle (it always is,
   *  here, since this list is built FROM that bundle) — kept explicit for the UI's own wording rather
   *  than implying an "active" flag that would need to live somewhere else. */
  active: true;
  locales: Partial<Record<Locale, { subject: string; body: string; cta: string; secondaryCta: string | null }>>;
}

export interface CommunicationsOverview {
  questionBankVersion: string | null;
  snapshotTemplateVersion: string | null;
  templates: TemplatePreview[];
}

function preview(
  key: string,
  source: TemplatePreview["source"],
  copy: Record<string, { subject: string; body: string; cta: string; secondary_cta?: string }>,
): TemplatePreview {
  const locales: TemplatePreview["locales"] = {};
  for (const [locale, entry] of Object.entries(copy)) {
    locales[locale as Locale] = {
      subject: fillTemplate(entry.subject, SAMPLE_VARIABLES),
      body: fillTemplate(entry.body, SAMPLE_VARIABLES),
      cta: fillTemplate(entry.cta, SAMPLE_VARIABLES),
      secondaryCta: entry.secondary_cta ? fillTemplate(entry.secondary_cta, SAMPLE_VARIABLES) : null,
    };
  }
  return { key, source, active: true, locales };
}

export async function communicationsOverview(bundles: BundleStore, configService: ConfigVersioningService): Promise<CommunicationsOverview> {
  const current = await configService.currentVersions();
  const templates: TemplatePreview[] = [];

  if (current.question_bank) {
    const bundle = await bundles.byVersion(current.question_bank);
    for (const [key, def] of Object.entries(bundle.emails)) templates.push(preview(key, "question_bank", def.copy));
  }
  if (current.snapshot_template) {
    const template = await bundles.templateByVersion(current.snapshot_template);
    for (const [key, def] of Object.entries(template.emails)) templates.push(preview(key, "snapshot_template", def.copy));
  }
  templates.sort((a, b) => a.key.localeCompare(b.key));

  return { questionBankVersion: current.question_bank, snapshotTemplateVersion: current.snapshot_template, templates };
}
