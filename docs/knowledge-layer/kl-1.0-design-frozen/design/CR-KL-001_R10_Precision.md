# Change Request · R10 con afirmaciones aprobadas y versionadas

CR-KL-001 · 16-oct-2026 · Origen: Design de Knowledge Layer 1.0 (resolución PO-1) · Destino: responsable de Precision 2.0 · Estado: **propuesta técnica aprobada por el PO (16-oct-2026) para revisión y aceptación del responsable de Precision; sin implementar**

Este CR no modifica Precision ni el contrato congelado. Mientras el responsable de Precision no lo acepte e implemente, KL entrega `approvedClaims: []` (bandera `kl.r10_claims_enabled = false`) y Precision conserva su comportamiento seguro actual: `approvedSources` vacío, R10 no aprueba afirmaciones legales por país, y ninguna afirmación de KL puede superar R10 por el comparador de contención. Describe el cambio mínimo que recomienda Design para que R10 pueda recibir conocimiento de KL sin aprobar afirmaciones que KL no aprobó. Lo implementa el responsable de Precision dentro de la fase C1 de convergencia, con la bandera `knowledge` apagada por defecto.

## 1. Problema

R10 (`precision/conversation/verifiers/country-claims.ts`, rama `feature/precision-v2-f5`, commit `a8f8f3e`) acepta una frase con afirmación legal o regulatoria por país si su texto normalizado **contiene** el de una fuente aprobada, o **está contenido** en él:

```ts
return src.length > 0 && (src.includes(sentenceNorm) || sentenceNorm.includes(src));
```

Hoy no hay riesgo porque `approvedSources` llega vacío (`domain/context-reader.ts`). Con fuentes reales, la contención aprueba de más en las dos direcciones:

- **Extensión:** una frase que contiene la fuente y agrega algo ("…y no aplica a servicios digitales") pasa.
- **Truncamiento:** una frase que es parte de la fuente y omite su excepción ("…16 por ciento" sin "salvo en la región fronteriza…") pasa.

Además, la aprobación no identifica **qué** afirmación se aprobó, así que no puede citarse `id@versión` ni revocarse con precisión.

Evidencia ejecutada (sección 7): con fuentes reales, el comparador actual aprueba 6 de 8 casos negativos.

## 2. Alternativas

| | A · Original de Design | B · Afirmaciones versionadas, igualdad exacta (**recomendada**) | C · Referencias de afirmación insertadas por Precision | D · Verificación semántica con modelo |
|---|---|---|---|---|
| Qué es | Mantener la contención; KL solo envía textos de 8 palabras o más | KL envía afirmaciones con id, versión, huella, idioma y autorización; R10 aprueba una frase solo si su texto normalizado es **igual** al de una afirmación vigente del idioma | El modelo escribe un marcador (`⟦c3⟧`); Precision lo sustituye por el texto exacto y R10 lo da por aprobado por posición | Un segundo modelo juzga si la frase está respaldada |
| Seguridad | Débil: extensión, truncamiento y negación siguen pasando | Fuerte: la aprobación no se extiende a nada que no sea exactamente la afirmación | Fuerte; además el modelo no puede alterar el texto | Probabilística; inyectable |
| Precisión | Aprueba frases no respaldadas | Exacta; una paráfrasis legítima se bloquea (falla cerrada) | Exacta y sin paráfrasis | Variable |
| Identifica la afirmación | No | Sí: `claimId` por frase | Sí | No de forma verificable |
| Mantenimiento | Bajo | Bajo: una función y un tipo; KL valida con la misma normalización | Medio: protocolo de marcadores, prompt y post-proceso | Alto: prompts, umbrales, evaluación |
| Latencia | Nula | Nula (búsqueda en un mapa por frase) | Nula | Una llamada adicional al modelo por turno |
| Compatibilidad con `country-claims.ts` | Total | Alta: cambia `isApproved` y el tipo de entrada; el detector de afirmaciones no cambia | Media: toca prompt, generación y verificación | Baja |

**Recomendación: B como cambio mínimo robusto.** Cumple lo pedido: Precision verifica exactamente qué afirmación quedó aprobada y la aprobación no se extiende a otras afirmaciones de la misma respuesta. **C** queda como fase 2 solo si las pruebas con modelo real muestran que el modelo no reproduce las afirmaciones de forma literal con suficiente frecuencia (umbral propuesto: menos del 90 % de usos literales en el ensayo de rutas). **A** y **D** se descartan.

