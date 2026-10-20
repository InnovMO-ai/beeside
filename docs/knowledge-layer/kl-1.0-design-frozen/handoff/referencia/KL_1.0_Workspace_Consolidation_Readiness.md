# KL 1.0 · Workspace Consolidation & Readiness

Snapshot del 16-oct-2026 · canónico: https://claude.ai/code/artifact/f95a2dd1-f13e-4df4-aac3-37bad4e272a1

## 1. Readiness Verdict

**Veredicto integral: Workspace de KL cerrado formalmente el 16-oct-2026. Design puede iniciar en un ambiente independiente con el Design Handoff Pack.** Ninguna requiere más Workspace: lo demás está especificado en la especificación v1.4, el handoff a Precision y la especificación de producto (Doing Business beeside México · Product Specification).

| Momento | Elemento | Estado |
| --- | --- | --- |
| Requisito de Design | Arquitectura, modelo, RAM y KSeed, contrato kl.v1, gobernanza, KL Admin y RBAC | Cerrado (v1.4 y handoff) |
| Requisito de Design | Source Registry, ingestión y recuperación (T9–T18) | Cerrado y aprobado por el PO |
| Requisito de Design | Producto 01: estructura, alcance MVP1, idioma maestro (P1), distribución y perfiles estatales | Aprobado por el PO el 16-oct (D20–D26) |
| Requisito de Design de integración | Familias y categorías de salida del catálogo (P6); servicios no catalogados como migración (D25: hallazgos; resolución en Service Explorer) | PO; no bloquea Design |
| Pendiente de Code | Precision 2.0 integrada a `main` (P5) | Equipo Precision |
| Pendiente de Code | Especificación de la RAM en Precision (P7) | Siguiente entregable de Claude |
| Pendiente de Code | Tokens medidos con el tokenizador real y línea base de Precision sin KL | Design |
| Pendiente de Code | Autorización del ADMIN para activar S04–S09 y el subconjunto ICE | PO |
| Pendiente de Code | Gobierno de cambios a equivalencias (O5) | No bloquea la conexión |
| Condición de publicación | Derechos de IMCO y DOF; licencias de Banxico e IMSS (P2) | PO / legal |
| Condición de publicación | Validadores por dominio, incluidos migración y datos personales (P3) | PO / operaciones |
| Condición de publicación | Autoridades vigentes verificadas (ATDT) y fuentes nuevas registradas: INM, tratados comerciales de SE, Secretaría Anticorrupción y Buen Gobierno | Proceso de KL |
| Condición de publicación | Adopción del ICE 2026 (P4) | Revisión humana |
| Condición de publicación | Contenido redactado, validado y aprobado en ES y EN; ninguna cifra sin registro | Flujo editorial |

Design trabajará sobre los contratos de Precision 2.0 tal como están en esa rama (commit `a8f8f3e`, 13-oct). Si cambian antes de Code, se ajusta el contrato de integración, no la arquitectura.

## 2. Decision Register

Todas las decisiones de producto están cerradas; la última, D3 (idioma maestro), se cerró el 16-oct con D22.

**Decisiones de Product Owner**

| ID | Decisión | Estado | Resolución aplicada |
| --- | --- | --- | --- |
| D1 | Propiedad del conocimiento consultivo global | Aprobada (res. 1) | KL es la autoridad; Precision 2.0 conserva conversación, hechos del proyecto, hipótesis, estados, diagnóstico y handoff; Service Explorer, el catálogo. Convergencia progresiva, sin migración destructiva. |
| D2 | Índices compuestos con variables de percepción | Aprobada (res. 5) | Percepción excluida por defecto. Un compuesto nunca se presenta como recalculado; si incluye percepción, lleva nota metodológica y se prefieren indicadores individuales objetivos. |
| D3 | Idioma maestro del Producto 01 | Cerrada por D22 (16-oct): español | El modelo soporta cualquier idioma maestro por pieza (`source_locale`). No bloquea arquitectura ni Design de KL. |
| D4 | Vínculo entre demanda y proyecto | Aprobada (res. 6 y 9) | Demanda agregada y separada de los datos del cliente. La implementación es delegada (T6). |
| D5 | Fuentes para sociedades, fiscal, laboral y aduanas | Aprobada (res. 4 y 5) | Se incorporan fuentes primarias especializadas. Contenido normativo con controles reforzados y validación especializada. Matriz en la pestaña Source Registry. |
| D6 | Alcance de la publicación automática | Aprobada (res. 4) | Gobernanza en tres niveles de riesgo (sección 7). |
| D7 | Orden de entrega del MVP1 | Delegada técnicamente | Plan en la sección 10. |
| D8 | Nomenclatura | Aprobada | KL 1.0; Precision 2.0 se conserva; ningún otro componente se renombra. |

