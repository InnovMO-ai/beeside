# KL 1.0 → Precision MVP1 · Canonical Architecture Handoff

Snapshot del 16-oct-2026 · canónico: https://claude.ai/code/artifact/a602f040-947b-4a48-99e0-c95dbf10fd9d

Contrato final y autoritativo de **Knowledge Layer 1.0** para **Claude trabajando en Precision 2.0**. En este documento "Claude" significa siempre el agente que implementa Precision; no hay lógica de Claude dentro de KL. Las decisiones de producto aquí descritas están cerradas y no se reabren durante la integración. Ante cualquier diferencia prevalece la especificación maestra de KL (v1.3). Los diagramas de "beeside platforms 1.2" se leen con las correcciones de la sección 9.

**Cambios de esta versión (15-oct, alineación con decisiones de producto):** secciones 1, 2, 3, 4, 5, 6, 8, 9, 10, 11 y 12. Nuevas decisiones cerradas: el seed inicial ya se está construyendo y KL no arranca vacío; las equivalencias viven en la RAM; KL no es un sistema de cara al cliente; ningún dato del cliente o de la empresa entra a KL. Secciones 7 (productos) sin cambios.

## 1. Arquitectura canónica de KL

1. **Qué es.** Knowledge Layer es la base de conocimiento gobernada de beeside: conocimiento validado, versionado, con procedencia, vigencia y derecho de uso, servido a las plataformas de beeside como un servidor "edge" rápido y confiable.
2. **KL no es un sistema de cara al cliente.** Es una fuente de información para las plataformas de beeside. No conversa con el cliente, no diagnostica su proyecto, no decide qué debe hacer, no mantiene contexto del cliente, no es dueño del Project Frame ni de la memoria de conversación y no emite conclusiones profesionales sobre un caso.
3. **KL sabe del mundo; Precision sabe del cliente.** Precision conversa, entiende el proyecto, mantiene su contexto, decide qué información necesita, consume KL, aplica ese conocimiento en la conversación, reconoce límites y deriva a especialistas. The Hive hace el análisis profesional cuando se requiere.
4. **Knowledge-first, not search-first.** Precision responde desde su RAM de conocimiento y desde KL. Nunca investiga en Internet durante la conversación.
5. **Una sola base gobernada.** El seed inicial (preparado por Claude trabajando en Precision) se carga en KL y desde ese momento es parte de la base gobernada; KL lo mantiene, amplía y versiona. No hay un segundo almacén permanente de conocimiento consultivo.
6. **KL no arranca vacío.** La primera conexión real Precision ↔ KL ya recupera conocimiento preparado.
7. **Equivalencias en la RAM.** La capa operativa de equivalencias (conceptos y servicios con nombres distintos según país o contexto) pertenece a la RAM de conocimiento de Precision. KL puede aportar conocimiento que la respalde o actualice, pero no es su dueño canónico.
8. **Qué pertenece a KL.** Fuentes y procedencia, evidencias, fichas de conocimiento empresarial, conocimiento general de servicios por país, versiones y vigencia, políticas de publicación y recuperación, productos derivados, demanda de conocimiento y su administración.
9. **Ningún dato del cliente entra a KL.** Precision traduce localmente el contexto del proyecto a parámetros estructurados antes de consultar.
10. **Un solo contrato.** Understanding y Precision by Category usan el mismo contrato; solo cambian etapa, categoría e intención.
11. **Lo que no se conoce no se improvisa.** Precision reconoce el límite, continúa el diagnóstico, registra el hallazgo localmente y envía solo una señal de demanda normalizada. La recurrencia nunca publica nada por sí sola.
12. **Agentes fuera de la conversación.** El agente de recolección accede a fuentes externas aprobadas de forma programada; el agente de conocimiento trabaja solo con información interna. Precision no invoca a ninguno para investigar una pregunta en vivo.
13. **Autoridad de fuentes.** Solo fuentes oficiales primarias fundamentan obligaciones legales, fiscales, laborales, aduaneras, migratorias o regulatorias; las demás dan contexto.
14. **Nada se sobrescribe.** Todo cambio es una versión nueva; ante duda, valoración humana; en productos, siempre aviso y aprobación.
15. **Despliegue MVP1.** Módulo propio en el mismo backend y la misma base de datos, con esquema propio y una interfaz estable que después puede exponerse por HTTP sin cambiar el contrato.

## 2. Matriz de ownership

Cada tipo de información tiene un solo dueño; los demás lo leen o lo referencian por ID, nunca lo copian como propio.

