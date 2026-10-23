# beeside Knowledge Layer 1.0 · Design Handoff Pack

16-oct-2026 · Workspace cerrado formalmente · Product Owner: Mike

Este paquete basta para abrir el ambiente de Design de KL 1.0 sin leer la conversación de Workspace. Si algo aquí contradice un documento canónico, prevalece el documento canónico (sección 1) y se reporta la diferencia.

**Veredicto de madurez.** La especificación está lista para Design. No hay contradicciones fundacionales ni una arquitectura alternativa materialmente superior. Hay una recomendación técnica de alineación (sección 9, R1) y dos decisiones de implementación que Design debe resolver (R2 y R3). Ninguna reabre decisiones de producto.

---

## 1. Documentos canónicos y ubicaciones

| Documento | Rol | Dónde |
|---|---|---|
| Master Product & Operating Specification v1.4 (adenda 16-oct) | Reglas canónicas; prevalece sobre todo | Proyecto claude.ai "Knowledge Layer": `specs/KL_1.0_Master_Spec_MVP1.md` · Mac: `~/Developer/beeside/KnowledgeLayer/specs/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.4.docx` (y `.md`) |
| KL 1.0 → Precision MVP1 · Canonical Architecture Handoff | Contrato `kl.v1` y fronteras con Precision | https://claude.ai/code/artifact/a602f040-947b-4a48-99e0-c95dbf10fd9d · snapshot: `handoff/referencia/KL_1.0_Precision_MVP1_Handoff.md` |
| Doing Business beeside México · Product Specification | Producto 01 aprobado (D20–D26) | https://claude.ai/code/artifact/8c8c2421-9e6c-4c36-9d0f-759d87af3b01 · snapshot: `handoff/referencia/Doing_Business_Mexico_Product_Specification.md` |
| KL 1.0 · Workspace Consolidation & Readiness | Decision Register, inventario de Precision, plan, veredicto | https://claude.ai/code/artifact/f95a2dd1-f13e-4df4-aac3-37bad4e272a1 (pestaña Consolidation & Readiness) |
| Source Registry México | Matriz funcional S01–S10, registro amplio R1–R34, configuración inicial de Admin | Misma URL, pestaña Source Registry México · snapshot: `handoff/referencia/KL_1.0_Source_Registry_Mexico.md` |
| Ingestión y recuperación | Prueba ICE 2025, arquitectura de consulta, carga manual, versionado, A/B/C | Misma URL, pestaña Ingestión y recuperación · snapshot: `handoff/referencia/KL_1.0_Ingestion_y_Recuperacion.md` |
| Paquete de evidencia ICE 2025 | Benchmark inicial reproducible (23 casos, scripts, resultados, límites) | `~/Developer/beeside/KnowledgeLayer/pruebas/ice2025/` |
| Código de Precision 2.0 | Base de integración (solo lectura) | Repo beeside, rama `feature/precision-v2-f5`, commit `a8f8f3e` (13-oct) |
| beeside platforms 1.1 / 1.2 (lámina 3) | Arquitectura de plataformas del PO | Compartidas por el PO en Workspace; resumidas en v1.4 §2–3 |

Rutas de Mac relativas a `~/Developer/beeside/KnowledgeLayer/`. Histórico (v1.0–v1.3) en `historico/`; no se usa en Design.

## 2. Decisiones congeladas y contratos

**Principios.** Objetivos inseparables: PRECISIÓN y EFICIENCIA INTEGRAL; la precisión diagnóstica prevalece sobre el ahorro de tokens. Knowledge-first: nunca búsqueda web en la conversación. KL sabe del mundo; Precision sabe del cliente.

