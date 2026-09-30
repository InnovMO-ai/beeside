import { communicationsOverview, saveAndPublishTemplate } from "../admin/communications-service";
import type { BundleStore } from "../fa/services/bundle-store";
import type { ConfigVersioningService, Queryable } from "../config-versioning/service";

const RESUME_LINK_EN = { subject: "Your beeside assessment is saved", body: "Hi {{preferred_name}}, saved until {{access_until}}.", cta: "Continue my assessment" };
const RESUME_LINK_ES = { subject: "Tu evaluación de beeside está guardada", body: "Hola {{preferred_name}}, guardado hasta {{access_until}}.", cta: "Continuar mi evaluación" };
const SNAPSHOT_READY_EN = { subject: "Your beeside Expansion Snapshot", body: "Hi {{preferred_name}}, it's ready.", cta: "View my Expansion Snapshot" };
const SNAPSHOT_READY_ES = { subject: "Tu Expansion Snapshot de beeside", body: "Hola {{preferred_name}}, ya está listo.", cta: "Ver mi Expansion Snapshot" };

function fakeBundles(): BundleStore {
  return {
    byVersion: async () => ({
      emails: { resume_link: { copy: { en: { ...RESUME_LINK_EN }, es: { ...RESUME_LINK_ES } } } },
    }),
    templateByVersion: async () => ({
      emails: { snapshot_ready: { copy: { en: { ...SNAPSHOT_READY_EN }, es: { ...SNAPSHOT_READY_ES } } } },
    }),
    current: async () => ({ version: "fa-qb-1.1.0", bundle: {} as never }),
    rulesByVersion: async () => ({}) as never,
    questionBankCompatibleWith: async () => true,
  } as unknown as BundleStore;
}

/** Matches the REAL ConfigVersioningService.currentVersions() shape: uppercase registry keys. */
function fakeConfigService(versions: { question_bank: string | null; snapshot_template: string | null }): ConfigVersioningService {
  return {
    currentVersions: async () => ({ QUESTION_BANK: versions.question_bank, RULES_ENGINE: null, SNAPSHOT_TEMPLATE: versions.snapshot_template }),
  } as unknown as ConfigVersioningService;
}

function fakeDb(existingVersions: string[] = []): Queryable {
  const taken = new Set(existingVersions);
  return {
    query: async (text: string, values: unknown[] = []) => {
      if (text.includes("published_at")) return { rows: [{ published_at: "2026-09-01T00:00:00.000Z" }] };
      if (text.startsWith("SELECT 1 FROM")) return { rows: taken.has(String(values[0])) ? [{}] : [] };
      return { rows: [] };
    },
  } as unknown as Queryable;
}

type Call = { op: string; registry: string; version: string; config?: unknown; review?: unknown };

function fakeWritableConfigService(versions: { question_bank: string | null; snapshot_template: string | null }): ConfigVersioningService & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    currentVersions: async () => ({ QUESTION_BANK: versions.question_bank, RULES_ENGINE: null, SNAPSHOT_TEMPLATE: versions.snapshot_template }),
    createDraft: async (registry: string, version: string, config: unknown) => {
      calls.push({ op: "createDraft", registry, version, config });
    },
    submitForPreview: async (registry: string, version: string) => {
      calls.push({ op: "submitForPreview", registry, version });
      return { change_kind: "CONTENT" };
    },
    recordReview: async (registry: string, version: string, _actor: string, review: unknown) => {
      calls.push({ op: "recordReview", registry, version, review });
      return "review-1";
    },
    publish: async (registry: string, version: string) => {
      calls.push({ op: "publish", registry, version });
      return { status: "PUBLISHED" };
    },
  } as unknown as ConfigVersioningService & { calls: Call[] };
}

describe("communicationsOverview", () => {
  it("fills sample placeholder values into every template from both current bundles, sorted by key", async () => {
    const overview = await communicationsOverview(fakeDb(), fakeBundles(), fakeConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: "st-1.0.0" }));
    expect(overview.questionBankVersion).toBe("fa-qb-1.1.0");
    expect(overview.snapshotTemplateVersion).toBe("st-1.0.0");
    expect(overview.questionBankPublishedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(overview.templates.map((t) => t.key)).toEqual(["resume_link", "snapshot_ready"]);
    const resume = overview.templates.find((t) => t.key === "resume_link")!;
    expect(resume.source).toBe("question_bank");
    expect(resume.active).toBe(true);
    // The raw field keeps its placeholders (it's what an edit form is pre-filled with)...
    expect(resume.locales.en?.body).toMatch(/\{\{/);
    // ...while its nested preview is the sample-filled, illustrative rendering.
    expect(resume.locales.en?.preview.body).not.toMatch(/\{\{/);
    expect(resume.locales.en?.subject).toBe(RESUME_LINK_EN.subject);
    expect(resume.locales.en?.preview.subject).toBe("Your beeside assessment is saved");
  });

  it("the preview never contains real project data, only static sample values", async () => {
    const overview = await communicationsOverview(fakeDb(), fakeBundles(), fakeConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: "st-1.0.0" }));
    for (const template of overview.templates) {
      expect(Object.keys(template)).toEqual(["key", "source", "active", "locales"]);
      for (const locale of Object.values(template.locales)) {
        expect(locale!.preview.body).not.toMatch(/@/); // no email address ever gets rendered in here
      }
    }
  });

  it("omits a registry entirely when it has no current version yet", async () => {
    const overview = await communicationsOverview(fakeDb(), fakeBundles(), fakeConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: null }));
    expect(overview.snapshotTemplateVersion).toBeNull();
    expect(overview.snapshotTemplatePublishedAt).toBeNull();
    expect(overview.templates.map((t) => t.key)).toEqual(["resume_link"]);
  });
});

