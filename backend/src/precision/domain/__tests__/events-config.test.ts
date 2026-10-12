import type { Db } from "../../../db/database";
import { APPROVED_CUSTOMER_LINKS, APPROVED_CONTACT_EMAIL, configEmail, configUrl, contactEmail, customerLink } from "../config";
import { emitEvent, PRECISION_EVENTS } from "../events";

const fakeDb = (rows: unknown[] = [], rowCount = 1) => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows, rowCount }; } } as unknown as Db;
  return { db, calls };
};

describe("analytics helper", () => {
  it("lists the 19 events once each", () => {
    expect(PRECISION_EVENTS).toHaveLength(19);
    expect(new Set(PRECISION_EVENTS).size).toBe(19);
  });

  it("writes with ON CONFLICT DO NOTHING and keeps only short primitives", async () => {
    const { db, calls } = fakeDb();
    await emitEvent(db, { name: "category_started", eventKey: "k:1", projectId: "p", locale: "xx", properties: { ok: 1, text: "a".repeat(500), nested: { a: 1 }, list: [1], "Bad-Key": 1, flag: true, nothing: null } });
    expect(calls[0]!.sql).toMatch(/ON CONFLICT \(event_key\) DO NOTHING/);
    expect(calls[0]!.params[3]).toBeNull(); // unknown locale is not stored
    const props = JSON.parse(calls[0]!.params[4] as string);
    expect(props).toEqual({ ok: 1, text: "a".repeat(120), flag: true, nothing: null });
  });

  it("returns whether this call inserted the event", async () => {
    expect(await emitEvent(fakeDb([], 1).db, { name: "x_event", eventKey: "a", projectId: "p" })).toBe(true);
    expect(await emitEvent(fakeDb([], 0).db, { name: "x_event", eventKey: "a", projectId: "p" })).toBe(false);
    await expect(emitEvent(fakeDb().db, { name: "x_event", eventKey: "", projectId: "p" })).rejects.toThrow();
  });
});

describe("configuration resolution", () => {
  it("accepts only https URLs and site paths; anything else is 'not configured'", async () => {
    for (const [value, expected] of [["https://ok.test/a", "https://ok.test/a"], ["/help", "/help"], [{ url: "https://ok.test" }, "https://ok.test"], ["javascript:alert(1)", null], ["http://insecure.test", null], ["//evil.test", null], ["", null], [42, null], [null, null]] as const) {
      expect(await configUrl(fakeDb([{ value }]).db, "k", "en")).toBe(expected);
    }
  });

  it("a database failure resolves to the fallback, never an error", async () => {
    const db = { query: async () => { throw new Error("connection lost"); } } as unknown as Db;
    expect(await configUrl(db, "k", "en")).toBeNull();
    // …and the customer links fall back to the approved values (never an error, never a blank link)
    expect(await customerLink(db, "privacy_url", "en", {})).toBe("https://beeside.you/PolíticaPrivacidad");
    expect(await contactEmail(db, "en", {})).toBe("contact@beeside.you");
  });

  it("e-mail and support contact", async () => {
    expect(await configEmail(fakeDb([{ value: "a@b.co" }]).db, "k", "en")).toBe("a@b.co");
    expect(await configEmail(fakeDb([{ value: "not an email" }]).db, "k", "en")).toBeNull();
  });

  it("approved customer links and the contact address: row > environment > approved default; malformed values fall through", async () => {
    const none = fakeDb([]).db;
    expect(await customerLink(none, "privacy_url", "es", {})).toBe("https://beeside.you/PolíticaPrivacidad");
    expect(await customerLink(none, "help_center_url", "en", {})).toBe("https://beeside.you/HelpCenter");
    expect(await customerLink(none, "terms_url", "en", {})).toBe("https://beeside.you/termsandconditions");
    expect(await customerLink(none, "commercial_notices_url", "en", {})).toBe("https://beeside.you/Policiescommercialnotices");
    expect(await contactEmail(none, "en", {})).toBe("contact@beeside.you");
    // environment override, then a database row beats the environment
    expect(await customerLink(none, "terms_url", "en", { PRECISION_TERMS_URL: "https://env.test/terms" })).toBe("https://env.test/terms");
    expect(await customerLink(fakeDb([{ value: "https://row.test/terms" }]).db, "terms_url", "en", { PRECISION_TERMS_URL: "https://env.test/terms" })).toBe("https://row.test/terms");
    // malformed at one level falls to the next, never to a broken link
    expect(await customerLink(fakeDb([{ value: "javascript:alert(1)" }]).db, "terms_url", "en", { PRECISION_TERMS_URL: "http://insecure.test" })).toBe("https://beeside.you/termsandconditions");
    expect(await contactEmail(fakeDb([{ value: "not an email" }]).db, "en", { PRECISION_CONTACT_EMAIL: "x y" })).toBe("contact@beeside.you");
    expect(await contactEmail(fakeDb([{ value: "ops@beeside.test" }]).db, "en", {})).toBe("ops@beeside.test");
  });

  it("every approved default is https, free of placeholders, localhost and staging hosts, and on the beeside.you domain", () => {
    for (const d of Object.values(APPROVED_CUSTOMER_LINKS)) {
      expect(d.value).toMatch(/^https:\/\/beeside\.you\/\S+$/);
      expect(d.value).not.toMatch(/localhost|example|staging|dev\.|127\.0\.0\.1|\.test|TODO|xxx/i);
    }
    expect(APPROVED_CONTACT_EMAIL.value).toBe("contact@beeside.you");
  });
});
