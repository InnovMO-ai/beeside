import { Snapshot } from "../products/builder";
import { COPY, JOURNEY, LETTER } from "./product-world";

/** Instantánea sintética fija (sin base de datos): sirve para probar el constructor y para la línea de referencia de AC-10. */
export const fixtureSha = (c: string) => c.repeat(64).slice(0, 64);
export const fixtureSnapshot = (): Snapshot => ({
  edition: { id: "e1", code: "2026.1", status: "rendering", productKey: "guia", country: "MX", cutoffDate: "2026-10-15", manifestSha256: fixtureSha("a"), nextCycleAt: "2027-04-15T18:00:00.000Z", reviewPeriodicity: "semiannual", changeReport: { reason: "first_edition", notices: [] } },
  manifest: {
    theme: "db.v3b", fonts: { family: "lato" }, unitRefs: ["stat.a@1", "card.b@1"],
    links: { "kl.links.discovery_start": "https://beeside.you", "kl.links.edition_verify": "https://verify.example/verificar/[edition-id]" },
    fixedBlocks: [{ blockId: "founder_letter", version: "3.0", sha256_es: fixtureSha("1"), sha256_en: fixtureSha("2") }, { blockId: "journey", version: "1.0", sha256_es: fixtureSha("3"), sha256_en: fixtureSha("4") }, { blockId: "guide_copy", version: "1.0", sha256_es: fixtureSha("5"), sha256_en: fixtureSha("6") }],
  },
  units: {
    "stat.a@1": { kind: "statistic", unitKey: "stat.a", version: 1, limits: { es: [], en: [] }, permittedUse: "paraphrase_and_cite", validatedOn: null,
      stat: { indicatorName: { es: "Informalidad", en: "Informality" }, geo: "MX-GUA", periodLabel: "2026-T1", display: { es: "41,2 %", en: "41.2%" }, unit: "%", sourcePublishedAt: "2026-04-15", valueStatus: "value" }, card: null,
      source: { publicationKey: "p1", title: "Encuesta", institution: "Instituto", officialUrl: "https://i.example/e", permittedUse: "paraphrase_and_cite" } },
    "card.b@1": { kind: "card", unitKey: "card.b", version: 1, limits: { es: ["Alcance."], en: ["Scope."] }, permittedUse: "paraphrase_and_cite", validatedOn: "2026-09-01", stat: null,
      card: { cardType: "normative", title: { es: "Obligación", en: "Obligation" }, body: { es: "Texto uno.\n\nTexto dos.", en: "Text one.\n\nText two." }, claims: { es: ["Una."], en: ["One."] }, normPublishedAt: "2026-01-02", normEffectiveFrom: "2026-02-03", lastReviewedAt: "2026-08-01" },
      source: { publicationKey: "p1", title: "Encuesta", institution: "Instituto", officialUrl: "https://i.example/e", permittedUse: "paraphrase_and_cite" } },
  },
  sections: [
    { sectionKey: "s1", chapter: "01", part: null, slot: "key_data", order: 1, contentType: "data", title: { es: "Datos", en: "Data" }, validationDomain: null, items: ["stat.a@1"] },
    { sectionKey: "s2", chapter: "02", part: null, slot: "obligations", order: 2, contentType: "obligation", title: { es: "Obligaciones", en: "Obligations" }, validationDomain: null, items: ["card.b@1"] },
  ],
  fixedBlocks: (["es", "en"] as const).flatMap((l, i) => [
    { blockId: "founder_letter", version: "3.0", locale: l, content: LETTER[l] as never, sha256: fixtureSha(i === 0 ? "1" : "2") },
    { blockId: "journey", version: "1.0", locale: l, content: JOURNEY[l] as never, sha256: fixtureSha(i === 0 ? "3" : "4") },
    { blockId: "guide_copy", version: "1.0", locale: l, content: COPY[l] as never, sha256: fixtureSha(i === 0 ? "5" : "6") },
  ]),
});
