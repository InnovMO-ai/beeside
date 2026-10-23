# KL 1.0 · Matriz de implementación y pruebas

Design · versión 3 (congelamiento) · 16-oct-2026 · Liga cada pieza a construir con su incremento de Code, sus pruebas y los criterios A01–A10 (spec v1.4, anexo A) y AC-01–AC-14 (Product Specification §12). No autoriza iniciar Code.

Incrementos (spec v1.4 §15): **R1** Núcleo · **R2** Automatización y Admin · **R3** Producto 01. Las condiciones de habilitación están al final, en tres grupos (A, B, C).

## 1. Implementación

| # | Pieza | Inc. | Reutiliza | Pruebas mínimas | Cubre |
|---|---|---|---|---|---|
| I1 | Esquema `kl` (migraciones pareadas con `_integrity`), roles de BD, triggers de inmutabilidad y transiciones | R1 | Patrón de migraciones a mano + integridad del repo | Integridad: UPDATE de contenido rechazado; transición no permitida rechazada; aprobar lo propio rechazado | A06, A10, AC-09 |
| I2 | Repositorio: unidades, versiones, `stat_value`, `card_content`, variantes, enlaces | R1 | Drizzle + `Db` | Unidad: periodo nuevo = unidad nueva; corrección = versión; vigencia = última publicada no retirada del periodo más reciente | A09 |
| I3 | Consulta `kl.v1` (metadatos + SQL; ranking por indicador) | R1 | — | Contrato: los tres casos sufficient/partial/not_available; reglas de PO-3; sin cliente HTTP en el módulo (lint) | A02, A03, A09 |
| I4 | Puerto `knowledge` + adaptador `kl` + implementación `off` | R1 | Patrón `ports/` y `IntegrationDescriptor` | Paridad con `off` (suites actuales sin cambios); presupuesto 250 ms; error → `availability` | §13 no regresión, resiliencia |
| I5 | Paquetes de contexto, manifiesto y validez por turno | R1 | — | Invalidación al retirar una pieza; siguiente turno sin la pieza | A06, A10 |
| I6 | `approvedClaims` en KL detrás de `kl.r10_claims_enabled = false` · CR-KL-001 en Precision (lo implementa el responsable de Precision, si lo acepta) | R1 (lado KL) | `country-claims.ts` (sin tocarlo desde KL) | Lado KL: con la bandera apagada `approvedClaims` siempre `[]`; activarla sin referencia de aceptación → rechazo y auditoría. Lado Precision: N1–N11, P1–P3 del CR; regresión de verificadores | Confiabilidad |
| I7 | Demanda y uso: señales, HMAC opaco, grupos, decisiones | R1 (señales) · R2 (grupos y UI) | — | Minimización: DTO con nombre de empresa no deja rastro en `kl.*`; demanda no se emite con `availability ≠ ok` | A01, A03 |
| I8 | Canal de carga: validación de archivos, original inmutable, extracción con localizador, QA, revisión | R1 (KSeed) · R2 (UI completa) | Almacenamiento de objetos con retención | XLSM y PDF con `/JavaScript` rechazados antes de guardar; duplicado por huella; revisor ≠ uploader | A08 |
| I9 | Carga de KSeed | R1 | I8 | Lote completo pasa QA y revisión; Precision recupera conocimiento real en la primera conexión | Handoff §10 |
| I10 | Source Registry y aprobación de fuentes | R2 | — | Comercial no aprobable sin excepción; excepción vence | A04 |
| I11 | Agente de recolección (worker) | R2 | `worker.ts`, jobs con `SKIP LOCKED` | Clasificación de cambios; nivel 1 se autopublica solo con QA ok; cambio de método a revisión; corte por bucle; salida solo a dominios aprobados | A05 |
| I12 | Agente de conocimiento | R2 | Worker | Compila solo publicado; sin red; promociones registradas | §13 eficiencia de Seed |
| I13 | KL Admin (8 espacios) en el Control Center | R2 | `AdminApp.tsx`, clases `admin-*`, sesión OIDC, `rbac.ts`; reglas responsive de `prototipos/canvas/kl-control-center.css` PARTE 3 en la hoja de KL | Pruebas de UI por rol: acciones ocultas o deshabilitadas con motivo; servidor rechaza aunque la UI falle. **Regresión responsive (UI-R1)** en CI: cada ruta de KL Admin a 1440, 1280, 768 y 390 px con la sonda de `evidencia/responsive/responsive-audit.mjs`: 0 palabras de texto normal partidas, 0 columnas de texto < 64 px, 0 recortes, 0 scroll horizontal de página; tablas anchas solo con scroll local | AC-14, §13 administración, UI-R1 |
| I14 | `kl.role_grant` y permisos KL | R2 | `admin_users` | Concesiones auditadas; KL_ADMIN explícito | §13 administración |
| I15 | Validación especializada (interna y externa con código) | R2 | I8 para evidencia | Código que no coincide rechazado; vencimiento → `requires_review` y fuera de edición | AC-03, R8 |
| I16 | Composición de producto, avisos de cambio, informe mensual | R3 | — | Cambio en dato citado genera aviso y no reescribe; sin cambios no hay edición | AC-07, AC-08 |
| I17 | Builder `knowledge_guide` sobre `ReportDocument` + bloques nuevos | R3 | `reports/report-model.ts` | Función pura; ninguna cifra fuera de `stat_value.display_*` | AC-01, AC-02, AC-11 |
| I18 | Render Chromium en worker + normalización + almacenamiento congelado | R3 | Playwright del repo | Prueba AC-10 de tres niveles (evidencia en `design/evidencia/ac10`) | AC-10, AC-13 |
| I19 | Controles de edición y aprobación editorial | R3 | — | Cada control bloquea con su motivo | AC-01–AC-06, AC-12 |
| I20 | Estado público de edición | R3 | Backend Express, `rate-limit.ts`, app web | Respuesta única para inexistente; sin contenido; límite de tasa | PO-2 |
| I22 | Tema del producto editorial (`db.v3b`), bloques nuevos (`guide_cover`, `founder_letter`, `section_header`, `kpi_row`, `key_insight`, `labelled_text`, `two_columns`, `matrix_table`, `journey`, `timeline`, `bar_breakdown`, `editorial_note`, `cta_link`, `sources_directory`, `publication_notes`), paginador y lint | R3 | Prototipo `prototipos/db2026-gen/` | Estrés: tablas partidas con encabezado repetido; bloque indivisible demasiado alto → falla cerrada; lint sin hallazgos; cada `ref` resuelve al directorio; `founder_letter` con huella distinta → falla; misma salida con Lato y con Public Sans (estructura) | AC-01, AC-10, AC-13 |
| I23 | Periodicidad `kl.cadence` y planificador; acciones «Revisar ahora» y «Edición extraordinaria» | R2 | Worker, `SKIP LOCKED` | Sin valor diario en el enumerado ni en la API; `inherit` toma la periodicidad más frecuente de sus consumidores; ningún agente corre fuera de `next_*_at` salvo acción manual auditada; DB = `semiannual`; `none` no programa nada | AC-08, PO-6 |
| I24 | Enlaces administrables (`kl.links.*`) | R3 | `kl.setting_version` | `cta_link` sin clave configurada → falla; cambiar el enlace no altera ediciones publicadas; la edición congela el valor en su manifiesto | PO-7 |
| I21 | Descarga autenticada y aviso de revocación (lado Precision) | R3 (responsable de Precision) | Ruta y `Banner` de Precision | Sin acceso → 403; revocada → aviso y edición vigente | AC-09, D23 |