## 3. Contrato propuesto

### 3.1 Lo que entrega KL (`kl.v1`, campo `approvedClaims`)

```ts
export interface KlApprovedClaim {
  claimId: string;            // "<unit_key>@<version>#<n>", p. ej. "mx.card.customs.padron_importadores@3#2"
  unitRef: string;            // "<unit_key>@<version>" (cita id@versión)
  country: string;            // ISO 3166-1 alfa-2
  locale: "es" | "en";        // sin fallback de idioma (PO-3)
  text: string;               // exactamente UNA frase según splitSentences; nombra el país; sin corchetes ni llaves
  normalizedSha256: string;   // sha256(normalizeText(text))
  authority: "A";             // solo fuente oficial primaria fundamenta obligaciones
  authorization: {
    kind: "specialist_validated" | "reviewed";   // HIGH exige specialist_validated
    validationRef?: string;   // id de kl.specialist_validation
    validUntil?: string;      // ISO; vencida → KL no la entrega (PO-3) y R10 tampoco la acepta
  };
}
```

Garantías de KL al publicar (rechaza la ficha si alguna falla):

1. `splitSentences(text).length === 1` y la frase la detecta R10 como afirmación (si no, no hace falta aprobarla).
2. Al menos 8 palabras, una sola afirmación, sin conectores que unan dos obligaciones.
3. Toda cifra presente en el texto está referenciada a una evidencia publicada.
4. HIGH: validación especializada vigente sobre esa versión exacta; variante del idioma aprobada.
5. `normalizedSha256` calculado con la misma `normalizeText` de Precision (sección 3.3).

### 3.2 Cambio en Precision (mínimo)

| Archivo | Cambio |
|---|---|
| `conversation/types.ts` | Nuevo tipo `ApprovedClaim` (forma de 3.1). `ConversationContext` gana `approvedClaims: ApprovedClaim[]` (vacío por defecto). `approvedSources` queda en desuso; hoy siempre es `[]`. |
| `conversation/verifiers/types.ts` | `VerifyContext` gana `approvedClaims` y `now?: string` (fecha ISO del reloj inyectado). |
| `conversation/verifiers/country-claims.ts` | `isApproved` pasa de contención a igualdad: índice `Map<locale|normalizado, ApprovedClaim[]>`; aprueba si hay una afirmación del idioma del contexto, vigente en `now` y cuya huella coincide. `findCountryClaims` devuelve también `approvedClaimIds` de las frases aprobadas. El detector (patrones, países, preguntas) no cambia. |
| `conversation/verifiers/verified-output.ts` | `VerifiedOutput` gana `citedClaimIds: string[]` para registrar `id@versión` en el turno, el CRP y el handoff (instrucción 9 del handoff). El reemplazo por "Todavía no puedo confirmar ese requisito." ante R10 no cambia. |
| `domain/context-reader.ts` | Con el puerto `knowledge` en `kl`: llena `approvedClaims` desde el paquete de etapa y las consultas del turno. Con `off`: `[]` (comportamiento actual). |
| Prompt de Precision (P7) | Las afirmaciones se presentan como texto citable literal, una por línea, con la instrucción de reproducirlas sin cambios o no usarlas. |

Pseudocódigo del comparador:

```ts
function approvedClaimFor(sentenceNorm: string, index: ClaimIndex, ctx: VerifyContext): ApprovedClaim | null {
  const candidates = index.get(`${ctx.locale}|${sentenceNorm}`) ?? [];
  return candidates.find((c) => !c.authorization.validUntil || !ctx.now || c.authorization.validUntil >= ctx.now) ?? null;
}
```

### 3.3 Normalización compartida

KL debe calcular la huella con la misma `normalizeText` y validar con la misma `splitSentences`. Para que no diverjan, se propone exportar ambas desde un módulo compartido (p. ej. `shared/text-normalization`), importado por Precision y por KL, con una prueba de contrato de paridad. Si el responsable prefiere no moverlas, KL mantiene una copia con la misma prueba de paridad contra la de Precision en CI.