| Tipo de información | Dueño | Ejemplos | ¿Entra a KL? |
| --- | --- | --- | --- |
| 1. Conocimiento empresarial | KL | Perfil de México, ficha del puerto de Manzanillo, indicadores, procedimientos generales | — |
| 2a. Conocimiento general de servicios | KL | Alcance típico, requisitos habituales y particularidades por país, independiente de proveedor | — |
| 2b. Catálogo de servicios activos | Service Explorer (catálogo provisional mientras no exista) | Existencia del servicio, familias y categorías, alcance y requisitos declarados por cada proveedor | No: KL solo referencia la clave |
| Equivalencias (conceptos y servicios) | RAM de conocimiento de Precision | RFC = tax ID = NIF = EIN; "constitución de sociedad" = "company incorporation" | KL puede aportar conocimiento que las respalde o actualice; no es su dueño |
| Seed inicial | Lo prepara Claude trabajando en Precision; al cargarse pasa a ser parte de la base gobernada de KL | Corpus inicial de fichas y datos | Sí, por el canal de carga con procedencia y aprobación |
| 3. Hechos del proyecto | Precision (Project Frame) y Discovery (registro original) | Empresa, país de origen del cliente, empleados, región elegida, decisiones | Nunca |
| 4. Memoria de conversación | Precision (turnos, estado del hilo, correcciones) | Lo que el cliente dijo y en qué punto va | Nunca. Solo una señal de demanda anónima y estructurada |
| Hallazgos para el Sherpa | Precision | Dato no disponible, servicio no catalogado | No; KL recibe solo la señal de demanda |
| 5. Análisis profesional del caso | The Hive (especialistas) | Ruta óptima, cálculo fiscal, dictamen legal | Solo como propuesta de conocimiento general revisada y sin datos del caso |
| Conocimiento de cómo opera beeside | Precision (Process Knowledge pack) | Qué sigue después de esta etapa, qué es Operation Hub | No en MVP1 |

**Diagnóstico vs análisis profesional.** Precision formula hipótesis, identifica servicios y prepara el handoff; no emite el análisis profesional. KL da contexto; nunca decide el caso.

## 3. Seed inicial, RAM de conocimiento y memoria del proyecto

La "RAM conversacional" del diagrama tiene dos partes con dueños, vida útil y reglas distintas. "Las equivalencias viven en la RAM" significa que viven en la parte reutilizable y persistente, no en la memoria de una sesión.

**Terminología canónica**

| Término | Qué es | Dueño | Vida útil |
| --- | --- | --- | --- |
| **Seed inicial (KSeed)** | Corpus de conocimiento preparado antes de la conexión | Lo prepara Claude trabajando en Precision; al cargarse pasa a la base gobernada de KL | Se carga una vez; queda como lote histórico de importación. Desde entonces se corrige y amplía solo en KL |
| **RAM de conocimiento** | Contenido reutilizable y preparado que Precision usa en toda conversación: la capa de equivalencias y el contexto compilado desde KL para el país, la etapa y los servicios | Precision (las equivalencias son suyas; el contexto compilado es una copia de solo lectura de lo publicado en KL) | Persistente entre conversaciones y proyectos. No desaparece al cerrar una sesión. El contexto compilado se renueva cuando KL publica una versión nueva |
| **Memoria del proyecto (Project Frame)** | Hechos del cliente, estado de turnos, correcciones, hallazgos, contexto del Project Frame | Precision | Persistente por proyecto, con las reglas de retención de Precision |

**Reglas**

- La RAM de conocimiento es igual para todos los clientes del mismo país, etapa y servicio; nunca contiene datos de un cliente.
- La memoria del proyecto es exclusiva de ese proyecto; nunca se usa para responder a otro cliente.
- Lo que puede salir hacia KL: señales de demanda normalizadas y telemetría de uso (qué `id@versión` se usaron, en qué etapa). Nada más.
- Ningún hecho del proyecto se convierte automáticamente en conocimiento. Si un Sherpa o un especialista detecta algo generalizable, lo propone a la cola de revisión de KL sin datos del caso, y una persona lo aprueba.
- El contexto compilado desde KL nunca se edita en Precision; si está mal, se corrige en KL.

## 4. Contrato conceptual Precision ↔ KL

Un solo contrato (`kl.v1`), de solo lectura para Precision salvo dos señales anónimas. KL recibe solo las dimensiones mínimas para recuperar conocimiento reutilizable; nunca el contexto del proyecto. Los nombres finales de los campos se fijan en Design.

**Operaciones**

| Operación | Para qué | Cuándo |
| --- | --- | --- |
| Paquete de contexto | Obtener el contexto compilado (paquete de contexto) para la RAM de conocimiento y su hash | Al iniciar o reanudar sesión, al cambiar de etapa o categoría |
| Consulta de conocimiento | Recuperar conocimiento aprobado que el paquete no trae | Solo ante una necesidad diagnóstica concreta |
| Recursos relacionados | Descubrir productos y secciones (p. ej. Doing Business México) para el país y la categoría | Cuando Precision quiere ofrecer un recurso |
| Señal de demanda | Registrar conocimiento ausente o parcial | Cuando la consulta devuelve partial o not\_available |
| Uso | Informar qué `id@versión` se usaron | En lote, al cerrar el turno o la sesión |

**KL sabe del mundo; Precision sabe del cliente.** Precision traduce localmente el contexto del proyecto a dimensiones estructuradas antes de llamar a KL.