**Acuerdos del 15-oct (lámina 3 de "beeside platforms 1.1"), incorporados en la especificación v1.2**

| ID | Decisión | Estado |
| --- | --- | --- |
| D9 | Service Explorer = control maestro de servicios activos, con familias y categorías. No existe aún: catálogo provisional definido por el PO, con claves estables | Aprobada |
| D10 | Conocimiento general de servicio vive en KL; las equivalencias pasan a la RAM de conocimiento de Precision (D16, especificación v1.3) | Aprobada |
| D11 | Clasificación de cambios sin sobrescritura; ante duda, valoración humana. Productos: aviso y aprobación, periodicidad por producto | Aprobada |
| D12 | Dato o servicio desconocido: hallazgo en Precision para el Sherpa + demanda anónima en KL | Aprobada |
| D13 | Agente de conocimiento: compila la RAM y promueve o retira contenido por uso; la consulta a KL en la conversación es una búsqueda directa | Aprobada |
| D14 | Canal formal de carga de datos del equipo beeside, con los mismos controles que el agente | Aprobada |
| D15 | Preguntas sobre cómo opera beeside: Process Knowledge pack de Precision en MVP1 | Recomendada; se confirma en la especificación de la RAM |

**Decisiones técnicas delegadas** (justificación en las secciones indicadas)

| ID | Decisión | Justificación | Reversible |
| --- | --- | --- | --- |
| T1 | KL como módulo de servicio propio con esquema `kl` en el PostgreSQL existente; Precision lo consume solo por API | Reusa la arquitectura aprobada de FA y Precision; separable después sin tocar Precision (s. 3) | Sí |
| T2 | Recuperación filtrada por metadatos primero, ordenación dentro del filtro; búsqueda vectorial solo si la medición lo justifica | El contexto de FA ya trae país, servicios y estados (s. 4) | Sí |
| T3 | Seed en tres niveles con manifiesto y hash | Evita megaprompt e invalida con certeza (s. 4) | Sí |
| T4 | Agente como pipeline determinista; IA solo para extraer, sin herramientas de red | Defensa contra inyección y contra ampliar fuentes en silencio (s. 7) | Sí |
| T5 | RBAC sobre la identidad de administración existente (OIDC + tabla de permisos) | Ya existe en el backend; no se crea otro sistema de usuarios (s. 7) | Sí |
| T6 | Demanda sin `project_id` en la tabla global; agrupación semántica fuera de línea | Separación de datos de clientes (s. 5) | Sí |
| T7 | Punto de integración con Precision: `approvedSources` del verificador R10 + un puerto `knowledge` en `ports/` | Usa los mecanismos que Precision ya tiene (s. 6) | Sí |
| T8 | En código, Knowledge Seed se nombra `knowledge_seed` | El repositorio ya usa `seed` para datos demo y para el catálogo de FA | Sí |
| T9 | Arquitectura híbrida: registro estructurado como fuente de verdad estadística; ficha versionada para normativo y consultivo; documento como evidencia | Prueba A/B/C: 23 de 23 aciertos con 7 veces menos contexto que leer el PDF | Sí |
| T10 | Regla primaria–intermediario: una clave por concepto; el valor de IMCO es vista derivada | Evita dos datos vigentes para lo mismo; la primaria tiene periodos más recientes | Sí |
| T11 | De ICE se extrae todo para control de calidad y se publica solo el subconjunto objetivo aprobado | El control cruzado necesita la tabla completa; lo consumible se limita a lo útil | Sí |
| T12 | Periodo inferido del anexo con marca de confianza; estimados marcados | La boleta no muestra periodo | Sí |
| T13 | Tolerancia de redondeo entre documentos; se conserva la cifra más precisa | Libro y boletas difieren solo en decimales | Sí |
| T14 | DENUE solo en agregados; KL no guarda fichas de empresas | No exponer empresas ni confundirlas con proveedores | Sí |
| T15 | FIX y tasa objetivo fuera de la RAM; consulta puntual con fecha | Vigencia de un día o de una decisión | Sí |
| T16 | Validación de archivos y estados de carga; el revisor no edita valores | Subir no es publicar; un valor erróneo se reextrae | Sí |
| T17 | Configuración inicial de KL Admin (pestaña Source Registry México) | Valores de arranque administrables sin código | Sí |
| T18 | KL no calcula indicadores derivados sin metodología aprobada | Un cálculo propio sería un dato sin fuente | Sí |

