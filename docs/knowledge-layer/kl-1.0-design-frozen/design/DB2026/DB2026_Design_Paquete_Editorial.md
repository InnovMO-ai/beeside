# Doing Business México 2026 · Design del paquete editorial (macrobloque 3)

Estado: Design consolidado (16-oct-2026) con las decisiones PO-4 a PO-7. No activa fuentes, no aprueba contenido factual, no modifica Workspace, Precision ni código productivo, y no inicia Code.
Insumos: `Doing_Business_Mexico_2026_beeside_v3_EN.pdf` (sha256 `9a98…`; la copia `… 2.pdf` en la raíz solo difiere en el manifiesto C2PA), `beeside_KL_Mexico_Source_Registry_v2.xlsx`, `README_KL_Handoff.md` y los tres archivos de logotipo. No falta ningún archivo.
Anexos: `DB2026_prototipo_definitivo.pdf` (tema B, 5 páginas reales de v3), `DB2026_Trazabilidad_Fuentes.xlsx` (entregables 3 y F), generador en `prototipos/db2026-gen/`, y en `historico/` el comparativo A/B y los PDF A y B de la exploración.

**Decisiones del PO (16-oct-2026):** PO-4 dirección visual B · PO-5 términos canónicos (CRP, My Service Map, Discovery) · PO-6 periodicidad seleccionable, DB semestral, sin monitoreo diario · PO-7 `discovery_start = https://beeside.you` hasta el paso a producción.

---

## 1. Evaluación editorial y visual

**Lo que v3 resuelve bien y se conserva.** Enfoque ejecutivo por decisión, no por directorio de trámites; seis pilares; cada página con título-tesis, dek, Key Insight, tabla de decisión y nota de alcance ("SCOPE", "READ WITH CARE", "IMPORTANT"); mapa de seis decisiones (p16); prólogo del fundador; experiencia beeside (p17–18); directorio de fuentes con periodo (p19) y notas de publicación (p20). La voz es prudente y separa dato, interpretación y límite: es compatible con R10 y con `usage: citable | context_only`.

**Sistema visual extraído (A).** A4 vertical; márgenes 18 mm; encabezado corrido a 13 mm (marca en morado editorial `#4D297D`, país/página en gris) y pie con versión, abeja y folio; una sola familia (Lato 300/400/700/900 en v3; en producción Public Sans sigue siendo la provisional del sistema de reportes y Lato entra solo con su verificación, ver §6); jerarquía: eyebrow 7.7 pt mayúsculas → título 26 pt regular → dek 9.3 pt gris con filete → cuerpo 10.6 pt; KPI 23.7 pt con etiqueta y fuente; Key Insight en panel charcoal `#2E2E33`; tablas con encabezado gris claro `#F3F3F3` y filas aireadas; notas con etiqueta en negrita. Paleta: tinta `#202020`, gris `#626262`, un solo acento morado. Sin imágenes ni decoración. Medido y reproducido en `historico/theme-a.css`; el tema definitivo (B) está en `prototipos/db2026-gen/theme.css`.

**Defectos (F).** Detalle en la hoja *Defectos* (17). Resumen:

- *Maquetación (13; el generador los elimina sin tocar contenido):* texto oculto bajo cajas en p1, p11, p14–15 y p18 (lo leen los lectores de pantalla y la extracción); hueco dentro del Key Insight (p7); Key Insight oscuro solo en p6, p8 y p15; títulos en Helvetica no incrustada (p6, p11, p17, p20); barra de IED sin leyenda (p5); folio duplicado; abeja en p2 contra la regla del README; falta el "01" del journey (p18); marcadores [01]… sin enlace; CTA sin enlace; PDF sin etiquetado ni idioma.
- *Sustantivos (4; requieren validación o decisión):* afirmaciones sin referencia (IED, aguinaldo, vacaciones, prima, jornada 48→40, USMCA); referencias débiles ([01] cubre cuatro datasets con un enlace de IGAE, [11] apunta a `sidofqa` —host de QA—, [07]–[09] usan páginas del SAT en vez de la ley, [13] y [23] son orientación de STPS/PROFEDET); terminología del journey; procedencia (manifiesto C2PA: generado con ChatGPT). Uno oculto es además sustantivo: "Updated every six months" (p1) contradice el README.

**Consecuencia de la procedencia.** v3 es la referencia editorial y visual, no una fuente. Su texto entra a KL como fichas versionadas en revisión; ninguna frase llega al PDF publicado si no es una afirmación aprobada (`claimId`), según CR-KL-001.

**Logotipos (C).** `logo_lockup_correct.png` es el maestro de uso: lockup horizontal, wordmark negro y abeja `#5D36B4`, recortado al borde, 1908 px (suficiente para 70 mm a 600 dpi). `beeside abeja lateral.png` es el mismo lockup con margen. `logo beeside.svg` no es vectorial: es un PNG incrustado con máscara (exportación de Canva) con la abeja en otro morado (`#573C9E`); no se usa. Variantes correctas sin alterar la marca: (1) portada: lockup completo, 70 mm; (2) pie: la abeja recortada del mismo lockup, 4.4 mm, sin recolorear; (3) encabezado: texto "beeside" en Lato, no logotipo. No hay variante en negativo: el diseño no la necesita (fondos blancos). Pendiente de marca: un maestro vectorial y un morado oficial (hoy conviven `#4D297D`, `#5D36B4`, `#573C9E`, `#7357C1`/`#2E0879`).