| No enviar | Enviar |
| --- | --- |
| "Somos una empresa portuguesa con 60 empleados y vamos a importar equipo a México" | destination\_country = MX; origin\_country = PT; topic = labor / customs / corporate; information\_type = general\_requirement; stage = understanding o precision\_by\_category |

**Dimensiones que KL puede recibir (y nada más)**

| Dimensión | Ejemplo |
| --- | --- |
| País o jurisdicción destino | MX |
| País de origen, si es relevante | PT |
| Estado o región, si hace falta | MX-GUA |
| Código de industria | Manufactura |
| Etapa | understanding, precision\_by\_category |
| Clave de categoría o servicio | logistics, customs\_brokerage |
| Tema y subtema | logistica.puertos |
| Tipo de información | definición, procedimiento, requisito general, dato o indicador, comparación |
| Idioma | es, en |
| Consulta normalizada, solo si es necesaria | Frase breve redactada por Precision sin hechos del cliente. Se procesa en memoria para recuperar y nunca se guarda |

**KL nunca recibe ni guarda:** nombre de la empresa o de personas, correo o datos de contacto, documentos del cliente, texto literal del cliente, cifras financieras del proyecto, número de empleados, decisiones del cliente, hechos del proyecto, `project_id` real, Project Frame, Category Requirement Packs, My Service Map ni la transcripción de la conversación. Los registros de KL guardan solo dimensiones estructuradas y los IDs devueltos.

**Lo que KL devuelve**

| Campo | Contenido |
| --- | --- |
| Cobertura | sufficient, partial o not\_available |
| Conocimiento | Unidades aprobadas con `id@versión`, tipo y contenido en el idioma pedido |
| Procedencia | Fuente, publicación, localizador, clase de autoridad (sección 6) |
| Vigencia | Periodo del dato, fecha de publicación, vigente desde y hasta, próxima revisión |
| Riesgo | high, medium o low |
| Confianza | Estado de validación: validado por especialista, revisado o publicado automáticamente (nivel bajo). No es un porcentaje |
| Límites | Qué no cubre la unidad y cuándo se requiere estudio |
| Especialista | Si hace falta y con qué categoría o servicio se relaciona |
| Relacionados | Productos y secciones, otras unidades, y conocimiento que respalde o actualice la capa de equivalencias de la RAM |

La única referencia a un proyecto que puede llegar a KL es el identificador opaco e irreversible de la señal de demanda (sección 5).

**K. Understanding y Precision by Category: mismo contrato**

|  | Understanding | Precision by Category |
| --- | --- | --- |
| Intención | Comprender, preguntar mejor, orientar en general, identificar dimensiones | Profundizar, reconocer implicaciones, orientar, señalar lo que requiere especialista |
| Paquete de contexto | Esenciales del país y guías de preguntas generales (las equivalencias ya están en la RAM de conocimiento) | Fichas de la categoría activa, conocimiento general de sus servicios, triggers de especialista |
| Consultas típicas | Definiciones, contexto, comparaciones generales | Procedimientos generales, requisitos habituales, particularidades locales |
| Riesgo | Mayormente low y medium | Incluye high (normativo): siempre con límites y señal de especialista |

No hay dos arquitecturas: solo cambian los valores de etapa, categoría e intención.

## 5. Flujo Knowledge Demand

Confirmado: **recurrencia ≠ publicación automática.** La demanda solo informa una decisión humana.

**En la conversación (Precision)**

1. La consulta a KL devuelve partial o not\_available.
2. Precision reconoce el límite con naturalidad: "No contamos con este dato, lo dejo señalado para la siguiente etapa" (o "al Sherpa que te atenderá", si ya hay Sherpa asignado). No afirma ni niega.
3. Continúa el diagnóstico.
4. Registra un hallazgo en el proyecto (privado) para que el Sherpa lo retome con contexto.
5. Emite a KL una señal de demanda normalizada.

**Modelo mínimo de la señal**

| Campo | Contenido |
| --- | --- |
| País y región | MX, MX-COL |
| Tema y subtema | logistica.ferrocarril, conectividad puerto-región |
| Categoría y servicio | Claves del catálogo, si aplican |
| Tipo de información | definición, procedimiento, requisito, dato, comparación, equivalencia |
| Cobertura | absent o partial (y qué unidad fue parcial) |
| Etapa e idioma | understanding o precision\_by\_category; es o en |
| Candidato propuesto | knowledge\_candidate, specialist\_service o unclear |
| Referencia de proyecto | Identificador opaco: hash con clave secreta, solo para contar proyectos distintos; KL no puede revertirlo |
| Fecha | Marca de tiempo |

Sin texto libre, sin PII y **sin `project_id` real**: la única referencia permitida es el identificador opaco e irreversible, y solo para contar proyectos distintos. El hallazgo con el detalle del caso se queda en Precision. La **recurrencia** no la envía Precision: KL la calcula agregando señales, y solo sirve para apoyar decisiones de curaduría posteriores.