| ID | Decisión congelada |
|---|---|
| D1 | KL es la autoridad del conocimiento consultivo global; convergencia aditiva con Precision 2.0. |
| D2 | Percepción excluida de lo consumible; índices compuestos nunca recalculados. |
| D4, D19 | Ningún dato del cliente o de la empresa entra a KL; solo dimensiones estructuradas; demanda con identificador opaco irreversible. |
| D5, D6 | Fuentes primarias para lo normativo; gobernanza en tres niveles de riesgo (1 estadístico, 2 cambio o anomalía, 3 normativo). |
| D8 | Nombres: Knowledge Layer 1.0; Precision 2.0. |
| D9, D25 | Service Explorer = control maestro de servicios activos (aún no existe; rige el catálogo provisional de 17 categorías y 200 servicios con claves estables). KL referencia `category_key` y `service_id`; nunca crea servicios. Lo no catalogado (p. ej., migración) va a hallazgos. |
| D10, D16 | Conocimiento general de servicio en KL; equivalencias en la RAM de Precision. |
| D11 | Sin sobrescritura; ante duda, valoración humana; en productos, aviso y aprobación. |
| D12 | Dato desconocido: límite + hallazgo en Precision para el Sherpa + demanda anónima en KL. |
| D13 | Agente de conocimiento compila la RAM y promueve o retira por uso; la consulta en conversación es búsqueda directa. |
| D14, D17 | Canal de carga del equipo; KSeed (preparado por Claude en Precision) entra por ese canal: KL no arranca vacío. |
| D18 | KL no es de cara al cliente. |
| D20–D26 | Producto 01: 12 capítulos; alcance MVP1 con 09 limitado a orientación general sin validadores; español maestro, inglés equivalente y publicación conjunta; distribución controlada con enlace desde Precision; 32 perfiles estatales sin rankings propios; notas editoriales no son conocimiento aprobado. |
| T1–T19 | Técnicas (T1–T18 aprobadas por el PO; T19 registrada el 16-oct): esquema `kl` en el PostgreSQL existente, consumido por API (T1); recuperación filtrada por metadatos (T2); RAM en niveles con manifiesto (T3); agente determinista (T4); RBAC sobre identidad existente (T5); demanda sin `project_id` (T6); `approvedSources` de R10 + puerto `knowledge` (T7); `knowledge_seed` en código (T8); híbrido (T9); primaria–intermediario (T10); publicación selectiva (T11); periodo con confianza (T12); tolerancia de redondeo (T13); DENUE agregado (T14); FIX fuera de RAM (T15); validación de cargas (T16); configuración inicial (T17); sin indicadores derivados (T18); rol SPECIALIST_VALIDATOR (T19). |
| O5 | Abierta, no bloquea: gobierno de cambios a equivalencias (recomendación: Precision con las mismas reglas que KL). |

**Contrato `kl.v1`** (solo lectura salvo demanda y uso; nombres de campos se fijan en Design):

| Operación | Uso |
|---|---|
| Paquete de contexto | RAM de etapa y su hash; al iniciar o reanudar sesión, o al cambiar de etapa o categoría |
| Consulta de conocimiento | Solo ante necesidad diagnóstica concreta |
| Recursos relacionados | Productos y secciones (Doing Business México) con edición y referencia de entrega |
| Señal de demanda | Cuando la cobertura es partial o not_available |
| Uso | `id@versión` usados, en lote |

Respuesta: cobertura (sufficient, partial, not_available), unidades con `id@versión`, procedencia, vigencia (periodo, publicación, vigente desde/hasta, próxima revisión), riesgo, confianza como estado de validación, límites, especialista y relacionados. Entrada: país destino y origen, región o estado, industria, etapa, categoría o servicio, tema, tipo de información, idioma y consulta normalizada transitoria. Nunca: nombres, documentos, cifras del proyecto, `project_id` real, Project Frame, transcripciones.

**Reglas de datos que el modelo debe hacer cumplir:** fecha de publicación, periodo estadístico, vigencia y actualización son campos distintos; nada se sobrescribe; una pieza solo es consumible publicada; ninguna cifra de producto se escribe a mano; cambio de método o cobertura exige evaluación antes de comparar periodos.

## 3. Alcance funcional MVP1 y exclusiones

| Incluido | Excluido (arquitectura preparada) |
|---|---|
| México sobre diseño multipaís | Operación multipaís |
| Source Registry con matriz S01–S10 y registro amplio | Activar fuentes sin aprobación del ADMIN |
| Agente de recolección programada (nivel 1 automático) y agente de conocimiento | Búsqueda web desde la conversación; investigación a la medida |
| Canal de carga del equipo (PDF, DOCX, XLSX, CSV) | Edición manual de valores extraídos |
| Modelo: evidencia, ficha, composición de producto, demanda, fuente | Motor de reglas universal; taxonomía de servicios propia |
| RAM de conocimiento en Precision alimentada por KL (puerto con bandera) | Cambios a Precision fuera del puerto y de `approvedSources` |
| Knowledge Demand con decisiones CREATE…REJECT | Incorporación automática por recurrencia |
| KL Admin interno con 8 espacios y RBAC | Acceso de partners; publicación abierta del PDF |
| Producto 01: 12 capítulos, fichas para Precision y PDF ES/EN | Ediciones personalizadas por cliente; múltiples guías; integración con Operation Hub |

## 4. Arquitectura conceptual y dependencias

