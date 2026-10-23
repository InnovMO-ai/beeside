# Precision · F4 Visual POC — Handoff para continuar en Design (8 oct 2026)

**Estado:** F4 VISUAL POC / DESIGN PROOF **AUTORIZADO por el PO**. Falta recibir la IDEA DE DISEÑO del PO. F5 BUILD NO autorizado.

## 1. Decisiones del PO ya tomadas (8 oct)
1. **Recomendación A aprobada:** un shell conversacional + un componente de documento reutilizable para PSM, CRP y vista previa de envío. ~9 composiciones principales; móvil solo en estados clave. No añadir pantallas sin necesidad real de producto.
2. **K-2:** el destinatario de la propuesta se captura solo como **función / tipo de destinatario** (tú, dirección general, finanzas, legal, procurement, otra persona del equipo, otro rol). Labels NO congelados, revisar UX. Sin nombres de personas en Precision; los nombres se completan después en Operation Hub.
3. **K-4:** la **vista previa antes de "Send to Operation Hub"** entra al POC como patrón evaluable (no canónico todavía). Cuatro bloques: identidad del proyecto, PSM vigente confirmado, CRP correspondiente, contexto de Empresa/Proyecto permitido. Mismo componente que PSM y CRP. Sin JSON, payloads, esquemas, ClickUp, proveedores ni identificadores técnicos.
4. **PSM visible y completo:** como resumen durante el journey y como página completa; confirmado/pendiente, versiones v1.0 → v2.0 sin reemplazo silencioso, navegación a Precision by Category y a los CRP.
5. **CRP de cliente:** sin matching de proveedores, nombres de proveedores, shortlist ni operación de The Hive.
6. **OH = SIMULATED/STUB.** Premium = ACTIVE simulado (fixture). El cliente no ve las palabras mock/stub/simulación; la capa de revisión del PO sí rotula Premium simulado, OH simulado, datos sintéticos.
7. **No mostrar "Contact my Sherpa".** Ayuda general siempre visible (Help, FAQ, Contact beeside).
8. **Deltas canónicos (K-4, Project Manifest v2, corrección del informe GT, documentos single-writer): NO aplicar.** Quedan como PROPOSED DELTAS; si el patrón se aprueba, preparar deltas formales para el writer antes de F5.
9. **Formato preferido:** HTML navegable (no solo wireframes). Debe poder revisarse rápido y ajustarse sin entrar a BUILD.

## 2. Recorrido mínimo a poder evaluar
Premium simulado → entrada a Precision → Understanding → PSM → Precision by Category → CRP → vista previa de envío → Send to OH simulado → estado de confirmación. Sin todos los edge cases en la primera pasada.

## 3. Qué se hizo y qué NO sirvió
- Se construyó un prototipo HTML navegable (guion determinista, datos sintéticos; Premium/OH simulados; capa de revisión PO; esperas con perfiles de latencia F4; móvil). Funcionaba de punta a punta en pruebas headless.
- **El PO indicó que la dirección de diseño no es lo que busca** y pidió pasar a Design con su propia idea. No se publicó. Referencia de lo construido: `claude/precision-visual-poc-html-prototype-v0-2026-10-08.html` (solo consulta; no es canon ni baseline).
- Aprendizaje útil del intento (no vinculante): la gramática de estados (Confirmado / Estimado / Pendiente / No aplica; No preguntado solo en vista interna), el guion de conversación (reutilizar lo conocido, una pregunta por turno, volumen por cantidad sin montos, headcount solo si hay dependencia) y los copys propuestos ya cumplen la Guía de Voz v1.

## 4. Reglas congeladas que Design debe respetar
- Plan completo: `claude/precision-visual-poc-plan-2026-10-08.md` (objetivos, recorridos, pantallas, criterios V1–V24, fallos críticos FC1–FC10, riesgos K-1…K-12).
- Voz: tuteo, una sola pregunta por turno, sin repreguntar lo conocido, sin juicios de calidad, "no mapeado" ≠ "fuera de alcance", sin Sherpa antes de tiempo, sin etiquetas internas (new:<slug>, _generic, CONTEXT_ONLY…).
- PSM inmutable tras confirmar; cambio material = nueva versión; "Add a Service" solo tras confirmar el PSM. Confirmar el PSM NO activa OH; el disparador es el primer CRP + acción explícita "Send to Operation Hub".
- Pendiente no bloquea nunca: "Completar ahora / Continuar con información pendiente" con igual peso; "Dependencia para la ejecución".
- Espera: F4 p50 ≈ 7.1 s, p95 ≈ 11 s; sin porcentajes ni promesas falsas.
- Sin nombres de personas ligadas a estructura societaria (ZDR diferido). Sin pago, checkout ni bloqueo por estado de pago.
- Marca: #2E0879, #7357C1, #F1F1FA, #17181B; Poppins (títulos) + Open Sans (texto); premium, editorial, sin cuadrículas genéricas de tarjetas; logo oficial (Project files: "Logos Beeside 1.png") nunca redibujado; #FFDE59 solo punto de estado; sin #B8860B.
- Fuera de alcance: Stripe real, OH real, ClickUp, Tableau/Analytics UI, Precision Admin, FA Admin, BUILD.

## 5. Próximo paso
El PO entrega su idea de diseño (dirección visual, referencias, pantallas prioritarias, qué no le gustó). Con eso: crear el artefacto de tipo Design (Claude Design), construir las composiciones, y detenerse (STOP) para revisión y decisión del PO.