**En KL (fuera de la conversación)**

1. El agente de conocimiento agrupa señales equivalentes por país, tema, categoría y servicio.
2. KL Admin muestra cada grupo con recurrencia, valor diagnóstico estimado, fuentes posibles y costo de mantenimiento.
3. Un revisor decide: CREATE, ENRICH, PARTIAL, MAP, SPECIALIST ONLY o DEFER / REJECT, con motivo.
4. Si se incorpora: se elige o propone una fuente; si es nueva, la aprueba ADMIN; se configuran frecuencia y validaciones.
5. El agente de recolección obtiene el dato en su ciclo programado; pasa clasificación y revisión por riesgo; se publica.
6. El agente de conocimiento lo incluye en los paquetes de contexto que correspondan. La próxima conversación ya lo tiene.

## 6. Knowledge Agent, fuentes y gobierno por riesgo

KL tiene dos agentes con permisos distintos, y ambos trabajan de forma asíncrona, fuera de la interacción con el cliente. **Precision no invoca a ninguno de los dos para investigar una pregunta del cliente en vivo: Precision consulta conocimiento ya preparado en KL; los agentes mantienen KL.**

|  | Agente de recolección | Agente de conocimiento |
| --- | --- | --- |
| Toca Internet | Sí, solo fuentes aprobadas (lista permitida) | No |
| Cuándo corre | Programado, fuera de toda conversación | Fuera de la conversación |
| Qué hace | Monitor → detectar nuevas publicaciones y cambios → extraer → validar → normalizar → comparar versiones → clasificar el cambio y su riesgo → publicar o proponer → versionar → refrescar | Compila paquetes de contexto, promueve o retira contenido según uso, agrupa demanda |
| Puede publicar solo | Nivel low (abajo) | Nada: solo selecciona contenido ya publicado |

**Fuente nueva no aprobada.** El agente puede detectarla o proponerla; queda como candidata en el Source Registry, no se descarga ni se usa, y solo ADMIN puede aprobarla con alcance, jurisdicción, vigencia y uso permitido.

**Clasificación del cambio.** Nuevo periodo (se agrega), corrección (nueva versión), complemento (dato relacionado), cambio de método o conflicto (revisión humana). Nada se sobrescribe. Si el cambio no se puede clasificar con certeza, va a valoración humana.

**G. Jerarquía de autoridad de fuentes**

| Clase | Ejemplos | Puede fundamentar |
| --- | --- | --- |
| A · Oficial primaria | DOF, SAT, IMSS, STPS, Secretaría de Economía, INM, ANAM, INEGI, Banxico, CONASAMI | Obligaciones legales, fiscales, laborales, aduaneras, migratorias y regulatorias; estadística oficial |
| B · Institucional confiable | IMCO, OCDE, Banco Mundial, CCE/CEESP | Contexto, comparaciones y tendencias. Nunca una obligación |
| C · Curada por beeside | Guías beeside; documentos de The Hive aprobados y generalizados | Orientación consultiva y explicación del proceso. Nunca autoridad normativa |
| D · Secundaria | Prensa, estudios comerciales y bancarios (excluidos por defecto; solo con excepción aprobada) | Solo contexto, nunca como única base |

Reglas para legal, tax, labor, customs, immigration y regulatorio:

- Una obligación solo se afirma si la respalda al menos una fuente de clase A y una validación especializada.
- El DOF es la evidencia del texto normativo; la compilación de la Cámara de Diputados sirve para detectar cambios. Del DOF y de IMCO se cita, se parafrasea y se enlaza; no se reproduce íntegro sin permiso.
- Los documentos de The Hive específicos de un proveedor son internos. Solo entran a KL como conocimiento general después de revisión y sin datos del proveedor.
- IMCO da contexto competitivo. Sus índices compuestos incluyen percepción: se muestran con nota metodológica y se prefieren indicadores individuales.
- INM no estaba en el Source Registry: queda como candidata para el dominio migratorio.

**H. Gobierno por riesgo (validado, con dos precisiones)**

| Nivel | Qué cubre | Aprobación |
| --- | --- | --- |
| LOW | Nuevo periodo o corrección de series estadísticas estables de fuentes A | Publicación automática si pasa todos los controles, con auditoría y revisión por muestreo |
| MEDIUM | Fichas de contexto, conocimiento general de servicios, complementos, cambios de método, conflictos, nuevas ediciones de índices | Revisión estándar (KL\_REVIEWER) |
| HIGH | Obligaciones legales, fiscales, laborales, aduaneras, migratorias y regulatorias | Revisión de especialista del dominio antes de publicar |

Precisiones: un cambio no clasificable sube de nivel, nunca baja; y en los productos ningún cambio es automático, sea cual sea su nivel.