- **beeside knowledge base** = RAM de conocimiento (en Precision: capa de equivalencias + copia de solo lectura compilada desde KL) + Knowledge Layer (servidor "edge" gobernado). La memoria del proyecto (Project Frame) es de Precision y nunca baja a KL.
- **Tres flujos que no se mezclan:** conversación (RAM → consulta directa a KL → límite y demanda), recolección programada (solo fuentes autorizadas) y conocimiento (compilar, promover y retirar RAM por uso).
- **Física (T1):** módulo con esquema `kl` en el PostgreSQL existente (Drizzle + pg en el backend), consumido por API; separable después sin tocar Precision. Puerto `knowledge` en `ports/` de Precision con bandera apagada por defecto; con la bandera apagada Precision se comporta como hoy.
- **Precision:** consume RAM y `kl.v1`; alimenta `approvedSources` del verificador R10; entrega al cliente el enlace del PDF con control de acceso (D23).
- **KSeed:** corpus inicial que prepara Claude trabajando en Precision; entra por el canal de carga y pasa revisión.
- **Service Explorer:** fuente de claves de categoría y servicio; hoy, catálogo provisional (`backend/src/precision/manifest/data/category-labels.json`, `services-projection.json`).
- **Dependencia abierta:** especificación de la RAM en Precision (P7), siguiente entregable de Claude; Design de KL define el lado KL del contrato.

## 5. Flujos principales

**Recuperación en conversación**
1. Precision traduce la necesidad a dimensiones.
2. RAM vigente con el `id@versión` → responde sin llamadas.
3. Si no, consulta a KL → registro compacto (valor, unidad, periodo, fuente, vigencia, límites); evidencia solo si se pide cita.
4. Si KL no cubre → "no contamos con este dato, lo dejo señalado…", hallazgo para el Sherpa y señal de demanda.
5. Uso anónimo → el agente de conocimiento promueve o retira de la RAM; cambios de estado invalidan paquetes por manifiesto.

**Agente de recolección:** Monitor → Detect (código, sin IA) → Extract (API primero; IA solo en PDF con esquema fijo, sin red) → Validate → Normalize → Compare (clasificación: nuevo periodo, corrección, complemento, método, conflicto) → Publish (nivel 1) o Review → Version → Refresh.

**Carga manual:** fuente registrada → validación de archivo (firma, tipo, tamaño, sin macros ni contenido activo, antimalware, huella) → original inmutable → extracción con localizador → clasificación → control de calidad con informe → revisión por persona distinta → publicación → invalidación o retiro.

**Knowledge Products:** composición (editor) → controles automáticos → revisión (KL_REVIEWER) → validación especializada nivel 3 → aprobación ES → traducción y revisión bilingüe → aprobación EN → aprobación editorial de la edición → publicación conjunta → entrega por Precision → informe mensual de cambios → nueva edición solo con cambios aprobados → despublicar o revocar con rastro.

**KL Admin (8 espacios):** Overview · Source Registry · Agent Operations · Knowledge Repository · Knowledge Demand · Seed Management · Knowledge Products · Governance & Settings. Dentro de la administración existente (`frontend/src/admin`), no como aplicación aparte.

## 6. Seguridad, gobernanza y auditoría

- Separación estricta entre datos de proyectos y conocimiento global; KL sin endpoints de cara al cliente.
- RBAC: SUPERVISOR, KL_EDITOR, KL_REVIEWER (con permiso editorial para productos), SPECIALIST_VALIDATOR, ADMIN; cuentas de servicio `kl-agent` (publica solo nivel 1) y agente de conocimiento (solo selecciona contenido publicado). Quien sube o redacta nunca aprueba lo propio.
- Fuentes: la IA propone, solo el ADMIN autoriza; comerciales excluidas salvo excepción.
- Contenido externo y cargado = dato, nunca instrucción (defensa ante inyección); agente sin herramientas de red en la extracción.
- Licencias: uso permitido por fuente aplicado al publicar; clase B solo cita y paráfrasis.
- Auditoría completa: autor, aprobador, versión, validación, ejecuciones del agente (fuente, resultado, tokens, costo).
- Presupuestos y límites: por ejecución y mensuales, reintentos acotados, corte por bucle.
- Revocación propagada a RAM y productos; rollback por versión; historia intacta.
- Descargas del PDF contadas de forma anónima; KL no registra quién descarga.

## 7. Criterios de aceptación y benchmarks

- **Producto 01:** AC-01 a AC-14 (Product Specification §12).
- **KL MVP1:** métricas de v1.4 §13 (calidad diagnóstica, confiabilidad, recuperación, no-search, eficiencia de Seed, automatización, administración, resiliencia, no regresión).
- **Casos:** A01–A10 (v1.4, Anexo A), incluidos A05 (ICE 2026 con cambio metodológico), A06 y A10 (revocación), A08 (carga con contenido activo rechazada), A09 (primaria frente a IMCO).
- **Benchmark inicial disponible:** prueba ICE 2025 — 1,696/1,696 registros; A/B/C con 23 casos: documento 20, estructurado 21, híbrido 23; contexto mediano 5,505 / 339 / 392 caracteres. Mide recuperación, no calidad conversacional; tokens estimados (caracteres/4).
- **Pendiente de medir en Design:** línea base de Precision 2.0 sin KL y tokens con el tokenizador real; los umbrales numéricos se fijan con esa línea base.