describe("saveAndPublishTemplate", () => {
  const basePatch = { locale: "en" as const, subject: "New subject", body: "New body for {{preferred_name}}.", cta: "New CTA" };

  it("drives the exact governed sequence — draft, preview, an auto-approved content review, publish — on a bumped version", async () => {
    const configService = fakeWritableConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: "st-1.0.0" });
    const result = await saveAndPublishTemplate(fakeDb(), fakeBundles(), configService, "admin-1", "question_bank", "resume_link", basePatch);

    expect(result.version).toBe("fa-qb-1.1.1");
    expect(configService.calls.map((c) => c.op)).toEqual(["createDraft", "submitForPreview", "recordReview", "publish"]);
    expect(configService.calls.every((c) => c.registry === "QUESTION_BANK" && c.version === "fa-qb-1.1.1")).toBe(true);
    expect((configService.calls[2]!.review as { decision: string; diffReviewed: boolean }).decision).toBe("APPROVED");
    expect((configService.calls[2]!.review as { decision: string; diffReviewed: boolean }).diffReviewed).toBe(true);

    // Only the edited locale changed; the other locale and every other template survive untouched.
    const draftedConfig = configService.calls[0]!.config as { emails: Record<string, { copy: Record<string, unknown> }> };
    expect(draftedConfig.emails.resume_link!.copy.en).toMatchObject({ subject: "New subject" });
    expect(draftedConfig.emails.resume_link!.copy.es).toEqual(RESUME_LINK_ES);

    expect(result.template.locales.en?.subject).toBe("New subject");
  });

  it("skips already-taken version numbers", async () => {
    const configService = fakeWritableConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: null });
    const result = await saveAndPublishTemplate(fakeDb(["fa-qb-1.1.1", "fa-qb-1.1.2"]), fakeBundles(), configService, "admin-1", "question_bank", "resume_link", basePatch);
    expect(result.version).toBe("fa-qb-1.1.3");
  });

  it("toggles active without touching copy when only active is given, and preserves it when omitted", async () => {
    const configService = fakeWritableConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: null });
    const off = await saveAndPublishTemplate(fakeDb(), fakeBundles(), configService, "admin-1", "question_bank", "resume_link", { ...basePatch, active: false });
    expect(off.template.active).toBe(false);

    const configService2 = fakeWritableConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: null });
    const untouched = await saveAndPublishTemplate(fakeDb(), fakeBundles(), configService2, "admin-1", "question_bank", "resume_link", basePatch);
    expect(untouched.template.active).toBe(true);
  });

  it("rejects a locale other than en/es", async () => {
    const configService = fakeWritableConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: null });
    await expect(saveAndPublishTemplate(fakeDb(), fakeBundles(), configService, "admin-1", "question_bank", "resume_link", { ...basePatch, locale: "fr" as never })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(configService.calls).toHaveLength(0);
  });

  it("rejects a template key that is not a real, routable email template", async () => {
    const configService = fakeWritableConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: null });
    await expect(saveAndPublishTemplate(fakeDb(), fakeBundles(), configService, "admin-1", "question_bank", "not_a_real_template", basePatch)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects a key that exists but belongs to the other source", async () => {
    const configService = fakeWritableConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: "st-1.0.0" });
    // resume_link is a question_bank template, never a snapshot_template one.
    await expect(saveAndPublishTemplate(fakeDb(), fakeBundles(), configService, "admin-1", "snapshot_template", "resume_link", basePatch)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects an unknown placeholder", async () => {
    const configService = fakeWritableConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: null });
    await expect(
      saveAndPublishTemplate(fakeDb(), fakeBundles(), configService, "admin-1", "question_bank", "resume_link", { ...basePatch, body: "Hi {{not_a_real_variable}}." }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects angle brackets and empty fields", async () => {
    const configService = fakeWritableConfigService({ question_bank: "fa-qb-1.1.0", snapshot_template: null });
    await expect(saveAndPublishTemplate(fakeDb(), fakeBundles(), configService, "admin-1", "question_bank", "resume_link", { ...basePatch, body: "<b>hi</b>" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(saveAndPublishTemplate(fakeDb(), fakeBundles(), configService, "admin-1", "question_bank", "resume_link", { ...basePatch, subject: "   " })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("rejects a secondary CTA on a snapshot_template email (the type never carries one)", async () => {
    const configService = fakeWritableConfigService({ question_bank: null, snapshot_template: "st-1.0.0" });
    await expect(
      saveAndPublishTemplate(fakeDb(), fakeBundles(), configService, "admin-1", "snapshot_template", "snapshot_ready", { ...basePatch, secondaryCta: "Preview room" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("refuses to edit a registry with no published version yet", async () => {
    const configService = fakeWritableConfigService({ question_bank: null, snapshot_template: null });
    await expect(saveAndPublishTemplate(fakeDb(), fakeBundles(), configService, "admin-1", "question_bank", "resume_link", basePatch)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
