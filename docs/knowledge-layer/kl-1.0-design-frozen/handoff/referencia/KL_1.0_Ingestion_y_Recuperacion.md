# Ingestión y recuperación · ICE 2025 como caso real

Snapshot del 16-oct-2026 · canónico: https://claude.ai/code/artifact/f95a2dd1-f13e-4df4-aac3-37bad4e272a1 (pestaña Ingestión y recuperación)

Recomendación: arquitectura híbrida. El registro estructurado es la fuente de verdad para datos estadísticos, la ficha versionada para lo normativo y consultivo, y el documento original queda como evidencia localizada. En 23 preguntas reales sobre ICE 2025, el híbrido acertó 23, el estructurado 21 y la recuperación directa sobre el PDF 20, con 14 veces más contexto por pregunta (mediana de 5,505 frente a 392 caracteres).

El bloque Source Registry + Ingestión + Recuperación queda listo para Design. No aparecen bloqueos de producto nuevos. Las fuentes siguen como candidatas: este trabajo no activa ninguna.

Ya estaba resuelto en la especificación v1.3 y aquí solo se extiende: política de admisión, filtros de percepción e índices, clasificación de cambios sin sobrescritura, canal de carga del equipo, niveles de riesgo, registro amplio de 33 fuentes y configuraciones administrables.

## 1. Prueba de estructuración ICE 2025

Se extrajeron los 53 indicadores de las 32 boletas: 1,696 de 1,696 registros, cada uno con entidad, valor, unidad, posición, periodo, fuente original y página. Ningún valor se escribió a mano. El periodo sale del anexo, porque la boleta no lo muestra.

| record\_id | Valor | Unidad (boleta) | Pos. | Periodo | Fuente original | Localizador | Uso en Precision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| imco.ice2025.informalidad.MX-NLE | 35% | Porcentaje de la población ocupada en informalidad laboral | 2 | 2024 | INEGI · ENOE | Boletas p. 73 (PDF 39) | Sí |
| imco.ice2025.ingreso\_promedio.MX-JAL | 10,795 | Pesos por mes | 16 | 2024 | INEGI · ENOE | Boletas p. 63 (PDF 29) | Sí |
| imco.ice2025.crecimiento\_imss.MX-TAB | -12.2% | Tasa de crecimiento anual | 32 | 2024 | IMSS · puestos afiliados | Boletas p. 89 (PDF 55) | Sí |
| imco.ice2025.terminales\_pv.MX-YUC | 170 | Por cada 10 mil adultos | 8 | 2024 | CNBV · inclusión financiera | Boletas p. 96 (PDF 62) | Sí |
| imco.ice2025.carga\_aerea.MX-QUE | 29,689.3 | Kilogramos por cada mil habitantes | 1 | 2024 | SICT · estadística de aeropuertos | Boletas p. 78 (PDF 44) | Sí |
| imco.ice2025.pib\_per\_capita.MX-QUE | $315,065 | Pesos por habitante | 7 | 2024 (estimado) | INEGI · PIBE | Boletas p. 78 (PDF 44) | Sí, con marca de estimado |
| imco.ice2025.ied.MX-BCS | 4.7 | Dólares por millar de PIB (promedio 3 años) | 1 | 2024 | SE · estadística de IED | Boletas p. 40 (PDF 6) | Sí |
| imco.ice2025.complejidad.MX-NLE | 100.00 | Índice normalizado (0-100) | 1 | 2022 | Data México (agregador) | Boletas p. 72 (PDF 38) | Solo contexto |
| imco.ice2025.costo\_deuda.MX-TLA | — | Tasa de interés promedio ponderada | — | 2024 | SHCP | Boletas p. 93 (PDF 59) | No: sin valor ("la entidad no presenta deuda") |
| imco.ice2025.percepcion\_seguridad.MX-YUC | 68% | Población adulta que se siente segura | 1 | 2024 | INEGI · ENVIPE | Boletas p. 96 (PDF 62) | No: percepción |

Cada registro guarda además: indicador e identificador estable, subíndice, tipo (objetivo, percepción, índice compuesto), etiqueta original del documento, intermediario (IMCO), clase de fuente (B), fecha de publicación (2025-06-09), confianza del periodo y estado (candidato).

**Hallazgos de calidad (medidos)**

