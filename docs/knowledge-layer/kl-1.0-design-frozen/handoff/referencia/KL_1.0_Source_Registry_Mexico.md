# Source Registry México (trabajo)

Snapshot del 16-oct-2026 · canónico: https://claude.ai/code/artifact/f95a2dd1-f13e-4df4-aac3-37bad4e272a1 (pestaña Source Registry México)

Ninguna fuente nueva está activa: IMCO, INEGI y CCE/CEESP son instituciones madre aprobadas, pero cada publicación queda **candidata** hasta su autorización con alcance en KL Admin. Registro amplio investigado al 14-oct-2026; matriz funcional del conjunto inicial verificada al 15-oct-2026; "(no abierta)" = URL tomada de resultados de búsqueda porque el sitio bloqueó la consulta.

**Niveles:** 1 = estadístico estable (automatización gobernada) · 2 = índice, encuesta u opinión (revisión humana ante cambios) · 3 = normativo (validación especializada). **Excluidas por defecto:** fuentes comerciales (bancos, consultoras, empresas), salvo excepción aprobada por publicación o institución.

## Matriz funcional · conjunto inicial

Diez publicaciones forman el conjunto inicial de Precision: tres de IMCO como intermediario y siete primarias. Todas siguen como candidatas; ninguna se activa sin aprobación del ADMIN.

### Identidad, obtención y tiempo

| ID | Publicación · series | Rol | Granularidad | Formato · obtención | Periodicidad real · verificación | Periodo estadístico vs publicación |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | IMCO · ICE 2025 (libro, boletas, anexo): 53 indicadores en 6 subíndices, cifra y posición por estado | Intermediario (B): compila primarias y calcula un índice propio | 32 entidades · anual | PDF; sin base descargable; extracción de boletas con localizador de página | Anual (9-jun-2025) · no se monitorea (histórico) | Cada indicador tiene su año (2022–2024 según el anexo); la boleta no lo muestra |
| S02 | IMCO · ICE 2026: misma estructura (53 / 6) | Intermediario (B) | 32 entidades · anual | PDF (libro, boletas, anexo) | Anual (21-sep-2026) · mensual; semanal en la ventana de publicación (junio–octubre) | Periodo por indicador según su anexo (por verificar); serie histórica recalculada |
| S03 | IMCO · ICU 2026: 35 indicadores en 6 subíndices | Intermediario (B) | 72 zonas metropolitanas · anual | PDF | Anual (2-jun-2026) · igual que S02 | Igual que S01 |
| S04 | INEGI · DENUE: unidades económicas por clase SCIAN, estrato de personal y ubicación | Primaria (A) | Establecimiento georreferenciado, agregable a municipio y estado | API con token; descarga masiva CSV | Semestral (05/2026 publicada 20-may-2026; siguiente 25-nov-2026) · en la fecha del calendario INEGI | Mes de corte del directorio vs fecha de publicación |
| S05 | INEGI · ENOE: informalidad laboral, PEA, ocupación, tasa de participación, ingreso | Primaria (A) | Nacional mensual; 32 estados y 39 ciudades solo trimestral | Tabulados XLSX, microdatos, BIE / API con token | Mensual nacional y trimestral estatal (2T-2026 el 25-ago; 3T-2026 el 25-nov-2026) · en la fecha del calendario | Trimestre de referencia vs publicación (unas 8 semanas después) |
| S06 | INEGI · PIBE (PIB por entidad, anual, base 2018) e ITAEE (actividad estatal trimestral) | Primaria (A) | 32 entidades · anual y trimestral | BIE / API con token; XLSX | PIBE: 2025 preliminar el 7-dic-2026; ITAEE: 2T-2026 el 29-oct-2026 · en la fecha del calendario | Año o trimestre de referencia; preliminar → revisado es una corrección versionada |
| S07 | Banxico · SIE: tipo de cambio FIX (SF43718) y tasa objetivo (SF61745) | Primaria (A) | Nacional · diaria y por decisión de política monetaria | API REST con token | FIX cada día hábil, publicado en el DOF el día hábil siguiente; tasa objetivo por decisión (6.50% desde el 24-sep-2026) · diaria hábil | Fecha de determinación vs fecha de publicación en el DOF |
| S08 | Banxico · Reporte sobre las Economías Regionales | Primaria institucional (A), análisis | 4 regiones · trimestral | PDF | Trimestral (último 10-sep-2026) · en la fecha del calendario | Trimestre analizado vs publicación |
| S09 | IMSS · puestos de trabajo afiliados y salario base de cotización (SBC) promedio | Primaria (A) | Nacional, estado, sector y tamaño de patrón · mensual | Datos abiertos CSV; comunicado PDF | Mensual, 8–12 días después del cierre (septiembre 2026 publicado el 9-oct-2026) · mensual en esa ventana | Mes de referencia vs publicación |
| S10 | ATDT · Registro Nacional de Regulaciones y Portal Ciudadano Único (asumen funciones de CONAMER, extinta por la LNETB, DOF 16-jul-2025) | Primaria normativa (A), nivel 3 | Trámites federales, estatales y municipales | Web; URL oficial y cobertura por verificar (catalogonacional.gob.mx no verificable) | Continua · semanal cuando se active | Fecha de alta o reforma del trámite vs fecha de consulta |

