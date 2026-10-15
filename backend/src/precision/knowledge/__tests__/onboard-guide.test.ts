import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryKnowledgeRepository } from "../memory-repo";
import { InMemoryCountryResources, resolveResources } from "../country-resources";
import { guideSourceId, onboardCountryGuide } from "../onboard-guide";
import { createOrientationPort } from "../orientation-port";
import { createResourcesPort } from "../resources-port";
import { assessKSeed } from "../kseed-spec";
import { retrieve } from "../retrieve";
import { emptyFrame } from "../../understanding/types";
import type { Frame } from "../../understanding/types";

const FX = (n: string): Buffer => readFileSync(join(__dirname, "fixtures", n));
const URL1 = "https://guides.beeside.example/doing-business-in-mexico-2026.pdf";
const URL2 = "https://guides.beeside.example/doing-business-in-mexico-2027.pdf";
const base = { countryCode: "MX", title: "Doing business in Mexico", language: "en", edition: "2026", url: URL1, file: { filename: "dbm.txt", data: FX("guia-pais-sintetica.txt") }, now: "2026-10-16T09:00:00.000Z", publishedAt: "2026-10-16" };
const frame = (): Frame => { const f = emptyFrame("en"); f.countries.push({ code: "MX", role: "operation", provenance: "client_stated", at: "2026-10-16T00:00:00.000Z" } as never); return f; };

describe("country guide onboarding — the document drops in without code changes", () => {
  it("one operation: curated source, versioned KSeed material, country resource with its HTTPS destination", async () => {
    const k = new InMemoryKnowledgeRepository(); const r = new InMemoryCountryResources();
    const out = await onboardCountryGuide(k, r, base);
    expect(out.ingest.status).toBe("ingested");
    expect(out.sourceId).toBe(guideSourceId("MX"));
    const src = await k.getSource(out.sourceId);
    expect(src).toMatchObject({ authority: "beeside_curated", roles: ["context"], reviewRequired: true, domains: ["guides.beeside.example"] });
    expect(out.ingest.document).toMatchObject({ title: "Doing business in Mexico", edition: "2026", version: 1, locator: URL1, jurisdiction: "MX", status: "active", confidence: "medium" });
    expect(out.resource).toMatchObject({ countryCode: "MX", destination: { kind: "url", ref: URL1 }, active: true, version: "2026" });
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
    const b = await onboardCountryGuide(k, r, { ...base, title: "Doing business in Mexico 2027", edition: "2027", url: URL2, now: "2027-10-16T09:00:00.000Z", file: { filename: "dbm27.txt", data: Buffer.from(`${FX("guia-pais-sintetica.txt").toString()}\nSección nueva sobre incentivos de inversión.`) } });
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

  it("Understanding can use it: orientation answers from the guide naming the source, and the guide is offered once, optionally", async () => {
    const k = new InMemoryKnowledgeRepository(); const r = new InMemoryCountryResources();
    await onboardCountryGuide(k, r, { ...base, language: "es", title: "Hacer negocios en México" });
    const o = await createOrientationPort(k).answer(frame(), "¿Qué es el IMMEX?", "es");
    expect(o?.coverage).toBe("full");
    expect(o?.text).toMatch(/Hacer negocios en México/);
    expect(o?.text).toMatch(/no una obligación/);
    const ports = (await assessKSeed(k)).find((a) => a.need.id === "mx.logistics.ports")!;
    expect(ports.status).toBe("covered");
    const f = frame(); f.locale = "es";
    const port = createResourcesPort(r);
    const offer = await port.offer(f, "es", "2026-10-17T00:00:00.000Z", "priority");
    expect(offer?.title).toBe("Hacer negocios en México");
    expect(offer?.text).not.toMatch(/https?:/);                         // the link is configuration, never in the chat text
    expect(offer?.text).toMatch(/No es necesario leerla/);
    f.asked[offer!.key] = 1;
    expect(await port.offer(f, "es", "2026-10-17T00:00:00.000Z", "priority")).toBeNull();
  });
});
