import { InMemoryKnowledgeRepository } from "../memory-repo";
import { INITIAL_SOURCES, seedInitialSources } from "../registry";
import { InMemoryCandidateStore, reviewPath, runAgentCycle, type SourceFetcher } from "../agent";
import type { KnowledgeSource } from "../types";

const NOW = "2026-10-15T12:00:00.000Z";
const base = INITIAL_SOURCES[0]!; // imco-ice (context, trusted institutional)
const low: KnowledgeSource = { ...base, id: "glossary", risk: "low", reviewRequired: false, authority: "beeside_curated", roles: ["context"], domains: ["beeside.com"] };
const official: KnowledgeSource = { ...base, id: "off", authority: "official_primary", roles: ["obligation", "context"], risk: "medium", reviewRequired: false, primary: true };

describe("risk-tiered review in the Knowledge Agent", () => {
  it("high-risk sources and obligation-bearing content get the strong tier", () => {
    expect(reviewPath(INITIAL_SOURCES.find((s) => s.id === "sat")!)).toMatchObject({ review: true, tier: "strong" });
    expect(reviewPath(official, { topics: ["taxes"] })).toMatchObject({ review: true, tier: "strong", reason: "obligation_content" });
    expect(reviewPath(official, { topics: null })).toMatchObject({ review: true, tier: "strong" });
  });
  it("sources flagged for review or medium-risk non-primary sources are standard", () => {
    expect(reviewPath({ ...low, reviewRequired: true })).toMatchObject({ review: true, tier: "standard" });
    expect(reviewPath({ ...low, risk: "medium", authority: "secondary" })).toMatchObject({ review: true, tier: "standard", reason: "medium_risk_non_primary" });
  });
  it("regulatory topics from a non-primary low-risk source are never light", () => {
    expect(reviewPath(low, { topics: ["customs"] })).toMatchObject({ review: true, tier: "standard", reason: "high_risk_content_non_primary" });
    expect(reviewPath(low, { topics: null })).toMatchObject({ review: true, tier: "standard", reason: "unclassified_content" });
  });
  it("terminology and general context from a low-risk source is light: applied under governance", () => {
    expect(reviewPath(low, { topics: ["infrastructure", "labor_market"] })).toEqual({ review: false, reason: "low_risk_auto", tier: "light" });
  });

  it("a light candidate is applied with an audit record, a regulatory one waits for a person", async () => {
    const repo = new InMemoryKnowledgeRepository(); await seedInitialSources(repo); await repo.upsertSource(low);
    const store = new InMemoryCandidateStore();
    const fetcher: SourceFetcher = { fetch: async (s) => s.id !== "glossary" ? [] : [
      { url: "https://beeside.com/g1", title: "Glosario logístico", edition: "2026-10", filename: "g.txt", data: Buffer.from("Un puerto seco es una terminal interior de carga. La infraestructura logística conecta puertos, carreteras y ferrocarril.") },
      { url: "https://beeside.com/g2", title: "Nota aduanal", edition: "2026-10", filename: "n.txt", data: Buffer.from("Los pedimentos de aduana y los aranceles de importación se declaran ante la aduana.") },
    ] };
    const rep = await runAgentCycle(repo, store, fetcher, NOW, { imco: NOW, sat: NOW, imss: NOW, se: NOW, dof: NOW });
    const byTitle = Object.fromEntries(rep.candidates.map((c) => [c.title, c]));
    expect(byTitle["Glosario logístico"]).toMatchObject({ tier: "light", status: "auto_applied", reviewReason: "low_risk_auto" });
    expect(byTitle["Nota aduanal"]).toMatchObject({ tier: "standard", status: "pending_review" });
    expect(byTitle["Nota aduanal"]!.contentTopics).toContain("customs");
    const docs = await repo.listDocuments({ sourceId: "glossary" });
    expect(docs.map((d) => d.title)).toEqual(["Glosario logístico"]);
  });
});
