# PRECISION V1.0 — PUBLIC READY · Checkpoint 2 — Discovery conectado y probado de punta a punta

Fecha: 2026-10-15 · Rama `feature/precision-continuity-foundation` · Go/no-go único: `precision-public-ready-evidence-pack-2026-10-15.md`.

**Conclusión.** El contrato canónico de Discovery pasó integración y aceptación con salida **real** de Discovery. **"Contrato canónico de Discovery" sale de la lista de bloqueantes.** No se encontró ninguna incompatibilidad real en el contrato publicado.

## Lo que se pidió y lo que quedó demostrado

| Requisito | Resultado |
|---|---|
| Consumir el contrato final publicado, sin inventar uno | `fa4-precision-context/1` (`Fa4PrecisionContextV1`), de Discovery, por su función publicada `getFa4PrecisionContext` |
| Nunca tablas mutables, YEV/PDF, FA3, artefactos de presentación | Adaptador solo lee el resultado **sellado**; guardia de arquitectura verde |
| Adaptador/puerto permanente en proceso, sin HTTP ni URLs | `Fa4DiscoveryContextReader` (puerto `FaContextReader`); `PRECISION_FA_CONTEXT_PROVIDER=discovery` |
| Mismo `project_id` permanente | Probado (pin, contexto y cadena hasta el paquete a OH) |
| Procedencia exacta de resultado/versión; origen inmutable y reproducible | El pin guarda resultado, versión de contrato, de catálogo y hash; releer da el mismo hash; el sobre sellado es único y append-only |
| Versiones/esquema | Versión de contrato no soportada → se rechaza; campos aditivos desconocidos → se ignoran sin propagarse |
| Valores heredados conservan procedencia | `sourcePinId` + `sourceItemRef` en cada uno |
| Precision sabe lo que Discovery sabe; Understanding no queda completo; sin repetición | Cero hechos del cliente antes de responder; el mapa no se confirma solo con Discovery; ningún sondeo reabre lo heredado |
| Una versión posterior no reescribe la historia | Discovery sella **un** resultado por proyecto (inmutable); una revisión del mapper no mueve el pin ni el historial de Precision |
| Caso portugués con Discovery real, de punta a punta | Discovery → Premium (fixture) → Contexto → Understanding → categorías → Service Map → Preview → OH simulado: **verde** |

## Caso portugués (salida real de Discovery)

- **Heredado:** destino México, origen Portugal, sector, producto, objetivo, plazo, duración (30 meses), modelo de plantilla; 5 necesidades de catálogo (entidad, impuestos, reclutamiento, nómina/laboral, seguros).
- **Profundizado por Precision:** entidad, financiamiento, plantilla y reparto, prestaciones, escala, intercompañía; en Fiscal: registro, marco contable, reporte a la matriz, precios de transferencia.
- **Aprendido:** 13 datos del cliente con procedencia (incluye una corrección del cliente).
- **Para el especialista:** 9 hallazgos y 14 elementos en 6 categorías; lo que el cliente no sabe viaja como pendiente.

## Hallazgos (todos corregidos)

1. Texto libre de Discovery (sector, motivo) aparecía como "servicio" en My Service Map — solo con salida real. Corregido en el origen + prueba.
2. Un mensaje de solo preguntas se leía como respuesta (resolvía conflictos pendientes y registraba "Sin respuesta clara") — lo encontró el ensayo de modelo real en el camino determinista. Corregido + pruebas.
3. El registro de borrado no clasificaba 3 tablas de Discovery (lo detectó la guardia al unir) — migración 0047, solo clasifica el mecanismo ya documentado de Discovery.
4. Renumeración de migraciones (Precision 0024–0046 tras Discovery 0017–0023): una BD nueva migra limpia (48). Un entorno que ya aplicó la numeración antigua debe recrearse.

## Para tu atención (sin bloquear Public Ready)

- **Core:** la promoción de `fa4_project` a `project` de Core con el mismo UUID al activar Premium (pago → Persona → Empresa → Proyecto) no está implementada; la prueba usa un andamio equivalente. Es trabajo de Core, no del contrato de Discovery.
- **Discovery sella un solo resultado por proyecto:** la lógica de reemplazo de pines queda como capacidad defensiva; un cliente que reinicia Discovery es otro proyecto.
- **Prioridad:** Discovery solo expone `critical`; Precision no inventa niveles intermedios.

## Regresión y ensayo

tsc/eslint limpios · unitarias 1849 · integración PG 337 (BD nueva) · Discovery con rol de runtime verde · IMCO real 6/6 · ensayo de modelo real **en seco 13/13** con un solo comando (`npm run rehearsal:real-model`; con modelo real, 11 cualidades: invariantes fallan la corrida, calidad se reporta para tu lectura).

## Siguiente (orden de tu lista)

2 modelo real/ZDR (necesito aprobación ZDR + endpoint/modelo/llave por canal seguro) · 3 contenido KSeed (*Doing Business in Mexico* + 12 brechas) · 4 Stripe sandbox · 5 ClickUp sandbox · 6 política de retención (2 campos, §6 del pack) · 7 tu recorrido final.
