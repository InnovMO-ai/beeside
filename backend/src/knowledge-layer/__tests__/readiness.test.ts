/**
 * The first production connection is never an EMPTY Knowledge Layer: a registry of approved sources is not knowledge.
 * Readiness = published (active) documents with passages for every required jurisdiction. Also the seed manifest parser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingestDocument } from "../ingest";
import { InMemoryKnowledgeRepository } from "../memory-repo";
import { knowledgeReadiness } from "../readiness";
import { seedInitialSources } from "../registry";
import { parseSeedManifest } from "../../scripts/kl-seed";

const NOW = "2026-10-16T10:00:00.000Z";
const FX = (n: string): Buffer => readFileSync(join(__dirname, "fixtures", n));

describe("knowledge readiness", () => {
  it("a layer with sources registered but no published knowledge is NOT ready (the empty adapter is not the production state)", async () => {
    const repo = new InMemoryKnowledgeRepository();
    await seedInitialSources(repo);
    expect(await knowledgeReadiness(repo, ["MX"])).toEqual({ ready: false, jurisdictions: [{ jurisdiction: "MX", activeDocuments: 0, passages: 0, ready: false }] });
  });
  it("is ready once the initial seed is published for the required country, and not for a country without it", async () => {
    const repo = new InMemoryKnowledgeRepository();
    await seedInitialSources(repo);
    await ingestDocument(repo, { sourceId: "imco-ice", edition: "2025", locator: "https://imco.org.mx/indices/ice-fixture", now: NOW, title: "ICE (fixture)", filename: "ice.pdf", data: FX("ice-sintetico.pdf") });
    const r = await knowledgeReadiness(repo, ["mx", "MX"]);
    expect(r.ready).toBe(true);
    expect(r.jurisdictions).toHaveLength(1);
    expect(r.jurisdictions[0]!.passages).toBeGreaterThan(0);
    expect((await knowledgeReadiness(repo, ["MX", "CL"])).ready).toBe(false);
    expect((await knowledgeReadiness(repo, [])).ready).toBe(false);
  });
});

describe("seed manifest", () => {
  const ok = { documents: [{ source: "imco-ice", title: "T", edition: "2025", locator: "https://imco.org.mx/x", file: "a.pdf", topics: ["labor_market"] }] };
  it("accepts a valid manifest and resolves files inside its folder", () => {
    const [e] = parseSeedManifest(ok, "/seed");
    expect(e!.path).toBe("/seed/a.pdf");
  });
  it("refuses an empty manifest, missing fields, unknown topics and paths that escape the folder", () => {
    expect(() => parseSeedManifest({ documents: [] }, "/seed")).toThrow(/non-empty/);
    expect(() => parseSeedManifest({ documents: [{ ...ok.documents[0], title: "" }] }, "/seed")).toThrow(/title/);
    expect(() => parseSeedManifest({ documents: [{ ...ok.documents[0], topics: ["nonsense"] }] }, "/seed")).toThrow(/unknown topic/);
    expect(() => parseSeedManifest({ documents: [{ ...ok.documents[0], file: "../etc/passwd" }] }, "/seed")).toThrow(/inside the manifest folder/);
    expect(() => parseSeedManifest({ documents: [{ ...ok.documents[0], file: "/etc/passwd" }] }, "/seed")).toThrow(/inside the manifest folder/);
  });
});