**Enlaces administrables (H).** Ningún URL de producto vive en el contenido. El bloque `cta_link` guarda una clave (`kl.links.discovery_start`, `kl.links.journey_guide`, `kl.links.edition_verify`) que KL Admin resuelve al componer; el valor queda congelado en el manifiesto de la edición (AC-10). El URL de verificación es la página pública de estado de edición (PO-2), con identificador no predecible. `discovery_start = https://beeside.you`, confirmado por el PO para la etapa de estabilización (PO-7); al pasar a producción se cambia en configuración, sin tocar contenido ni plantillas.

**Viabilidad arquitectónica.** Todo v3 cabe en `ReportDocument` + `report-model.ts` + Playwright con bloques nuevos (sección 4) y un paso de paginación en el navegador antes de `page.pdf()`. Probado en A4 con los dos temas: bytes normalizados idénticos entre corridas, texto y PNG idénticos, `Tagged: yes`, `/Outlines`, `/Lang (en)`, 594.96 × 841.92 pt, referencias enlazadas; estrés (tablas ×6, párrafos ×5): 7 páginas, 0 errores, 0 lint, tablas partidas con encabezado repetido.

**Tratamiento ES/EN.** Se propone: fichas maestras en español (normativo y validación); el texto de v3 se usa como borrador del equivalente inglés de cada ficha; cada `claimId` tiene par ES/EN revisado; la edición se aprueba y publica en ambos idiomas a la vez (PO-3, D22). Cifras, fechas y referencias salen de la ficha, no del texto traducido, para que no diverjan. Esto sustituye la regla del Excel "PDF en inglés primero" (hoja *Coverage*), que contradecía D22; resuelto con el PO.

## 2. Mapeo 6 pilares ↔ 12 capítulos internos

La edición publica 6 pilares; los 12 capítulos siguen siendo la estructura interna de KL (fichas, alcance de fuentes, revisión especializada). Cada bloque del PDF declara `chapter` y `pillar`; un capítulo puede alimentar varias páginas y viceversa.

| Página v3 | Bloque visible | Pilar | Capítulos internos |
|---|---|---|---|
| 1 | Portada | — | — |
| 2 | Prólogo del fundador | bloque fijo `founder_letter@3.0` | — (texto aprobado por el PO, nunca generado) |
| 3 | Mexico at a glance | Resumen | 00, 01 |
| 4–5 | Market opportunity / FDI | 01 Mercado | 01 (y 02 en lo regional) |
| 6–7 | Market entry / local presence | 02 Entrada | 03, 04 |
| 8–9 | Tax / margin and cash | 03 Fiscal | 07 (y 08 en importación) |
| 10–11 | Talent / working-time | 04 Talento | 06 |
| 12–13 | Location / operating cost | 05 Ubicación | 02, 05, 08 (logística) |
| 14–15 | Regulatory readiness | 06 Regulatorio | 04, 08, 09 |
| 16 | Decision map | bloque fijo editorial | 00 |
| 17–18 | Why beeside / journey | bloque fijo | 11 |
| 19 | Sources directory | generado | 12 (manifiesto) |
| 20 | Publication notes | generado | 12 |

Capítulo **10 (Perfiles estatales)** no se publica en la edición nacional (v3 lo dice en p12: anexo opcional). Sigue disponible en KL para Precision. Si el PO quiere anexo estatal, es otra edición con su propio manifiesto.

## 3. Trazabilidad y brechas de fuentes

En `DB2026_Trazabilidad_Fuentes.xlsx`:

- *Afirmaciones* (27): página, pilar, contenido, tipo, fuente indicada, fuente oficial exacta por verificar, periodo, licencia, riesgo, revisión y estado (todas "Por verificar"). 17 de riesgo alto; 16 sin referencia en el cuerpo.
- *Fuentes PDF* (26): URL real de cada referencia, hallazgo, fuente a usar e ID del Excel y del canon, sin renombrar.
- *Excel vs canon*: choque de prefijos (MX-S01 = INEGI frente a S01 = IMCO ICE 2025), datasets MX-D como publicaciones candidatas, "Verificada – registro fuente" ≠ aprobación, altas y faltantes, conflictos de calendario e idioma, derechos del DOF (R17).

El Excel se trata como registro curado inicial: ninguna de sus filas activa una fuente.

## 4. Diseño de componentes

Bloques nuevos de `ReportDocument` (todos con `chapter`, `pillar`, `lang` y, si llevan datos, `claimIds[]` y `refs[]`):