- **Quién aprueba:** KL\_REVIEWER (MEDIUM), KL\_REVIEWER con validación de especialista (HIGH), ADMIN (fuentes y excepciones). Nadie aprueba lo que él mismo creó.
- **Auditoría:** autor, aprobador, fecha, fuente, diferencia contra la versión anterior y motivo.
- **Versionado y estados:** borrador, en revisión, publicado, sustituido (superseded), vencido, retirado (withdrawn). Cada cambio es una versión nueva.
- **Fechas efectivas:** periodo del dato, fecha de publicación en la fuente, vigente desde y hasta, próxima revisión.
- **Rollback:** se republica la versión anterior como versión nueva; los paquetes de contexto afectados se invalidan en el turno siguiente.
- **Historial:** inmutable.

## 7. Productos de KL

Un producto de KL es una **composición editorial versionada de unidades de conocimiento**, la combinación de las opciones planteadas: no tiene datos propios; solo ordena, redacta y presenta fichas y evidencias de KL, citadas por `id@versión`.

| Elemento | Qué es |
| --- | --- |
| Composición | Estructura del producto: capítulos y secciones, cada una ligada a unidades de KL |
| Secciones estructuradas | La forma consumible por Precision: cada sección es una unidad con tipo, país, categoría, riesgo y límites |
| Renderizaciones | Salidas para personas, por ejemplo la guía PDF, una por idioma, congelada al publicar |
| Edición | Número y fecha de publicación del conjunto, con las versiones de cada unidad fijadas |

**Versionado.** Cada publicación es una edición nueva y la anterior queda archivada. Si cambia una unidad citada, KL avisa y un revisor editorial aprueba antes de aplicar; la IA nunca reescribe una sección aprobada. La periodicidad de revisión se define por producto.

**Cómo lo descubre Precision.** Con la operación genérica "Recursos relacionados" (país, categoría, tema). KL devuelve las secciones y productos pertinentes con su edición y el enlace de distribución configurado en KL Admin. Precision puede citarlos u ofrecerlos al cliente.

**Doing Business beeside México** es simplemente la primera instancia: producto tipo guía, país MX, idiomas ES/EN. Precision no tiene código específico para él; cualquier guía de otro país llegará por el mismo camino.

**Entrega al cliente (D23, 16-oct).** En MVP1 la guía se distribuye de forma controlada: KL publica la edición congelada y devuelve su referencia; Precision la entrega como enlace con control de acceso, en el idioma del cliente (ES o EN, publicados juntos). KL no expone un acceso público ni registra quién descarga. Ninguna publicación abierta hasta verificar derechos de reproducción.

## 8. Frontera KL ↔ Service Explorer y Operation Hub

Knowledge Layer = conocimiento y contexto. Service Explorer = servicios activos con beeside. Las equivalencias (incluidos aliases y sinónimos de servicios) no pertenecen a ninguno de los dos: viven en la RAM de conocimiento de Precision.

| Tema | Dueño | Detalle |
| --- | --- | --- |
| Familias, categorías y servicios | Service Explorer | Hoy no existe: rige el catálogo provisional (17 categorías, 200 servicios) que define el PO, con claves estables que Service Explorer adoptará |
| Alcance y requisitos declarados por cada proveedor | Service Explorer | Administrados por los proveedores |
| Identidad de proveedores, precios, disponibilidad | Service Explorer / The Hive | Nunca en KL ni expuestos al cliente |
| Conocimiento general del servicio por país | KL | Alcance típico, requisitos habituales, particularidades locales; complementa a Service Explorer mientras la información de proveedores sea limitada |
| Equivalencias entre países, aliases y sinónimos | RAM de conocimiento de Precision | Conceptos (RFC = tax ID = NIF = EIN) y nombres de servicios; las de servicios apuntan a la clave del catálogo. KL puede aportar conocimiento que las respalde o actualice |

**Qué intercambian.** KL lee las claves de categoría y servicio del catálogo y referencia la versión fijada en cada proyecto. En MVP1, KL no escribe nada en Service Explorer.

**Necesidad legítima no catalogada**

1. Precision no la descarta: la registra en hallazgos.
2. El Sherpa evalúa con The Hive si hay que buscar e integrar un proveedor.
3. Cuando el proveedor se integra, el servicio se registra en Service Explorer.
4. Si hace falta, KL agrega conocimiento general del servicio y la RAM de conocimiento incorpora sus equivalencias.

**Qué no se duplica en KL:** el catálogo, el alcance o los requisitos de un proveedor, datos de proveedores, la búsqueda pública de servicios ni la capa de equivalencias.

**L. Operation Hub**

- **MVP1:** Operation Hub no consume KL. Recibe el resultado ya estructurado de Precision (Category Requirement Pack y handoff), que lleva las citas `id@versión` de lo usado. Su relación de soporte es con Service Explorer.
- **Futuro:** si Operation Hub necesita mostrar conocimiento o productos de KL al cliente o al Sherpa, usará el mismo contrato de solo lectura. No se define ahora.

## 9. Revisión de los diagramas ("beeside platforms 1.2")

