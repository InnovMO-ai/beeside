# Checkpoint — Discovery → Precision bridge preparation (2026-10-14)

Rama de trabajo `feature/precision-continuity-foundation` @ `f6e8574` (local, sin push). Línea base congelada `feature/precision-v2-f5` @ `a8f8f3e`: intacta.
Terminología: **Discovery** = nombre de Producto (antes First Assessment / FA). Los identificadores técnicos (`fa4_*`, `FaContextReader`, nombres de migraciones, `fa_journey_event`) NO se renombraron.

## 1. Suite de conformidad Discovery → Precision
Hecha y reutilizable contra el lector real (una línea de fábrica por suite). Tres capas: (a) conformidad del lector (identidad de proyecto, identidad/versión de resultado, contexto reproducible/inmutable, solo contenido client-safe estructurado, aislamiento); (b) conformidad del puente del lado Precision, con PostgreSQL (procedencia por valor, pin = referencia sin copia, determinismo, supersesión, tolerancia a campos aditivos futuros, sin contexto = sin oferta ni pin, **lo heredado no crea hechos y no completa el Understanding**); (c) guardia de arquitectura (sin tablas mutables de Discovery, sin módulo FA3 legacy, sin YEV). No se construyó conector temporal ni se inventó el contrato. Detalle y checklist de reconciliación: `discovery-bridge-acceptance.md`.

## 2. Admin
Matriz REQUIRED → IMPLEMENTED → TESTED → STILL MISSING en `admin-capability-matrix.md`. Los 11 requeridos son usables desde la UI con el rol correcto y están probados (API y componente). Esta ronda cerró: selector de empresa por búsqueda (antes había que pegar un id). **Aún no se declara Admin Feature Complete:** falta E2E en navegador, opción de provisionar SUPER_ADMIN en la UI, edición de programas, y la política de retención (decisión Privacy/Legal, no código).

## 3. Analítica / estadísticas
Vistas `analytics_v1_*` + catálogo de métricas + Admin → Precision → Statistics, live. Alias de Producto "Discovery" documentado para `fa_journey_event` y claves `fa.*` (ids históricos sin renombrar; no se justifica migración). Las métricas que dependen de la capa de producto Precision siguen `awaiting_product_layer` (reportan 0/null, no se aproximan).

## 4. Operation Hub / ClickUp
Feature Complete en el alcance construido: `Precision → OperationHubPort → adaptador ClickUp`; brief legible para Sherpa derivado del mismo payload canónico, payload de máquina como fuente de verdad, Preview y Send usan el mismo builder, `Sent` solo tras aceptación externa; visibilidad en Admin. **No verificado contra ClickUp real** (sin credenciales); queda por confirmar el límite de tamaño de descripción con brief + payload.

## 5. `taskId` → `workItemId`
Verificado: registros históricos persistidos se leen (decodificador acepta `taskId` legado y normaliza), ledger de idempotencia intacto (no se tocó), reintentos creados antes del cambio resuelven, vistas de Admin compatibles, contrato del adaptador externo sin cambios (ClickUp conserva su propio `task.id`; marcadores `beeside-oh/1` y `/2` aceptados). **No requiere migración de datos.** Escrituras nuevas: neutrales. Pruebas: 26 en `oh-delivery.int.test.ts` + ClickUp v1 replay.

## 6. Privacidad
Mecanismo de borrado completo y gobernado (política versionada → dry-run → confirmación escrita → ejecución; anonimización; bloqueos; auditoría solo con conteos). ACCESO (90 días read-only configurable tras Premium) separado de RETENCIÓN. **No se inventó duración de retención**: sigue bloqueada hasta que Privacy/Legal apruebe una política. Un bloqueo/borrado de privacidad nunca es sobrescrito por un derecho comercial (probado).

## 7. Stripe recurrente
Implementado (suscripción, renovación, reactivación, cancelación, fin de periodo) y probado contra fake; flag apagado para la prueba inmediata Discovery → Precision. Premium nunca = "Stripe dice activo": Stripe → entitlement de beeside → Precision. Sandbox real: pendiente de credenciales.

## 8. Brechas del núcleo de producto Precision (pendientes)
Comprensión profunda (Understanding) y suficiencia/profundidad; Project Frame progresivo; rationale / "por qué"; razonamiento multi-país/multi-fase; prioridad del cliente; corrección del Service Map; Add a Service; necesidades desconocidas legítimas; filtrado de ruido; categoría Marketing; frescura de hechos; readiness; integridad del Preview; calidad conversacional; depth gate; arnés de evaluación (DP10). **La infraestructura es necesaria, no suficiente: no se declara Feature Complete.**
Observaciones: etiquetas de ítems CRP en manifiestos aprobados están en forma de pregunta (se conservan como contenido canónico; Producto puede preferir sustantivos más adelante). La lint de higiene es herramienta de QA, no compuerta de runtime.

## 9. Bloqueado por el contrato canónico de Discovery
Lector real y prueba de primera ejecución (proyecto/resultado real → contexto → Premium simulado → frontera → Precision → pin → Understanding); regla de rechazo de versión mayor no soportada; confirmación de que `source_result_id` es uuid; limpieza de supuestos FA3 legacy. Al llegar el contrato: **reconciliación primero** (checklist en el doc de aceptación), sin adaptar en silencio.

## 10. Bloqueado por la Beta Knowledge Base
Arquitectura/ingesta de conocimiento (no se construye KB manual grande antes de revisarla).

## 11. Requiere credenciales externas
Modelos (proveedor/ZDR y aprobación de privacidad), Stripe sandbox, ClickUp sandbox/producción, aprobación de política de retención (Legal).

## 12. Commits y regresión
Commits locales (sin push): …`c7be639` (conformidad del lector), **`f6e8574`** (terminología Discovery, clases de higiene, compat workItemId, conformidad del puente + guardia, selector de empresa en Admin).
Regresión sobre `f6e8574`, base fresca: backend `tsc` limpio; unit 1522 ✓ (8 skipped preexistentes); integración 265 ✓ (2 suites omitidas por compuerta de entorno, p. ej. ensayo con modelo real que exige credenciales); SQL (7 suites) sin FAIL; frontend `tsc` y `eslint` limpios, vitest 149 ✓.
