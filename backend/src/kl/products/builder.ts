import { GuideBlock, GuideCopy, GuideDocument, GuideLocale, GuidePage, GuideStatus } from "./guide-model";

/**
 * Constructor del documento de la guía: FUNCIÓN PURA sobre la instantánea congelada de la edición (`kl.edition_snapshot`).
 * No lee base de datos ni reloj, no usa IA, no formatea ni calcula cifras (AC-01): cada número es el `display_<locale>` de su ficha y
 * cada afirmación lleva su unidad y `claimId`. Los bloques fijos (prólogo, journey) se copian tal cual con su huella.
 */
export interface Snapshot {
  edition: { id: string; code: string; status: string; productKey: string; country: string; cutoffDate: string; manifestSha256: string; nextCycleAt: string | null; reviewPeriodicity: string; changeReport: { reason?: string; notices?: { kind: string; unitKey: string }[] } };
  manifest: { theme: string; fonts: { family: "lato" | "publicsans" }; unitRefs: string[]; links: Record<string, string>; fixedBlocks: { blockId: string; version: string; sha256_es: string; sha256_en: string }[] };
  units: Record<string, SnapshotUnit>;
  sections: { sectionKey: string; chapter: string; part: string | null; slot: string; order: number; contentType: string; title: { es: string; en: string }; validationDomain: string | null; items: string[] }[];
  fixedBlocks: { blockId: string; version: string; locale: GuideLocale; content: Record<string, unknown>; sha256: string }[];
}

export interface SnapshotUnit {
  kind: "statistic" | "card";
  unitKey: string;
  version: number;
  limits: { es: string[]; en: string[] };
  permittedUse: string;
  stat: { indicatorName: { es: string; en: string }; geo: string; periodLabel: string; display: { es: string; en: string }; unit: string; sourcePublishedAt: string | null; valueStatus: string } | null;
  card: { cardType: string; title: { es: string; en: string | null }; body: { es: string; en: string | null }; claims: { es: string[]; en: string[] | null }; normPublishedAt: string | null; normEffectiveFrom: string | null; lastReviewedAt: string | null } | null;
  source: { publicationKey: string; title: string; institution: string; officialUrl: string; permittedUse: string } | null;
  validatedOn: string | null;
}

export class GuideBuildError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "GuideBuildError";
  }
}

export interface BuildOptions {
  locale: GuideLocale;
  copy: GuideCopy;
  /** «PREVIEW»: PDF de prueba con marca visible. «PUBLISHED»: edición publicada (lleva el identificador de verificación). */
  status: GuideStatus;
  verificationId?: string;
}

