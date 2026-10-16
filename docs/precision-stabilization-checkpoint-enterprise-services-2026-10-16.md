# PRECISION — Checkpoint ESTABILIZACIÓN · Enterprise Services RAM + terminología + My Journey diferido

Fecha: 2026-10-16 · Base: commit `50959ca` + cambios de este bloque (sin push, sin despliegue).

## 1. Enriquecimiento Enterprise Services RAM — **COMPLETO (con una salvedad)**

**Qué es.** Un conjunto de sondas de comprensión (dentro del motor existente `precision/understanding/`), no un módulo nuevo, ni un cuestionario, ni un catálogo, ni memoria del cliente, ni datos de KL. Es neutral respecto de cualquier proveedor.

**Mapa de dimensiones A–L (modo de tratamiento):**

| Dim. | Contenido | Tratamiento |
|---|---|---|
| A Contexto de empresa | entidad existente, grupo, presencia | hereda de FA + `existing_presence` (cross-cutting, ahora detecta "ya constituimos…") |
| B Servicios requeridos | contabilidad, nómina, facturación, AP | reconocimiento de servicio (catálogo); e-invoicing y AP → ruta de servicio no mapeado |
| C Modelo contable | quién lleva libros, sistemas, marco | `accounting.setup` (interno/externo), `accounting.systems`, `reporting.group` (marcos, periodicidad, día límite) |
| D Nómina / personas | plantilla, periodicidad | `workforce.model` (infiere directo si hay empleados propios + nómina), `workforce.payroll_cadence` |
| E Facturación / AP / volumen | volumen, monedas | `scale.volume`, `scale.currencies` (factura / paga) |
| F Intercompañía / partes relacionadas | servicios con empresa relacionada | `tax.intercompany` extendido (servicios con relacionada) + materialidad |
| G Bancos / reportes | reporte al grupo | `reporting.group` |
| H Proveedores extranjeros | existencia, relacionados, servicios | `scale.foreign_vendors` |
| I Situación fiscal / J laboral | estatus al corriente | `compliance.status` (una sola pregunta cubre libros/fiscal/laboral/revisión abierta) |
| K Documentación | — | solo **recomendada** cuando es materialmente útil; nunca solicitada como bloque |
| L Gobierno | — | extracción pasiva |

Archivos: `understanding/enterprise-services.ts` (nuevo), `probes.ts`, `concepts.ts`, `cross-cutting.ts`, `compose.ts`, `frame.ts`, `category-inheritance.ts`.

**Reconciliación con la fuente:** cerrada y congelada con el texto normalizado (ver `precision-enterprise-services-source-reconciliation-2026-10-16.md`); el workbook original no se usa.

## 2. Prueba de que NO se comporta como cuestionario

Suite semántica `enterprise-services.test.ts` (14 pruebas, todas en verde). Escenario canónico: entidad ya constituida, back-office en México, 35 empleados, nómina quincenal, IFRS mensual a la matriz, facturas en MXN y USD, servicios de una empresa extranjera relacionada, otro proveedor lleva la contabilidad.

- Un solo mensaje del cliente produce todos esos hechos (nómina quincenal, grupo IFRS mensual, monedas, proveedor extranjero relacionado, contabilidad externa, empleados propios).
- **No se repregunta lo ya dicho**; solo quedan por profundizar los hechos materiales faltantes: volumen, prestaciones, ingresos y estatus de cumplimiento.
- Máximo 5 preguntas en todo el recorrido; respuestas parciales se fusionan (profundizan, no reinician).
- Proyectos sin relación (p. ej. sin nómina) no reciben ninguna de estas preguntas; "reporte" no se confunde con "nómina".
- Conexión con materialidad de precios de transferencia y con herencia de categoría (los campos de la categoría no se vuelven a preguntar).
- **Sin conclusiones** fiscales/legales (no aparecen incumplimiento, multa, sanción…), **sin nombres de proveedor** (ni "GT"), **sin entradas nuevas de catálogo**, **sin solicitudes de documentos**.
- ES/EN.

Regresión completa: `tsc` OK · `eslint --max-warnings=0` OK · unit **90 suites / 1894 pasadas, 8 omitidas** · integración sobre BD nueva **40 suites / 347 pasadas** (6 suites omitidas por diseño) · `npm run build` OK · migraciones 50/50.

## 3. My Journey — DIFERIDO A PRODUCTION READINESS · *arquitectónicamente considerado, no implementado*

Verificación: no existe ningún botón, popup, tour, animación ni máquina de estados "My Journey" en backend ni frontend (búsqueda de "journey" sin resultados). Nada que construir ni que revertir. Nada en el UI de Precision bloquea un futuro punto de entrada ligero (modal de primera entrada, descartable, reabrible, tras una bandera inactiva). Referencia conceptual: "Your beeside Journey" (Discovery → Precision → My Service Map → Operation Hub → The Hive; "YOU ARE HERE / YOU WILL GET HERE").

## 4. Terminología de ciclo de vida — **CAMBIADA POR COMPLETO**

CODE → **ESTABILIZACIÓN** → **PRODUCCIÓN**. El término anterior del ciclo de vida fue eliminado de código, scripts, workflow y documentos del repo. La puerta ahora es `STABILIZATION_DEPLOYMENT_APPROVAL` (solo nombre; arquitectura de despliegue sin cambios). Archivos renombrados: `infra/deploy/precision-stabilization.sh`, `cloudbuild-precision-stabilization.yaml`, `docs/precision-stabilization-*.md`.

**Tránsito ESTABILIZACIÓN → PRODUCCIÓN (herramientas ya listas):**
1. Fase `baseline` (con aprobación): respaldo *clean baseline* tras seed + admin y antes de cualquier dato ficticio.
2. Fase `audit` (solo lectura, `REQUIRE_CLEAN=1` falla si queda algo): clasifica las 99 tablas con el registro de borrado de privacidad; reporta solo conteos. Prueba local: BD recién migrada ⇒ `clean:true` (31 tablas / 137 filas de sistema conservadas, 0 datos de prueba); BD con datos de prueba ⇒ `clean:false`.
3. Limpieza: **riesgo señalado** — una purga automática en producción es irreversible. Recomendación: restaurar el *clean baseline* y reaplicar config; alternativa, purga por registro con aprobación explícita. No se construyó la purga; se decide en production readiness.
4. Luego: conectar y validar Stripe y ClickUp/Operation Hub, y verificaciones finales.

## 5. Bloqueos externos exactos antes de desplegar

1. Proyecto GCP de producción con facturación y acceso + `terraform apply` de `envs/production`.
2. Contenido de la semilla inicial de KL en un bucket privado con `manifest.json` (el backend se niega a arrancar con KL vacío).
3. Cliente OAuth Web de Google (Internal, beeside.you) + su secreto en Secret Manager + correo del primer SUPER_ADMIN.
4. Aprobación explícita `STABILIZATION_DEPLOYMENT_APPROVAL`.

## 6. ESTABILIZACIÓN DEPLOYMENT READY: **NO** (únicamente por bloqueos externos; el código y el script están listos)