**Decisiones del Producto 01 y cierre (16-oct-2026)**

| ID | Decisión | Estado |
| --- | --- | --- |
| D20 | 12 capítulos por recorrido de expansión con matriz de trazabilidad; sustituye el índice preliminar | Aprobada |
| D21 | Los 12 capítulos en MVP1; sin validadores, solo orientación general con fuentes oficiales; nada especializado sin validar | Aprobada con ajuste |
| D22 | Español maestro editorial y de validación; inglés equivalente; publicación conjunta (cierra P1) | Aprobada |
| D23 | Distribución controlada y enlace desde Precision con control de acceso; sin publicación abierta hasta verificar derechos | Aprobada |
| D24 | 32 perfiles estatales objetivos, sin rankings propios ni recomendaciones de localización | Aprobada con ajuste |
| D25 | Necesidades sin servicio catalogado: hallazgo; resolución en Service Explorer; no bloquea Design | Aprobada |
| D26 | Nota editorial no pasa a conocimiento aprobado sin contraste con documento oficial vigente | Aprobada |
| T19 | Rol SPECIALIST\_VALIDATOR por dominio; revisor editorial = KL\_REVIEWER con permiso editorial | Técnica |

**Pendientes reales** (ninguno bloquea Design)

| ID | Pendiente | Dueño | Necesario antes de |
| --- | --- | --- | --- |
| P1 | Idioma maestro y flujo de traducción (ex D3). Cerrado el 16-oct por D22: español | PO, en la especificación Doing Business México | Design del Producto 01 |
| P2 | Derechos de reutilización: IMCO declara todos los derechos reservados; el DOF exige consentimiento escrito de SEGOB para reproducción con fines de lucro | PO / legal | Publicar el PDF |
| P3 | Validadores especialistas por dominio normativo (fiscal, laboral, aduanas, societario) | PO / operaciones | Publicar contenido de nivel 3 |
| P4 | Adopción del ICE 2026 como edición vigente | Proceso de KL (revisión humana por cambio metodológico) | Publicar contenido ICE |
| P5 | Integración a `main` de Precision 2.0 | Equipo Precision | Code de integración |
| P6 | Familias y categorías de salida del catálogo provisional (hoy 17 categorías y 200 servicios en estado provisional) | PO | Design de integración con el catálogo |
| P7 | Especificación de la RAM (Knowledge Seed) en Precision | Claude, al cerrar Workspace de KL | Code de integración |

Para P2 recomiendo por defecto **citar, parafrasear y enlazar**, y reproducir cifras solo de fuentes con licencia abierta (INEGI, Libre Uso MX, Banco Mundial CC BY). Así no hace falta decidir nada antes de Design.

## 3. Arquitectura conceptual consolidada

Dos flujos que no se cruzan en tiempo real: la conversación solo lee conocimiento publicado; solo el pipeline gobernado o un revisor escriben en KL. Ningún componente de la conversación accede a la web pública.

&#91;embedded content: arquitectura KL 1.0 · dos flujos separados\]

Precision recibe un paquete Seed y consulta KL solo cuando el paquete no alcanza. Lo que no encuentra se registra como demanda.

| Plataforma | Responsabilidad (autoridad) | Relación con KL | Lo que nunca hace |
| --- | --- | --- | --- |
| Knowledge Layer 1.0 | Conocimiento consultivo global validado: fuentes, procedencia, evidencias, fichas, versiones, vigencia, políticas de publicación y recuperación, productos derivados, demanda | — | Guardar hechos de un proyecto; crear catálogo de servicios; razonar el diagnóstico |
| Knowledge Seed | Proyección compacta y contextual de KL para Precision | Compilada e invalidada por KL | Ser fuente de verdad o editarse fuera de KL |
| Precision 2.0 | Conversación, interpretación, hechos del proyecto, hipótesis, estados, Understanding y Precision by Category, diagnóstico y handoff | Consume Seed y `kl.lookup`; aporta citas y eventos de demanda | Investigar en la web; promover hechos privados a KL |
| Service Explorer | Control maestro de servicios activos (los proveedores administran alcance y requisitos), familias y categorías. Aún no existe: rige el catálogo provisional (17 categorías, 200 servicios) con claves estables | KL referencia sus claves; equivalencias y conocimiento general del servicio viven en KL; un servicio no registrado va a hallazgos de Precision para el Sherpa | — |
| First Assessment / Discovery | Registro original del cliente y Your Expansion View | Ninguna directa: Precision pasa las señales al pedir el paquete Seed | — |
| The Hive / Sherpa | Servicios especializados; propuestas de conocimiento operativo | Propuestas a la cola de revisión de KL, marcadas como generales o específicas de proveedor | Exponer partners en fichas o experiencias del cliente |
| Operation Hub | Datos operativos de proyectos y entregables | Ninguna en MVP1 | — |
| KL Admin | Gestión interna de KL | Parte de KL | Acceso fuera del personal interno de beeside |

