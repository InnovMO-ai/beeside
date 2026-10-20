/**
 * Modelo de documento de la guía (Knowledge Product). Es propio de KL a propósito: el modelo de reportes compartido
 * (`reports/report-model.ts`) importa tipos de Discovery (fa/, snapshot/) y KL no depende de Discovery. La forma de los bloques sigue
 * Design Spec §8.2 y DB2026 §4; si en el futuro se unifica con el sistema de reportes basta una traducción 1:1.
 *
 * Reglas del modelo: es un valor ya resuelto y localizado (ninguna cadena queda por elegir), las cifras son texto ya formateado que viene
 * de la ficha (`display_<locale>`), y nada aquí calcula ni formatea números nuevos (AC-01).
 */
export type GuideLocale = "es" | "en";
export type GuideStatus = "PREVIEW" | "PUBLISHED";

export interface GuideRef {
  /** Referencia visible del directorio de fuentes, p. ej. "01". */
  id: string;
}

export type GuideBlock =
  | { type: "guide_cover"; titleLight: string; titleBold: string[]; year: string; tagline: string; edition: string; month: string; publisher: string }
  | { type: "founder_letter"; blockId: string; version: string; sha256: string; eyebrow: string; paragraphs: string[]; signature: { name: string; role: string } }
  | { type: "section_header"; eyebrow: string; title: string; dek: string }
  | { type: "kpi_row"; items: { label: string; value: string; period: string; ref: string; unitRef: string }[] }
  | { type: "labelled_text"; label: string; paragraphs: string[]; unitRefs: string[]; claimIds: string[] }
  | { type: "two_columns"; columns: { label: string; text: string }[] }
  | { type: "editorial_note"; label: string; text: string; unitRefs?: string[] }
  | { type: "key_insight"; label: string; text: string }
  | { type: "matrix_table"; title: string; columns: string[]; rows: { cells: string[]; ref: string; unitRef: string }[]; notAvailable: string }
  | { type: "journey"; blockId: string; version: string; sha256: string; steps: { title: string; text: string }[] }
  | { type: "timeline"; title: string; points: { year: string; text: string }[] }
  | { type: "bar_breakdown"; title: string; legend: string; segments: { label: string; value: number; display: string }[]; total: number }
  | { type: "cta_link"; linkKey: string; label: string; text: string }
  | { type: "sources_directory"; title: string; entries: { id: string; citation: string; href: string; periods: string[]; permittedUse: string }[] }
  | { type: "publication_notes"; title: string; lines: { label: string; text: string }[] }
  | { type: "edition_stamp"; editionCode: string; manifestSha: string; verifyLabel: string; verifyUrl: string };

export interface GuidePage {
  id: string;
  kind: "cover" | "body" | "generated";
  chrome: boolean;
  pillar?: string;
  blocks: GuideBlock[];
}

export interface GuideDocument {
  kind: "knowledge_guide";
  product: string;
  locale: GuideLocale;
  edition: { code: string; label: string; month: string; monthLong: string; country: string; dataCutoff: string };
  status: GuideStatus;
  /** Texto de la marca de vista previa; vacío en una edición publicada. */
  statusLabel: string;
  chrome: { left: string; guide: string; continued: string };
  links: Record<string, { label: string; href: string; settingKey: string }>;
  sources: Record<string, { label: string; href: string }>;
  pages: GuidePage[];
}

/** Copia editorial aprobada (bloque fijo `guide_copy`): rótulos, títulos de portada y textos de estructura por idioma. */
export interface GuideCopy {
  cover: { titleLight: string; titleBold: string[]; tagline: string; publisher: string };
  chrome: { left: string; guide: string; country: string };
  labels: { sources: string; notAvailable: string; keyData: string; primarySource: string; lastValidated: string; limits: string; decideWith: string; verify: string; edition: string; cutoff: string; nextReview: string; changes: string; noChanges: string; previewMark: string; permittedUse: string; indicator: string; value: string; period: string; source: string; continued: string };
  months: string[];
  sectionDeks?: Record<string, string>;
  ctaLinks: Record<string, { label: string; text: string }>;
}