Los diagramas son correctos como intención; una sola flecha debe cambiar (el agente que recolecta "lo que no conoce"), y la mayoría necesita precisión para que nadie infiera escritura o búsqueda en tiempo real.

**Página 2 · beeside support platforms**

| Elemento | Veredicto | Lectura correcta |
| --- | --- | --- |
| Título "Precision Precision" | CAMBIAR | Texto duplicado: un solo "Precision" |
| Understanding y Precision by Category → Knowledge Layer | CORRECTO PERO NECESITA PRECISIÓN | Consulta y respuesta (KL → Precision) con el mismo contrato para ambas etapas. Precision solo escribe señales de demanda y de uso, nunca conocimiento |
| Understanding y Precision by Category → Service Explorer | CORRECTO PERO NECESITA PRECISIÓN | Verificar existencia, alcance y requisitos de un servicio. Service Explorer aún no existe: en MVP1 es el catálogo provisional |
| Discovery sin flecha a KL | CORRECTO | Discovery no consume KL; Precision le pasa a KL solo parámetros estructurados |
| Operation Hub → Service Explorer | CORRECTO | Operation Hub no consume KL en MVP1; recibe el resultado estructurado de Precision |
| Service Explorer → www.beeside.you (búsqueda del servicio) | CORRECTO PERO NECESITA PRECISIÓN | Solo se publican servicios con marca beeside, nunca proveedores ni sus catálogos. No afecta a KL en MVP1 |
| Sin relación KL ↔ Service Explorer | CORRECTO PERO NECESITA PRECISIÓN | Conviene una línea punteada "KL referencia claves del catálogo" |

**Página 3 · beeside knowledge base**

| Elemento | Veredicto | Lectura correcta |
| --- | --- | --- |
| Título "beeside knowledge base" | CORRECTO | Nombre del conjunto: RAM de conocimiento (lado Precision) + Knowledge Layer. Ninguno es un sistema de cara al cliente por sí mismo; quien conversa es Precision |
| Línea punteada | CORRECTO | Arriba, Precision: RAM de conocimiento, memoria del proyecto y conversación. Abajo, KL. Los hechos del cliente y del proyecto nunca cruzan hacia abajo |
| RAM conversacional | CORRECTO PERO NECESITA PRECISIÓN | Está del lado de Precision. Contiene la RAM de conocimiento (equivalencias y contexto compilado desde KL, persistente y reutilizable) y, separada, la memoria del proyecto (sección 3) |
| Equivalencias (no dibujadas) | AGREGAR | Viven en la RAM de conocimiento, arriba de la línea. KL puede aportar conocimiento que las respalde o actualice |
| Agente "Actualización y recolección de datos que no conoce" (flecha RAM ↔ repositorio) | CAMBIAR | Se lee como búsqueda en vivo de lo desconocido. Debe decir "Agente de conocimiento: compila contexto desde KL hacia la RAM, solo con información interna". Lo desconocido no dispara investigación inmediata: va al Knowledge Demand Registry |
| www ↔ agente ↔ repositorio (recolección periódica programada) | CORRECTO PERO NECESITA PRECISIÓN | Agente de recolección: solo fuentes aprobadas, programado y fuera de la conversación. La flecha debería ir en un sentido (web → KL): el agente lee, no escribe |
| Repositorio "información de consumo estructurada y categorizada" | CORRECTO PERO NECESITA PRECISIÓN | Solo el contenido publicado y versionado es consumible; incluye el seed inicial ya cargado |
| Icono de base de datos y caja verde "Knowledge Layer" | CORRECTO PERO NECESITA PRECISIÓN | Son la misma plataforma: el repositorio es parte de KL |
| Understanding y Precision by Category ↔ Knowledge Layer | CORRECTO PERO NECESITA PRECISIÓN | Precision consume KL con dimensiones estructuradas; no le envía contexto del cliente. Hacia KL solo van señales de demanda y de uso |
| Carga de datos por parte del team beeside | CORRECTO PERO NECESITA PRECISIÓN | Es también el canal del seed inicial. Mismo flujo de validación que el agente; quien sube no aprueba |
| KL → productos (Doing Business, otros) | CORRECTO PERO NECESITA PRECISIÓN | Composición de unidades de KL; todo cambio con aviso y aprobación; periodicidad por producto |
| Ausentes | AGREGAR | Knowledge Demand Registry (Precision → KL, señal anónima), hallazgos para el Sherpa (dentro de Precision), seed inicial cargado antes de la conexión, KL Admin y las reglas "Precision: sin acceso a la web" y "KL: sin datos del cliente" |

## 10. Despliegue, frontera web y MVP1

KL no arranca vacío. Antes de la conexión real Precision ↔ KL, el seed inicial ya estará cargado en KL y habrá conocimiento real seleccionado. La primera integración prueba recuperación contra ese conocimiento. Para conectar, Precision solo necesita la superficie de integración acordada y ese conocimiento inicial; no hace falta que todo el roadmap de KL esté completo.

**N. Despliegue y datos**