La tecnología física no se congela aquí. La recomendación de base (T1) es un módulo con esquema propio en el PostgreSQL existente, consumido por API.

## 4. Knowledge Seed y recuperación

Seed es un paquete pequeño que se recompone según la etapa y el contexto del proyecto. La jerarquía aprobada se aplica tal cual: Seed → KL → reconocer límite y registrar demanda.

**Niveles**

| Nivel | Contenido | Selección | Cuándo cambia |
| --- | --- | --- | --- |
| Núcleo | Política de límites, criterio de cuándo derivar a especialista, esenciales del país destino | Por país | Solo al publicar una versión nueva del núcleo |
| Paquete de etapa | Fichas resumidas y guías de preguntas relevantes | País y estados + industria + etapa (Understanding o Precision by Category) + servicios del My Service Map o de la categoría en curso | Al iniciar o reanudar sesión, al cambiar de etapa o categoría, o al confirmarse un servicio nuevo |
| Recuperación puntual | Ficha o evidencia completa con cita `id@versión` | Bajo demanda, filtrada por los mismos ejes | Cada consulta |

**Recuperación proporcional.** Precision consulta KL solo cuando hay una necesidad diagnóstica: el cliente pide un hecho del país, el paquete no cubre un servicio detectado, o una respuesta haría una afirmación que el verificador R10 exige respaldar. Si la duda es de proceso de beeside, responde el Process Knowledge pack de Precision, no KL.

**Presupuestos.** Cada nivel tiene un tope de tokens configurable en KL Admin. Los valores iniciales salen de la línea base (sección 9), no de supuestos. Si el tope obliga a recortar, se recortan primero resúmenes de menor relevancia, nunca la política de límites ni las fichas de los servicios activos.

**Actualización e invalidación.**

- Cada paquete lleva un manifiesto (`id@versión` de cada pieza) y un hash.
- Publicar, sustituir, retirar o revocar una pieza marca obsoletos los paquetes que la incluyen.
- Precision compara el hash al empezar cada turno y recarga si cambió. Una pieza revocada deja de servirse en el turno siguiente.
- Precision guarda las citas `id@versión` en su registro interno. Así se pueden listar handoffs, Category Requirement Packs y PDFs afectados por una revocación.

**Observabilidad** (sin guardar texto del cliente)

- Tokens por nivel y por turno.
- Aciertos de Seed, consultas a KL, respuestas "sin conocimiento".
- Bloqueos del verificador R10.
- Latencia añadida por `kl.lookup`.
- Paquetes obsoletos servidos (debe ser cero).

## 5. Modelo de conocimiento

Cinco entidades en KL bastan para MVP1. Las reglas operativas y el catálogo quedan donde está su autoridad, referenciados por ID: no hay motor de reglas universal ni taxonomía paralela.

| Clase de la res. 3 | Dónde vive | Entidad o mecanismo |
| --- | --- | --- |
| Hechos e indicadores con fuente | KL | **Evidencia**: valor, unidad, indicador, periodo del dato, geografía, localizador en la fuente, marca de percepción, versión. Sin idioma. |
| Conocimiento contextual y fichas | KL | **Ficha** con `kind`: perfil país o región, ficha de contexto (p. ej. puerto de Manzanillo) |
| Conocimiento consultivo: preguntas, triggers, dependencias locales | KL | **Ficha** con `kind`: guía de preguntas, trigger diagnóstico, condición local de servicio |
| Reglas operativas | Precision 2.0 | Manifiestos de categoría, decisiones críticas, verificadores, Process Knowledge pack. Pueden citar una ficha KL por ID. |
| Referencias canónicas de servicios | Service Explorer | `service_id` y `category_key`; KL solo los referencia |
| Productos editoriales | KL | **Composición de producto**: secciones que referencian fichas y evidencias con versión fijada |
| Demanda no cubierta | KL | **Evento de demanda** y **grupo** con decisión CREATE, ENRICH, PARTIAL, MAP, SPECIALIST ONLY o DEFER/REJECT |

La quinta entidad es **Fuente y publicación** (el Source Registry). Transversales: historial de versiones con aprobador y manifiesto de paquete Seed.

**Campos que hacen cumplir las resoluciones**

