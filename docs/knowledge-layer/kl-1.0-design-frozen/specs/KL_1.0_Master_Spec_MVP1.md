# beeside Knowledge Layer 1.0 — Master Product & Operating Specification | Workspace · MVP1

Versión de trabajo 1.4 · 16 octubre 2026 · Workspace cerrado; referencia vigente para Design

Estado: Workspace cerrado formalmente el 16-oct-2026. Arquitectura, Source Registry, ingestión y recuperación (prueba real sobre ICE 2025) y Producto 01 aprobados por el Product Owner. Sin bloqueantes para Design; los pendientes restantes son de Code o de publicación. Detalle técnico delegado a Claude dentro de las restricciones de este documento.

Documento canónico de reglas. El estado detallado de pendientes, el inventario de Precision 2.0 y el Source Registry de trabajo viven en *KL 1.0 · Workspace Consolidation & Readiness*.

# Control de cambios

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 14-oct-2026 | Primera definición de Workspace. |
| 1.1 | 14-oct-2026 | Nombre corregido a Knowledge Layer 1.0 (Precision 2.0 conserva el suyo). Resoluciones del PO sobre propiedad del conocimiento, Seed, modelo, fuentes y gobernanza por riesgo, ICE 2026, demanda, KL Admin y Producto 01. Decisiones D1–D8 cerradas. |
| 1.2 | 15-oct-2026 | Acuerdos sobre la lámina 3 de "beeside platforms 1.1": beeside knowledge base = Knowledge Seed + KL; Service Explorer redefinido como control maestro de servicios activos (aún no existe; catálogo provisional definido por el PO); equivalencias y conocimiento general de servicio en KL; clasificación de cambios sin sobrescritura; productos con aviso y aprobación; canal de carga del equipo beeside; agente de conocimiento con promoción por uso; dato desconocido a hallazgos para el Sherpa; preguntas sobre cómo opera beeside. Decisiones D9–D15. |
| 1.3 | 15-oct-2026 | Alineación con el handoff a Precision: KSeed = seed inicial que prepara Claude trabajando en Precision y se carga en KL (KL no arranca vacío); RAM de conocimiento (Precision) vs memoria del proyecto; equivalencias en la RAM de conocimiento (sustituye a D10); KL no es un sistema de cara al cliente; ningún dato del cliente o de la empresa entra a KL. Decisiones D16–D19. |
| 1.4 | 15-oct-2026 | Cierre del bloque Source Registry + Ingestión + Recuperación: arquitectura híbrida de consulta por tipo de contenido, regla primaria–intermediario, flujo de carga manual con validación de archivos y estados, casos de versionado y vigencia, CONAMER sustituida por ATDT, casos de validación A08–A10. Decisiones técnicas T9–T18, aprobadas por el PO el 15-oct-2026 con cinco precisiones (fuente primaria vs identidad del intermediario, publicación selectiva, separación de fechas, pendientes de publicación, benchmark ICE). Adenda del 16-oct-2026 (sin nueva versión): Producto 01 aprobado con ajustes (D20–D26), rol de validador especializado (T19) y cierre formal de Workspace. |

# Resumen ejecutivo

La **beeside knowledge base** tiene dos partes. La **RAM de conocimiento** vive en Precision 2.0: contenido reutilizable y persistente (la capa de equivalencias y el contexto compilado desde KL) que resuelve casi toda la conversación sin búsquedas; es distinta de la memoria del proyecto (Project Frame), que también es de Precision. **Knowledge Layer (KL)** es el servidor "edge" de conocimiento de beeside: la base gobernada del conocimiento consultivo global y reutilizable, que alimenta la RAM y responde lo que ella no tiene. **KSeed** es el seed inicial, preparado por Claude trabajando en Precision y cargado en KL antes de la conexión: KL no arranca vacío.

KL es una fuente de información para las plataformas de beeside, no un sistema de cara al cliente: no conversa, no diagnostica, no guarda contexto del cliente y no emite conclusiones profesionales. KL sabe del mundo; Precision sabe del cliente.

KL no es un Google empresarial ni investiga preguntas públicas en tiempo real. Da contexto local suficiente a Precision para interpretar Discovery, dialogar en lenguaje de negocios, detectar necesidades y servicios, profundizar lo necesario y producir un handoff útil hacia The Hive. Los objetivos son inseparables: PRECISIÓN y EFICIENCIA INTEGRAL.

MVP1: México como país inicial sobre diseño multipaís; KL Admin interno con roles y permisos; Source Registry; agente de recolección programada y agente de conocimiento; carga de datos del equipo beeside; capa de equivalencias en la RAM de conocimiento; demanda de conocimiento; integración con Precision 2.0 y con el catálogo de servicios; Producto 01 Doing Business beeside México como conocimiento consultable y PDF en español e inglés.

# 1. Propósito, límites y principios

## 1.1 Resultado esperado

- Comprender el proyecto y la conversación; producir mejores preguntas, categorías y servicios candidatos, no respuestas enciclopédicas.
- Conocer los hechos contextuales de México útiles para operar: regiones, infraestructura, actividad económica, servicios y procedimientos generales.
- Distinguir hechos, hipótesis diagnósticas, orientación general, criterio profesional y necesidad de estudio.
- Preparar solicitudes accionables para partners de The Hive sin reemplazar sus análisis especializados.
- Reutilizar información institucional aprobada para elevar calidad y reducir tokens, latencia, búsquedas y costos.

## 1.2 Restricciones no negociables

- Knowledge-first, no search-per-question: Precision no investiga en la web pública durante el diálogo. La investigación externa pertenece a los procesos gobernados de KL.
- Sin conocimiento vigente y aprobado: no inventar, no afirmar ni negar, continuar el diagnóstico, registrar demanda agregada y valorar su incorporación después.
- No realizar recomendaciones definitivas de inversiones, ubicaciones, cumplimiento, rutas o costos sin alcance y evidencia adecuados.
- No sustituir artificialmente estudios profesionales, y tampoco ocultar conocimiento general válido para provocar una venta. El límite depende de confiabilidad, complejidad, alcance y responsabilidad profesional.
- No usar información privada de un proyecto como hecho global. Ningún dato del cliente o de la empresa entra a KL: ni nombres, contactos, documentos, texto literal, cifras, empleados, decisiones, hechos del proyecto, project_id real, Project Frame, Category Requirement Packs, My Service Map ni transcripciones. Precision traduce localmente el contexto a dimensiones estructuradas.
- KL no es un sistema de cara al cliente.
- No exponer partners ni sus catálogos en fichas, taxonomías o experiencias del cliente.
- No crear una taxonomía de servicios paralela a Service Explorer ni repositorios paralelos de conocimiento consultivo.
- La precisión diagnóstica prevalece sobre el ahorro de tokens: ninguna optimización puede perder información crítica ni degradar la calidad consultiva.

