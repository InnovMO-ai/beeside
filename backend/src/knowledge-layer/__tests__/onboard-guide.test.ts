import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryKnowledgeRepository } from "../memory-repo";
import { InMemoryCountryResources, resolveResources } from "../country-resources";
import { guideSourceId, onboardCountryGuide } from "../onboard-guide";
import { assessKSeed } from "../kseed-spec";
import { retrieve } from "../retrieve";
import { createKnowledgeLayer } from "../service";
import { InMemoryDemandRepository } from "../demand";
import { askLocally } from "./local-consumer";

const FX = (n: string): Buffer => readFileSync(join(__dirname, "fixtures", n));
const URL1 = "https://guides.beeside.example/doing-business-in-mexico-2026.pdf";
const URL2 = "https://guides.beeside.example/doing-business-in-mexico-2027.pdf";
const base = { countryCode: "MX", title: "beeside Doing Business México", language: "es", edition: "2026", url: URL1, file: { filename: "dbm.txt", data: FX("guia-pais-sintetica.txt") }, now: "2026-10-16T09:00:00.000Z", publishedAt: "2026-10-16" };

describe("country resource onboarding — the document drops in without code changes", () => {
  it("one operation: curated source, versioned KSeed material, country resource with its HTTPS destination", async () => {
    const k = new InMemoryKnowledgeRepository(); const r = new InMemoryCountryResources();
    const out = await onboardCountryGuide(k, r, { ...base, resourceType: "pdf" });
    expect(out.ingest.status).toBe("ingested");
    expect(out.sourceId).toBe(guideSourceId("MX"));
    const src = await k.getSource(out.sourceId);
    expect(src).toMatchObject({ authority: "beeside_curated", roles: ["context"], reviewRequired: true, domains: ["guides.beeside.example"] });
    expect(out.ingest.document).toMatchObject({ title: "beeside Doing Business México", edition: "2026", version: 1, locator: URL1, jurisdiction: "MX", status: "active", confidence: "medium" });
    expect(out.resource).toMatchObject({ countryCode: "MX", destination: { kind: "url", ref: URL1 }, active: true, version: "2026", resourceType: "pdf" });
    expect((await resolveResources(r, { countryCode: "MX", language: "en" })).map((x) => x.destination.ref)).toEqual([URL1]);
  });

  it("is idempotent: the same bytes and edition change nothing", async () => {
    const k = new InMemoryKnowledgeRepository(); const r = new InMemoryCountryResources();
    await onboardCountryGuide(k, r, base);
    const again = await onboardCountryGuide(k, r, base);
    expect(again.ingest.status).toBe("unchanged");
    expect(await k.listDocuments({ sourceId: guideSourceId("MX") })).toHaveLength(1);
    expect((await r.list()).length).toBe(1);
  });

  it("a later edition supersedes the older one in KSeed and replaces it as the offered resource; history and provenance remain", async () => {
    const k = new InMemoryKnowledgeRepository(); const r = new InMemoryCountryResources();
    const a = await onboardCountryGuide(k, r, base);
    const b = await onboardCountryGuide(k, r, { ...base, title: "beeside Doing Business México 2027", edition: "2027", url: URL2, now: "2027-10-16T09:00:00.000Z", file: { filename: "dbm27.txt", data: Buffer.from(`${FX("guia-pais-sintetica.txt").toString()}\nSección nueva sobre incentivos de inversión.`) } });
    expect(b.ingest.status).toBe("ingested");
    expect(b.deactivated).toEqual([a.resource.id]);
    const docs = await k.listDocuments({ sourceId: guideSourceId("MX") });
    expect(docs.map((d) => `${d.edition}:${d.status}`).sort()).toEqual(["2026:superseded", "2027:active"]);
    expect(docs.find((d) => d.edition === "2026")?.locator).toBe(URL1);
    expect((await resolveResources(r, { countryCode: "MX", language: "en" })).map((x) => x.destination.ref)).toEqual([URL2]);
    expect((await r.get(a.resource.id))?.active).toBe(false); // deactivated, never deleted
    expect(await k.getSource(guideSourceId("MX"))).toMatchObject({ domains: ["guides.beeside.example"] });
  });

  it("refuses an insecure destination and never lets a curated guide ground obligations", async () => {
    const k = new InMemoryKnowledgeRepository(); const r = new InMemoryCountryResources();
    await expect(onboardCountryGuide(k, r, { ...base, url: "http://insecure.example/x.pdf" })).rejects.toThrow(/https/);
    await onboardCountryGuide(k, r, base);
    const hits = await retrieve(k, { text: "importación temporal IMMEX", topics: ["customs"], jurisdiction: "MX" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.mayGroundObligation === false)).toBe(true);
    const customs = (await assessKSeed(k)).find((a) => a.need.id === "mx.customs.regimes")!;
    expect(customs.status).toBe("partial"); // context exists, but obligations still need an official primary source
  });

  it("the layer serves it through its contract: units with the guide's provenance, and the guide as a country resource", async () => {
    const k = new InMemoryKnowledgeRepository(); const r = new InMemoryCountryResources();
    await onboardCountryGuide(k, r, { ...base, language: "es", title: "Hacer negocios en México" });
    const kl = createKnowledgeLayer({ knowledge: k, demand: new InMemoryDemandRepository(), resources: r });
    const res = await askLocally(kl, "¿Qué es el IMMEX?");
    expect(res.availability).toBe("sufficient");
    expect(res.units[0]).toMatchObject({ wording: "context", source: { sourceId: guideSourceId("MX"), documentTitle: "Hacer negocios en México", edition: "2026", version: 1, authority: "beeside_curated", status: "active", locator: URL1 } });
    expect((await kl.resources({ country: "MX", language: "es" })).map((x) => x.title)).toEqual(["Hacer negocios en México"]);
    expect(await kl.openResource(out0(await r.list()))).toMatchObject({ url: URL1 });
  });
});

const out0 = (rs: { id: string }[]): string => rs[0]!.id;