## 2. Casos A01–A10

| Caso | Prueba | Inc. | Piezas |
|---|---|---|---|
| A01 Portugal → México | Ensayo de rutas con modelo real: dimensiones mínimas, categorías, límites HIGH, nada del cliente en `kl.*` | R1 | I3, I4, I6, I7 |
| A02 Asia → México, Manzanillo | `sufficient` con ficha de contexto y límites; sin ruta, costos ni tiempos | R1 | I3, I4 |
| A03 Ferrocarril Manzanillo–Guanajuato | `not_available`, límite, hallazgo, señal con `topic` y HMAC; sin tráfico saliente | R1 | I3, I4, I7 |
| A04 Fuente comercial bancaria | Rechazo por defecto; excepción con alcance y vencimiento | R2 | I10 |
| A05 ICE 2026 | `method_change`, nivel 2, sin autopublicación, serie nueva ligada | R2 | I11 |
| A06 Revocación de ficha | `withdrawn`, paquete invalidado, `change_notice`, historia intacta | R1 | I1, I5, I16 |
| A07 PDF ES/EN | Edición real con AC-01–AC-06, AC-10, AC-13 | R3 | I16–I19 |
| A08 Carga con contenido activo | Rechazo antes de guardar | R1/R2 | I8 |
| A09 IMCO frente a ENOE | Precision recibe la primaria; IMCO solo `rank` con nota | R1 | I2, I3 |
| A10 Revocación de fuente | Una transacción; siguiente turno `not_available`; historia intacta | R1 | I1, I5 |

## 3. Criterios AC-01–AC-14