- `risk_tier` (1, 2 o 3) en la publicación y en la ficha. Decide qué se puede auto-publicar (sección 7).
- `specialist_validation` en fichas de nivel 3: quién validó y cuándo. Sin ella, la ficha no se sirve a Precision.
- `permitted_use` (Precision, interno, publicable) heredado de la fuente. Bloquea reproducir contenido sin derechos.
- `source_locale` y variantes por idioma en fichas y composiciones. Las cifras no se traducen.
- `perception` en evidencias. Por defecto las excluye de lo consumible y publicable; un compuesto que las contiene se marca, nunca se recalcula.

**Estados.** Borrador, en revisión, publicada, sustituida, vencida y retirada. Una marca adicional, *requiere revisión*, se enciende cuando cambia una evidencia citada: la ficha sigue sirviendo su versión fechada hasta que un revisor la actualice. Una cifra nueva nunca reescribe un texto interpretativo.

## 6. Convergencia Precision → KL

No hay nada que migrar: Precision 2.0 no tiene hoy un repositorio de conocimiento país o sector, así que la convergencia es aditiva. Se conecta KL en los puntos de extensión que Precision ya tiene y no se reconstruye ningún componente.

Inspección en solo lectura de la rama `feature/precision-v2-f5` (commit `a8f8f3e`, 13-oct). No se modificó nada.

**Inventario**

| Activo en Precision | Qué es | Clase | Autoridad | Acción |
| --- | --- | --- | --- | --- |
| Process Knowledge pack (`pk-2026-10-12.1`) | Hechos atómicos sobre el proceso de beeside (Precision Center, My Service Map, CRP, Operation Hub) con `sourceRef`, estado y ES/EN | Regla de producto y operación | Precision | Se queda. Las fichas de KL copian su patrón (hecho + fuente + estado). |
| Term registry | Nombres canónicos y acrónimos permitidos | Regla de producto | Precision | Se queda |
| Manifiestos de categoría v2 (8 categorías, estado `DRAFT-SIN-VALIDAR`) | Campos, decisiones críticas y reglas de visibilidad del Category Requirement Pack | Regla operativa | Precision | Se queda |
| `country_overlays` de los manifiestos (MX, US, DE, SG) | Campos que se activan por país (p. ej. IMMEX, PROSEC, padrón de importadores), varios marcados `CONTENT_VALIDATION_REQUIRED` | Regla operativa con conocimiento país implícito | Precision la regla; KL la explicación y la validación | Referencia opcional a una ficha KL; la marca se levanta cuando la ficha está validada |
| Verificador R10 (`country-claims`) y `approvedSources` | Bloquea afirmaciones legales o regulatorias por país sin fuente aprobada; la lista llega siempre vacía | Regla de seguridad | Precision | Se queda. KL alimenta `approvedSources`. |
| Regla del prompt "Never state legal or regulatory facts about any country" | Prohibición absoluta, más estricta que R10 | Regla de seguridad | Precision | Se alinea con R10: solo desde fuentes aprobadas (fase C2) |
| `services-projection.json` (200 servicios), etiquetas de categoría, catálogo de FA, crosswalk | Proyecciones del catálogo | Catálogo | Service Explorer | KL referencia la misma versión fijada en `context_pin` |
| `fact`, `context_pin`, `pack` (CRP), `service_map_snapshot`, turnos | Hechos y estado del proyecto | Privado del proyecto | Precision | Nunca se promueve a KL |
| Voice pack y textos | Voz y presentación | UI | Precision | Se queda |
| Contenido apto para Seed | No existe hoy | — | KL | Se compila desde KL |

**Alternativas**

|  | Recomendada: integración aditiva por puertos | Migración en bloque | Convivencia indefinida |
| --- | --- | --- | --- |
| Qué es | Puerto `knowledge` en `ports/` (patrón ya usado para FA y Operation Hub), activable por bandera | Mover el conocimiento país de los manifiestos a KL y reescribir Precision | Precision sigue escribiendo conocimiento país en manifiestos y prompts |
| Riesgo de regresión | Bajo: con la bandera apagada, Precision se comporta exactamente como hoy | Alto | Ninguno inmediato |
| Cumple "sin repositorios paralelos" | Sí | Sí | No |

**Fases**

1. **C0 · Regla de contenido (ya, solo documental).** El conocimiento país nuevo se escribe en KL, no en manifiestos ni prompts.
2. **C1 · Puerto y contrato.** `kl.lookup`, paquete Seed y `approvedSources` llegan desde KL con la bandera apagada por defecto. Pruebas de contrato.
3. **C2 · Activación.** Se alinea la regla del prompt con R10 y se activa la bandera por país (México primero).
4. **C3 · Overlays.** Las marcas `CONTENT_VALIDATION_REQUIRED` se enlazan a fichas KL validadas.