- Errores de extracción detectados y corregidos antes de cerrar 1,696 de 1,696: cuatro. El último (la unidad de "Crecimiento de puesto de trabajo" se tomaba del paréntesis "(IMSS)" del nombre) lo detectó el contraste de unidad boleta frente al anexo.
- Valor ausente: uno. Tlaxcala no tiene deuda, así que no tiene costo de deuda: se registra sin valor y responde "no disponible", nunca cero.
- Empates de posición: 19 grupos en 7 indicadores (Jalisco y Estado de México comparten el 2 en diversificación; cuatro estados sin carga aérea comparten el 29). La posición no identifica un registro.
- Coherencia valor–posición: cero violaciones en 53 indicadores. La dirección (menor es mejor en informalidad) se infiere y se guarda.
- Libro frente a boletas: mismas cifras con distinta precisión (terminales punto de venta CDMX 378.86 vs 379; carga aérea Querétaro 29,689 vs 29,689.3; escolaridad CDMX 11.77 vs 11.8). Es el mismo dato; se conserva el más preciso.
- Anexo frente a boleta: redacción distinta de unidades ("población ocupada" vs "PEA ocupada"), una redacción dudosa en el anexo ("población foránea residente" en educación superior) y una errata en el libro ("Tasa de anual"). Van a revisión editorial; no cambian el dato.
- Periodo: de 2022 a 2024 según el indicador. PIB per cápita y crecimiento del PIB son estimación de IMCO para 2024; internet y telefonía usan ENIGH 2022.
- Percepción: 64 registros (2 indicadores en 32 estados) excluidos de lo consumible sin alterar el documento.
- Nueva edición: ICE 2026 reporta 33% de informalidad en Nuevo León frente a 35% en ICE 2025. Es un nuevo periodo, no una corrección; como 2026 recalcula la historia, la comparación entre ediciones va a revisión humana.

**Duplicación con la primaria.** De los 15 indicadores objetivos propuestos para el subconjunto consumible (5 de mercado de trabajo, 4 de infraestructura, 6 de economía), 14 tienen fuente primaria identificable; complejidad económica viene de un agregador. Para esos 14 aplica la regla primaria–intermediario del Source Registry: la cifra de IMCO es una vista derivada para posición relativa, no un segundo dato vigente.

## 2. Arquitectura de consulta

Cada tipo de contenido tiene una forma de almacenamiento propia; ninguno se responde leyendo el PDF en la conversación.

| Tipo de contenido | Forma recomendada | Por qué | Qué recibe Precision |
| --- | --- | --- | --- |
| Estadístico (indicadores y series) | Registro estructurado pre-consolidado: dimensiones, valor, unidad, periodo, fuente y localizador | Exactitud determinística, unos 400 caracteres por dato, sin llamada al modelo; se actualiza por periodo | Valor con `id@versión`, periodo, fuente y límites. Máximos y rankings se calculan en KL, no en el modelo |
| Normativo (obligaciones, trámites, plazos) | Ficha versionada redactada y validada por especialista, con cita a la fuente primaria (DOF); el texto legal queda como evidencia | El nivel 3 exige validación antes de interpretar; un fragmento de ley suelto no es orientación | Ficha breve, límite y marca de especialista |
| Consultivo (guías de preguntas, triggers, conocimiento general de servicio) | Ficha estructurada corta por categoría y etapa | Precision necesita la pauta, no el documento | Paquete de contexto por etapa y categoría |
| Metodológico (qué mide un índice, qué no permite) | Metadato de fuente e indicador con fragmento localizado del anexo | En la prueba, "¿el índice predice inversión?" solo se respondía con el anexo | Nota metodológica adjunta al dato |
| Documento cargado sin estructurar | No consumible | Subir no es publicar | Nada |

| Criterio | A · Documento | B · Estructurado | C · Híbrido (recomendado) |
| --- | --- | --- | --- |
| Precisión | Depende de que el modelo lea bien una página con 35 cifras; sin periodo ni fuente primaria | Exacta en datos; no responde metodología | Exacta en datos y con respaldo metodológico |
| Tokens por pregunta | Altos (páginas completas) | Mínimos | Mínimos; sube solo cuando cita evidencia |
| Latencia | Búsqueda más lectura por el modelo | Consulta por índice | Consulta por índice; búsqueda solo como respaldo |
| Confiabilidad | No aplica exclusiones ni vigencia | Aplica exclusiones, vigencia y versiones | Igual que B, con evidencia verificable |
| Mantenimiento | Bajo al cargar, alto al responder | Extracción y validación por publicación | Igual que B más fichas metodológicas |
| Actualización | Reemplazar el documento rompe citas | Nuevo periodo o versión sin romper historia | Igual que B |