## 1.3 Objetivos rectores

| Objetivo | Criterios |
|---|---|
| PRECISIÓN | Comprensión del proyecto y del contexto de First Assessment, calidad factual, pertinencia de preguntas, detección de necesidades explícitas e implícitas, cobertura correcta de categorías y servicios, handoff completo, reconocimiento de límites. |
| EFICIENCIA INTEGRAL | Tokens, llamadas y recuperaciones, latencia, reutilización de conocimiento validado, costo del agente y del mantenimiento, ausencia de duplicación, fluidez conversacional. |

# 2. Ecosistema y responsabilidades

Referencia: "beeside platforms 1.1". Front: Discovery → Understanding → Precision by Category → Operation Hub. Support: Knowledge Layer y Service Explorer. La lámina 3 separa con una línea punteada lo que vive en Precision (arriba: Understanding, Precision by Category y la RAM) de lo que es Knowledge Layer (abajo).

| Componente | Responsabilidad (autoridad) | Relación con KL |
|---|---|---|
| Knowledge Layer 1.0 | Conocimiento consultivo global validado por país, región, industria, dominio y categoría: fuentes y procedencia, evidencias, fichas, conocimiento general de servicios, versiones, vigencia, políticas de publicación y recuperación, productos derivados y demanda. | — |
| RAM de conocimiento | Contenido reutilizable y persistente en Precision: capa de equivalencias (dueña la RAM) y copia de solo lectura del contexto compilado desde KL. | El contexto compilado lo genera e invalida KL; KL puede aportar conocimiento que respalde o actualice las equivalencias. |
| KSeed (seed inicial) | Corpus inicial preparado por Claude trabajando en Precision. | Se carga en KL por el canal de carga y pasa a la base gobernada; queda como lote histórico. |
| Precision 2.0 | Interpretar proyecto y conversación; hechos del cliente; preguntas; hipótesis; Understanding y Precision by Category; categorías y necesidades; estado; hallazgos; resultados y handoff; conocimiento de cómo opera beeside (Process Knowledge pack). | Consume Seed y KL; aporta citas y eventos de demanda anónimos. |
| Service Explorer | Control maestro de los **servicios activos** con beeside: los proveedores administran ahí sus servicios, su alcance y sus requisitos; administra familias y categorías. Precision lo consulta para saber si un servicio existe y qué cubre. | KL referencia sus `service_id` y `category_key`; nunca guarda el alcance o requisitos de un proveedor como conocimiento general. |
| Discovery (First Assessment) | Registro original del cliente y Your Expansion View. | Sin relación directa; Precision traslada las señales. |
| The Hive / Sherpa | Servicios especializados; retoma los hallazgos de Precision; propone conocimiento operativo. | Propuestas sometidas a gobernanza, distinguiendo conocimiento general de específico de proveedor. |
| Operation Hub | Datos operativos de proyectos y entregables. Se relaciona con Service Explorer. | Sin integración en MVP1. |
| Knowledge Products | Productos editoriales sobre KL, sin base factual propia. | Parte de KL. |
| KL Admin | Administración interna de KL. | Parte de KL. |

## 2.1 Catálogo provisional mientras no exista Service Explorer

Service Explorer aún no existe. Mientras tanto, la referencia de servicios es el catálogo provisional que ya usan Discovery y Precision (17 categorías y 200 servicios, en estado provisional pendiente de aprobación de contenido). El PO define las familias y categorías de salida. Reglas:

- Las claves (`category_key`, `service_id`) son estables: Service Explorer las adoptará al existir, sin renombrarlas.
- KL referencia la versión de catálogo fijada en cada proyecto; no crea un catálogo propio.
- Las equivalencias de nombres de servicios viven en la RAM de conocimiento y apuntan a esas claves.

## 2.2 Convergencia con Precision 2.0

Precision 2.0 no tiene hoy repositorio de conocimiento país o sector: su verificador R10 bloquea afirmaciones legales o regulatorias por país sin fuente aprobada, y esa lista llega vacía. La convergencia es progresiva y aditiva:

- C0: el conocimiento país nuevo se escribe en KL, no en manifiestos ni prompts de Precision.
- C1: puerto de conocimiento en Precision (RAM, consulta a KL y fuentes aprobadas para R10) con bandera apagada; pruebas de contrato.
- C2: alineación de la regla del prompt con R10 y activación por país.
- C3: los campos de los manifiestos marcados para validación de contenido se enlazan a fichas KL validadas.

Permanecen en Precision: Process Knowledge pack, term registry, manifiestos de categoría y sus reglas, verificadores, voz y textos, hallazgos y todos los datos del proyecto. Con la bandera apagada Precision se comporta como hoy. Toda fase exige pruebas de regresión.

# 3. Arquitectura conceptual: beeside knowledge base

Tres flujos que no se mezclan:

1. **Conversación** (en vivo): Precision usa la RAM; si no basta, consulta KL con una búsqueda directa y filtrada, sin llamadas adicionales al modelo; si KL tampoco tiene el dato, reconoce el límite y lo registra. Ningún componente de la conversación accede a la web pública.
2. **Recolección** (programada): el agente de recolección sale a fuentes públicas solo de forma periódica y solo a fuentes autorizadas, que el PO indica o que el agente propone y el PO autoriza. Detecta, extrae, valida, normaliza, compara, publica o envía a revisión, versiona y refresca.
3. **Conocimiento** (fuera de la conversación): el agente de conocimiento compila la RAM desde KL, analiza el consumo y promueve o retira contenido de la RAM.

Además, el equipo beeside puede cargar datos por un canal formal que pasa por los mismos controles que el agente (§6.3).

## 3.1 RAM de conocimiento