**Pruebas de regresión**

- Suites existentes de Precision sin cambios: turn-engine, verifiers, process-knowledge, terminology y e2e live, incluida injection.
- Paridad con la bandera apagada: mismas respuestas que hoy.
- KL caído o lento: Precision reconoce el límite, registra demanda y no se bloquea.
- Casos A01–A03 y A06 con la bandera encendida.

## 7. Gobernanza por riesgo, agente y KL Admin

El nivel de riesgo de cada publicación decide cuánta autonomía tiene el agente; nadie aprueba ejecuciones rutinarias a mano.

| Nivel | Qué cubre | Autonomía | Ejemplos México |
| --- | --- | --- | --- |
| 1 · Estadístico estable | Series con estructura y metodología estables | Publicación automática si pasan todos los controles | INPC, UMA, tipo de cambio FIX, empleo formal IMSS, IED trimestral |
| 2 · Cambio o anomalía | Cambio metodológico, conflicto entre fuentes, valor fuera de rango, cambio de licencia, nueva edición de un índice | Cola de revisión humana | ICE 2026: un indicador sustituido, otro con método nuevo y serie recalculada |
| 3 · Normativo | Obligaciones fiscales, legales, laborales, aduaneras o regulatorias | La evidencia se captura como borrador; ninguna interpretación se sirve sin validación especializada | Resolución Miscelánea Fiscal, salario mínimo, reformas a la LFT, LIGIE |

**Flujo del agente.** Monitor → Detect → Extract → Validate → Normalize → Compare → Publish/Review → Version → Refresh.

- **Monitor y Detect** los hace código, sin IA, y solo sobre URLs del registro. Si no hay edición nueva, termina sin costo de modelo: verificar no implica actualizar.
- **Extract**: API o archivos estructurados primero. IA solo para PDFs, contra un esquema fijo y sin herramientas de red; el contenido descargado se trata como dato, nunca como instrucción.
- **Validate y Compare**: esquema, unidades, rangos, periodo, licencia, duplicados y huella metodológica (lista de indicadores, unidades y fuente de cada uno).
- **Publish/Review** según el nivel. **Version** conserva siempre la versión anterior. **Refresh** recompila los paquetes Seed afectados.
- Cada ejecución registra fuente, resultado, tokens y costo, con tope de presupuesto y política de reintentos.

**Cinco frecuencias distintas**, todas configurables en KL Admin sin código:

| Frecuencia | Pertenece a | Ejemplo |
| --- | --- | --- |
| Periodicidad esperada | Publicación | INPC quincenal |
| Frecuencia de verificación del agente | Publicación | Revisar el calendario de INEGI cada semana |
| Revisión de ficha | Ficha | Ficha de Manzanillo cada 6 meses |
| Vigencia del dato | Evidencia | Salario mínimo vigente del 1 de enero al 31 de diciembre |
| Actualización editorial | Producto | Revisión mensual de Doing Business México |

**KL Admin (MVP1).** Los ocho espacios aprobados, cada uno reducido a listas, detalle y las acciones que la operación necesita hoy. Se construye dentro de la administración existente del backend (`frontend/src/admin`), no como aplicación aparte. Destinos y enlaces configurables viven en Governance & Settings, sin valores fijos en el código.

**RBAC.** Se extiende la identidad existente (OIDC restringido a dominios de beeside y tabla de permisos `ADMIN`/`SUPERVISOR`):

| Rol | Puede | Origen |
| --- | --- | --- |
| SUPERVISOR | Leer todo KL Admin | Existente |
| KL\_EDITOR | Crear y editar borradores; clasificar demanda | Nuevo |
| KL\_REVIEWER | Aprobar y publicar; nunca su propio borrador. Con atributo de dominio, firma la validación especializada de nivel 3 | Nuevo |
| ADMIN | Aprobar fuentes y excepciones comerciales, presupuestos, umbrales, roles | Existente |
| `kl-agent` (cuenta de servicio) | Crear borradores; publicar solo nivel 1 | Nuevo |

Toda acción queda en auditoría con autor, aprobador y versión.

## 8. Producto 01: requisitos funcionales mínimos

Estas son las capacidades que KL debe tener para Doing Business beeside México, sin depender todavía de su contenido. El contenido y la profundidad por capítulo los define el siguiente macrobloque.