- **Mismo backend, módulo propio.** KL vive en el mismo repositorio y backend que Precision, como módulo independiente (no dentro de `precision/`), con esquema propio (`kl`) en la misma base PostgreSQL. Sin microservicios.
- **Sin HTTP en MVP1.** Precision llama a KL por una interfaz (puerto) en proceso, siguiendo el patrón de puertos que Precision ya usa. Los DTOs se versionan como `kl.v1` y se diseñan para exponerse por HTTP después sin cambiar el contrato.
- **Escritura acotada.** Precision no tiene permisos de escritura sobre el esquema `kl` salvo insertar señales de demanda y de uso a través del módulo de KL. Conviene un rol de base de datos separado.
- **El agente de recolección corre aparte**, como trabajo programado (worker), no en el proceso que atiende conversaciones.

| Datos de KL (esquema `kl`) | Datos de Precision |
| --- | --- |
| Fuentes, publicaciones y aprobaciones | Hechos del proyecto (Project Frame), context pin, Category Requirement Pack, My Service Map |
| Lotes de carga, incluido el seed inicial, y ejecuciones de agentes | Turnos, estado del hilo, correcciones, hallazgos |
| Evidencias, fichas y sus versiones | Capa de equivalencias (RAM de conocimiento) |
| Composiciones de producto y ediciones | Process Knowledge pack, manifiestos de categoría, verificadores |
| Señales y grupos de demanda, telemetría de uso | Citas `id@versión` usadas en cada salida |
| Contexto compilado y sus manifiestos | Copia de solo lectura del contexto compilado (regenerable) |
| Auditoría de KL |  |

**M. Frontera web (congelada)**

- Precision → sin búsqueda web. Su modelo no tiene herramienta de navegación ni de búsqueda.
- KL al servir a Precision → sin búsqueda web ad hoc provocada por un cliente. El código de consulta no tiene cliente HTTP saliente.
- Agente de recolección → sí, solo dentro de su proceso gobernado.

Límite técnico recomendado:

1. Lista cerrada de herramientas para el modelo de Precision, sin web.
2. Salida a Internet bloqueada para el proceso que atiende conversaciones, salvo el proveedor del modelo y servicios internos.
3. Salida permitida solo al worker del agente, y solo a los dominios del Source Registry.
4. Prueba automática que falla si una conversación genera tráfico saliente no permitido.

**O. MVP1**

| Prioridad | Capacidad |
| --- | --- |
| MUST · conexión Precision ↔ KL | Superficie de integración `kl.v1` acordada (contexto compilado, consulta, recursos relacionados, señal de demanda, uso) |
| MUST · conexión Precision ↔ KL | Seed inicial cargado en KL con procedencia, versión y estado publicado; conocimiento real seleccionado disponible |
| MUST · conexión Precision ↔ KL | Consulta filtrada con respuesta sufficient, partial y not\_available; procedencia, vigencia, riesgo, límites y señal de especialista |
| MUST · conexión Precision ↔ KL | Contexto compilado para la RAM con manifiesto e invalidación; `approvedSources` de R10 alimentado desde KL |
| MUST · conexión Precision ↔ KL | Capa de equivalencias operativa en la RAM de conocimiento |
| MUST · conexión Precision ↔ KL | Respuesta de límite, hallazgo local para el Sherpa y señal de demanda normalizada; registro de demanda en KL |
| MUST · conexión Precision ↔ KL | Frontera web aplicada y probada; minimización de datos probada (ningún dato del cliente llega a KL) |
| MUST · conexión Precision ↔ KL | Pruebas de integración con los tres casos: conocimiento disponible, parcial y no disponible; las suites actuales de Precision siguen pasando |
| Evolución de KL (no bloquea la conexión) | Agente de recolección automatizado, KL Admin completo, revisión por riesgo completa, Producto 01 Doing Business México ES/EN |
| Post-MVP1 | API HTTP, consumo desde Operation Hub, promoción automática por uso, búsqueda semántica, integración con Service Explorer cuando exista, multipaís operativo |

## 11. Contradicciones y decisiones abiertas

O1 y O2 quedan cerrados por el PO. Queda una sola pregunta abierta, sobre cómo se gobiernan los cambios a las equivalencias; no bloquea la conexión.

| ID | Tema | Estado | Decisión |
| --- | --- | --- | --- |
| O1 | Qué es KSeed y si KL arranca vacío | Cerrada (PO, 15-oct) | KSeed es el seed inicial, preparado por Claude trabajando en Precision; se carga en KL y pasa a la base gobernada. KL no arranca vacío. Lo que Precision usa en cada conversación se llama RAM de conocimiento |
| O2 | Dueño de equivalencias, aliases y sinónimos | Cerrada (PO, 15-oct) | Viven en la RAM de conocimiento de Precision. KL puede aportar conocimiento que las respalde o actualice. Sustituye a la decisión D10 de la especificación v1.2 |
| O3 | KL no es un sistema de cara al cliente | Cerrada (PO, 15-oct) | Fuente de información para las plataformas de beeside; no conversa, no diagnostica y no guarda contexto del cliente |
| O4 | Ningún dato del cliente o de la empresa entra a KL | Cerrada (PO, 15-oct) | Lista de exclusiones y dimensiones permitidas en la sección 4 |

