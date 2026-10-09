/**
 * Spanish (and cross-client) additions to the client-input guard. engine/guard.ts' deterministic layers are
 * English-only; this module closes the Spanish gap and the "show me another client's data" case from the Voice
 * Pack evaluation set (S11). Same contract as the engine guard: a verdict plus a reason that is NEVER shown.
 */
import { normalizeText } from "./text-utils";

const PATTERNS: readonly RegExp[] = [
  /\bignora\w*\s+(?:todas?\s+)?(?:tus|las|mis|sus)\s+(?:instrucciones|reglas|indicaciones)\b/,
  /\bolvida\w*\s+(?:todas?\s+)?(?:tus|las|mis)\s+(?:instrucciones|reglas)\b/,
  /\b(?:muestra|muestrame|dime|revela|ensename|imprime|repite)\w*\s+(?:tu|el|las|tus)\s+(?:prompt|instrucciones|mensaje del sistema)\b/,
  /\bprompt del sistema\b/,
  /\bnuevas?\s+instrucciones\s*:/,
  /\b(?:modo\s+(?:desarrollador|dios)|developer mode|jailbreak)\b/,
  /\b(?:eres|actua|actuaras)\s+(?:ahora|como)\s+(?:un\s+)?(?:asistente\s+)?sin\s+(?:restricciones|filtros|reglas)\b/,
  /\b(?:muestra|muestrame|dame|dime|revela|comparte|ensename)\w*\s+(?:los\s+|las\s+|todos\s+los\s+)?(?:datos|informacion|proyectos?|expedientes?|detalles)\s+de\s+(?:otra|otro)\s+(?:empresa|cliente|proyecto|compania)\b/,
  /\b(?:show|give|tell|reveal|share)\s+me\s+(?:the\s+|all\s+)?(?:data|information|details|projects?)\s+(?:of|about|from)\s+(?:another|other|a different)\s+(?:company|client|customer|project)\b/,
];

export interface ExtraGuardResult { verdict: "allow" | "block"; reason: string }

export function extraGuard(text: string): ExtraGuardResult {
  const norm = normalizeText(text);
  for (const p of PATTERNS) if (p.test(norm)) return { verdict: "block", reason: `matched ${p.source.slice(0, 40)}` };
  return { verdict: "allow", reason: "" };
}