### Uso, gobierno y relación con el catálogo

| ID | Vigencia | Método · unidades | Licencia | Validaciones | Uso Seed · KL · Productos | Categorías · service\_ids | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S01 | Histórica: no se sirve como dato vigente si la primaria tiene un periodo posterior | Min-max 0–100, ACP, grupos por percentil; unidad por indicador en el anexo; "no predice ni determina causalidad" | Derechos reservados: citar y parafrasear; reproducir tablas requiere permiso | Completitud 53 × 32; posición 1–32; monotonía valor–posición; unidad boleta vs anexo; empates; nulos; libro vs boletas con tolerancia de redondeo | Seed: no · KL: posición relativa con nota metodológica · Productos: cita, sin tablas | market\_intelligence (location\_studies), industrial\_real\_estate (industrial\_site\_selection), strategic\_advisory (reservada) | Histórico |
| S02 | Edición actual tras verificación | Igual que S01; un indicador sustituido y otro con método nuevo | Igual que S01 | S01 + comparación con ICE 2025: cambio metodológico → revisión humana (caso A05) | Igual que S01 | Igual que S01 | Candidata bloqueada hasta verificar |
| S03 | Hasta la siguiente edición | Índice por zona metropolitana | Igual que S01 | S01 + catálogo de zonas y municipios | KL: contexto urbano para ubicación · Productos: cita | industrial\_real\_estate (industrial\_site\_selection), corporate\_real\_estate, market\_intelligence (location\_studies) | Candidata |
| S04 | Hasta la siguiente edición | SCIAN; personal en rangos, no conteos | Términos INEGI: uso comercial con atribución "Fuente: INEGI" | Variación por estado y sector vs edición previa; claves SCIAN válidas | Seed: agregados por estado y sector si se promueven · KL: solo agregados, nunca fichas de empresas · Productos: agregados con fuente | market\_intelligence (market\_sizing, industry\_research), procurement\_supply\_chain | Candidata |
| S05 | Hasta el siguiente trimestre | Encuesta por muestreo; precisión estadística por estado | Términos INEGI | Rango plausible; coeficiente de variación; periodo previo; concepto vs IMCO | Seed: informalidad y participación por estado · KL: series · Productos: con periodo | people\_payroll\_employment (recruitment, payroll\_processing, compensation\_studies, temporary\_staffing), corporate\_legal\_admin (labor\_legal\_support) | Candidata |
| S06 | Hasta la siguiente cifra | Base 2018; precios constantes y corrientes | Términos INEGI | Suma estatal vs nacional; preliminar → revisado | Seed: PIB y crecimiento por estado · KL: series; per cápita solo si una fuente lo publica · Productos: con periodo | market\_intelligence (market\_sizing), industrial\_real\_estate (industrial\_site\_selection), strategic\_advisory | Candidata |
| S07 | FIX: un día; tasa: hasta la siguiente decisión | Pesos por dólar; tasa anual | Reproducción citando fuente y URL; uso comercial no mencionado (verificar) | Día hábil; salto sobre umbral → revisión; SIE vs DOF | Seed: no (volátil) · KL: consulta puntual con fecha · Productos: solo "al \<fecha>" | banking\_finance\_insurance (foreign\_exchange\_fx, corporate\_banking), tax\_accounting\_audit (tax\_compliance) | Candidata |
| S08 | Hasta el siguiente reporte | Análisis regional; incluye encuestas de opinión empresarial | Igual que S07 | Separar opinión y expectativas (excluidas) de datos | Seed: resumen regional si se promueve · KL: contexto citado · Productos: sin cifras de opinión | strategic\_advisory, market\_intelligence (industry\_research) | Candidata |
| S09 | Hasta el siguiente mes | Puestos, no personas; SBC en pesos diarios; ruptura de serie desde ene-2026 (plataformas digitales) | Datos abiertos: licencia por verificar | Ruptura marcada; empleo formal ≠ empleo total; variación vs mes previo | Seed: puestos por estado con nota · KL: series · Productos: con nota de ruptura | people\_payroll\_employment (payroll\_processing, recruitment, employee\_benefits) | Candidata |
| S10 | La de cada trámite | Ficha de trámite: requisitos, plazos, costos | Por verificar | URL oficial; contraste con el DOF | Seed: no · KL: existencia y requisitos generales con validación especializada · Productos: enlazar | corporate\_legal\_admin (company\_incorporation\_corporate\_setup), industrial\_infrastructure, certifications\_quality | Candidata bloqueada (verificar) |