| AC | Cómo se demuestra | Automático |
|---|---|---|
| AC-01 Toda cifra = registro publicado `id@versión` | Cruce manifiesto ↔ texto extraído del PDF | Sí |
| AC-02 Fuente, periodo y fecha por cifra | Inspección de bloques `data_table` del `ReportDocument` | Sí |
| AC-03 Sin ficha normativa con validación vencida | Intento de aprobar edición con validación vencida → bloqueado | Sí |
| AC-04 ES = EN en piezas, citas y cifras | Comparación de manifiestos y conteos por sección | Sí |
| AC-05 Sin percepción, partners, cliente ni valores diarios | Controles en la composición | Sí |
| AC-06 Uso permitido | Fuente `cite_only` en la edición: no se reproduce texto | Sí |
| AC-07 Cambio citado → aviso, nunca reescritura | Nuevo periodo de prueba | Caso de prueba |
| AC-08 Sin cambios no hay edición | Ciclo semestral vacío (DB) y ciclo de prueba `weekly` vacío | Caso de prueba |
| AC-09 Despublicar y revocar con rastro | Auditoría + estado público + aviso Precision | Caso de prueba |
| AC-10 Mismo manifiesto, mismo PDF | Tres niveles: contenido, visual y binario (sección 4) | Sí, en CI |
| AC-11 Misma cifra en Precision y PDF | Consulta `kl.v1` vs tabla del PDF para la misma versión | Sí |
| AC-12 Límites y claves de catálogo válidas | Validación contra el catálogo provisional | Sí |
| AC-13 PDF accesible y navegable | `Tagged: yes`, marcadores, `Lang`; validador PDF/UA si se puede instalar, si no revisión con lector de pantalla documentada | Parcial |
| AC-14 Ruta de edición sin intervención técnica | Prueba con roles reales | Manual |

## 4. AC-10 · evidencia ya obtenida en Design

Prueba ejecutada sobre un prototipo del pipeline (`design/evidencia/ac10`): mismo `ReportDocument` → HTML de impresión → Chromium 141 (Playwright 1.56) → PDF carta, etiquetado y con marcadores, 7 páginas, fuentes empaquetadas del repo. El PDF resultante (`evidencia/ac10/AC10_artefacto_tecnico_carta.pdf`) es un artefacto técnico, no referencia editorial.

**Repetición en A4 con el tema definitivo (DB2026):** 5 páginas reales de v3 + estrés de 7 páginas; dos corridas: `paged.html`, texto y PNG idénticos; PDF normalizado idéntico; `Tagged: yes`, `/Outlines`, `/Lang (en)`, 594.96 × 841.92 pt; 0 errores y 0 hallazgos de lint con Lato y con Public Sans.

| Nivel | Resultado |
|---|---|
| Contenido | `ReportDocument` y HTML idénticos (misma huella); texto extraído idéntico |
| Visual | Las 7 páginas rasterizadas idénticas |
| Binario sin normalizar | Distinto entre segundos distintos: solo difieren `/CreationDate` y `/ModDate` (4 bytes) |
| Binario normalizado | Idéntico byte a byte tras fijar ambas fechas a la de la edición (sustitución de igual longitud) |
| Control negativo | Cambiar una posición (2 → 3) cambia la huella normalizada y el texto |
| Accesibilidad | `Tagged: yes`, `/StructTreeRoot`, `/Outlines`, `/Lang (es)`; estructura H1–H3, tablas con TH, listas |

Conclusión: el requisito byte a byte es técnicamente viable y no hace falta proponer cambiarlo. Condiciones: versión de Chromium fijada en el worker y en CI, fuentes empaquetadas, sin red durante el render. El PDF se renderiza una vez al publicar y se guarda congelado; la prueba de CI vuelve a renderizar y compara.

## 5. Línea base y presupuestos (R5)

1. Guiones A01, A02, A03 en el arnés de ensayo de rutas de Precision con modelo real, KL apagado: tokens del proveedor, llamadas, latencia, preguntas pertinentes, servicios detectados.
2. Mismos guiones con KL encendido y KSeed cargado.
3. Fijar presupuestos de RAM por nivel y umbrales de §13 con esos datos; acordarlos con el PO antes del go-live.
4. Recalcular el A/B/C de ICE 2025 con el tokenizador real.

## 6. Condiciones de habilitación (no bloquean Design)

Principio: el desarrollo aislado (datos sintéticos, fuentes desactivadas, `PRECISION_KNOWLEDGE_PROVIDER = off`, `kl.r10_claims_enabled = false`, agentes apagados, sin publicación) no exige licencias editoriales, validadores definitivos ni titulares operativos. A la inversa, ninguna función sensible se activa sin sus controles: cada condición B o C está atada a una bandera o a un control en servidor que la hace cumplir.