| Bloque | Contenido | Regla de composición |
|---|---|---|
| `guide_cover` | título en tres líneas, año, tagline, edición, editor | página sin encabezado ni pie; lockup 70 mm |
| `founder_letter` | referencia a bloque fijo versionado | texto inmutable; nunca pasa por IA ni por reescritura |
| `section_header` | eyebrow (pilar), título, dek | `keep-with-next` |
| `kpi_row` | 2–4 KPI: valor, etiqueta, periodo, `ref` | indivisible; valor solo desde afirmación aprobada |
| `key_insight` | etiqueta + párrafo | un solo tratamiento; indivisible |
| `labelled_text` / `two_columns` | etiqueta + párrafo(s) | divisible por párrafo |
| `matrix_table` | caption, columnas, filas | se parte por filas con encabezado repetido y "(continued)" |
| `numbered_steps` / `journey` | pasos numerados 01–05 | numeración generada, no escrita |
| `timeline` | hitos con año y valor | indivisible |
| `bar_breakdown` | segmentos con valor y leyenda | leyenda obligatoria; suma validada |
| `editorial_note` | etiqueta + texto | clase `scope`, `caution`, `important` |
| `cta_link` | texto + clave de configuración | URL resuelto y congelado en el manifiesto |
| `sources_directory` | generado del manifiesto | cada `ref` del cuerpo enlaza aquí |
| `publication_notes` | versión, fecha de corte, cambios | generado |

**Paginador y lint.** Paso determinista en Chromium antes de imprimir: coloca bloques mientras quepan; si no, el bloque pasa a la página siguiente con su encabezado (`keep-with-next`); las tablas se parten por filas; un bloque indivisible que no cabe en una página vacía **detiene la publicación** (nunca se reduce letra ni se recorta). El lint rechaza elementos fuera de página, texto recortado y desborde del cuerpo. Encabezado, pie y folio se generan por página. Con esto el número de páginas es variable (G) sin solapamientos.

## 5. Prototipo y comparativo

Generador de prototipo (contenido literal de 4 páginas de v3, marcado "DESIGN PROTOTYPE · CONTENT NOT YET VALIDATED") y comparativo A/B publicado. A = v3 corregida; B = misma estructura con mejor lectura (medida de línea, KPI con fuente junto, tablas 22 % más bajas, pilar en el encabezado, folio único). **El PO eligió B (PO-4).** El tema A y el comparativo quedan en histórico. Al prototipo definitivo se añadió la página del journey (p18) con los términos canónicos y el `cta_link` resuelto desde configuración. La sustitución de términos queda registrada en `editorialChanges` del contenido.

## 6. Impacto en contratos, AC y pruebas

- **Spec y matriz:** papel **A4** para la edición (el formato carta solo fue del artefacto técnico de AC-10); **Public Sans se mantiene provisional** y Lato entra en el tema `db.v3b` solo tras verificar disponibilidad, licencia (OFL) y compatibilidad en el worker; probado que el tema compone igual con Public Sans (0 errores, 0 lint, determinista).
- **Periodicidad (PO-6):** enumerado `kl.cadence` (semanal, mensual, trimestral, semestral, anual, no actualizar) en productos y publicaciones; DB semestral; sin valor diario; acciones manuales auditadas.
- **`kl.v1`:** sin cambios de forma. Se añade al manifiesto de edición: `theme`, `links{clave: url}`, `blocks[].claimIds`, `fixedBlocks{founder_letter: "3.0"}`. Ningún ID canónico cambia.
- **CR-KL-001:** propuesta técnica aprobada por el PO, pendiente de aceptación del responsable de Precision; mientras tanto KL entrega `approvedClaims: []`. El PDF aplica la misma regla (solo afirmaciones aprobadas) sin depender de Precision.
- **AC-10:** se amplía la prueba de tres niveles al paginador (mismo manifiesto → mismo `paged.html` → mismo PDF normalizado).
- **AC-13:** ya probado en A4 (etiquetado, outline, idioma, enlaces).
- **Pruebas nuevas:** paginación con contenido de estrés; bloque indivisible demasiado alto → falla cerrada; lint sin hallazgos; cada `ref` del cuerpo resuelve a una entrada del directorio; `cta_link` sin clave configurada → falla; `founder_letter` con huella distinta a la versión aprobada → falla; paridad ES/EN de `claimIds`.

## 7. Design Readiness

**Design del paquete Doing Business está cerrado.** Las cuatro decisiones pedidas quedaron resueltas (PO-4 a PO-7) y no hay contradicciones fundacionales abiertas.

Pendientes que no son de Design (clasificados en la Matriz §6):

- **Técnicos de Code:** bloques y paginador (I22), periodicidad (I23), enlaces (I24), verificación de Lato en el worker (B7), Chromium fijado (B6).
- **Condiciones de publicación:** verificación de las 27 afirmaciones y sus fuentes (C5), derechos y licencias (C3), validadores (C2), texto aprobado ES/EN (C7), enlace de producción (C9). Opcional: maestro vectorial del logotipo y morado oficial (C10).
- **Logotipos:** los cinco SVG enviados por el PO el 16-oct no llegaron a la sesión. No hacen falta: el PDF usa el lockup del handoff sin alterar y la abeja recortada de él; no hay fondos oscuros que pidan la versión en blanco.