- Jerarquía: RAM → KL → reconocer límite, hallazgo para el Sherpa y demanda.
- Niveles: núcleo (política de límites, esenciales del país, conocimiento de cómo opera beeside, capa de equivalencias del país destino y del país de origen del cliente, propiedad de la RAM), paquete de etapa (según país y estados, industria, etapa de Precision y servicios detectados) y recuperación puntual desde KL con cita `id@versión`.
- Solo se compila desde conocimiento publicado en KL; nada entra a la RAM sin pasar por KL.
- **Promoción por uso:** si un contenido de KL se consulta con frecuencia para un país, etapa o servicio, el agente de conocimiento lo sube al paquete correspondiente; si deja de usarse, lo retira. Siempre dentro del presupuesto de tokens y visible en Seed Management.
- Presupuestos de contexto configurables por nivel, definidos con línea base medida; nunca un megaprompt.
- Cada paquete lleva manifiesto de piezas y versiones; publicar, sustituir, retirar o revocar invalida los paquetes afectados.
- Observabilidad de aciertos, consultas, tokens, latencia, promociones y fallos sin almacenar texto del cliente.
- La especificación detallada de la RAM en Precision se elabora cuando Workspace de KL esté cerrado.

## 3.2 Knowledge Layer

- Fuente central de conocimiento validado y reutilizable, con procedencia y derecho de uso.
- Estados: borrador, en revisión, publicado, sustituido, vencido y retirado; marca "requiere revisión" cuando cambia una evidencia citada.
- Lectura selectiva por país, región, industria, servicio, categoría, vigencia, idioma y uso permitido.
- Arquitectura física: módulo con esquema propio en el PostgreSQL existente, consumido por API (decisión técnica delegada).
- Recuperación híbrida por tipo de contenido (T9): el dato estadístico es un registro estructurado (dimensiones, valor, unidad, periodo, fuente y localizador) que se consulta por dimensiones; lo normativo y lo consultivo son fichas versionadas; el documento original es evidencia localizada y nunca se lee en la conversación. Máximos, rankings y filtros se resuelven en KL, no en el modelo.
- Lo que Precision recibe es el registro compacto (`id@versión`, valor, unidad, periodo, fuente, vigencia y límites); la evidencia solo viaja cuando se pide la cita.
- KL es la única fuente de verdad del dato; la RAM guarda copias de solo lectura referenciadas por manifiesto.

# 4. Modelo de conocimiento

| Clase | Dónde vive | Entidad |
|---|---|---|
| Hechos e indicadores con fuente | KL | Evidencia |
| Conocimiento contextual y fichas empresariales | KL | Ficha (perfil país o región, ficha de contexto) |
| Conocimiento consultivo: preguntas, triggers y dependencias locales | KL | Ficha (guía de preguntas, trigger diagnóstico, condición local de servicio) |
| Conocimiento general de servicios: alcance típico, requisitos habituales, particularidades por país, independiente de proveedor | KL | Ficha (conocimiento general de servicio), referenciada a `service_id` |
| Equivalencias de conceptos y de nombres de servicios | RAM de conocimiento (Precision) | Capa de equivalencias; KL aporta conocimiento de respaldo |
| Reglas operativas y conocimiento de cómo opera beeside | Precision 2.0 | Manifiestos, decisiones críticas, verificadores, Process Knowledge pack |
| Servicios activos, alcance y requisitos por proveedor, familias y categorías | Service Explorer (catálogo provisional mientras no exista) | service_id, category_key |
| Productos editoriales | KL | Composición de producto |
| Demanda no cubierta | KL | Evento y grupo de demanda (anónimos) |
| Fuentes | KL | Fuente y publicación (Source Registry) |

**Equivalencia.** Un concepto canónico (p. ej. identificación fiscal de empresa) con su denominación por país (MX RFC, ES NIF, US EIN, CO NIT, PT NIF), sinónimos en español e inglés y, cuando aplique, el `service_id` relacionado. Las equivalencias de nombres de servicio ("constitución de sociedad" = "company incorporation" = "abrir una empresa") apuntan a la clave del catálogo. Viven en la RAM de conocimiento de Precision; su mecanismo de aprobación y versionado es la decisión abierta O5.

Atributos mínimos: ID, tipo, país y región, idioma e idioma maestro; categoría y servicios; fuente, publicación y localizador (página, tabla, hoja o celda); fuente original e intermediario; confianza del periodo (declarado, inferido, estimado); periodo del dato y fecha de publicación; ingestión, revisión y próxima revisión; vigencia; método, unidades, alcance y limitaciones; nivel de riesgo; uso permitido y exclusiones; marca de percepción; validación especializada; versiones, estado, auditoría y aprobador; trigger, profundidad, límite y handoff.

Separar dato original, interpretación estructurada y orientación de beeside. Nada se sobrescribe: todo cambio es una versión nueva ligada a la anterior. No se crea un motor de reglas universal.

# 5. Source Registry

## 5.1 Política de admisión

- Preferentes: autoridades y organismos públicos, institutos nacionales de estadística, reguladores, organismos multilaterales, institutos de investigación independientes, asociaciones y cámaras empresariales reconocidas, fuentes académicas e institucionales con metodología confiable.
- Comerciales (bancos, consultoras, empresas): excluidas por defecto. beeside puede autorizar excepciones por publicación específica o, justificadamente, por institución, delimitando alcance, jurisdicción, vigencia y uso permitido.
- La IA puede recomendar fuentes; no puede aprobarlas ni ampliar el universo autorizado.
- Fuentes de partners: internas y acotadas; nunca hechos neutrales de país.

## 5.2 Fuentes México

IMCO, INEGI y CCE/CEESP son las instituciones de partida; cada publicación se registra y autoriza con su alcance. Se incorporan fuentes primarias especializadas para sociedades, fiscalidad, trabajo, seguridad social, aduanas y comercio exterior (SAT, DOF, Secretaría de Economía, IMSS, INFONAVIT, STPS, CONASAMI, ANAM, Banxico, entre otras). La matriz funcional del conjunto inicial (S01–S10: IMCO ICE 2025, ICE 2026 e ICU 2026; INEGI DENUE, ENOE, PIBE e ITAEE; Banxico SIE y Reporte sobre las Economías Regionales; IMSS; ATDT) y el registro amplio con periodicidad, condiciones de uso y frecuencia de monitoreo están en el Source Registry de trabajo. Ninguna fuente nueva se activa sin aprobación.

CONAMER se extinguió con la LNETB (DOF 16-jul-2025); sus funciones de registro de regulaciones y trámites pasan a la ATDT (Registro Nacional de Regulaciones y Portal Ciudadano Único). La fuente queda bloqueada hasta verificar URL y cobertura, y lo que cite a CONAMER pasa a "requiere revisión".

