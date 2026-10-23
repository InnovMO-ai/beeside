# PRECISION — Enterprise Services RAM · Reconciliación final con la fuente normalizada (texto)

Base: texto normalizado entregado por Mike (el workbook original no se usa ni se almacena; sin nombre ni lenguaje de proveedor). Método: cada área se contrastó con el motor real mediante conversaciones de prueba, no solo leyendo código.

| Área de la fuente | Cobertura actual de la RAM | Acción |
|---|---|---|
| A. Contexto de empresa / operación | Se hereda de Discovery / Persona / Proyecto; no se pregunta | COVERED |
| B. Servicios Enterprise requeridos | Léxico de conceptos (contabilidad, nómina, declaraciones, facturación electrónica, cuentas por pagar, reportes IFRS/US GAAP); lo no mapeado sigue la ruta de servicio desconocido; sin altas de catálogo | COVERED |
| C. Sistemas contable / de nómina | Había un solo campo: un sistema de nómina volunteered se guardaba como "sistema contable" | PARTIAL — MINOR CORRECTION (separa contabilidad y nómina; reconoce "mismo sistema"; un sistema de nómina solo no cierra la pregunta contable) |
| D. Plantilla / nómina | Plantilla, modelo, periodicidad y prestaciones adicionales por sondas; empleados extranjeros los cubre el manifiesto de Personas (`hr_immigration_sponsorship_need_flag`); rotación no se pregunta por diseño (plantilla + periodicidad dimensionan la nómina) | COVERED |
| E. Facturación / pagos / volumen | `scale.volume` solo guardaba la primera cifra ("120 facturas") y perdía "200 pagos"; faltaban asientos/pólizas | PARTIAL — MINOR CORRECTION (captura todas las cifras de volumen) |
| F. Intercompañía / partes relacionadas | `tax.intercompany` + señales + materialidad existentes | COVERED |
| G. Contexto de precios de transferencia | Lógica Fiscal existente (campo de estatus de documentación, materialidad); sin duplicar preguntas | COVERED |
| H. Monedas / bancos | Monedas de facturación y pago cubiertas; el número de cuentas bancarias no se pregunta (la nota de la dimensión decía "se extrae si se menciona", sin código: corregida) | COVERED (nota corregida) |
| I. Reporte financiero | `reporting.group`: norma (IFRS/US GAAP/local), periodicidad, día límite, destino matriz; plan de cuentas y formato corporativo → solo recomendación documental | PARTIAL — MINOR CORRECTION (se añade "catálogo de cuentas del grupo" a las sugerencias de documentos; nunca se solicita) |
| J. Proveedores extranjeros | Existía, pero una respuesta natural como "De Alemania, servicios de TI y licencias" no se entendía y la pregunta se **repetía** | PARTIAL — MINOR CORRECTION (nombrar el país basta; guarda países; se pregunta una sola vez) |
| K. Libros / estado de limpieza | Estado de libros al corriente/atrasado; faltaba el vocabulario neutral de diferencias, errores, inconsistencias, regularización (distingue soporte continuo vs. depuración) | PARTIAL — MINOR CORRECTION (léxico neutral; sin criticar al proveedor actual; sin conclusiones) |
| L. Cumplimiento fiscal | Revisión abierta, atrasos, al corriente, vía `compliance.status`; una sola pregunta cubre libros, fiscal y laboral; sin conclusiones | COVERED |
| M. Cumplimiento laboral | Mismo mecanismo; extranjeros en el manifiesto de Personas | COVERED |
| N. Documentos de ejecución | Solo sugerencias (balanza, estados financieros, declaraciones anuales, ejemplos de reporte, calendario); ninguna sonda los pide | COVERED |
| O. Gobierno / cadencia | Cadencia y fechas límite por `reporting.group`; contacto operativo viene de la Persona | COVERED |
| P. Confidencialidad | No se capturaba nada si el cliente la mencionaba | MISSING — ADD (hecho transversal solo si el cliente lo plantea; sin flujo NDA, sin sonda, sin concepto de catálogo) |
| Independencia / conflictos del proveedor (accionistas, directivos, cotización, holding) | Excluido; no existe en el código ni en textos | EXCLUDED — PROVIDER/PROCESS SPECIFIC |

## Cambios (mínimos)

`enterprise-services.ts` (sistemas, vendors, léxico de libros, hint, notas), `probes.ts` (volumen), `cross-cutting.ts` y `types.ts` (confidencialidad). Sin módulo nuevo, sin sondas nuevas, sin entradas de catálogo, sin solicitudes de documentos.

## Evidencia

- Pruebas semánticas del motor: 148 en verde (21 de Enterprise Services; 7 nuevas de reconciliación).
- Regresión: `tsc`, `eslint --max-warnings=0` y `build` OK; unit 90 suites / 1901 pasadas (8 omitidas); integración sobre BD nueva 40 suites / 347 pasadas; migraciones 50/50.
- Sin regresión de cuestionario: el escenario canónico (35 empleados, nómina quincenal, IFRS mensual, MXN/USD, relacionada extranjera, otro proveedor lleva la contabilidad) sigue extrayéndose en un turno, sin repreguntas, con máximo 5 preguntas y solo los faltantes materiales.

## ENTERPRISE SERVICES RAM SOURCE RECONCILIATION: **CHANGES REQUIRED → APPLIED** (mínimos; sin pendientes)

Enterprise Services RAM **CONGELADA para F0 Canon**. My Journey sigue DEFERRED TO PRODUCTION READINESS / ARCHITECTURALLY CONSIDERED / NOT IMPLEMENTED. Sin despliegue.