**Del dato a la RAM, sin duplicar la fuente de verdad**

1. Precision traduce la necesidad a dimensiones (país, estado, tema o indicador, categoría, etapa); nada del cliente sale.
2. Si el paquete de RAM ya tiene ese `id@versión` vigente, responde sin llamadas.
3. Si no, consulta KL por dimensiones y recibe el registro compacto: valor, unidad, periodo, fuente, vigencia y límites. La evidencia localizada solo viaja si se pide la cita.
4. Precision usa el dato citando periodo y fuente. Si lo usa en un hallazgo, el proyecto guarda solo la referencia `id@versión`, no el dato como hecho del cliente.
5. KL cuenta el uso de ese `id` de forma anónima.
6. Si el uso supera el umbral por país, etapa o categoría, el agente de conocimiento lo copia al paquete de RAM como solo lectura, con manifiesto.
7. Una versión nueva, un vencimiento o una revocación en KL invalidan los paquetes cuyo manifiesto lo contiene; la RAM nunca se edita en Precision.

KL es la única fuente de verdad del dato. La RAM guarda copias referenciadas y la capa de equivalencias, que traduce términos y no contiene cifras.

## 3. Ingestión manual desde KL Admin

Subir un archivo no autoriza una fuente ni publica nada: la carga solo avanza si su fuente está registrada, y solo se publica tras revisión. Es el mismo canal que usa el KSeed inicial (D14, D17).

1. **Carga** (KL\_EDITOR). Elige una fuente registrada o la propone; sin fuente, la carga queda "en espera de fuente". Metadatos obligatorios: publicación, edición, fecha de publicación, procedencia o URL y licencia declarada.
2. **Validación del archivo**, antes de guardar. Tipo real por firma, no por extensión; solo PDF, DOCX, XLSX y CSV; máximo 50 MB; rechazo de archivos cifrados, con macros (XLSM, DOCM) o con contenido activo en PDF; antimalware; límite de descompresión; huella SHA-256 para detectar duplicados exactos; CSV en UTF-8 con delimitador declarado; en XLSX se leen valores, nunca se ejecutan fórmulas.
3. **Original inmutable.** Se guarda con huella, autor y fecha; nunca se modifica.
4. **Extracción** de texto y tablas con localizador (página, tabla, hoja y celda). Todo el contenido es dato: una instrucción escrita dentro del archivo se ignora.
5. **Clasificación.** Tipo de contenido, indicadores y entidades contra el modelo, marcas de percepción e índice, y tipo de cambio frente a lo publicado (§6.2).
6. **Control de calidad** automático: completitud, rangos, unidades contra metadatos, empates, nulos, coherencia valor–posición, cruce con la primaria y con la edición previa. Genera un informe.
7. **Revisión** (KL\_REVIEWER, nunca quien subió). Ve original, registros e informe; aprueba, corrige el mapeo o rechaza. No edita valores: un valor mal extraído se reextrae. Nivel 3 añade validación especializada.
8. **Publicación.** Aplica uso permitido y filtros, asigna versión y deja el registro consultable. Si sustituye algo, invalida la RAM afectada.
9. **Invalidación.** Revocar la fuente o la carga pasa sus registros a retirado y marca sus referencias en RAM y productos; la historia se conserva.

| Estado de la carga | Quién lo cambia | Consumible por Precision |
| --- | --- | --- |
| Recibida · rechazada en validación | Sistema | No |
| En espera de fuente | ADMIN al autorizar la fuente | No |
| Extraída · en revisión | Sistema · KL\_REVIEWER | No |
| Aprobada | KL\_REVIEWER | No |
| Publicada | Sistema, tras aprobación | Sí |
| Sustituida · retirada | Nueva versión · KL\_REVIEWER o ADMIN | Sustituida: solo como historia · retirada: no |

## 4. Cobertura y calidad por categoría

KL aporta contexto del mundo; los hechos del proyecto los obtiene Precision del cliente, y el criterio profesional queda en The Hive. KL no cambia readiness, estados ni reglas: la suficiencia por materialidad de Precision decide, y KL solo informa su cobertura (sufficient, partial, not\_available).