**Regla primaria–intermediario (T10).** Un concepto tiene una sola clave. El dato vigente proviene de la fuente primaria; el valor de un intermediario (p. ej., IMCO) se guarda como vista derivada ligada a ella y solo responde preguntas de posición relativa, con nota metodológica. Diferencias del mismo periodo fuera de la tolerancia de redondeo son diferencias de método: se documentan y no se corrige ninguna. La publicación intermediaria conserva su identidad metodológica y sus resultados históricos: no se sobrescribe con la primaria ni se confunde con ella.

ICE 2025 (libro, boletas y anexo) permanece como histórico trazable. ICE 2026 (publicado el 21-sep-2026; 53 indicadores y 6 subíndices; un indicador sustituido, otro con método nuevo y serie recalculada retroactivamente; sin base de datos descargable) se evaluará como referencia vigente cuando sus documentos y cambios metodológicos estén verificados.

La incorporación exhaustiva de fuentes no bloquea Design; la publicación del contenido correspondiente sí requiere fuentes suficientes y validadas.

## 5.3 Filtros de contenido

- Indicadores de percepción u opinión excluidos por defecto de lo consumible y publicable, en especial los que puedan leerse como evaluación política o institucional.
- Se distinguen datos objetivos, resultados documentados de experiencias empresariales y preguntas de opinión.
- Los documentos originales no se alteran.
- Un índice compuesto que incluya variables excluidas nunca se presenta como recalculado sin ellas; lleva nota metodológica y se prefieren indicadores individuales objetivos cuando la limitación es relevante.
- Derechos de reutilización por fuente: el uso permitido se aplica al publicar.
- KL no calcula indicadores derivados (p. ej., per cápita) ni recalcula índices sin metodología aprobada (T18).
- Directorios de establecimientos (DENUE) solo en agregados; KL no guarda fichas de empresas (T14).
- De un índice se extraen todos los indicadores para control de calidad, pero solo se publica como consumible el subconjunto objetivo aprobado (T11).

## 5.4 Configuraciones administrables

Institución, publicación, jurisdicción, tema, URL oficial, patrón de nuevas ediciones, licencia, responsable; estado de aprobación, excepciones y vencimiento; nivel de riesgo; periodicidad esperada y frecuencia de verificación; ventana, presupuesto y política de reintentos; contenidos permitidos e indicadores excluidos; idiomas; uso permitido; validaciones y umbrales; historial de cambios.

# 6. Agentes, carga del equipo y gobernanza por riesgo

## 6.1 Agente de recolección

Trabaja fuera de las conversaciones, solo sobre fuentes autorizadas y con frecuencia programada: Monitor → Detect → Extract → Validate → Normalize → Compare → Publish / Review → Version → Refresh. Puede proponer fuentes nuevas; solo el PO (rol ADMIN) las autoriza. La frecuencia de búsqueda no implica actualización: sin nueva publicación válida no hay cambio. El contenido externo se trata como dato, nunca como instrucción.

## 6.2 Clasificación de cambios

Antes de aplicar algo, el agente clasifica el cambio:

| Tipo | Ejemplo | Tratamiento |
|---|---|---|
| Nuevo periodo | Sale un nuevo dato mensual de una serie | Se agrega; el anterior queda en la historia |
| Corrección del mismo dato | La fuente corrige una cifra publicada | Nueva versión ligada a la anterior |
| Complemento | Llega el desglose por estado de un dato nacional | Se suma como dato relacionado; no sustituye |
| Cambio de definición o método | Un índice cambia un indicador | Revisión humana |
| Conflicto entre fuentes | Dos fuentes difieren | Revisión humana |

El agente nunca borra ni sobrescribe. **Si no puede clasificar un cambio con certeza, lo envía a valoración humana.**

## 6.3 Carga de datos del equipo beeside

Canal formal para subir documentos o datos, también usado por el KSeed inicial. Subir no autoriza una fuente ni publica nada.

1. Carga (KL_EDITOR) con fuente registrada; sin fuente autorizada queda "en espera de fuente". Metadatos obligatorios: publicación, edición, fecha de publicación, procedencia y licencia declarada.
2. Validación del archivo antes de guardarlo: tipo real por firma; PDF, DOCX, XLSX o CSV; tamaño máximo configurable (inicial 50 MB); rechazo de archivos cifrados, con macros o con contenido activo; antimalware; límite de descompresión; huella para duplicados; las fórmulas se leen como valores, nunca se ejecutan.
3. Original inmutable con huella, autor y fecha.
4. Extracción con localizador; el contenido es dato, nunca instrucción.
5. Clasificación del contenido y del cambio (§6.2).
6. Control de calidad automático con informe: completitud, rangos, unidades, empates, nulos, coherencia valor–posición y cruce con la primaria y la edición previa.
7. Revisión por KL_REVIEWER distinto de quien subió; no edita valores (un valor erróneo se reextrae); nivel 3 con validación especializada.
8. Publicación con uso permitido y filtros; invalidación de la RAM afectada.
9. Retiro o revocación con historia conservada.

Estados de la carga: recibida, rechazada, en espera de fuente, extraída, en revisión, aprobada, publicada, sustituida y retirada. Solo la publicada es consumible. De un índice extraído completo, solo se habilitan para Precision los indicadores aprobados y permitidos por la política editorial.

## 6.4 Gobernanza por riesgo

| Nivel | Alcance | Gobernanza en el repositorio |
|---|---|---|
| 1 · Estadístico estable | Datos con estructura y metodología estables | Nuevo periodo y corrección se publican solos si superan todas las validaciones |
| 2 · Cambio o anomalía | Cambios metodológicos, conflictos, anomalías, licencias, complementos, nuevas interpretaciones | Revisión humana |
| 3 · Normativo | Obligaciones fiscales, legales, laborales o regulatorias | Controles reforzados y validación especializada antes de generar interpretaciones consultivas |

En los productos ningún cambio se aplica automáticamente (§11.1).

Se registran ejecuciones, resultados, versiones, costos y errores, con límites de presupuesto, volumen y reintentos. Frecuencias distintas y administrables sin código: periodicidad esperada de la publicación, frecuencia de verificación del agente, revisión de la ficha, vigencia del dato y periodicidad de cada producto.

## 6.5 Versionado y vigencia