### A · Bloqueantes reales para iniciar Code o ejecutar una migración

| # | Condición | Bloquea | Responsable |
|---|---|---|---|
| A1 | Aprobación del PO del congelamiento de Design y del Code Handoff Pack | Iniciar Code | PO |
| A2 | Rama base acordada para el módulo `backend/src/kl/` y su CI (independiente de Precision) | Iniciar Code | PO / Plataforma |
| A3 | Para migrar fuera de local o CI efímero: entorno destino, rol `kl_owner`, respaldo y plan de reversión del esquema `kl` | Ejecutar una migración compartida | Plataforma |

### B · Dependencias para implementar o habilitar funciones concretas

| # | Condición | Habilita | Control que lo hace cumplir | Responsable |
|---|---|---|---|---|
| B1 | P5 Precision 2.0 integrada a `main` | Implementar el puerto `knowledge` y su adaptador (I4) | El módulo KL no importa Precision; el puerto llega con P5 | Precision |
| B2 | **P7 especificación de la RAM en Precision** | Lado Precision de los paquetes de contexto (consumo, validez por turno, prompt de afirmaciones citables); KL construye y prueba su lado (I5) con un consumidor de prueba | Paquetes compilados pero sin consumidor real hasta P7 | Claude (Precision) / PO |
| B3 | Aceptación e implementación de CR-KL-001 por el responsable de Precision | Emitir `approvedClaims` (I6) | `kl.r10_claims_enabled = false`; solo KL_ADMIN con referencia de aceptación | Precision |
| B4 | Encender `PRECISION_KNOWLEDGE_PROVIDER = kl` en un entorno | Conversaciones con conocimiento de KL | Requiere B1, B2 y la línea base R5; sin B3, sin afirmaciones | PO + Precision |
| B5 | P6 familias y categorías de salida; O5 gobierno de equivalencias | Claves de catálogo definitivas (AC-12) | Catálogo provisional versionado | PO |
| B6 | Chromium fijado en la imagen del worker y en CI | Render del PDF (I18) | Sin renderizador, la edición no pasa de `in_approval` | Plataforma |
| B7 | Verificación de Lato en la imagen del worker (disponibilidad, licencia OFL, compatibilidad) | Tema `db.v3b` con Lato | Si falla, Public Sans provisional (probado, misma estructura) | Code |
| B8 | Antimalware disponible | Cargas de archivos reales (I8) | Sin escáner, la carga se rechaza; en desarrollo solo archivos sintéticos | Plataforma |
| B9 | Bucket privado con retención | Guardar originales y PDF fuera de local | Almacenamiento local solo en desarrollo | Plataforma |
| B10 | Autorización de KL_ADMIN por publicación (S04–S09, subconjunto ICE) | Agente recolector con fuentes reales (I11) | Fuente no aprobada = sin salida de red | PO como KL_ADMIN |
| B11 | Dominio de la página pública de verificación | Estado público de edición (I20) | Ruta apagada sin dominio | PO / Plataforma |

### C · Condiciones de operación y publicación

| # | Condición | Antes de | Responsable |
|---|---|---|---|
| C1 | Titulares de KL_ADMIN, KL_EDITOR, KL_REVIEWER (mínimo dos personas distintas) | Operar KL con contenido real (KSeed incluido) | PO |
| C2 | Validadores especializados por dominio (P3) | Publicar contenido nivel 3 | PO |
| C3 | Derechos de IMCO y DOF; licencias de Banxico e IMSS (P2) | Publicar PDF | PO |
| C4 | P4 adopción del ICE 2026 (revisión metodológica) | Usar ICE 2026 | PO |
| C5 | Verificación de las afirmaciones y fuentes de DB (27 afirmaciones, 17 de riesgo alto; `DB2026/DB2026_Trazabilidad_Fuentes.xlsx`) | Aprobar la edición DB 2026 | Editor + validadores |
| C6 | Autoridades vigentes (ATDT) y notas editoriales contrastadas con el DOF (D26) | Publicar capítulos afectados | Editor |
| C7 | Contenido redactado, validado y aprobado en ES y EN | Publicar cualquier edición | Editor + revisor editorial |
| C8 | Presupuestos de RAM y umbrales (R5) acordados | Go-live | PO |
| C9 | Enlace `kl.links.discovery_start` de producción | Paso de estabilización a producción | PO (cambio de configuración) |
| C10 | Maestro vectorial del logotipo y morado oficial (opcional: el PNG del handoff basta para imprimir) | Siguiente edición si se entrega | Marca |
