# PRECISION V1.0 — Integración permanente Precision ↔ Knowledge Layer (checkpoint)

Fecha: 2026-10-15 · Estado de partida: `f462946` (núcleo Precision FC en modo simulado).

**Estado de feature complete**

- NÚCLEO DEL PRODUCTO PRECISION — FEATURE COMPLETE EN MODO SIMULADO: **SÍ**.
- PRECISION MVP1 COMPLETO (incluida la integración permanente con Knowledge Layer): **SÍ en modo simulado/local (checkpoint aceptado; corrección semántica de suficiencia aplicada, §8).** No queda ningún requisito interno de MVP1 abierto (ver §6). Lo que falta para Public Ready es externo y va separado (§7).

No se reabrió: arquitectura de Understanding, materialidad, herencia de categoría, Service Map, caso Portugal, filosofía KSeed, prohibición de búsqueda en vivo, frontera profesional. Solo se movió el conocimiento detrás de la frontera correcta.

---

## 1. Contrato Precision → Knowledge Layer

Un solo archivo, `backend/src/knowledge-layer/contract.ts` (solo tipos + la interfaz `KnowledgeLayer`; async y solo datos, para que KL pueda correr algún día como servicio sin cambiar al consumidor).

| Método | Para qué |
|---|---|
| `coverage(jurisdicción)` | ¿Hay conocimiento aprobado para este país? |
| `interpret(pregunta)` | Lee la pregunta en vocabularios de KL: tema, subtema, tipo de información, **frontera profesional**. No se almacena. |
| `request(req)` | Conocimiento aprobado para una solicitud. Nunca búsqueda en vivo. |
| `recordDemand(ctx, señal)` | Envía una **señal de demanda normalizada** (sin texto del cliente). KL agrega, prioriza y decide. |
| `resources(país, idioma…)` / `openResource(id)` | Guías por país (p. ej. Doing Business in Mexico). El destino HTTPS solo se resuelve a través de KL. |

**Solicitud** (`KnowledgeRequest`): país/jurisdicción, intención (`answer_question` | `project_context`), pregunta (solo para recuperación/interpretación; nunca se guarda ni se devuelve), temas, subtema, categoría/servicio del consumidor (para enrutar), contexto de proyecto necesario para recuperar (p. ej. estados comparados), idioma.

**Respuesta** (`KnowledgeResponse`):

- `availability`: **`sufficient` | `partial` | `unavailable`** (+ `reason`: `no_sources`, `no_hits`, `granularity`, `professional_judgment`).
- `units[]` (`KnowledgeUnit`): texto, temas, granularidad, indicadores y `source` con fuente/institución, documento, **edición y versión**, jurisdicción, **fecha de publicación / vigencia**, fecha de captura, locator, ubicación (p. ej. "p. 14"), **clase de autoridad** (`official_primary` > `trusted_institutional` > `beeside_curated` > `secondary`), roles que puede fundamentar, **riesgo**, **confianza** y **estado** (`active` | `superseded` | `withdrawn`); más `citation` verificable y `wording` (`obligation` solo si una fuente oficial primaria lo permite; si no, `context`).
- `limits[]`, `comparison` (neutra, nunca recomienda), `unresolved[]` (lo que sigue sin saberse: granularidad, juicio profesional, tema no cubierto).
- `boundary`: metadata de frontera profesional (tipo, área del especialista en ambos idiomas, categoría de ruteo).
- `interpretation`, `specialistNote`, `recommends: false` (siempre).

**Cómo Precision usa cada estado** (adaptadores en `precision/knowledge-client/`, único lugar de Precision que habla con KL):

- *sufficient*: responde con la fuente y como contexto, no como obligación.
- *partial*: orienta solo dentro de lo soportado, nombra el límite (granularidad / juicio profesional), añade la frontera y envía la señal de demanda.
- *unavailable*: reconoce la limitación, el diagnóstico continúa, registra demanda y deja nota al especialista. Sin investigación externa.

La **demanda** pertenece a KL: Precision solo manda campos controlados (país, tema, subtema, tipo, categoría/servicio de *su* Service Map, resultado). KL valida el vocabulario, cuenta recurrencia (proyectos y turnos distintos, con referencias opacas) y solo una persona cambia el estado. Precision no está acoplado al registro.

## 2. Qué se movió / quedó detrás de KL

`backend/src/precision/knowledge/` → **`backend/src/knowledge-layer/`** (paquete independiente; `git mv`, historial conservado):