Las claves de categoría y servicio son las del catálogo provisional de Precision 2.0 (rama feature/precision-v2-f5); KL las referencia, no las define.

## Regla primaria–intermediario

Un concepto tiene una sola clave, por ejemplo tasa de informalidad laboral por estado. El dato vigente viene de la primaria (ENOE); el valor de IMCO se guarda como vista derivada ligada a ella ("derivado de", "mismo concepto que") y solo responde preguntas de posición relativa, con nota metodológica.

- Mismo periodo y cifras distintas fuera de la tolerancia de redondeo: diferencia de método, no conflicto. Se documenta; no se corrige ninguna.
- KL no recalcula indicadores de IMCO ni deriva otros (p. ej., per cápita) sin metodología aprobada.
- De ICE 2025 se extraen los 53 indicadores para el control de calidad, pero solo se publica como consumible el subconjunto objetivo aprobado; el resto queda extraído y no publicado.

## Configuración inicial de KL Admin

| Parámetro | Valor inicial | Justificación |
| --- | --- | --- |
| Verificación de fuentes con calendario (INEGI, IMSS, Banxico) | El día publicado en el calendario oficial; reintentos a T+1 y T+3 días hábiles | La periodicidad real es conocida; sondear a diario gasta sin aportar |
| Verificación de fuentes sin calendario (IMCO, OCDE) | Mensual; semanal en la ventana habitual de publicación | ICE e ICU se publican una vez al año en fechas variables |
| Verificación normativa (DOF, SAT, ATDT) | Diaria (DOF) y semanal (resto) | Nivel 3; el DOF es la evidencia |
| Alerta por publicación atrasada | 5 días hábiles después de la fecha esperada | Evita servir como vigente un dato que ya debió renovarse |
| Vigencia por defecto | Hasta la siguiente publicación esperada; después se sirve como "último disponible, periodo X" con cobertura parcial | No se borra; Precision recibe el límite |
| Anomalía estadística (nivel 1) | Variación frente al periodo previo mayor que 3 desviaciones estándar de las variaciones históricas de la serie → revisión humana | Umbral propio de cada serie; se recalibra con la línea base |
| Tolerancia entre documentos | Diferencia dentro de la precisión mostrada = mismo dato; se conserva el de mayor precisión | Caso real: libro 378.86 vs boletas 379 (terminales punto de venta, CDMX) |
| Indicadores de percepción | Excluidos de lo consumible (ICE: percepción de seguridad y de corrupción estatal) | D2 |
| Índices compuestos y subíndices | Solo contexto, con nota metodológica; nunca recalculados | D2 |
| Uso permitido por defecto en clase B | Cita y paráfrasis con atribución | Derechos reservados de IMCO |
| Carga manual | PDF, DOCX, XLSX y CSV; máximo 50 MB por archivo | Formatos del alcance; cubre boletas y anexos |
| Presupuesto del agente | Por ejecución y mensual; 3 reintentos; corte por bucle | §6.4 de la especificación |

## Registro amplio · estadística, competitividad y contexto