| Caso | Tratamiento |
|---|---|
| Nueva edición con el mismo método | Nuevo periodo; el anterior queda como historia |
| Nueva edición con cambio de método (caso real: ICE 2026) | Revisión humana; la serie recalculada entra como serie nueva ligada, sin empalmar ediciones |
| Ruptura de serie (caso real: IMSS desde enero de 2026) | Marca en el periodo; comparar a través de ella lleva límite |
| Indicador o fuente discontinuados (caso real: CONAMER) | "Sin continuidad": solo historia con fecha; lo que lo cita pasa a "requiere revisión" |
| Corrección de la fuente o error de extracción propio | Versión nueva ligada, con su origen |
| Conflicto entre fuentes | Revisión humana; para el dato vigente prevalece la primaria |
| Fuente revocada | Registros retirados; invalidación inmediata de la RAM; productos marcados |

Fecha de publicación, periodo estadístico, vigencia y fecha de actualización en KL son campos distintos y nunca se infieren uno del otro. Un cambio de metodología o de cobertura de una serie exige evaluación antes de comparar periodos.

Es vigente la última versión publicada y no retirada del periodo más reciente; pasada la fecha esperada de la siguiente publicación, el dato se sirve como "último disponible" con cobertura parcial. Cada paquete de RAM lleva manifiesto de `id@versión`: si una pieza cambia de estado, el paquete se descarta y se recompila, y mientras tanto Precision consulta KL directamente.

## 6.6 Agente de conocimiento

Trabaja fuera de la conversación: compila e invalida la RAM, analiza consumo y demanda, promueve o retira contenido de la RAM según uso (§3.1) y prepara la información para las decisiones de demanda. No sale a la web ni crea conocimiento; solo selecciona contenido ya publicado.

# 7. Consultas y Knowledge Demand

## 7.1 Política de respuesta

| Condición | Respuesta |
|---|---|
| La RAM tiene el dato vigente | Responder con contexto validado y continuar el diagnóstico. |
| La RAM no basta y KL tiene ficha validada | Recuperar solo lo relevante (búsqueda directa, sin razonamiento adicional) y responder con límites. |
| KL tampoco lo tiene | No inventar, no afirmar ni negar, no buscar en Internet. Responder con naturalidad, por ejemplo: "No contamos con este dato, pero lo dejo señalado para la siguiente etapa" (si hay Sherpa asignado: "lo dejo señalado al Sherpa que te atenderá en la siguiente etapa"). Continuar el diagnóstico. |
| Necesidad de decisión especializada | Explicar el alcance y, cuando corresponda, identificar el servicio competente de The Hive, sin promoción artificial. |
| Pregunta sobre cómo opera beeside (qué sigue, qué es Operation Hub, cómo se llama el rol del asistente humano) | Responder desde el conocimiento de proceso de Precision, según el estado del proyecto. El nombre de la persona asignada es dato del proyecto, nunca de KL. |

## 7.2 Doble registro de lo que no se conoce

- **Hallazgo en Precision (privado del proyecto):** el dato o servicio pendiente queda en los hallazgos para que el Sherpa lo retome con el contexto del cliente.
- **Demanda en KL (anónima y agregada):** tema, país, región, categoría y servicio, sin datos del cliente.

Un servicio que no existe en el catálogo sigue el mismo camino: Precision lo deja pasar, lo registra en hallazgos y el Sherpa evalúa buscar e integrar un proveedor.

## 7.3 Decisión sobre la demanda

KL agrupa la demanda semánticamente. El administrador decide CREATE, ENRICH, PARTIAL, MAP, SPECIALIST ONLY o DEFER / REJECT según recurrencia, valor diagnóstico, confiabilidad de fuentes, estabilidad, costo de mantenimiento, riesgo de desactualización y riesgo de sustituir un estudio especializado. La recurrencia no autoriza incorporación automática. Al aprobar, se asocian fuente autorizada, frecuencia y validaciones. beeside no responde como buscador: lo que no está validado no se improvisa.

## 7.4 Caso de aceptación: ferrocarril Manzanillo–Guanajuato

Si la RAM y KL no contienen evidencia aprobada, Precision no afirma ni niega la conexión ni busca públicamente; continúa el diagnóstico logístico (tipo de carga, destino, requerimientos), registra el hallazgo para el Sherpa y la demanda "conectividad ferroviaria puerto–región". El administrador decide; si aprueba, asocia fuente oficial, frecuencia y validaciones.

# 8. Inteligencia consultiva e integración con First Assessment

First Assessment alimenta hipótesis: señales explícitas, implícitas, incertidumbres y profundidad requerida. Precision valida mediante diálogo, identifica familias y servicios canónicos, detecta prerrequisitos y prepara el handoff. KL aporta guías de preguntas, triggers, conocimiento local y límites; no decide contrataciones ni obligaciones particulares. No se convierten presunciones en servicios confirmados.

Ejemplo: importación marítima desde Asia. Precision reconoce los principales puertos relevantes y explica sus características generales con fichas validadas; recupera la ficha de Manzanillo si se pregunta por ella; no prescribe la mejor ruta, costos, tiempos o disponibilidad sin estudio, y cuando corresponde identifica un servicio especializado.

# 9. Integración con Service Explorer, The Hive y equivalencias

- Precision consulta el catálogo de servicios (Service Explorer, o el catálogo provisional mientras no exista) para saber si un servicio existe y qué alcance y requisitos declara su proveedor.
- KL complementa con conocimiento general del servicio por país mientras la información de proveedores sea limitada. Nunca convierte el alcance o requisitos de un proveedor en conocimiento general.
- Las equivalencias de conceptos y de nombres de servicios viven en la RAM de conocimiento de Precision, apuntando a las claves del catálogo; KL puede aportar conocimiento que las respalde o actualice.
- Servicio no registrado: Precision lo deja pasar y lo registra en hallazgos; el Sherpa evalúa buscar e integrar un proveedor. KL no publica servicios.
- Handoff: objetivo, alcance, país, necesidades, hechos confirmados, incertidumbres, restricciones, dependencias, preguntas pendientes y hallazgos.
- Conocimiento de partners o Sherpas: entra por propuesta y revisión; se diferencia el específico de proveedor del general.

# 10. KL Admin — MVP1

