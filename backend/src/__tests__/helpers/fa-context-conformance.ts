import type { FaContextRead, FaContextReader } from "../../precision/ports/fa-context";

/**
 * FaContextReader conformance — the guarantees Precision needs from ANY reader of First Assessment (FA4) context, written down as tests.
 *
 * It encodes only what Product has required of the bridge, and nothing about how FA4 builds it (that contract belongs to FA4):
 *   - permanent project identity (the project id Precision uses is the one the source reports, always);
 *   - result / version identity (which result, under which catalog / contract / crosswalk);
 *   - immutable, reproducible context for a given result (same read => same content and same hash);
 *   - structured, client-safe content only (no e-mail, tokens, payment data or rendered Expansion View; nothing to parse out of text);
 *   - isolation (an unknown project is "nothing delivered", never somebody else's data) and tolerance (a miss is null, not an exception).
 *
 * The fixture reader runs this today. The real reader runs the SAME suite when FA4 delivers its contract: green here is the entry ticket
 * for the first real-project proof, not a substitute for it.
 */
export interface FaContextSubject {
  reader: FaContextReader;
  /** A project that has a delivered result. */
  projectId: string;
  /** A second project that has a delivered result (isolation). */
  otherProjectId?: string;
  /** A project id the source has never heard of. */
  unknownProjectId: string;
  /** Delivers a NEW result for `projectId` (a re-run). Optional: without it supersession is not checked. */
  redeliver?: () => Promise<void> | void;
}

const ALLOWED_TOP = ["project", "company", "needs", "literals", "locale"];
const ALLOWED_PROJECT = ["destinationCountry", "destinationMarket", "sector", "expansionObjective", "timeframe"];
const ALLOWED_COMPANY = ["displayName", "sizeBand", "operatingCountries"];
const ALLOWED_NEED = ["capabilityId", "label", "priority", "status"];

const FORBIDDEN_TEXT: Array<[string, RegExp]> = [
  ["e-mail address", /[^\s"@]+@[^\s"@]+\.[a-z]{2,}/i],
  ["token or secret", /\b(bearer\s+[a-z0-9._-]{10,}|sk_(live|test)_[a-z0-9]+|eyJ[a-zA-Z0-9_-]{10,}\.)/i],
  ["payment data", /\b(card_number|cvv|iban|stripe|checkout_session|payment_intent)\b/i],
  ["rendered view / markup", /<\/?[a-z][^>]*>|expansion[_ ]view|\bYEV\b|radar|executive[_ ]pdf/i],
];

const keysOutside = (o: object, allowed: string[]): string[] => Object.keys(o).filter((k) => !allowed.includes(k));

export function faContextConformance(name: string, make: () => FaContextSubject | Promise<FaContextSubject>): void {
  describe(`FaContextReader conformance — ${name}`, () => {
    let s: FaContextSubject;
    let first: FaContextRead;
    beforeEach(async () => {
      s = await make();
      const r = await s.reader.read(s.projectId);
      if (!r) throw new Error("subject project has no delivered result");
      first = r;
    });

    it("keeps the permanent project identity and names the result and the versions it was built under", () => {
      expect(first.sourceSystem).toBe("fa4");
      expect(first.sourceProjectId).toBe(s.projectId);
      for (const f of ["sourceResultId", "catalogVersion", "contractVersion", "crosswalkVersion", "contextHash", "deliveredAt"] as const) {
        expect(typeof first[f]).toBe("string");
        expect(first[f].length).toBeGreaterThan(0);
      }
      expect(Number.isNaN(Date.parse(first.deliveredAt))).toBe(false);
    });

    it("is reproducible: reading again, or through a new call, gives the same result id, content and hash", async () => {
      const again = await s.reader.read(s.projectId);
      expect(again).toEqual(first);
      expect(JSON.stringify(again?.context)).toBe(JSON.stringify(first.context));
      expect(again?.contextHash).toBe(first.contextHash);
    });

    it("cannot be changed through what it returns (the caller's copy is its own)", async () => {
      (first.context.project as { sector: string }).sector = "TAMPERED";
      (first.context.needs as unknown[]).push({ capabilityId: "x" });
      const again = await s.reader.read(s.projectId);
      expect(again?.context.project.sector).not.toBe("TAMPERED");
      expect(again?.context.needs.some((n) => n.capabilityId === "x")).toBe(false);
    });

    it("returns structured, client-safe content only: the declared shape, no text that has to be parsed or must not leave FA", () => {
      expect(keysOutside(first.context, ALLOWED_TOP)).toEqual([]);
      expect(keysOutside(first.context.project, ALLOWED_PROJECT)).toEqual([]);
      expect(keysOutside(first.context.company, ALLOWED_COMPANY)).toEqual([]);
      for (const n of first.context.needs) {
        expect(keysOutside(n, ALLOWED_NEED)).toEqual([]);
        expect(["high", "medium", "low"]).toContain(n.priority);
        expect(typeof n.capabilityId).toBe("string");
      }
      expect(["es", "en"]).toContain(first.context.locale);
      const text = JSON.stringify(first.context);
      for (const [label, re] of FORBIDDEN_TEXT) expect([label, re.test(text)]).toEqual([label, false]);
    });

    it("answers an unknown project with nothing delivered, never with an exception or somebody else's data", async () => {
      await expect(s.reader.read(s.unknownProjectId)).resolves.toBeNull();
      if (s.otherProjectId) {
        const other = await s.reader.read(s.otherProjectId);
        expect(other?.sourceProjectId).toBe(s.otherProjectId);
        expect(other?.sourceResultId).not.toBe(first.sourceResultId);
        expect(JSON.stringify(other?.context)).not.toContain(first.context.company.displayName);
      }
    });

    it("a re-run is a NEW result of the SAME project: result id changes, project id does not, the old context is not rewritten", async () => {
      if (!s.redeliver) return;
      await s.redeliver();
      const next = await s.reader.read(s.projectId);
      expect(next?.sourceProjectId).toBe(s.projectId);
      expect(next?.sourceResultId).not.toBe(first.sourceResultId);
      expect(first.sourceResultId).not.toBe(next?.sourceResultId); // what the caller already holds keeps describing the old result
    });
  });
}