| ID | Requisito |
| --- | --- |
| FR-01 | El producto es una composición editorial versionada (capítulos y secciones) que solo referencia fichas y evidencias de KL por `id@versión`; no guarda hechos propios. |
| FR-02 | Una sola composición produce las dos modalidades: fichas consultables por Precision y guía PDF. |
| FR-03 | Español e inglés por sección, con idioma maestro, estado de traducción e invalidación de la variante cuando cambia el maestro. Las cifras son las mismas en ambos idiomas. |
| FR-04 | Una cifra nueva marca "requiere revisión" en las secciones que la citan; la IA nunca reescribe una sección aprobada. La regeneración es controlada y la lanza un revisor. |
| FR-05 | Revisión mensual automatizada que produce un informe de cambios en las evidencias citadas. Si nada cambió, no se crea edición nueva. |
| FR-06 | El PDF es una instantánea congelada al publicar: versiones fijadas, número de edición, fecha, fuentes y periodos visibles, avisos de límite. Un archivo por idioma. |
| FR-07 | Cada cifra muestra fuente y periodo. El uso permitido de la fuente se aplica al publicar: lo no publicable se bloquea. Percepción excluida; un índice compuesto con percepción lleva nota. |
| FR-08 | Cada capítulo declara sus límites consultivos y se enlaza con categorías y servicios de Service Explorer, sin nombres de partners. |
| FR-09 | Flujo editor → revisor, con validación especializada en secciones de nivel 3 y auditoría completa. |
| FR-10 | Publicar, despublicar y revocar; una revocación se propaga a Seed y al PDF vigente. La edición anterior queda archivada para rollback. Los enlaces de distribución se configuran en Admin. |
| FR-11 | La plantilla de composición es por país; México es la primera instancia. |

**Lo que debe resolver la especificación de Doing Business México:** audiencia y objetivo, índice definitivo, contenido y profundidad por capítulo, fuentes permitidas por capítulo (de la pestaña Source Registry), fichas reutilizables, límites frente a The Hive, idioma maestro (P1), metadatos, modelo del PDF y canales de distribución.

## 9. Medición de Precisión y Eficiencia

La misma batería de casos corre con KL apagado (línea base: Precision 2.0 actual) y encendido. Los umbrales se fijan después con esos datos, y ninguna mejora de costo se acepta si una métrica de calidad empeora.

**Método.** Precision ya tiene proveedor de modelo con guion, ensayo con modelo real y arnés de latencia. Se reutilizan con los casos A01–A07 más casos nuevos por categoría. Un revisor de beeside califica la calidad con una rúbrica fija, a ciegas respecto de la variante.

| Dimensión | Métrica | Cómo se mide |
| --- | --- | --- |
| Calidad diagnóstica | Categorías y servicios correctos (aciertos y omisiones frente a un patrón por caso) | Rúbrica sobre My Service Map resultante |
| Profundidad | Preguntas pertinentes por servicio; necesidades implícitas detectadas | Rúbrica |
| Confiabilidad factual | Afirmaciones con cita `id@versión`; afirmaciones sin respaldo en auditoría de muestra; bloqueos R10 | Registro de citas + auditoría |
| Completitud del handoff | Campos del handoff completos (objetivo, alcance, país, necesidades, hechos, incertidumbres, restricciones, dependencias, pendientes) | Lista de verificación |
| Límites | Casos sin conocimiento resueltos sin inventar y con demanda registrada | Casos A03 y variantes |
| Tokens | Tokens por turno y por diagnóstico completo, por nivel de Seed | Telemetría |
| Latencia | p50 y p95 por turno; tiempo añadido por `kl.lookup` | Arnés de latencia existente |
| Recuperación | Aciertos de Seed; consultas a KL por sesión; consultas cuyo resultado no se usó | Telemetría + citas |
| Costo por proyecto | Modelo + recuperación por proyecto completo | Telemetría de costos |
| Costo de mantenimiento | Costo por ejecución del agente y por fuente al mes; ejecuciones sin cambio que usaron IA (debe ser cero) | Registro de jobs |
| Fallos | KL caído o lento sin bloquear la conversación; paquetes obsoletos servidos (debe ser cero) | Pruebas de resiliencia |

## 10. Plan por macrobloques hasta MVP1

El siguiente bloque es la especificación de Doing Business México; después, un solo Design y tres liberaciones de Code que prueban primero el valor diagnóstico.