const monthLong = (iso: string, copy: GuideCopy) => `${copy.months[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const fmtDate = (iso: string | null, copy: GuideCopy) => (iso ? `${Number(iso.slice(8, 10))} ${copy.months[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "");

export function buildKnowledgeGuide(snap: Snapshot, o: BuildOptions): GuideDocument {
  const { locale, copy } = o;
  if (snap.manifest.theme !== "db.v3b") throw new GuideBuildError("theme", `tema no soportado: ${snap.manifest.theme}`);
  const unit = (ref: string): SnapshotUnit => {
    const u = snap.units[ref];
    if (!u) throw new GuideBuildError("missing_unit", `la unidad ${ref} no está en la instantánea`);
    return u;
  };

  // Directorio de fuentes: un número por publicación, en orden de aparición.
  const sourceNo = new Map<string, string>();
  const periods = new Map<string, Set<string>>();
  const sourceMeta = new Map<string, { citation: string; href: string; permittedUse: string }>();
  const noteSource = (u: SnapshotUnit): string => {
    if (!u.source) throw new GuideBuildError("no_source", `la unidad ${u.unitKey} no tiene fuente`);
    const key = u.source.publicationKey;
    if (!sourceNo.has(key)) {
      sourceNo.set(key, String(sourceNo.size + 1).padStart(2, "0"));
      sourceMeta.set(key, { citation: `${u.source.institution} · ${u.source.title}`, href: u.source.officialUrl, permittedUse: u.source.permittedUse });
    }
    if (u.stat) (periods.get(key) ?? periods.set(key, new Set()).get(key))?.add(u.stat.periodLabel);
    return sourceNo.get(key) as string;
  };

  const fixed = (blockId: string) => {
    const fb = snap.fixedBlocks.find((b) => b.blockId === blockId && b.locale === locale);
    const declared = snap.manifest.fixedBlocks.find((b) => b.blockId === blockId);
    if (!fb || !declared || declared[locale === "es" ? "sha256_es" : "sha256_en"] !== fb.sha256) throw new GuideBuildError("fixed_block", `el bloque fijo ${blockId} no coincide con su versión aprobada`);
    return fb;
  };

  const pages: GuidePage[] = [];
  const edition = { code: snap.edition.code, label: `V${snap.edition.code}`, month: monthLong(snap.edition.cutoffDate, copy).toUpperCase(), monthLong: monthLong(snap.edition.cutoffDate, copy), country: copy.chrome.country, dataCutoff: fmtDate(snap.edition.cutoffDate, copy) };

  pages.push({
    id: "cover", kind: "cover", chrome: false,
    blocks: [{ type: "guide_cover", titleLight: copy.cover.titleLight, titleBold: copy.cover.titleBold, year: snap.edition.cutoffDate.slice(0, 4), tagline: copy.cover.tagline, edition: edition.label, month: edition.month, publisher: copy.cover.publisher }],
  });
  const letter = fixed("founder_letter");
  const lc = letter.content as { eyebrow: string; paragraphs: string[]; signature: { name: string; role: string } };
  pages.push({ id: "founder_letter", kind: "body", chrome: true, pillar: "", blocks: [{ type: "founder_letter", blockId: letter.blockId, version: letter.version, sha256: letter.sha256, eyebrow: lc.eyebrow, paragraphs: lc.paragraphs, signature: lc.signature }] });

  for (const section of [...snap.sections].sort((a, b) => a.order - b.order || a.sectionKey.localeCompare(b.sectionKey))) {
    if (section.items.length === 0) continue;
    const blocks: GuideBlock[] = [{ type: "section_header", eyebrow: [section.part, section.chapter].filter(Boolean).join(" · ").toUpperCase(), title: section.title[locale], dek: copy.sectionDeks?.[section.sectionKey] ?? "" }];
    const units = section.items.map((r) => ({ ref: r, u: unit(r) }));
    if (section.contentType === "data") {
      const stats = units.filter((x) => x.u.stat);
      if (section.slot === "key_data") {
        blocks.push({ type: "kpi_row", items: stats.slice(0, 4).map(({ ref, u }) => ({ label: (u.stat as NonNullable<SnapshotUnit["stat"]>).indicatorName[locale], value: (u.stat as NonNullable<SnapshotUnit["stat"]>).display[locale], period: (u.stat as NonNullable<SnapshotUnit["stat"]>).periodLabel, ref: noteSource(u), unitRef: ref })) });
      }
      blocks.push({
        type: "matrix_table", title: section.title[locale], notAvailable: copy.labels.notAvailable,
        columns: [copy.labels.indicator, copy.labels.value, copy.labels.period, copy.labels.source],
        rows: stats.map(({ ref, u }) => {
          const s = u.stat as NonNullable<SnapshotUnit["stat"]>;
          return { cells: [s.indicatorName[locale], s.valueStatus === "value" ? s.display[locale] : copy.labels.notAvailable, s.periodLabel], ref: noteSource(u), unitRef: ref };
        }),
      });
    } else {
      for (const { ref, u } of units) {
        const c = u.card;
        if (!c) throw new GuideBuildError("not_a_card", `la unidad ${u.unitKey} no es una ficha`);
        const title = locale === "en" ? c.title.en : c.title.es;
        const body = locale === "en" ? c.body.en : c.body.es;
        const claims = locale === "en" ? c.claims.en : c.claims.es;
        if (title === null || body === null || claims === null) throw new GuideBuildError("locale_missing", `la unidad ${u.unitKey} no tiene texto aprobado en ${locale}`);
        if (u.permittedUse === "cite_only") throw new GuideBuildError("cite_only", `la unidad ${u.unitKey} es cite_only: no se reproduce texto`);
        const refNo = u.source ? noteSource(u) : "";
        blocks.push({ type: "labelled_text", label: title, paragraphs: body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean), unitRefs: [ref], claimIds: claims.map((_, i) => `${u.unitKey}@${u.version}#${i + 1}`) });
        if (section.contentType === "obligation" && u.source) {
          blocks.push({ type: "editorial_note", label: copy.labels.primarySource, unitRefs: [ref], text: `${u.source.institution} · ${u.source.title}${c.normPublishedAt ? ` · ${fmtDate(c.normPublishedAt, copy)}` : ""}${c.normEffectiveFrom ? ` · ${fmtDate(c.normEffectiveFrom, copy)}` : ""} [${refNo}] · ${copy.labels.lastValidated} ${fmtDate(u.validatedOn ?? c.lastReviewedAt, copy)}` });
        }
        const limits = locale === "en" ? u.limits.en : u.limits.es;
        if (limits.length > 0) blocks.push({ type: "editorial_note", label: copy.labels.limits, text: limits.join(" "), unitRefs: [ref] });
      }
    }
    pages.push({ id: section.sectionKey, kind: "body", chrome: true, pillar: section.title[locale], blocks });
  }

  const journey = snap.manifest.fixedBlocks.find((b) => b.blockId === "journey");
  if (journey) {
    const j = fixed("journey");
    const jc = j.content as { steps: { title: string; text: string }[]; cta?: string };
    const blocks: GuideBlock[] = [{ type: "journey", blockId: j.blockId, version: j.version, sha256: j.sha256, steps: jc.steps }];
    if (jc.cta) {
      const link = snap.manifest.links[jc.cta];
      const text = copy.ctaLinks[jc.cta];
      if (!link || !text) throw new GuideBuildError("cta_link", `cta_link sin enlace configurado: ${jc.cta}`);
      blocks.push({ type: "cta_link", linkKey: jc.cta, label: text.label, text: text.text });
    }
    pages.push({ id: "journey", kind: "body", chrome: true, pillar: "", blocks });
  }

  // Páginas generadas del manifiesto: directorio de fuentes y notas de la edición. Cada ref del cuerpo resuelve aquí.
  pages.push({
    id: "sources", kind: "generated", chrome: true, pillar: copy.labels.sources,
    blocks: [{ type: "sources_directory", title: copy.labels.sources, entries: [...sourceNo.entries()].map(([key, id]) => ({ id, citation: (sourceMeta.get(key) as { citation: string }).citation, href: (sourceMeta.get(key) as { href: string }).href, periods: [...(periods.get(key) ?? [])].sort(), permittedUse: (sourceMeta.get(key) as { permittedUse: string }).permittedUse })) }],
  });
  const report = snap.edition.changeReport;
  const verifyTemplate = snap.manifest.links["kl.links.edition_verify"] ?? "";
  const verifyUrl = o.status === "PUBLISHED" && o.verificationId ? verifyTemplate.replace("[edition-id]", o.verificationId) : verifyTemplate;
  pages.push({
    id: "publication_notes", kind: "generated", chrome: true, pillar: copy.labels.sources,
    blocks: [
      {
        type: "publication_notes", title: copy.labels.edition,
        lines: [
          { label: copy.labels.edition, text: edition.label },
          { label: copy.labels.cutoff, text: edition.dataCutoff },
          // La fecha de la próxima revisión se genera del ciclo programado; nunca se escribe a mano.
          ...(snap.edition.nextCycleAt ? [{ label: copy.labels.nextReview, text: fmtDate(snap.edition.nextCycleAt.slice(0, 10), copy) }] : []),
          { label: copy.labels.changes, text: report.notices && report.notices.length > 0 ? report.notices.map((n) => `${n.unitKey} (${n.kind})`).join("; ") : copy.labels.noChanges },
        ],
      },
      { type: "edition_stamp", editionCode: snap.edition.code, manifestSha: snap.edition.manifestSha256.slice(0, 12), verifyLabel: copy.labels.verify, verifyUrl },
    ],
  });

  const links: GuideDocument["links"] = {};
  for (const [key, href] of Object.entries(snap.manifest.links)) links[key] = { label: key === "kl.links.discovery_start" ? href.replace(/^https:\/\//, "") : copy.labels.verify, href: key === "kl.links.edition_verify" ? verifyUrl : href, settingKey: key };
  const sources: GuideDocument["sources"] = {};
  for (const [key, id] of sourceNo) sources[id] = { label: (sourceMeta.get(key) as { citation: string }).citation, href: (sourceMeta.get(key) as { href: string }).href };

  return {
    kind: "knowledge_guide", product: snap.edition.productKey, locale, edition, status: o.status,
    statusLabel: o.status === "PREVIEW" ? copy.labels.previewMark : "",
    chrome: { left: copy.chrome.left, guide: copy.chrome.guide, continued: copy.labels.continued },
    links, sources, pages,
  };
}