| # | Institución · recurso | Dominio | Nivel | Periodicidad | Monitoreo propuesto | Uso y riesgo | Actualización | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | IMCO · [ICE 2026](https://imco.org.mx/indice-de-competitividad-estatal-2026/): [libro](https://imco.org.mx/wp-content/uploads/2026/09/Indice-de-Competitividad-Estatal-2026-comprimido.pdf), [boletas](https://imco.org.mx/wp-content/uploads/2026/09/ICE-2026-Boletas-por-estado.pdf), [anexo](https://imco.org.mx/wp-content/uploads/2026/09/anexo_metodologico_ICE_2026-2.pdf) | Competitividad estatal | 2 | Anual (21-sep-2026) | Mensual | Derechos reservados: citar y parafrasear. Incluye percepción; serie recalculada hacia atrás; sin base de datos | PDF, extracción con IA + revisión | Candidata (P4) |
| 2 | IMCO · ICE 2025 (libro, boletas, anexo) | Competitividad estatal | 2 | — | No se monitorea | Igual que 1 | Cargado en el proyecto | Histórico |
| 3 | IMCO · [ICU 2026](https://imco.org.mx/indice-de-competitividad-urbana-2026-2/) | Competitividad urbana (72 zonas) | 2 | Anual (2-jun-2026) | Mensual | Igual que 1 | PDF | Candidata |
| 4 | INEGI · [API Banco de Indicadores](https://www.inegi.org.mx/servicios/api_indicadores.html) | PIB, actividad, empleo | 1 | Según serie | Según [calendario INEGI](https://www.inegi.org.mx/contenidos/saladeprensa/doc/cal_2026.pdf) | [Libre uso](https://www.inegi.org.mx/inegi/terminos.html), comercial con atribución. Revisiones de cifras | API con token | Candidata |
| 5 | INEGI · [INPC](https://www.inegi.org.mx/temas/inpc/) | Inflación | 1 | Quincenal y mensual | Según calendario | Libre uso. Cambios de base | API | Candidata |
| 6 | INEGI · [UMA](https://www.inegi.org.mx/temas/uma/) | Valor de referencia | 1 | Anual (enero; vigente 1-feb) | Anual, enero | Libre uso. No confundir con salario mínimo | PDF y API | Candidata |
| 7 | INEGI · [DENUE](https://www.inegi.org.mx/temas/directorio/) | Establecimientos | 1 | Semestral | Semestral | Libre uso. Rangos de personal, no conteos | API con token | Candidata |
| 8 | INEGI · [ENCRIGE](https://www.inegi.org.mx/rnm/index.php/catalog/691) | Calidad regulatoria en empresas | 2 | Última edición 2020 | Anual | Separar experiencia documentada de percepción; dato antiguo | PDF y XLS | Candidata |
| 9 | Banxico · [SIE](https://www.banxico.org.mx/SieAPIRest/service/v1/doc/series) | Tipo de cambio FIX, tasas | 1 | Diaria | Diaria | Términos no localizados (verificar) | API con token | Candidata |
| 10 | SE · Estadística oficial de IED | Inversión extranjera | 1 | Trimestral | Trimestral | Público. Cifras preliminares que se revisan | PDF y XLS (no abierta) | Candidata |
| 11 | SE + INEGI · [Data México](https://www.economia.gob.mx/datamexico/) | Perfiles de lugares e industrias | 1 | Variable | Mensual | Agregador: citar la fuente primaria | Web | Candidata (solo navegación) |
| 12 | IMSS · Datos abiertos | Empleo formal | 1 | Mensual (verificar) | Mensual | Empleo formal no es empleo total | CSV (no abierta) | Candidata |
| 13 | ASIPONA Manzanillo · Estadística portuaria | Puertos | 1 | Mensual (verificar) | Mensual | Contenido no legible al consultar | HTML y PDF | Candidata |
| 14 | CCE / CEESP · [Análisis económico](https://ceesp.org.mx/) | Coyuntura | 2 | Semanal | Mensual | Posición gremial, no neutral: contexto interno, no hechos de país | HTML | Candidata |
| 15 | OCDE · [Economic Survey Mexico 2026](https://www.oecd.org/en/publications/oecd-economic-surveys-mexico-2026_8a7c0ac4-en.html) | Diagnóstico macro | 2 | Bienal | Anual | Licencia por verificar | PDF | Candidata |
| 16 | Banco Mundial · [B-READY](https://www.worldbank.org/en/businessready/about-us/covered-economies) | Comparación regulatoria | 1 | Anual | Anual | CC BY 4.0. México no está en la edición 2025 | API | Candidata |

## Registro complementario · normativa legal, fiscal, laboral y aduanera (nivel 3: validación especializada)

| # | Institución · recurso | Dominio | Periodicidad | Monitoreo propuesto | Uso y riesgo | Actualización | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 17 | SEGOB · [DOF / SIDOF](https://sidof.segob.gob.mx/avisoLegal) | Publicación oficial | Diaria | Diaria | Reproducción con lucro requiere consentimiento escrito de SEGOB: citar y enlazar | RSS y PDF | Candidata (P2) |
| 18 | Cámara de Diputados · [LeyesBiblio](https://www.diputados.gob.mx/LeyesBiblio/index.htm) | Leyes federales vigentes | Continua | Semanal | Compilación, no versión oficial: detecta cambios; la evidencia es el DOF | HTML y PDF | Candidata |
| 19 | SAT · [RMF 2026 y RGCE 2026](https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2026.html) | Fiscal y comercio exterior | Anual + modificaciones (4 en 2026) | Semanal | Versiones anticipadas sin vigencia | PDF | Candidata |
| 20 | Congresos y tesorerías estatales · Impuesto sobre nóminas | Fiscal estatal (32) | Anual (diciembre) | Anual, enero | 32 regímenes; no generalizar una tasa | Sin URL única | Candidata |
| 21 | SE · [RNIE](https://rnie.economia.gob.mx/RNIE/faces/preguntas.xhtml) | Inversión extranjera | Por acuerdo | Trimestral | Umbrales y plazos cambian | HTML | Candidata |
| 22 | SE · Constitución de SAS en línea | Sociedades | Con reformas | Semestral | Requisitos por verificar | HTML (no abierta) | Candidata |
| 23 | SE · SIGER / Registro Público de Comercio | Registro mercantil | Consulta | No se monitorea | Costos estatales distintos | Web con acceso | Candidata (solo referencia) |
| 24 | CONASAMI / DOF · Salarios mínimos | Laboral | Anual (DOF en diciembre, vigente 1-ene) | Anual, diciembre | Contrastar con el DOF | HTML y PDF | Candidata |
| 25 | Cámara de Diputados · [Reformas a la LFT](https://www.diputados.gob.mx/LeyesBiblio/ref/lft.htm) | Laboral | Irregular | Semanal | Transitorios graduales | HTML | Candidata |
| 26 | STPS · [REPSE](https://repse.stps.gob.mx/) | Subcontratación | Consulta | Mensual | Padrón; un registro vencido cambia obligaciones | Web | Candidata |
| 27 | IMSS · [Patrones](https://www.imss.gob.mx/patrones) | Seguridad social | Con la LSS, UMA y salario mínimo | Trimestral | Cuotas dependen de SBC y UMA | HTML | Candidata |
| 28 | INFONAVIT · [Portal](https://portalmx.infonavit.org.mx/) | Vivienda (aportaciones) | Irregular | Semestral | Términos propios; reforma 2025 | HTML | Candidata |
| 29 | ANAM · Portal de aduanas | Aduanas | Irregular | Semanal | Normativa compartida con SAT | HTML (no abierta) | Candidata |
| 30 | SE · [SNICE](https://www.snice.gob.mx/cs/avi/snice/hce.calc.origen2020.html), TIGIE y LIGIE | Aranceles y origen | Muy frecuente | Diaria | Clasificar es asesoría experta: solo nivel guía | Web | Candidata |
| 31 | SE / VUCEM · IMMEX y origen T-MEC | Programas de comercio exterior | Por trámite | Trimestral | Ligado a RGCE | HTML (no abierta) | Candidata |
| 32 | SICT · ATTRAPI (sustituye a la ARTF, DOF 13-ene-2026) | Ferrocarril | Irregular | Semestral | Normas que aún citan a la ARTF | HTML y PDF | Candidata |
| 33 | IMPI · MARCANET | Propiedad industrial | Consulta | No se monitorea | Una búsqueda no sustituye el dictamen | Web | Candidata (solo referencia) |
| 34 | ATDT · Registro Nacional de Regulaciones y Portal Ciudadano Único (sustituyen a CONAMER, extinta por la LNETB, DOF 16-jul-2025) | Trámites y regulaciones | Continua | Semanal | Transición institucional: fichas que citen a CONAMER requieren revisión; catalogonacional.gob.mx no verificable | Web (URL por verificar) | Candidata bloqueada (S10) |

**Regla de dato para normativa:** cada dato guarda fuente primaria (DOF o documento firmado), fecha de publicación, fecha de vigencia y jurisdicción. LeyesBiblio y el SAT sirven para detectar cambios; el DOF es la evidencia.

**Fuentes de la investigación:** páginas enlazadas arriba, más [Libre Uso MX](http://datos.gob.mx/libreusomx/) como licencia de referencia para datos federales abiertos.