| # | Macrobloque | Contenido | Puerta de salida |
| --- | --- | --- | --- |
| 1 | Workspace · Doing Business beeside México — Product Specification | Audiencia, índice definitivo, profundidad, fuentes por capítulo, límites, idioma maestro, PDF, distribución | Aprobación del PO |
| 2 | Design | Contratos de integración (puerto de Precision, referencias de Service Explorer, propuestas de The Hive); modelo y estados; prototipos HTML de KL Admin y del PDF con datos reales; plan de validación; medición de la línea base | Aprobación del PO |
| 3 | Code R1 · Núcleo | Esquema y Source Registry; ingestión ICE 2025 (histórico) e ICE 2026 (por revisión); series de nivel 1; fichas iniciales; Seed, `kl.lookup` y puerto en Precision con bandera apagada; demanda | Casos A01–A03 y A06; paridad con bandera apagada |
| 4 | Code R2 · Automatización y Admin | Pipeline por niveles, huella metodológica, KL Admin y RBAC | Casos A04 y A05 |
| 5 | Code R3 · Producto 01 | Composición, ES/EN, PDF congelado | Caso A07 |
| 6 | Verification & Testing | Regresión de Precision, seguridad e inyección, comparativa contra línea base, acuerdo de umbrales | Umbrales acordados |
| 7 | MVP1 Release | Bandera encendida para México, manual de Admin, documentación operativa | P2, P3 y P5 cerrados |

**Cerrado el 15-oct:** Source Registry + Ingestión + Recuperación eficiente, con prueba real sobre ICE 2025 y validación A/B/C (Ingestión y recuperación). Queda listo para Design sin bloqueos nuevos; las reglas pasan a la especificación v1.4.

**Cerrado el 16-oct:** macrobloque 1 (Producto 01 aprobado, D20–D26) y cierre formal de Workspace. Siguiente: macrobloque 2, Design, en un ambiente independiente a partir del Design Handoff Pack.

**En paralelo, sin bloquear nada:** conseguir y verificar el libro, las boletas y el anexo del ICE 2026; la consulta legal de P2; designar validadores (P3); confirmar enlaces y términos de las fuentes marcadas "no abierta" en el Source Registry.

**Recomendación para iniciar el bloque 1.** Partir del índice preliminar de la especificación maestra y, por capítulo, fijar: pregunta que responde, nivel de riesgo, fuentes del registro, fichas que genera para Precision y límite frente a The Hive. Los capítulos 04 a 07 son de nivel 3: su profundidad debe pensarse junto con quien hará la validación especializada.

## 11. Acuerdos sobre la lámina 3 (v1.2)

La lámina 3 confirma la arquitectura y la precisa en seis puntos; todos están ya en la especificación v1.2.

- **beeside knowledge base** = Knowledge Seed (RAM, en Precision) + Knowledge Layer (servidor edge). La memoria del proyecto nunca baja de la línea punteada.
- **Tres flujos:** conversación (RAM y búsqueda directa en KL, sin web), recolección programada (solo fuentes que el PO indica o autoriza) y conocimiento (el agente compila la RAM y promueve por uso).
- **Clasificación de cambios:** nuevo periodo, corrección, complemento, cambio de método o conflicto. Nada se sobrescribe; ante duda, valoración humana. En productos, siempre aviso y aprobación.
- **Carga del equipo beeside:** mismo flujo y controles que el agente; quien sube no aprueba.
- **Equivalencias en la RAM de conocimiento (actualizado en v1.3):** conceptos por país (RFC = tax ID = NIF = EIN) y nombres de servicios; la RAM lleva la tabla del país destino y del de origen.
- **Lo que no se conoce:** "No contamos con este dato, lo dejo señalado para la siguiente etapa"; hallazgo en Precision para el Sherpa y demanda anónima en KL. Nunca respuesta tipo buscador.

## 12. Documentos canónicos

Hay un solo documento canónico de reglas y otro de estado; no hay copias paralelas.

| Documento | Propósito | Prevalece en |
| --- | --- | --- |
| Master Product & Operating Specification v1.4 (`specs/KL_1.0_Master_Spec_MVP1.md` en el proyecto, y .docx) | Reglas de negocio, alcance, límites, arquitectura aprobada y estado final de las decisiones | Toda regla de producto |
| Este documento (Workspace Consolidation & Readiness) | Análisis, Decision Register detallado, inventario de Precision, Source Registry de trabajo, plan y veredicto | Estado de pendientes y fuentes candidatas |
| Doing Business beeside México · Product Specification (aprobada el 16-oct) y KL 1.0 · Design Handoff Pack | Especificación editorial del Producto 01 | Contenido del Producto 01; se subordina a la maestra |

La revisión de la Instrucción 01 queda sustituida por este documento y sigue disponible en su historial de versiones. El Source Registry de esta pestaña es de trabajo: al construir KL Admin se carga ahí y la pestaña deja de mantenerse.