| Espacio | Capacidad |
|---|---|
| Overview | Estado, cobertura, fuentes, alertas, ejecuciones y consumo. |
| Source Registry | Alta, propuesta del agente, aprobación, suspensión, revocación, configuración, frecuencias y excepciones. |
| Agent Operations | Ejecuciones de ambos agentes, resultados, errores, reintentos, alertas, controles y cambios enviados a valoración humana. |
| Knowledge Repository | Fichas, evidencias, carga del equipo (incluido el seed inicial), revisiones, versiones, estados, retiro, comparación y validación. |
| Knowledge Demand | Grupos, recurrencia, decisiones e incorporación de fuentes. |
| Seed Management | Contenido activo de la RAM, promociones y retiros por uso, políticas de selección, presupuestos, versiones e invalidación. |
| Knowledge Products | Productos, secciones, idiomas, versiones, avisos de cambio, aprobación editorial, periodicidad, generación y distribución. |
| Governance & Settings | Roles, permisos, reglas, auditoría, umbrales, presupuestos, integraciones, enlaces y rutas configurables. |

Acceso exclusivo para personal interno autorizado de beeside, sobre la identidad de administración existente.

| Acción | Quién autoriza |
|---|---|
| Agregar o aprobar una fuente o una excepción comercial | ADMIN (el agente solo propone) |
| Carga de datos del equipo | KL_EDITOR sube; KL_REVIEWER aprueba (nunca la misma persona) |
| Nuevo periodo o corrección de nivel 1 | Automático si pasa controles |
| Complemento, cambio metodológico, conflicto o cambio no clasificable | KL_REVIEWER |
| Contenido normativo (nivel 3) | KL_REVIEWER con validación especializada del dominio |
| Propuestas de actualización de equivalencias para la RAM | KL_EDITOR propone; aprobación según la decisión abierta O5 |
| Decisión sobre demanda | KL_REVIEWER; ADMIN si implica fuente nueva o costo |
| Cambio en un producto | Revisor editorial (KL_REVIEWER con permiso editorial), siempre después del aviso |
| Validación de contenido de nivel 3 | SPECIALIST_VALIDATOR del dominio, distinto de quien redactó |
| Políticas, presupuestos y promoción automática de la RAM | ADMIN |

Roles: SUPERVISOR (lectura), KL_EDITOR, KL_REVIEWER, SPECIALIST_VALIDATOR (valida contenido de nivel 3 de su dominio y no tiene otros permisos; si el especialista es externo, Design define cómo se registra su validación sin abrir KL Admin a identidades ajenas a beeside; T19), ADMIN y cuentas de servicio de los agentes (el de recolección solo publica nivel 1; el de conocimiento solo selecciona contenido publicado para la RAM).

# 11. Knowledge Products y Producto 01

## 11.1 Política general

Un producto es una composición editorial versionada que referencia fichas, datos y fuentes de KL; no tiene base factual propia. **En los productos ningún cambio se aplica automáticamente:** cuando cambia un dato citado o el agente detecta un cambio relevante, lo notifica y beeside aprueba antes de aplicarlo. La periodicidad de revisión la define beeside por producto. Más adelante, beeside podrá marcar campos concretos de un producto como de actualización automática. Se conservan estructura, versiones, idiomas, fuentes, periodos, cambios, aprobaciones, historial de publicación y regeneración controlada.

## 11.2 Doing Business beeside México (MVP1)

| Dimensión | Definición |
|---|---|
| Modalidades | Fichas estructuradas consumibles por Precision + guía PDF compartible. |
| Idiomas | Español e inglés, coherentes y trazables. |
| Ámbito | México, sobre arquitectura replicable a otros países. |
| Propósito | Guía empresarial práctica sobre condiciones generales de establecimiento y operación; no enciclopedia. |
| Actualización | Periodicidad definida por beeside (propuesta inicial: mensual), sin forzar cambios cuando las fuentes no se han actualizado; todo cambio con aviso y aprobación. |
| Límite | No sustituye estudios ni asesoría legal, fiscal, logística o a la medida de The Hive. |
| Gestión | Secciones, fuentes, estado editorial, versiones, distribución y auditoría desde KL Admin. |

## 11.3 Requisitos funcionales mínimos

FR-01 composición que solo referencia `id@versión`; FR-02 una composición, dos modalidades; FR-03 ES/EN con idioma maestro e invalidación de variantes; FR-04 un cambio en datos citados genera aviso, nunca reescritura por IA; FR-05 revisión periódica configurable con informe de cambios; FR-06 PDF congelado con edición, fecha, fuentes y periodos; FR-07 uso permitido y filtros aplicados al publicar; FR-08 límites por capítulo y enlace a servicios del catálogo sin partners; FR-09 flujo editor → revisor con validación especializada de nivel 3; FR-10 publicar, despublicar, revocar y archivar; FR-11 plantilla por país.

## 11.4 Estructura aprobada (D20)

Doce capítulos por recorrido de expansión, precedidos de un resumen con la ruta típica; sustituyen el índice preliminar de 10 capítulos.

| Parte | Capítulos |
|---|---|
| — | 00 Resumen y ruta típica |
| I · Decidir | 01 México en breve · 02 Entorno de negocios y regiones · 03 Opciones de entrada |
| II · Establecer | 04 Constitución y registros · 05 Inmuebles, sitios e infraestructura · 06 Personas, nómina, seguridad social y movilidad |
| III · Operar | 07 Impuestos y contabilidad · 08 Comercio exterior, aduanas y logística · 09 Cumplimiento transversal |
| IV · Regiones | 10 Perfiles estatales |
| V · Siguiente paso | 11 Cómo apoya beeside tu expansión · 12 Fuentes, método y avisos |

Cada capítulo conserva su matriz de trazabilidad capítulo → contenido → pieza KL → fuente → validación, definida en la especificación de producto ("Doing Business beeside México · Product Specification", aprobada el 16-oct-2026).

## 11.5 Reglas aprobadas del Producto 01

