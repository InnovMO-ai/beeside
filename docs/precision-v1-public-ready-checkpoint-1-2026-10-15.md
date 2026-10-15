# PRECISION V1.0 — PUBLIC READY · Checkpoint 1

> **SUPERSEDED (2026-10-15):** el frente 1 (Discovery) quedó PROBADO con salida real; ver `precision-v1-public-ready-checkpoint-2-2026-10-15.md` y el evidence pack único `precision-public-ready-evidence-pack-2026-10-15.md`.

Fecha: 2026-10-15 · Base: `a5fcf34` (corrección de suficiencia de KL sobre `d4b6675`).

**Estado.** Núcleo del producto: FEATURE COMPLETE (simulado/local). MVP1 con KL: FEATURE COMPLETE (simulado/local). Corrección semántica de suficiencia aplicada y con regresión completa verde: tsc/eslint limpios; unitarias 78 suites / 1800; integración PG en BD limpia 35 suites / 293; IMCO real 6/6 (amplio "mercado laboral" = suficiente; "prestaciones obligatorias" con solo informalidad = no suficiente). Detalle en `precision-knowledge-layer-integration-2026-10-15.md` §8.

## Estado de los 8 puntos de reporte

| # | Frente | Estado | Qué hay construido | Qué falta (y de quién) |
|---|---|---|---|---|
| 1 | Discovery real + continuidad | **Esperando insumo** | Puerto `FaContextReader` con pin de procedencia, guardia de arquitectura (sin tablas mutables, sin YEV), suites G1–G5 contra fixtures. | **Contrato canónico de Discovery** (Product/Discovery). Por decisión vigente no se construye conector temporal: al llegar, reconcilio contra G1–G5 y reporto contradicciones antes de adaptar. Además sigue abierto el hallazgo H4/H8: `fa4_project` ≠ `project` de Core, no existe la promoción ni el congelado de `Answers`; el contrato debe definirlos. |
| 2 | Modelo real / ZDR | **Esperando insumo** | Gateway con 3 niveles de respaldo, ensayo A–J ya corrido con datos sintéticos (12-oct), `PRECISION_UNDERSTANDING_INTERPRETER=model` apagado hasta tener aprobación ZDR. | **Aprobación ZDR/privacidad por escrito + endpoint/modelo/llave de producción** (tú, por un canal seguro; yo nunca las imprimo ni commiteo). |
| 3 | Stripe sandbox recurrente | **Listo para correrse** | Adaptador + webhook firmado + reconciliación + `stripe:sandbox-verify` (modo `subscription`, `--cancel-check`, test clock). Probado contra fake; **no contra Stripe**. | Llaves **de prueba** (`sk_test_`), `price_` recurrente, `whsec_`, un proyecto elegible en BD sandbox y `stripe listen`. Corres el script (o me das un entorno donde yo pueda). |
| 4 | ClickUp / OH real incl. `understanding` | **Esperando insumo** | Adaptador completo (idempotencia, marcador v2, reintentos) + servidor fake con suite de contrato; el bloque `understanding` viaja en el paquete OH. | `CLICKUP_TOKEN`, workspace y space **de sandbox** (`CLICKUP_MODE=SANDBOX`); luego repito la suite de contrato contra el space real. |
| 5 | Retención | **Esperando política** | Borrado (`privacy_erase_project`): exige política aprobada, proyecto bloqueado fuera de ventana, sin suscripción activa, una transacción, registro append-only, seguimientos externos (OH/ClickUp). **Sin programar** (la ventana legal no está decidida). | Legal/privacidad: `min_days_after_block` y `retain_legal_acceptance`. Con eso se inserta la política aprobada y se corre dry-run. |
| 6 | Recorridos humanos / calidad conversacional | **Construido, no probado con modelo real** | Recorridos con guion verdes; caso Portugal completo con KL. | Depende del frente 2 + una lectura humana tuya de los transcritos reales. |
| 7 | KSeed de producción | **Esperando contenido** | Ruta de ingesta única (KL) lista; plan de 12 brechas + paquete de solicitud de fuentes entregado. | **Doing Business in Mexico** (PDF/URL) y materiales aprobados de The Hive para las 12 brechas. Ingiero sin rediseñar. |
| 8 | Bloqueantes exactos a PUBLIC V1.0 | — | — | Los 6 de arriba. No hay bloqueantes **internos** de ingeniería. |

## Herramienta nueva

`npm run public-ready:status` (solo lectura, sin imprimir valores): dice por frente si está configurado y cuál es el comando de prueba. Cada insumo que llegue se verifica con una corrida.

## Orden recomendado de insumos (de mayor a menor desbloqueo)

1. **Contrato canónico de Discovery** — es el camino crítico (hoy el producto corre sobre fixtures de contexto).
2. **ZDR + credenciales de modelo** — habilita los frentes 2 y 6.
3. **Stripe test / ClickUp sandbox** — independientes entre sí, cada uno es una corrida corta.
4. **Política de retención** — decisión de Legal, 2 parámetros.
5. **Contenido KSeed** — en paralelo, sin pausar ingeniería.

## Seguridad

Nada de credenciales entra en chat, repo ni logs. Para sandbox: variables de entorno en el equipo que ejecuta; si prefieres que yo ejecute, necesito un entorno donde tú las hayas cargado, no que las escribas aquí.
