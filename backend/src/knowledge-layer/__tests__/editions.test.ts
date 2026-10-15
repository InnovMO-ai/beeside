import { InMemoryKnowledgeRepository } from "../memory-repo";
import { seedInitialSources } from "../registry";
import { compareEditions, ingestDocument, seriesTitle } from "../ingest";
import { compareDocuments, compareWithPrevious, listSeries } from "../editions";
import { retrieve } from "../retrieve";

const NOW = "2026-10-14T12:00:00.000Z";
const URL25 = "https://imco.org.mx/indices/ice-2025";
const URL26 = "https://imco.org.mx/indices/ice-2026";
const csv = (rows: string[][]): Buffer => Buffer.from(["Estado,Indicador,Valor,Lugar,Año", ...rows.map((r) => r.join(","))].join("\n"));
const ED25 = csv([["Nuevo León", "Mercado de trabajo", "68.2", "3", "2025"], ["Querétaro", "Mercado de trabajo", "64.9", "6", "2025"], ["Chiapas", "Mercado de trabajo", "31.0", "31", "2025"]]);
const ED26 = csv([["Nuevo León", "Mercado de trabajo", "66.0", "5", "2026"], ["Querétaro", "Mercado de trabajo", "64.9", "6", "2026"], ["Sonora", "Mercado de trabajo", "50.0", "12", "2026"]]);

const ing = (repo: InMemoryKnowledgeRepository, title: string, edition: string, locator: string, data: Buffer) =>
  ingestDocument(repo, { sourceId: "imco-ice", title, edition, locator, filename: "ice.csv", data, now: NOW });

describe("series and editions", () => {
  it("reduces edition-bearing titles to a series title and orders editions naturally", () => {
    expect(seriesTitle("ICE 2025 Boletas")).toBe("ICE Boletas");
    expect(seriesTitle("ICE-2026_Boletas-")).toBe("ICE Boletas");
    expect(seriesTitle("Índice de Competitividad Estatal")).toBe("Índice de Competitividad Estatal");
    expect(seriesTitle("2025")).toBe("2025");
    expect(compareEditions("2025", "2026")).toBeLessThan(0);
    expect(compareEditions("2026-Q4", "2026-Q2")).toBeGreaterThan(0);
    expect(compareEditions("2026", "2026-Q2")).toBeLessThan(0);
    expect(compareEditions("2026", "2026")).toBe(0);
    expect(compareEditions("2027", "2026-Q4")).toBeGreaterThan(0);
  });

  it("ICE 2026 under a different title supersedes 2025; history is kept with provenance", async () => {
    const repo = new InMemoryKnowledgeRepository(); await seedInitialSources(repo);
    const a = await ing(repo, "ICE 2025", "2025", URL25, ED25);
    const b = await ing(repo, "ICE 2026", "2026", URL26, ED26);
    expect(a.status).toBe("ingested"); expect(b.status).toBe("ingested");
    if (a.status !== "ingested" || b.status !== "ingested") return;
    expect(b.supersededId).toBe(a.document.id);
    const docs = await repo.listDocuments({ sourceId: "imco-ice" });
    expect(docs.map((d) => `${d.edition}:${d.status}`).sort()).toEqual(["2025:superseded", "2026:active"]);
    const old = await repo.getDocument(a.document.id);
    expect(old?.supersededById).toBe(b.document.id); expect(old?.locator).toBe(URL25); expect(old?.contentHash).toBe(a.document.contentHash);
    expect((await repo.getDocument(b.document.id))?.supersedesId).toBe(a.document.id);
    expect((await repo.listPassages(a.document.id)).length).toBeGreaterThan(0);
    const hits = await retrieve(repo, { text: "mercado de trabajo", topics: ["labor_market"], jurisdiction: "MX" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.provenance.edition === "2026")).toBe(true);
    const series = await listSeries(repo, "imco-ice");
    expect(series).toHaveLength(1);
    expect(series[0]?.current?.edition).toBe("2026");
    expect(series[0]?.editions.map((e) => e.edition)).toEqual(["2025", "2026"]);
  });

  it("an older edition that arrives later is stored as historical and never becomes active", async () => {
    const repo = new InMemoryKnowledgeRepository(); await seedInitialSources(repo);
    const b = await ing(repo, "ICE 2026", "2026", URL26, ED26);
    const a = await ing(repo, "ICE 2025", "2025", URL25, ED25);
    expect(a.status).toBe("ingested");
    if (a.status !== "ingested" || b.status !== "ingested") return;
    expect(a.historical).toBe(true); expect(a.document.status).toBe("superseded");
    expect((await repo.getDocument(b.document.id))?.status).toBe("active");
    expect((await repo.getDocument(a.document.id))?.supersededById).toBe(b.document.id);
    const hits = await retrieve(repo, { text: "mercado de trabajo", topics: ["labor_market"], jurisdiction: "MX" });
    expect(hits.every((h) => h.provenance.edition === "2026")).toBe(true);
    // re-ingesting the same historical bytes is a no-op
    expect((await ing(repo, "ICE 2025", "2025", URL25, ED25)).status).toBe("unchanged");
    expect(await repo.listDocuments({ sourceId: "imco-ice" })).toHaveLength(2);
  });

  it("a series stored before series existed (title with its year) is continued under its stored title", async () => {
    const repo = new InMemoryKnowledgeRepository(); await seedInitialSources(repo);
    await repo.insertDocument({ id: "imco-ice:ice-2025:v1", sourceId: "imco-ice", title: "ICE 2025", edition: "2025", version: 1, retrievedAt: NOW, jurisdiction: "MX", topics: ["labor_market"], locator: URL25, contentHash: "legacy", confidence: "medium", status: "active", language: "es" }, []);
    const b = await ing(repo, "ICE 2026", "2026", URL26, ED26);
    if (b.status !== "ingested") throw new Error("setup");
    expect(b.document.title).toBe("ICE 2025");
    expect(b.supersededId).toBe("imco-ice:ice-2025:v1");
  });

  it("reports what changed between editions without touching either", async () => {
    const repo = new InMemoryKnowledgeRepository(); await seedInitialSources(repo);
    const a = await ing(repo, "ICE 2025", "2025", URL25, ED25);
    const b = await ing(repo, "ICE 2026", "2026", URL26, ED26);
    if (a.status !== "ingested" || b.status !== "ingested") throw new Error("setup");
    const cmp = await compareDocuments(repo, a.document.id, b.document.id);
    const kinds = cmp.changes.map((c) => `${c.unit}:${c.kind}`).sort();
    expect(kinds).toEqual(["Chiapas:removed", "Nuevo León:value_changed", "Sonora:added"]);
    expect(cmp.unchanged).toBe(1); expect(cmp.needsReview).toBe(true);
    expect(await compareWithPrevious(repo, b.document.id)).toEqual(cmp);
    expect(await compareWithPrevious(repo, a.document.id)).toBeNull();
    expect((await repo.getDocument(a.document.id))?.contentHash).toBe(a.document.contentHash);
  });
});