| Categoría (clave) | Lo obtiene Precision del cliente | Aporta KL (fuente) | Criterio de especialista |
| --- | --- | --- | --- |
| people\_payroll\_employment | Número y perfil de empleados, estados objetivo, contratación directa o por tercero | Informalidad, participación e ingreso por estado (S05); empleo formal y SBC (S09); salario mínimo y UMA (registro amplio) | Esquema de contratación, REPSE, costo total de nómina |
| corporate\_legal\_admin | Actividad, estructura accionaria, socios extranjeros, plazos | Trámites y requisitos generales, nivel 3 (S10; SE: SAS, RNIE) | Tipo societario, poderes, cumplimiento |
| tax\_accounting\_audit | Modelo de facturación, operaciones con partes relacionadas | Obligaciones generales (SAT, nivel 3); tipo de cambio FIX (S07) | Precios de transferencia, régimen fiscal |
| international\_trade\_customs | Productos, origen, volúmenes, programa de importación | Programas y aranceles a nivel guía (SNICE, VUCEM); exportaciones por estado | Clasificación arancelaria, autorización IMMEX |
| industrial\_real\_estate | Requisitos de terreno o nave, mercado destino, logística | Comparativos estatales y urbanos (S01–S03, solo posición relativa), PIB y actividad (S06), establecimientos agregados (S04) | Estudio de ubicación, due diligence |
| banking\_finance\_insurance | Monedas, flujos, necesidades de cuenta | FIX y tasa objetivo con fecha (S07) | Estructura financiera, coberturas |
| market\_intelligence | Producto, segmento, territorio | Establecimientos agregados (S04), PIB estatal (S06), contexto regional (S08) | Estudio de mercado y dimensionamiento |
| logistics | Tipo de carga, origen y destino, frecuencia | Fichas de puertos (registro amplio), conectividad aérea por estado (S01) | Ruta, costos y tiempos |

Calidad mínima de cada pieza consumible: fuente autorizada, periodo, vigencia, versión y uso permitido. Una cobertura parcial de KL nunca bloquea el avance del proyecto ni se convierte en requisito para el cliente.

## 5. Actualización y versionado

Nada se reemplaza en silencio: cada cambio es una versión o un periodo nuevo ligado al anterior, y ninguna RAM queda vigente sobre conocimiento retirado.

| Caso | Ejemplo real | Tratamiento en KL | Efecto en la RAM | Efecto en productos |
| --- | --- | --- | --- | --- |
| Nueva edición, mismo método | Nuevo trimestre de ENOE | Nuevo periodo; el anterior queda como historia | Invalidación y recompilación del paquete | Aviso y aprobación |
| Nueva edición con cambio de método | ICE 2026 sustituye un indicador y recalcula la historia | Revisión humana; la serie recalculada entra como serie nueva ligada, sin empalmar ediciones | No se promueve hasta aprobar | Aviso y aprobación |
| Ruptura de serie | IMSS incluye plataformas digitales desde enero de 2026 | Marca de ruptura en el periodo; comparar a través de ella lleva límite | El dato viaja con la nota | La nota se muestra |
| Indicador o fuente discontinuados | Mejora regulatoria del ONMR; CONAMER extinta | "Sin continuidad": solo historia con fecha; lo que lo cita pasa a "requiere revisión" | Se retira del paquete | Aviso |
| Corrección de la fuente | PIBE preliminar → revisado | Versión nueva ligada; nivel 1 se publica sola si pasa controles | Invalidación | Aviso y aprobación |
| Error de extracción propio | Unidad mal tomada (caso de la prueba) | Reextracción y versión nueva con origen "corrección beeside" | Invalidación | Aviso |
| Conflicto entre fuentes | IMCO frente a la primaria, mismo periodo, fuera de tolerancia | Revisión; no se corrige ninguna; para el dato vigente prevalece la primaria | Sin cambio hasta resolver | Sin cambio |
| Fuente revocada | Licencia retirada o error grave | ADMIN revoca: registros retirados, auditoría intacta | Invalidación inmediata; Precision consulta KL y recibe not\_available | Marcados para revisión |

Regla de vigencia: es vigente la última versión publicada y no retirada del periodo más reciente. Cada paquete de RAM lleva manifiesto de `id@versión`; si alguno cambia de estado, el paquete se descarta y se recompila, y mientras tanto Precision consulta KL directamente. Ante cualquier duda de clasificación, el cambio va a valoración humana.

## 6. Validación medible A/B/C

