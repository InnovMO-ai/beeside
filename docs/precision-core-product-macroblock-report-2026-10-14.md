# PRECISION V1.0 — Core Product Macroblock: reporte

Fecha: 14 oct 2026 · Rama `feature/precision-continuity-foundation` (base congelada `a8f8f3e`) · Condición terminal: **A — macrobloque central completo** (con un punto de producto para decidir, abajo).

## Resultado

Precision ya no es Discovery con mejor formato: entiende en profundidad, usa lo que Discovery ya sabe, construye My Service Map desde lo que el cliente dijo (con su prioridad y sus razones), deja que el cliente lo corrija, y lleva la profundidad limpia hasta Preview y Operation Hub. El caso de referencia (empresa portuguesa subcontratada por ganadores de proyectos de energía en México) corre de punta a punta por la API real sobre PostgreSQL: narrativa inicial → ~10 preguntas de profundidad sin repetir lo que Discovery sabía → prioridad definida por el cliente → mapa confirmado → briefing en snapshot y payload de OH.

## Qué quedó construido (A–Q)

- **A Understanding profundo / D multi-país y fases / E prioridades del cliente / C razones (WHY):** frame del proyecto como fuente de verdad (versionado, transaccional con eventos), intérprete gobernado (cita y valor validados), planner de una pregunta por turno, profundidad "material vs valiosa" (DEPTH ≠ CONFIRMACIÓN).
- **B Project Frame progresivo / L frescura:** si Discovery cambia después de empezar Precision, el frame lo sigue y lo dice; nada se pregunta dos veces.
- **F Service Map desde el frame / G corrección:** necesidades con las palabras del cliente, agrupadas por el catálogo; prioridad, razón y plazo del cliente; tombstones (lo quitado no regresa). API de correcciones (quitar, renombrar, razón, prioridad, mover) y **UI** en My Service Map (diálogo Editar, solo con permiso de escritura).
- **H Add a Service / I necesidades legítimas desconocidas / J ruido / K Marketing:** primero la NECESIDAD ("marketing" → marketing_communications; "almacén"/"cadena de frío" se preguntan una vez; "4 plumones", "un sillón" y meta-frases no son servicios; lo no ubicable queda en "En revisión" con sus palabras).
- **M readiness por categoría / Q suficiencia:** función de readiness por proyecto con bloqueantes específicos de categoría y compuerta de suficiencia (no un % genérico).
- **N Preview / O OH limpio:** `briefing` (contexto, hechos, pendientes, "Hallazgos para poner atención") construido del frame, nunca de la conversación; compuerta de higiene que descarta cualquier resto conversacional.
- **P calidad conversacional:** verificadores de voz + detector de repetición sobre todo el corpus; el reintento baja la vara en lugar de repetir la pregunta.
- **Knowledge Layer:** Source Registry con jerarquía de autoridad, ingestión genérica, orientación con guarda de granularidad (IMCO: solo nivel estado, nunca autoridad legal, nunca inferir municipio, versionado/superseded), Knowledge Agent. **Biblioteca de recursos por país:** API Admin (alta/edición/desactivación versionada, auditada, solo https), oferta contextual única en la conversación sin URL en el texto, y resolvedor que solo abre guías ofrecidas a ese proyecto. Sin URLs fijas en código.
- **Intérprete con modelo (opcional):** `PRECISION_UNDERSTANDING_INTERPRETER=model`, con gobernador y respaldo automático a reglas. **Apagado por defecto.**

## Verificación

- Unit backend 1655 ✓ (precision 1309). Understanding: 97 pruebas, incluidas las compuertas P y Q sobre el corpus de aceptación (portuguesa, país único, café Colombia→México→EE.UU., rica, escasa).
- Integración sobre BD limpia: 33 suites ✓ (core 6/6 incluida la oferta de guía, journey, access, reliability, CRP, discovery-bridge, knowledge, entitlement, Stripe, analytics, admin). SQL: 8 suites ✓.
- Frontend: vitest 151 ✓, tsc y eslint limpios; backend eslint limpio en precision/admin.
- Se corrigieron 3 pruebas frágiles preexistentes (orden físico de filas, consulta sin acotar por proyecto); no eran regresiones.
- Commits locales; **sin push**.

## Para que Mike decida / aceptar

1. **Campo aditivo `understanding` en el payload hacia Operation Hub.** *Riesgo:* OH debe aceptarlo (hoy `psm` es un registro abierto, así que no rompe). *Opciones:* (a) aceptar el campo; (b) enviarlo solo en el brief legible. *Recomendada:* (a), con aceptación de OH antes de producción.
2. **Readiness por categoría aún no gobierna la UI de categorías.** *Riesgo:* la conversación de categoría podría volver a preguntar algo que el frame ya sabe (headcount, facturación). El briefing sí viaja completo a OH. *Opciones:* (a) sembrar cada hilo de categoría con los hechos conocidos y usar el readiness como bloqueo; (b) dejarlo para V1.1. *Recomendada:* (a), es el siguiente bloque; cambia el flujo de categoría, por eso lo dejo a tu decisión.
3. **Intérprete con modelo apagado.** *Riesgo:* con reglas, narrativas muy libres se entienden menos que con modelo. *Recomendada:* aprobar ZDR/credenciales y correr un ensayo con modelo real sobre el corpus antes del release candidate.
4. **Ruta por concepto en Add a Service:** acepta solo frases totalmente explicadas por el concepto ("marketing" sí, "public procurement tenders" no se fuerza a Procurement). Es conservadora; si prefieres más cobertura, sube la tasa de errores de clasificación.
5. Guías de tipo "documento" (no URL): el cliente verá "ya no está disponible" hasta que exista visor; las de URL funcionan.

## Externos abiertos (no bloquean)

Contrato canónico de Discovery · Beta KB · credenciales/ZDR del modelo real · Stripe sandbox · credenciales ClickUp · política legal de retención · PDFs reales de IMCO (se usaron fixtures sintéticos; necesito que los adjuntes o autorices la descarga).

## Siguiente

Con tu visto bueno al punto 2: sembrar categorías desde el frame + readiness como bloqueo; ensayo con modelo real; ingestión de los PDFs reales de IMCO.
