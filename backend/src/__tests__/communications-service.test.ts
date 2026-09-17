import { communicationsOverview } from "../admin/communications-service";
import type { BundleStore } from "../fa/services/bundle-store";
import type { ConfigVersioningService } from "../config-versioning/service";

function fakeBundles(overrides: Partial<Record<string, unknown>> = {}): BundleStore {
  return {
    byVersion: async () => ({
      emails: {
        resume_link: {
          copy: {
            en: { subject: "Your beeside assessment is saved", body: "Hi {{preferred_name}}, saved until {{access_until}}.", cta: "Continue my assessment" },
            es: { subject: "Tu evaluación de beeside está guardada", body: "Hola {{preferred_name}}, guardado hasta {{access_until}}.", cta: "Continuar mi evaluación" },
          },
        },
      },
      ...overrides,
    }),
    templateByVersion: async () => ({
      emails: {
        snapshot_ready: {
          copy: {
            en: { subject: "Your beeside Expansion Snapshot", body: "Hi {{preferred_name}}, it's ready.", cta: "View my Expansion Snapshot" },
            es: { subject: "Tu Expansion Snapshot de beeside", body: "Hola {{preferred_name}}, ya está listo.", cta: "Ver mi Expansion Snapshot" },
          },
        },
      },
    }),
    current: async () => ({ version: "fa-qb-2.0.0", bundle: {} as never }),
    rulesByVersion: async () => ({}) as never,
    questionBankCompatibleWith: async () => true,
  } as unknown as BundleStore;
}

function fakeConfigService(versions: { question_bank: string | null; snapshot_template: string | null }): ConfigVersioningService {
  return {
    currentVersions: async () => ({ question_bank: versions.question_bank, rules_engine: null, snapshot_template: versions.snapshot_template }),
  } as unknown as ConfigVersioningService;
}

describe("communicationsOverview", () => {
  it("fills sample placeholder values into every template from both current bundles, sorted by key", async () => {
    const overview = await communicationsOverview(fakeBundles(), fakeConfigService({ question_bank: "fa-qb-2.0.0", snapshot_template: "st-1.0.0" }));
    expect(overview.questionBankVersion).toBe("fa-qb-2.0.0");
    expect(overview.snapshotTemplateVersion).toBe("st-1.0.0");
    expect(overview.templates.map((t) => t.key)).toEqual(["resume_link", "snapshot_ready"]);
    const resume = overview.templates.find((t) => t.key === "resume_link")!;
    expect(resume.source).toBe("question_bank");
    expect(resume.locales.en?.body).not.toMatch(/\{\{/);
    expect(resume.locales.en?.subject).toBe("Your beeside assessment is saved");
  });

  it("never proposes a write: the preview carries no editable fields, only rendered text", async () => {
    const overview = await communicationsOverview(fakeBundles(), fakeConfigService({ question_bank: "fa-qb-2.0.0", snapshot_template: "st-1.0.0" }));
    for (const template of overview.templates) {
      expect(Object.keys(template)).toEqual(["key", "source", "active", "locales"]);
    }
  });

  it("omits a registry entirely when it has no current version yet", async () => {
    const overview = await communicationsOverview(fakeBundles(), fakeConfigService({ question_bank: "fa-qb-2.0.0", snapshot_template: null }));
    expect(overview.snapshotTemplateVersion).toBeNull();
    expect(overview.templates.map((t) => t.key)).toEqual(["resume_link"]);
  });
});