**Pregunta abierta para el PO**

| ID | Pregunta | Por qué importa | Opciones | Recomendación |
| --- | --- | --- | --- | --- |
| O5 | ¿Cómo se aprueban y versionan los cambios a la capa de equivalencias, ahora que vive fuera de KL? | La base de conocimiento de KL tiene versionado, revisión y rollback. Si las equivalencias cambian sin ese control, un error (p. ej. tratar dos conceptos fiscales distintos como iguales) se propagaría a todas las conversaciones | a) Precision administra y versiona las equivalencias con las mismas reglas que KL (nada se sobrescribe, revisión humana); KL solo propone actualizaciones. b) Se editan en KL Admin y se publican a la RAM, aunque el dueño operativo sea Precision | **a)**: respeta la decisión de que la RAM es la dueña y no crea dependencia de KL Admin. No bloquea la conexión: el seed inicial ya trae las equivalencias aprobadas |

**Ajustes que no requieren decisión:** el nombre es KL 1.0 (D8); la señal de demanda lleva solo un identificador opaco e irreversible; los niveles LOW, MEDIUM y HIGH son los tres niveles de riesgo ya aprobados, con auditoría por muestreo en LOW; INM se agrega como fuente candidata para temas migratorios.

**Pendientes ya registrados:** categorías de salida del catálogo provisional (PO), integración de Precision 2.0 a la rama principal, derechos de reutilización de IMCO y DOF, validadores especialistas, ICE 2026.

## 12. Instrucciones para Claude trabajando en Precision

Reglas obligatorias. Las decisiones de este documento están cerradas: no se reabren durante la integración. Cualquier excepción se escala al PO antes de implementarla.

1. **Knowledge-first, not search-first.** Ninguna herramienta web, de navegación o de búsqueda en el modelo ni en el proceso de conversación.
2. **KL no es un sistema de cara al cliente.** Precision conversa, diagnostica, mantiene el contexto y decide qué información necesita; KL solo informa.
3. **No invocar agentes de KL.** Precision usa únicamente el contrato `kl.v1`: contexto compilado, consulta, recursos relacionados, señal de demanda y uso.
4. **Seed inicial.** Prepararlo y estructurarlo para su carga en KL por el canal de carga, con procedencia. Una vez cargado, KL es su única fuente: Precision no conserva una copia editable.
5. **RAM de conocimiento.** Mantener en ella la capa de equivalencias (persistente, no de sesión) y la copia de solo lectura del contexto compilado desde KL. No mezclarla con la memoria del proyecto.
6. **No crear otros almacenes de conocimiento.** Ningún prompt, tabla o archivo de Precision guarda conocimiento país o de servicios como fuente propia, salvo la capa de equivalencias.
7. **Ningún dato del cliente a KL.** Traducir localmente el contexto del proyecto a dimensiones estructuradas (sección 4). Nunca enviar texto del cliente, nombres, contactos, documentos, cifras, empleados, decisiones, hechos del proyecto, `project_id` real, Project Frame, Category Requirement Packs, My Service Map ni transcripciones.
8. **No escribir conocimiento en KL.** Solo señales de demanda y de uso, estructuradas y anónimas.
9. **Citar siempre.** Toda afirmación tomada de KL lleva su `id@versión` en el registro interno y en las salidas (Category Requirement Pack, handoff).
10. **Respetar riesgo y límites.** Si una unidad es HIGH, expresar sus límites y la señal de especialista; nunca convertir una obligación en recomendación concluyente.
11. **Sin conocimiento, no improvisar.** Reconocer el límite con naturalidad, continuar el diagnóstico, registrar el hallazgo localmente para el Sherpa y enviar solo la señal de demanda normalizada.
12. **Mantener R10.** El verificador de afirmaciones por país sigue activo; `approvedSources` viene de KL. La regla del prompt se alinea con R10: afirmaciones legales o regulatorias solo desde fuentes aprobadas.
13. **Un solo contrato para Understanding y Precision by Category.** Solo cambian etapa, categoría e intención.
14. **Servicios.** Existencia, alcance y requisitos por proveedor se consultan en el catálogo (Service Explorer o el provisional). Un servicio no catalogado se registra en hallazgos, no se descarta ni se inventa.
15. **Sin código específico por producto.** Doing Business México se descubre con "recursos relacionados", como cualquier producto futuro.
16. **Probar los tres casos.** Conocimiento disponible, parcial y no disponible, contra el seed real cargado; además, frontera web y minimización de datos.
17. **No regresión.** Las suites actuales de Precision deben seguir pasando.
18. **No reinterpretar los diagramas.** Usar las lecturas de la sección 9; en caso de duda, prevalece la especificación maestra de KL.
