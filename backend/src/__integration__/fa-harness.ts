import request from "supertest";
import { Client } from "pg";
import { createSavepointDb } from "../db/database";
import { createApp } from "../index";
import { syncFieldRegistry } from "../fa/admin/field-registry";
import { ensureDevBootstrapAdmin, publishDevConfiguration } from "../fa/admin/publish-config";
import { CaptureEmailTransport } from "../fa/email/email-adapter";
import { BundleStore } from "../fa/services/bundle-store";
import { FaDeps } from "../fa/services/repository";

export const databaseUrl = process.env.TEST_DATABASE_URL;
export const describeWithDb = databaseUrl ? describe : describe.skip;

export interface Harness {
  client: Client;
  deps: FaDeps;
  email: CaptureEmailTransport;
  clock: { now: Date };
  api: () => request.SuperTest<request.Test>;
  advanceDays: (days: number) => void;
  advanceMinutes: (minutes: number) => void;
}

/** One pg client per test file; every test runs in a transaction that is rolled back. */
export function useHarness(): Harness {
  const client = new Client({ connectionString: databaseUrl });
  const email = new CaptureEmailTransport();
  const clock = { now: new Date() };
  const db = createSavepointDb(client);
  const deps: FaDeps = {
    db,
    email,
    bundles: new BundleStore(db),
    config: { appBaseUrl: "https://fa.test", sessionTtlHours: 24, emailCooldownMinutes: 5, now: () => clock.now },
  };
  const harness: Harness = {
    client,
    deps,
    email,
    clock,
    api: () => request(createApp({ fa: deps })) as unknown as request.SuperTest<request.Test>,
    advanceDays: (days) => {
      clock.now = new Date(clock.now.getTime() + days * 86_400_000);
    },
    advanceMinutes: (minutes) => {
      clock.now = new Date(clock.now.getTime() + minutes * 60_000);
    },
  };

  beforeAll(() => client.connect());
  afterAll(() => client.end());
  beforeEach(async () => {
    email.messages.length = 0;
    clock.now = new Date();
    await client.query("BEGIN");
    await syncFieldRegistry(client);
    const adminId = await ensureDevBootstrapAdmin(client);
    await publishDevConfiguration(client, adminId);
  });
  afterEach(() => client.query("ROLLBACK"));
  return harness;
}

export function identity(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Ana",
    lastName: "Rivera",
    company: "Northwind Manufacturing S.A. de C.V.",
    email: "Ana.Rivera@Northwind-Test.example",
    website: "www.northwind-test.example",
    interfaceLanguage: "es",
    acceptLegal: true,
    anonymousSessionId: "5f0c7c2e-6d7a-4c1e-9b8a-3d2f1e0a9b7c",
    ...overrides,
  };
}

/** Manufacturer entering Mexico with a firm, contract-driven timeline (QA persona). */
export const MANUFACTURER: Record<string, unknown> = {
  STORY: "We make industrial valves in Texas and need to start assembling in Mexico for a new customer.",
  ANOTHER_PROJECT: "yes",
  G1: "set_up_local_operation",
  G2: "Deliver the first contract volumes from Mexico on time.",
  G3: "firm_commitment",
  G4: { precision: "quarter", value: "2027-Q2" },
  G5: "customer_contract",
  G6: "existing_customer_demand",
  P1: "know_country_comparing_locations",
  P2: ["MX"],
  P3: "preparing_entry",
  P4: ["target_market", "commercial_model"],
  P5: "no",
  P6: "Choose between Monterrey and Saltillo.",
  SP1: "The market is decided; the site and legal structure are open.",
  B1: "We manufacture industrial valves.",
  B2: "manufacturing",
  B3: "b2b",
  B4: "physical_products",
  B5: ["manufacture", "import"],
  B6: "201_500",
  SP2: "Margins similar to our US plant within two years.",
  O1: ["manufacturing", "import_export", "local_workforce"],
  O_MFG_VOLUME: { amount: 20000, unit: "units" },
  O_MFG_SKU: "51_250",
  O_IMP_SHIPMENTS: "21_100",
  O_IMP_CROSS_BORDER: "yes",
  O_WF_HIRING: "yes",
  O_WF_HEADCOUNT: "not_sure",
  CAP1: ["legal_corporate", "banking", "customs_trade"],
  CAP_BANKING: "need_to_establish",
  D1: "yes",
  D2: "local_entity_legal_setup",
  D3: "within_30_days",
  C1: ["customs_trade", "local_workforce"],
  C2: "customs_trade",
  SP3: "Customs classification delays.",
  C3: "Customer contract signed for deliveries starting Q2 2027.",
  C3_AREAS: ["go_to_market_commercial_strategy"],
  C_CONTRACT: "yes",
  C4: "Our quality certification process.",
  C4_AREAS: ["regulatory_permits_certifications"],
  C5: "Underestimating import lead times.",
  S1: "leading",
  S5: "Ana",
  S6_INTERACTION: "es",
  S6_DELIVERABLE: "en",
};

interface View {
  status: string;
  currentStepId: string | null;
  steps: Array<{ id: string; questionIds: string[] }>;
  answers: Record<string, unknown>;
}

/** Drives the journey through the API exactly like the web app: answer, then confirm each step. */
export async function runJourney(h: Harness, token: string, persona: Record<string, unknown>): Promise<View> {
  const auth = { Authorization: `Bearer ${token}` };
  for (let guard = 0; guard < 40; guard++) {
    let view = (await h.api().get("/api/fa/session").set(auth)).body as View;
    if (view.status === "COMPLETED_LOCKED" || !view.currentStepId) return view;
    const stepId = view.currentStepId;
    const answered = new Set<string>();
    for (let pass = 0; pass < 10; pass++) {
      const step = view.steps.find((s) => s.id === stepId);
      const pending = (step?.questionIds ?? []).filter((id) => id in persona && !answered.has(id));
      if (pending.length === 0) break;
      for (const id of pending) {
        const res = await h.api().put(`/api/fa/session/answers/${id}`).set(auth).send({ value: persona[id] });
        if (res.status !== 200) throw new Error(`answer ${id} failed: ${res.status} ${JSON.stringify(res.body)}`);
        answered.add(id);
        view = res.body as View;
      }
    }
    const done = await h.api().post(`/api/fa/session/steps/${stepId}/complete`).set(auth).send({ durationMs: 1200 });
    if (done.status !== 200) throw new Error(`step ${stepId} failed: ${done.status} ${JSON.stringify(done.body)}`);
  }
  throw new Error("journey did not finish");
}

export function lastLinkToken(h: Harness): string {
  const message = h.email.messages[h.email.messages.length - 1];
  const token = message?.ctaUrl.split("/resume/")[1];
  if (!token) throw new Error("no captured link");
  return token;
}
