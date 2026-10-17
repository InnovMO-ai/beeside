import { Pool } from "pg";
import { withServiceAttestation } from "../db/attested-tx";
import { KlLocale, KlStage } from "../contract/kl-v1";
import { packageKeyFor } from "../read/read-service";

/**
 * Compilador de paquetes de contexto (RAM, I5). Lee solo lo publicado y consumible con el rol `kl_knowledge` y llama a
 * `kl.compile_package`. Reglas de Design Spec §5.5: los valores de periodicidad diaria (FIX, tasa objetivo) nunca entran
 * a un paquete (T15); solo entra lo servible en el idioma del paquete; nada con validación vencida. Sin red.
 *
 * En R1 el compilador es una biblioteca: ningún proceso lo programa (agentes apagados). Lo ejercen las pruebas y el
 * consumidor de prueba.
 */
export interface CompileRequest {
  destinationCountry: string;
  stage: KlStage;
  categoryKey?: string;
  locale: KlLocale;
  budgetTokens: number;
}

const CORE_CARD_TYPES = ["country_profile", "context", "methodology", "beeside_process", "question_guide"];

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export async function compilePackage(knowledge: Pool, req: CompileRequest): Promise<{ packageId: string; packageKey: string; estimatedTokens: number; members: number } | null> {
  const packageKey = packageKeyFor({ destinationCountry: req.destinationCountry, stage: req.stage, ...(req.categoryKey ? { categoryKey: req.categoryKey } : {}), locale: req.locale });
  return withServiceAttestation(knowledge, async (tx) => {
    const cardTypes = req.stage === "understanding" ? CORE_CARD_TYPES : null;
    const cards = await tx.query<{ unit_version_id: string; body_es: string; body_en: string | null; title_es: string; title_en: string | null; card_type: string; content_risk: string }>(
      `SELECT unit_version_id, body_es, body_en, title_es, title_en, card_type, content_risk
         FROM kl.v_consumable_card
        WHERE country = $1 AND validation_state <> 'expired'
          AND ($2::text[] IS NULL OR card_type = ANY($2))
          AND ($3::text IS NULL OR $3 = ANY(category_keys) OR cardinality(category_keys) = 0)
          AND ($4 = 'es' OR variant_en_status = 'approved')
        ORDER BY published_at DESC, unit_key`,
      [req.destinationCountry, cardTypes, req.categoryKey ?? null, req.locale],
    );
    const stats =
      req.stage === "understanding"
        ? { rows: [] as { unit_version_id: string; display_es: string; display_en: string }[] }
        : await tx.query<{ unit_version_id: string; display_es: string; display_en: string }>(
            `SELECT unit_version_id, display_es, display_en FROM kl.v_consumable_stat
              WHERE country = $1 AND is_current_period AND validation_state <> 'expired' AND coalesce(publication_periodicity, '') <> 'daily'
                AND ($2::text IS NULL OR $2 = ANY(category_keys) OR cardinality(category_keys) = 0)
              ORDER BY unit_key`,
            [req.destinationCountry, req.categoryKey ?? null],
          );
    const items: { id: string; tokens: number }[] = [
      ...stats.rows.map((r) => ({ id: r.unit_version_id, tokens: estimateTokens(req.locale === "en" ? r.display_en : r.display_es) + 24 })),
      ...cards.rows.map((r) => ({ id: r.unit_version_id, tokens: estimateTokens(`${req.locale === "en" ? r.title_en : r.title_es} ${req.locale === "en" ? r.body_en : r.body_es}`) + 24 })),
    ];
    const chosen: typeof items = [];
    let total = 0;
    for (const item of items) {
      if (total + item.tokens > req.budgetTokens) continue; // nunca se supera el presupuesto: se omite lo que no cabe
      chosen.push(item);
      total += item.tokens;
    }
    if (chosen.length === 0) return null;
    const scope = { destinationCountry: req.destinationCountry, stage: req.stage, categoryKey: req.categoryKey ?? null, locale: req.locale };
    const level = req.stage === "understanding" ? "core" : "stage";
    const r = await tx.query<{ id: string }>("SELECT kl.compile_package($1, $2, $3::jsonb, $4::uuid[], $5, $6) AS id", [packageKey, level, JSON.stringify(scope), chosen.map((c) => c.id), total, req.budgetTokens]);
    return { packageId: (r.rows[0] as { id: string }).id, packageKey, estimatedTokens: total, members: chosen.length };
  });
}
