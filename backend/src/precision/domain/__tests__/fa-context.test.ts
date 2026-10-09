import type { FaContextRead, FaContextReader } from "../../ports/fa-context";
import { createFaContextService, destinationsOf, parseCountryCodes, parseTimeWindow } from "../fa-context";

const read = (id = "r1"): FaContextRead => ({
  sourceSystem: "fa4", sourceProjectId: "p", sourceResultId: id, catalogVersion: "c", contractVersion: "k", crosswalkVersion: "x", contextHash: "h", deliveredAt: "2026-10-01T00:00:00.000Z",
  context: { project: { destinationCountry: "Mexico", sector: "Food", expansionObjective: "Hub" }, company: { displayName: "Co", operatingCountries: [] }, needs: [], literals: {}, locale: "en" },
});
const reader = (impl: () => Promise<FaContextRead | null>): FaContextReader & { calls: number } => {
  const r = { calls: 0, describe: () => ({ port: "fa_context", implementation: "test", mode: "SIMULATED", verification: "NOT_VERIFIED" }) as never, read: async () => { r.calls += 1; return impl(); } };
  return r;
};

describe("First Assessment context service", () => {
  it("never throws: a failing or empty reader is null, and a failure is not cached", async () => {
    let fail = true;
    const r = reader(async () => { if (fail) throw new Error("upstream down 10.0.0.1"); return read(); });
    const logs: string[] = [];
    const svc = createFaContextService(r, (_l, m, f) => void logs.push(JSON.stringify({ m, f })));
    expect(await svc.read("p")).toBeNull();
    expect(await svc.read("p")).toBeNull();
    expect(r.calls).toBe(2);
    fail = false;
    expect(await svc.read("p")).not.toBeNull();
  });

  it("readWithStatus tells a failed read apart from nothing delivered (the Understanding opening depends on it)", async () => {
    let mode: "fail" | "empty" | "ok" = "fail";
    const r = reader(async () => { if (mode === "fail") throw new Error("boom"); return mode === "empty" ? null : read(); });
    const svc = createFaContextService(r, () => undefined);
    expect(await svc.readWithStatus("p")).toEqual({ read: null, failed: true });
    mode = "empty";
    expect(await svc.readWithStatus("p")).toEqual({ read: null, failed: false });
    mode = "ok";
    const ok = await svc.readWithStatus("p");
    expect(ok.failed).toBe(false);
    expect(ok.read?.sourceResultId).toBe("r1");
  });

  it("caches a delivered context briefly, then asks again", async () => {
    let now = 1_000;
    const r = reader(async () => read());
    const svc = createFaContextService(r, () => undefined, () => now);
    await svc.read("p");
    await svc.read("p");
    expect(r.calls).toBe(1);
    now += 31_000;
    await svc.read("p");
    expect(r.calls).toBe(2);
    svc.invalidate("p");
    await svc.read("p");
    expect(r.calls).toBe(3);
  });

  it("parses destinations and time windows conservatively", () => {
    expect(parseCountryCodes("Mexico")).toEqual(["MX"]);
    expect(parseCountryCodes("México y España")).toEqual(["MX", "ES"]);
    expect(parseCountryCodes("Spain, Germany and mx")).toEqual(["ES", "DE", "MX"]);
    expect(parseCountryCodes("Atlantis")).toEqual([]);
    expect(parseCountryCodes(undefined)).toEqual([]);
    expect(destinationsOf(["MX"], "es")).toEqual([{ code: "MX", label: "México" }]);
    expect(parseTimeWindow("2027-04")).toBe("2027-04");
    expect(parseTimeWindow("2027")).toBe("2027");
    expect(parseTimeWindow("2027-13")).toBeNull();
    expect(parseTimeWindow("next spring")).toBeNull();
  });
});