- Registro de fuentes y autoridad, ingesta con ediciones por serie (supersede, nunca sobrescribe), procedencia, riesgo, cadencia, revisión por niveles de riesgo, agente de conocimiento (único puerto de fetch, solo fuentes aprobadas, nunca alcanzable desde una conversación).
- Recuperación/orientación (guarda de granularidad, comparación de estados), frontera profesional, demanda de conocimiento, guías por país (+ onboarding), evaluación KSeed (27 necesidades MX), plan de brechas V1 y paquete de solicitud de fuentes.
- Nuevo: `contract.ts`, `service.ts` (`createKnowledgeLayer`), `index.ts` (`createPgKnowledgeLayer`, que además publica el registro inicial al arrancar), `refs.ts`, `text.ts` propio. **KL ya no importa nada de Precision.**

Del lado Precision: `precision/knowledge-client/` (puertos que consume el engine, adaptadores, `drivers.ts` con los temas que el proyecto hace relevantes, y el mapeo tema→categoría del Service Map, que es conocimiento de *Precision*, no de KL). `understanding/engine.ts`, `api/wiring.ts` y `api/router.ts` ya no importan internos de KL. Admin y scripts (ingesta, onboarding de guías, informe KSeed) usan la superficie administrativa de KL (`admin/knowledge-layer-admin.ts`); las rutas HTTP de Admin no cambian.

Dos cambios de comportamiento deliberados (resto idéntico): la frontera profesional y el estado de disponibilidad ahora viajan como metadata estructurada en la respuesta; el router abre las guías vía `openResource`.

## 3. IMCO real a través de KL

Con los tres PDFs reales (ICE 2025 libro, Anexo, Boletas), `imco-real.int.test.ts` (6/6): IMCO se publica en KL por su ruta de ingesta (versionado, 32 estados, 53 indicadores, re-ingesta idempotente, corrección = versión nueva que supersede) y **un request por contrato** devuelve: unidades con edición 2025/v1, fecha 2025-06-09, clase `trusted_institutional`, riesgo, confianza, estado activo y cita "IMCO, Índice de Competitividad Estatal (2025), p. N"; comparación Nuevo León vs Querétaro sin recomendar; `wording = context` siempre.

## 4. Parcial y sin conocimiento, a través de KL

- **Parcial por granularidad** (Apodaca / San Pedro): `partial`, límite declarado, contexto estatal etiquetado como tal, nota al especialista, ninguna unidad municipal.
- **Parcial por frontera profesional** ("¿cuál es la mejor opción de estado…?"): contexto con fuente + `boundary: best_option`; señal de demanda `partial` / `specialist_service`.
- **Determinación fiscal** ("¿cuánto ISR voy a pagar?"): nunca `sufficient`; frontera `tax_conclusion` → categoría fiscal; solo contexto, jamás obligación.
- **Sin conocimiento** (Chile): `coverage` dice no; Precision no pide nada, declara el límite, el diagnóstico sigue (una pregunta sobre el proyecto) y la señal de demanda queda registrada para `CL`/`no_sources`. Sin documentos nuevos, sin web.

## 5. Caso Portugal con KL (acceptance en PostgreSQL)

`precision/api/__integration__/knowledge-layer.int.test.ts` (4/4) envuelve KL en un grabador: todo conocimiento usado por Precision debe aparecer en una llamada de contrato.

- **A.** Empresa portuguesa (energía → México): IMCO publicado en KL → pregunta → `request` (MX, `answer_question`) → respuesta `sufficient` → la conversación cita la fuente devuelta, los `sourceRefs` son ids de unidades que KL devolvió, no se registra demanda, y el caso **completa hasta Service Map confirmado**.
- **B.** Parcial + frontera → señal normalizada (el JSON de la señal no contiene palabras de la pregunta).
- **C.** Chile sin conocimiento.
- **D.** **Doing Business in Mexico**: se incorpora con `onboardCountryGuide` (la misma ruta de cualquier contenido) → la orientación responde desde la guía (autoridad `beeside_curated`, contexto, nunca obligación), se ofrece **una sola vez** como recurso de país y se abre por `openResource`. **No existe ruta especial de Precision**: cuando llegue el PDF/URL real es solo ejecutar el onboarding.

## 6. Brechas internas de MVP1 restantes

Ninguna bloqueante. Menores, todas con tamaño pequeño:

1. Las rutas HTTP de Admin siguen bajo `/precision/knowledge/*` (el módulo ya es de KL). Cambio cosmético con alias; no afecta al producto.
2. KL corre **en proceso** (frontera de paquete + contrato async). Separarlo como servicio es decisión de plataforma, no de MVP1.
3. `refs.ts` (referencias de hallazgos → pasajes) vive en KL pero ningún flujo de Precision lo consume todavía (ya era así antes del movimiento).
4. ~~Tema vecino cubierto = respuesta suficiente~~ — **resuelto en §8** (la suficiencia ahora se mide contra la intención de información).

## 7. Bloqueantes externos de Public Ready (separados)

- Contrato real de Discovery (hoy lector de fixtures).
- Ensayo con modelo real / ZDR.
- Stripe en sandbox.
- Aceptación real de ClickUp / Operation Hub.
- Política de retención y recorridos humanos finales.
- **Contenido:** Doing Business in Mexico (PDF/URL que proporcionas), ICE 2026 (no bloqueante), y los materiales de las 12 brechas KSeed / aprobaciones de The Hive (paquete de solicitud ya entregado).

## 8. Corrección semántica final — suficiente vs. parcial (intención de información)

**Regla.** La suficiencia se evalúa contra lo que el usuario quiso saber, no contra "hay una unidad del mismo tema".

- `sufficient`: el conocimiento aprobado responde materialmente la necesidad preguntada.
- `partial`: hay conocimiento aprobado útil, pero una parte material de lo pedido sigue sin soporte.
- `unavailable`: no hay conocimiento aprobado capaz de abordar materialmente la solicitud.

**Cómo, sin reglas de palabras clave frágiles** (`knowledge-layer/sufficiency.ts`, todo sobre los vocabularios controlados que KL ya usaba):

1. **Amplitud de la intención.** Una pregunta amplia ("cuéntame del mercado laboral") se responde por la *familia* del tema (informalidad es un componente legítimo); una específica (subtema o tipo de información determinado) exige evidencia de lo que nombra.
2. **Familias de temas** (taxonomía exhaustiva, con test): un tema hermano de la misma familia es contexto, no respuesta.
3. **Ajuste de autoridad.** Una pregunta de regla (requisito legal, tratamiento fiscal) solo la responde una fuente oficial primaria que fundamente obligaciones; análisis o contenido curado nunca la vuelve suficiente, por cercano que sea el texto.
4. **Evidencia del subtema** con el mismo vocabulario controlado de subtemas (no una lista nueva de palabras).
5. **Sesgo conservador a `partial`** ante duda, y varios temas en la pregunta → cada uno debe estar cubierto por sí mismo.

**Contrato:** `KnowledgeUnit.support: "direct" | "contextual"` (las unidades contextuales se ofrecen como contexto, no como respuesta); `unresolved` incluye `topic_not_covered`; `partial` con `reason: no_hits` cuando lo pedido queda sin soporte. Recuperación ampliada a la familia del tema preguntado; unidades de otra familia no cuentan como parcial (ruido → `unavailable`). El adaptador de Precision redacta lo contextual como "contexto relacionado" y nunca como respuesta.

**Ejemplos verificados:** "mercado laboral en Nuevo León" → suficiente (informalidad es un componente); "prestaciones obligatorias en México" con solo conocimiento laboral/informalidad → parcial, unidades solo contextuales, `topic_not_covered`; con fuente oficial IMSS que habla de aguinaldo/prima → suficiente, esa unidad directa y primera; IMMEX preguntado con solo exportaciones → parcial; sin nada de la familia → no disponible; con IMCO real de 3 PDFs ambos casos pasan.

## Verificación

- `tsc` y `eslint` limpios.
- Unitarias: **78 suites / 1800 tests** verdes (incluye contrato KL, adaptadores Precision y la guardia de arquitectura).
- Integración PG en BD limpia (40 migraciones): **35 suites / 293 tests** verdes (más 3 suites condicionadas a archivos externos), IMCO real 6/6 con las aserciones de suficiencia.
- Guardia de arquitectura nueva (`src/__tests__/knowledge-layer-boundary.test.ts`): Precision importa de KL solo el contrato (y el cableado de composición); KL no importa Precision; solo Admin/scripts tocan internos; el contrato es solo tipos; sin red ni búsqueda web en Precision ni KL; el agente de fetch no es alcanzable desde conversación ni desde el servicio. Verifiqué que la guardia falla si se introduce una importación indebida.
- Sin cambios de esquema/migraciones ni de frontend en este bloque (por eso no se re-ejecutaron SQL ni frontend).