- **Alcance MVP1 (D21).** Los 12 capítulos, incluido 09 Cumplimiento transversal. Sin validadores especializados a tiempo, un capítulo o sección se limita a orientación general respaldada por fuentes oficiales, sin interpretaciones jurídicas particulares. El contenido especializado no validado no se publica; no se presenta una sección incompleta como asesoría integral. La falta de validadores nunca autoriza publicar afirmaciones normativas de riesgo sin revisión.
- **Idioma (D22).** Español es el idioma maestro editorial y de validación. El inglés es una versión equivalente: no introduce afirmaciones nuevas. Aprobación y publicación conjunta ES/EN, mismas piezas `id@versión` y control de equivalencia terminológica.
- **Distribución (D23).** MVP1 con distribución controlada por beeside y acceso por enlace desde Precision con control de acceso. KL publica la edición congelada; quien la entrega al cliente es la plataforma de cara al cliente (D18). Sin publicación abierta hasta verificar derechos de reproducción, licencias y condiciones de reutilización; la distribución controlada no exime de comprobarlos.
- **Perfiles estatales (D24).** 32 fichas con indicadores objetivos, trazabilidad, periodos y metodología. Sin rankings propios, juicios generales de conveniencia ni recomendaciones automáticas de localización. Se permiten explicaciones empresariales descriptivas, fundamentadas y no evaluativas cuando estén validadas. Solo se comparan estados con indicadores, periodos y metodología equivalentes.
- **Servicios no catalogados (D25).** Una necesidad sin servicio en el catálogo (p. ej., migratoria) se conserva como hallazgo y posible necesidad de servicio, sin perderse ni bloquear el diagnóstico. Su resolución canónica corresponde a Service Explorer; KL no crea servicios.
- **Notas editoriales (D26).** Una nota editorial (p. ej., sobre privacidad o la reforma aduanera) se contrasta con el documento oficial vigente antes de convertirse en ficha consultable o publicable; nunca pasa automáticamente a conocimiento aprobado.
- **Composición.** PDF determinista desde contenido versionado y aprobado; ninguna cifra escrita a mano; control de consistencia entre Precision y la guía; 14 criterios de aceptación (AC-01 a AC-14) de la especificación de producto.

# 12. Seguridad, privacidad y gobernanza

- Separación de información privada de proyectos y conocimiento global; protección frente a contaminación entre clientes.
- Control de acceso por roles y acciones; trazabilidad de aprobaciones; versionado e historial.
- Agente restringido a fuentes configuradas; protección frente a contenido malicioso e instrucciones incrustadas; validación de documentos y extracción.
- Control de licencias y derechos de reproducción.
- Límites de costo, volumen, reintentos y almacenamiento; protección ante bucles.
- Rollback, despublicación y revocación propagada a Seed y productos.
- Controles en las integraciones con otras plataformas; compatibilidad con las políticas de privacidad del ecosistema.
- No se presupone habilitada ninguna política contractual, técnica o de privacidad pendiente.
- No afirmar actualidad sin fecha; no usar rankings como prescripciones de inversión.

# 13. Métricas y criterios de aceptación MVP1

| Dominio | Evidencia de aceptación |
|---|---|
| Calidad diagnóstica | Casos de prueba: servicios correctos, cobertura de categorías, preguntas pertinentes y handoff completo, comparados contra Precision 2.0 sin KL. |
| Confiabilidad | Toda cifra o afirmación factual publicable vinculada a fuente, periodo, versión y uso permitido. |
| Recuperación | Consultas estadísticas resueltas por registro estructurado, sin leer documentos en la conversación. Línea base de Workspace (ICE 2025, 23 preguntas): híbrido 23/23 con mediana de 392 caracteres de contexto frente a 5,505 al recuperar el documento. Es un benchmark inicial de recuperación, no una prueba de la calidad conversacional de Precision; el paquete de evidencia (23 casos, resultados, scripts y limitaciones) se conserva íntegro. |
| No-search-per-question | Un caso sin conocimiento registra demanda y continúa sin web pública. |
| Eficiencia de Seed | Tokens, tiempo y recuperación frente a línea base, sin degradación de calidad. |
| Automatización | Nueva edición detectada y actualizada si pasa controles; anomalía bloqueada y escalada. |
| Administración | Roles impiden acceso o publicación no autorizada; auditoría completa. |
| Producto 01 | Consulta estructurada en Precision y PDF ES/EN con fuentes y versión visible. |
| Resiliencia | Rollback, invalidación de Seed y fallo de fuente sin contaminar conocimiento; KL caído no bloquea Precision. |
| No regresión | Las suites de Precision 2.0 pasan sin cambios; con KL apagado su comportamiento es idéntico. |

Los umbrales numéricos se fijan con la línea base medida y se acuerdan antes del go-live.

# 14. Delimitación MVP1

| MVP1 comprometido | Fuera de alcance inicial (arquitectura preparada) |
|---|---|
| México; KL, Seed, Source Registry, actualización gobernada por riesgo, Knowledge Demand, KL Admin, integración con Precision 2.0 y Service Explorer, Producto 01 ES/EN. | Expansión multipaís operativa; múltiples guías; investigación personalizada desde Precision; reemplazo de estudios de especialistas; marketplace de datos; acceso Admin de partners; integración con Operation Hub. |

# 15. Metodología

Workspace → Design → Code → Verification & Testing → MVP1 Release. Claude recomienda e implementa soluciones técnicas por macrobloques; las decisiones que cambian materialmente producto, seguridad, arquitectura canónica o compromisos funcionales se presentan para aprobación.

Secuencia: Workspace · Doing Business México Product Specification → Design → Code R1 Núcleo → Code R2 Automatización y Admin → Code R3 Producto 01 → Verification & Testing → MVP1 Release.

# 16. Registro de decisiones