## 4. Casos negativos (deben quedar bloqueados)

| # | Caso | Frase de prueba (sintética) | Hoy | Con B |
|---|---|---|---|---|
| N1 | Extensión en la misma frase | "En Chile el IVA general es del 19 por ciento y no aplica a servicios digitales." | Aprueba | Bloquea |
| N2 | Truncamiento que borra una excepción | "En México el IVA general es del 16 por ciento." (la afirmación incluye "salvo en la región fronteriza…") | Aprueba | Bloquea |
| N3 | Fuente corta que aprueba frases largas | Fuente "IVA del 19 por ciento"; frase "En Chile el IVA del 19 por ciento no aplica a exportadores de servicios." | Aprueba | Bloquea (y KL nunca emite esa fuente) |
| N4 | Negación | "No es cierto que en Chile el IVA general es del 19 por ciento." | Aprueba | Bloquea |
| N5 | Idioma distinto | Afirmación ES usada en respuesta EN | Bloquea | Bloquea |
| N6 | Afirmación vencida | Frase idéntica a una afirmación con `validUntil` pasado | Aprueba | Bloquea |
| N7 | Cifra cambiada | "…es del 18 por ciento." | Bloquea | Bloquea |
| N8 | Dos afirmaciones unidas | "En Chile … 19 por ciento y en México … 16 por ciento." | Aprueba | Bloquea |
| N9 | Afirmación aprobada seguida de otra no aprobada | Primera frase aprobada; segunda frase con afirmación sin fuente | Bloquea el texto (R10) | Bloquea el texto (R10); sin cambio |
| N10 | Huella manipulada | `normalizedSha256` que no corresponde al texto | No aplica | El índice rechaza la afirmación al cargar el contexto |
| N11 | Paquete revocado entre turnos | Afirmación de una unidad retirada | No aplica | No llega: el paquete se invalida por turno (DD-06); si llegara, `validUntil`/estado la excluyen |

Positivos: P1 frase idéntica; P2 diferencias solo de mayúsculas, acentos o puntuación (las absorbe `normalizeText`); P3 pregunta que menciona un país (nunca es afirmación, sin cambio).

## 5. Pruebas de regresión

1. Toda la suite de verificadores (`conversation/__tests__/verifiers.test.ts`) pasa sin cambios de expectativa. El caso actual de R10 que acepta una frase "contenida en una fuente aprobada" se migra a la forma `approvedClaims` con la frase idéntica; sigue aceptándose.
2. `produceVerifiedText`: R10 sigue sin regenerar y sigue reemplazando por la copia de "no puedo confirmar".
3. Con `PRECISION_KNOWLEDGE_PROVIDER=off`: `approvedClaims` vacío y cualquier afirmación por país se marca como hoy (paridad total; suites de integración y ensayo de rutas sin cambios).
4. Nuevas pruebas unitarias: N1–N11 y P1–P3.
5. Prueba de paridad de normalización KL ↔ Precision sobre un corpus de frases ES/EN con acentos, cifras, porcentajes y puntuación.
6. Ensayo de rutas con modelo real (A01, A02): tasa de reproducción literal de afirmaciones y tasa de reemplazos R10, para decidir si hace falta la fase C.

## 6. Riesgos residuales (fuera de este CR)

- R10 solo examina frases que nombran un país y contienen una señal legal. Una inferencia sin nombre de país ("en tu caso, eso significa que no necesitas registrarte") no la revisa R10. Mitigación propuesta para P7: regla de prompt que prohíbe aplicar una obligación al caso del cliente y verificación específica en una fase posterior.
- La igualdad exacta bloquea paráfrasis correctas. Es una falla segura (el cliente recibe "todavía no puedo confirmarlo" y el hallazgo queda para el Sherpa) y se mide en el punto 6.

## 7. Evidencia

`KnowledgeLayer/design/evidencia/r10/r10-claims-proto.mjs` reproduce los comparadores actual y propuesto sobre las funciones `normalizeText` y `splitSentences` copiadas literalmente de `a8f8f3e`, con afirmaciones sintéticas de prueba. Resultado (`result.txt`): el propuesto cumple los 10 casos; el actual aprueba indebidamente N1, N2, N3, N4, N6 y N8. Es evidencia de diseño, no código de Precision.