El híbrido fue el único que respondió las 23 preguntas, con 7 veces menos contexto total que la recuperación directa. Preguntas: 14 de dato puntual, 1 con alias ("Estado de México"), 1 sin valor, 1 de percepción, 1 de índice compuesto, 2 agregadas, 1 de metadato y 2 metodológicas. Las respuestas correctas se transcribieron a mano del PDF, sin usar el extractor.

| Métrica | A · Documento | B · Estructurado | C · Híbrido | Tipo |
| --- | --- | --- | --- | --- |
| Aciertos (de 23) | 20 | 21 | 23 | Medido |
| Dónde falla | Percepción servida sin exclusión; 2 agregadas que exigen leer 32 páginas | 2 metodológicas | — | Medido |
| Procedencia | Página, sin periodo ni fuente primaria | Fuente, periodo, versión y página | Igual que B más la línea de evidencia | Medido |
| Contexto mediano por pregunta | 5,505 caracteres | 339 | 392 | Medido |
| Contexto total de las 23 | 114,193 caracteres | 7,724 | 15,578 | Medido |
| Tokens totales | ≈ 28,500 | ≈ 1,900 | ≈ 3,900 | Estimado (caracteres / 4) |
| Latencia mediana de recuperación | 0.11 ms | 0.001 ms | 0.01 ms | Medido en memoria local |
| Mantenimiento por edición | Cargar el PDF | Extractor de unas 210 líneas y 4 defectos corregidos en 66 páginas | B más fichas metodológicas | Observado |

Límites de la prueba. En A, "acierto" significa que la cifra correcta estaba en las tres páginas recuperadas; un modelo todavía debe leerla bien entre unas 35 cifras por página, así que su exactitud real es igual o menor. No se ejecutó ningún modelo para redactar respuestas. Las latencias excluyen red, base de datos y lectura por el modelo, que en producción dominan y castigan más a A. Los tokens se calcularán con el tokenizador real en Design.

Reproducible con dos scripts y los textos de los documentos del proyecto, guardados en la carpeta KnowledgeLayer (`pruebas/ice2025`).

## 7. Cierre del bloque

**Cuestionamiento del enfoque.** Usar el ICE como base de datos de Precision no es lo mejor: es un lente comparativo de un intermediario con derechos reservados y periodos mezclados. Los datos vigentes deben venir de las primarias (INEGI, IMSS, Banxico); el ICE aporta posición relativa. Tampoco conviene la matriz completa para las 34 fuentes desde ahora: basta para el conjunto que se activará, y el resto espera en el registro amplio.

**Decisiones técnicas autónomas** (dentro de la arquitectura aprobada)

| ID | Decisión |
| --- | --- |
| T9 | Híbrido: registro estructurado como fuente de verdad estadística, ficha versionada para normativo y consultivo, documento como evidencia localizada. |
| T10 | Regla primaria–intermediario: una clave por concepto; el valor de IMCO es vista derivada para posición relativa. |
| T11 | Extracción completa para control de calidad; publicación solo del subconjunto objetivo aprobado. |
| T12 | Periodo inferido del anexo con marca de confianza; los estimados se marcan. |
| T13 | Tolerancia de redondeo entre documentos; se conserva la cifra más precisa. |
| T14 | DENUE solo en agregados; KL nunca guarda fichas de empresas. |
| T15 | FIX y tasa objetivo fuera de la RAM; solo consulta puntual con fecha. |
| T16 | Validación de archivos y estados de carga; el revisor no edita valores. |
| T17 | Configuración inicial de KL Admin (tabla en el Source Registry). |
| T18 | KL no calcula indicadores derivados sin metodología aprobada. |

**Riesgos**

- Cambios de formato de PDF entre ediciones rompen la extracción; el control 53 × 32 lo detecta, pero cada edición cuesta revisión.
- Licencias sin confirmar: IMCO (derechos reservados), Banxico (uso comercial) e IMSS (datos abiertos). Limitan productos, no la consulta interna.
- Transición CONAMER → ATDT: URLs y catálogos inestables; S10 queda bloqueada hasta verificar.
- La precisión muestral de ENOE por estado varía; se reporta con su periodo y sin sobreinterpretar diferencias pequeñas.
- Los tokens son estimados; si el tokenizador real difiere mucho, se recalibran los presupuestos de la RAM.

**Bloqueos reales de producto:** ninguno para Design. Antes de publicar contenido siguen pendientes los derechos de IMCO y DOF y los validadores especializados de nivel 3. Cuando lleguemos a Code, el ADMIN aprobará la activación de S04–S09 y del subconjunto ICE.