| ID | Decisión | Estado |
|---|---|---|
| DEC-01 | Actualizaciones rutinarias verificadas se publican automáticamente; excepciones a revisión. | Confirmada; precisada por D6 y D11 |
| DEC-02 | Administración interna beeside con roles y permisos, desde MVP1. | Confirmada |
| DEC-03 | Doing Business México: fichas para Precision + PDF compartible. | Confirmada |
| DEC-04 | Producto 01 en español e inglés. | Confirmada |
| DEC-05 | México en MVP1 sobre arquitectura multipaís. | Confirmada |
| D1 | KL es la autoridad del conocimiento consultivo global; convergencia progresiva con Precision 2.0. | Aprobada |
| D2 | Percepción excluida por defecto; compuestos nunca presentados como recalculados. | Aprobada |
| D3 | Idioma maestro del Producto 01. | Cerrada por D22 (español) |
| D4 | Demanda agregada y separada de los datos del cliente. | Aprobada |
| D5 | Fuentes primarias especializadas para dominios normativos, con validación especializada. | Aprobada |
| D6 | Gobernanza diferenciada en tres niveles de riesgo. | Aprobada |
| D7 | Orden de entrega del MVP1. | Delegada técnicamente |
| D8 | Nomenclatura: KL 1.0; Precision 2.0 se conserva. | Aprobada |
| D9 | Service Explorer = control maestro de servicios activos, con familias y categorías; aún no existe: catálogo provisional definido por el PO con claves estables. | Aprobada (15-oct) |
| D10 | Conocimiento general de servicio vive en KL. (La parte de equivalencias queda sustituida por D16.) | Aprobada (15-oct); modificada |
| D11 | Clasificación de cambios sin sobrescritura; ante duda, valoración humana. Productos: aviso y aprobación; periodicidad por producto. | Aprobada (15-oct) |
| D12 | Dato o servicio desconocido: hallazgo en Precision para el Sherpa + demanda anónima en KL; nunca búsqueda pública en la conversación. | Aprobada (15-oct) |
| D13 | Agente de conocimiento: compila la RAM y promueve o retira contenido por uso; la consulta a KL en la conversación es una búsqueda directa. | Aprobada (15-oct) |
| D14 | Canal formal de carga de datos del equipo beeside con los mismos controles que el agente. | Aprobada (15-oct) |
| D16 | Equivalencias, aliases y sinónimos viven en la RAM de conocimiento de Precision; KL aporta conocimiento de respaldo. | Aprobada (15-oct) |
| D17 | KSeed = seed inicial preparado por Claude trabajando en Precision, cargado en KL antes de la conexión; KL no arranca vacío. | Aprobada (15-oct) |
| D18 | KL no es un sistema de cara al cliente. | Aprobada (15-oct) |
| D19 | Ningún dato del cliente o de la empresa entra a KL; solo dimensiones estructuradas. | Aprobada (15-oct) |
| O5 | Aprobación y versionado de cambios a la capa de equivalencias (recomendación: Precision con las mismas reglas que KL). | Abierta, no bloquea la conexión |
| T9–T18 | Decisiones técnicas del bloque Source Registry + Ingestión + Recuperación: arquitectura híbrida, regla primaria–intermediario, publicación selectiva, periodo con marca de confianza, tolerancia de redondeo, DENUE agregado, FIX fuera de la RAM, validación de cargas, configuración inicial de Admin y prohibición de indicadores derivados sin metodología. Detalle en Workspace. | Aprobadas por el PO (15-oct), con precisiones |
| D20 | Producto 01: 12 capítulos por recorrido de expansión, con matriz de trazabilidad; sustituye el índice preliminar. | Aprobada (16-oct) |
| D21 | Alcance MVP1 con los 12 capítulos; sin validadores, solo orientación general con fuentes oficiales y nada especializado sin validar. | Aprobada con ajuste (16-oct) |
| D22 | Español idioma maestro editorial y de validación; inglés equivalente sin afirmaciones nuevas; publicación conjunta. | Aprobada (16-oct); cierra P1 |
| D23 | Distribución controlada y enlace desde Precision con control de acceso; sin publicación abierta hasta verificar derechos. | Aprobada (16-oct) |
| D24 | 32 perfiles estatales objetivos, sin rankings propios ni recomendaciones de localización; descripciones validadas no evaluativas. | Aprobada con ajuste (16-oct) |
| D25 | Necesidades sin servicio catalogado: hallazgo y posible necesidad; resolución canónica en Service Explorer; no bloquea Design. | Aprobada (16-oct) |
| D26 | Una nota editorial no se convierte en conocimiento aprobado sin contraste con el documento oficial vigente. | Aprobada (16-oct) |
| T19 | Rol SPECIALIST_VALIDATOR por dominio para el nivel 3; revisor editorial = KL_REVIEWER con permiso editorial. | Técnica (16-oct) |
| D15 | Preguntas sobre cómo opera beeside: Process Knowledge pack de Precision en MVP1; dominio "beeside" en KL si otras plataformas lo necesitan. | Recomendada; se confirma en la especificación de la RAM |

Workspace cerrado el 16-oct-2026. Pendientes que no bloquean Design (de Code o de publicación; ninguno autoriza publicar contenido no validado): derechos de reutilización de IMCO y DOF antes de publicar o distribuir el PDF; condiciones de uso de Banxico (uso comercial) e IMSS (datos abiertos); verificación de autoridades oficiales vigentes (p. ej., ATDT); autorización de fuentes por el ADMIN; designación de validadores especializados; verificación e ingestión del ICE 2026; integración de Precision 2.0 a la rama principal antes de Code de integración; familias y categorías de salida del catálogo provisional y servicios no catalogados (PO / Service Explorer; no bloquea Design); contraste con el DOF de las notas sobre privacidad y reforma aduanera; especificación de la RAM en Precision, al cerrar Workspace de KL.

# Anexo A. Casos de validación

A01 Portugal → México: sociedad por definir, 20 empleados directos y 40 por tercero, operaciones intercompany, venta de equipo. A02 Importación marítima Asia → México con ficha de Manzanillo. A03 Sin ficha ferroviaria Manzanillo–Guanajuato. A04 Fuente comercial bancaria: rechazada por defecto; aprobación de estudio específico. A05 Nueva edición ICE con cambio metodológico: detectar, bloquear actualización automática y escalar (caso real: ICE 2026). A06 Revocación de ficha: invalidar Seed y referencias publicables; preservar historia. A07 Export PDF Doing Business ES/EN con citas y fechas coherentes. A08 Carga manual de un XLSM o PDF con contenido activo: rechazada antes de guardarse. A09 Mismo concepto en IMCO y en ENOE: Precision recibe la primaria; IMCO solo para posición relativa. A10 Revocación de una fuente: registros retirados, RAM invalidada en el acto y respuesta not_available sin contaminar la historia.

# Anexo B. Fuentes documentales

- beeside platforms 1.1 (plataformas Front y Support; lámina 3: beeside knowledge base).
- ICE 2025: libro, boletas estatales y anexo metodológico (IMCO). ICE 2026: presentación en el proyecto; libro, boletas y anexo disponibles en imco.org.mx.
- Acuerdos funcionales de Precision 2.0, Service Explorer y Knowledge Layer establecidos en este Workspace.
- Código de Precision 2.0, rama feature/precision-v2-f5 (inspección de solo lectura, 14-oct-2026), incluido el catálogo provisional de 17 categorías y 200 servicios.
- KL 1.0 · Workspace Consolidation & Readiness (estado, inventario, Source Registry de trabajo y prueba de ingestión y recuperación sobre ICE 2025, reproducible en `KnowledgeLayer/pruebas/ice2025`).

Nota: publicaciones, fechas y permisos de fuentes se verifican antes de la ingestión productiva; este documento establece política y requisitos, no certifica la vigencia de cada cifra.