## 8. Dependencias no bloqueantes

| Para Code | Para publicación |
|---|---|
| P5 Precision 2.0 integrada a `main` | P2 derechos de IMCO y DOF; licencias de Banxico e IMSS |
| P7 especificación de la RAM en Precision | P3 validadores por dominio (incluidos migración y datos personales) |
| Autorización del ADMIN para activar S04–S09 y el subconjunto ICE | P4 adopción del ICE 2026 (revisión metodológica) |
| Renderizador de PDF disponible en la plataforma (ver R1) | Autoridades vigentes verificadas (ATDT) y fuentes nuevas registradas (INM, tratados de SE, Secretaría Anticorrupción y Buen Gobierno) |
| P6 familias y categorías de salida (no bloquea Design) | Notas editoriales (privacidad, reforma aduanera) contrastadas con el DOF (D26) |
| O5 gobierno de equivalencias | Contenido redactado, validado y aprobado en ES y EN |

Ninguna dependencia autoriza publicar contenido no validado.

## 9. Riesgos para Design y recomendaciones técnicas

**R1 · PDF: reutilizar el sistema de reportes existente (recomendación de alineación).** El backend ya define un modelo de reporte independiente del renderizador, `backend/src/reports/report-model.ts` ("beeside Strategic Report System"), que exige que todo reporte nuevo sea un builder sobre el mismo `ReportDocument`, nunca un modelo paralelo. El mismo archivo documenta que no hay librería de PDF instalada y que el registro npm está bloqueado por la política de salida de la organización. Recomendación: el Producto 01 es un builder nuevo (`kind` de guía) sobre ese modelo; Design define solo las primitivas que falten (tabla de datos con cita por fila, bloque normativo con vigencia, marca de tipo de contenido) como extensiones del modelo compartido. Riesgo: el renderizador es una dependencia de plataforma compartida con Discovery y Precision; sin él, AC-10 y AC-13 no pueden probarse.

**R2 · Validadores externos y la identidad de administración.** T5 restringe la identidad a dominios de beeside; T19 permite especialistas externos. Recomendación para MVP1: la validación de un externo la registra un KL_REVIEWER con evidencia firmada adjunta (documento o correo con alcance y fecha), sin abrir KL Admin a identidades externas; si beeside prefiere acceso directo, cuentas de beeside asignadas. Design elige; no es decisión de producto.

**R3 · Entrega del PDF (D18 + D23).** KL publica la edición congelada y devuelve una referencia; Precision la entrega con enlace de acceso controlado y caducidad, en el idioma del cliente. Design define almacenamiento, firma del enlace y verificación de "edición vigente".

**R4 · Contrato contra una rama no integrada (P5).** Diseñar contra `a8f8f3e`; si Precision cambia antes de Code, se ajusta el contrato de integración, no la arquitectura.

**R5 · Presupuestos de RAM sin medición real.** Fijar los presupuestos por nivel con la línea base y el tokenizador real; no con la estimación caracteres/4.

**R6 · Extracción frágil de PDFs de intermediarios.** Cada edición de IMCO puede cambiar el formato; el control de completitud lo detecta. Design incluye la revisión de extracción en el flujo de Agent Operations.

**R7 · Cobertura parcial en temas sin fuente central** (permisos municipales, migración). El modelo y la UI deben expresar cobertura parcial y límite sin parecer error ni promesa.

**R8 · Vigencia de validaciones de nivel 3.** Revalidación a 12 meses como máximo o ante reforma del DOF; Design muestra vencimientos en Overview y en Knowledge Products.

Recomendaciones técnicas adicionales: recuperación por metadatos sin base vectorial en MVP1 (T2) mientras el volumen de fichas consultivas sea pequeño; prototipos HTML de KL Admin y del PDF con datos reales aprobados o marcadores evidentes, nunca cifras inventadas; pruebas de contrato y de paridad con bandera apagada desde el primer incremento de Code.

## 10. Entregables esperados de Design (macrobloque 2)

1. Contratos de integración: `kl.v1` con nombres de campos, puerto `knowledge` en Precision, `approvedSources`, referencias de catálogo, entrega del PDF.
2. Modelo de datos del esquema `kl` y máquinas de estado (pieza, carga, edición, fuente).
3. Prototipos HTML de KL Admin (8 espacios) y del PDF del Producto 01 con datos reales o marcadores evidentes.
4. Extensiones del modelo de reporte compartido para el Producto 01 (R1).
5. Plan de validación con casos A01–A10, AC-01–AC-14 y medición de la línea base.
6. Resolución de R2 y R3.

No iniciar Code hasta la aprobación de Design por el PO.
