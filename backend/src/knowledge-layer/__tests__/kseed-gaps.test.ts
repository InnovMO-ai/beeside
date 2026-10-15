import { KSEED_SPEC, assessKSeed } from "../kseed-spec";
import { V1_GAP_PLAN, renderV1GapList } from "../kseed-gaps";
import { InMemoryKnowledgeRepository } from "../memory-repo";
import { seedInitialSources } from "../registry";
import { ingestDocument } from "../ingest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("V1 KSeed gap plan", () => {
  it("has exactly one plan entry per V1-required need, with unique priorities 1..n", () => {
    const required = KSEED_SPEC.filter((n) => n.v1 === "required" && n.kind === "obligation" || n.id === "mx.logistics.ports").map((n) => n.id);
    expect(V1_GAP_PLAN.map((p) => p.needId).sort()).toEqual([...required].sort());
    expect(V1_GAP_PLAN.map((p) => p.priority).sort((a, b) => a - b)).toEqual(V1_GAP_PLAN.map((_, i) => i + 1));
    for (const p of V1_GAP_PLAN) {
      expect(KSEED_SPEC.some((n) => n.id === p.needId)).toBe(true);
      for (const f of [p.topic, p.whyPrecisionNeedsIt, p.exampleQuestion, p.enables, p.idealSourceType, p.suggestedSource, p.minimumV1, p.reviewer]) expect(f.length).toBeGreaterThan(10);
      expect(p.supports.length).toBeGreaterThan(0);
    }
  });
  it("lists the open gaps in priority order, always marking sources as not approved", async () => {
    const repo = new InMemoryKnowledgeRepository(); await seedInitialSources(repo);
    await ingestDocument(repo, { sourceId: "imco-ice", title: "ICE", edition: "2025", locator: "https://imco.org.mx/x", filename: "ice.pdf", data: readFileSync(join(__dirname, "fixtures", "ice-sintetico.pdf")), now: "2026-10-15T00:00:00.000Z" });
    const md = renderV1GapList(await assessKSeed(repo));
    expect(md).toMatch(/\(12\)/);
    expect((md.match(/NO APROBADA TODAVÍA/g) ?? []).length).toBe(12); expect(md).toMatch(/NO APROBADAS TODAVÍA/);
    const order = [...md.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(md).not.toMatch(/https?:\/\//);
  });
});
