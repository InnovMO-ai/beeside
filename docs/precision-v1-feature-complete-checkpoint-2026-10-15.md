# Precision V1.0 — Checkpoint de Feature Complete (15-oct-2026)

Rama `feature/precision-continuity-foundation` (sin push). Cubre las aclaraciones de Producto tras la aceptación del bloque KSeed: ediciones por serie, México primero (no solo México), Knowledge Layer con revisión por riesgo, lista priorizada de las 12 brechas de KSeed, ruta lista para «Doing business in Mexico» y siembra de categorías genéricas desde el Frame.

## Resumen
Con el material disponible hoy, **el flujo de Producto de Precision queda cerrado de punta a punta**. Lo que sigue abierto no es código interno: es material de conocimiento (las 12 brechas), el PDF de «Doing business in Mexico», la edición ICE 2026 (que no bloquea) y los bloqueos externos de Public Ready. Una sola decisión de UI queda para ti (sección A).

## A. Brechas internas de Feature Complete que quedan
Cerradas en este bloque:
- **Siembra de categorías genéricas desde el Frame** (antes solo vía «Agregar un servicio»): una necesidad que el catálogo no puede ubicar abre su categoría ya con la necesidad en palabras del cliente, la razón que dio y la prioridad que fijó (urgencia alta/media/baja). Solo lo que el cliente dijo o confirmó; nunca una propuesta de la IA. La fusión no destruye nada: si el cliente ya empezó a describir la necesidad en la categoría, el Frame solo rellena lo vacío; su respuesta propia no se sobrescribe y no genera conflicto. Idempotente.
- **Ediciones por serie** (ICE 2026 no bloquea; ver B de la sección de arquitectura).
- **Ruta de «Doing business in Mexico»** sin cambios de código al llegar (ver C).

Siguen abiertas:
1. **Visibilidad del Frame en la UI de categoría.** Hoy el cliente ve el texto de apertura «Parto de lo que ya me contaste…» y la barra de progreso; no hay un panel de «lo que ya sé / lo que falta confirmar».
   **Riesgo:** sin él, el cliente no ve cuánto de su proyecto ya está en la categoría, y puede dudar de si Precision «se acuerda».
   **Por qué importa:** es la prueba visible de la continuidad Discovery → Understanding → Categoría.
   **Opciones:** (A) mantener el texto de apertura y la barra de progreso para V1; (B) añadir en la categoría un bloque compacto «Lo que ya sé» (3–4 líneas en palabras del cliente, editable) sin tocar preguntas ni orden.
   **Recomendada:** B, porque no cambia lógica congelada, reutiliza `knownLines` que ya existe y se diseña como página completa (escritorio y móvil) antes de implementarse; no lo implementé sin tu visto bueno por ser composición de página.
2. Aspectos del Frame que ninguna categoría puede preguntar viajan al especialista como pendientes (aceptado en V1).
3. Decisión previa sobre la readiness de la categoría fiscal: se mantiene la opción A (recomendada) hasta medir rondas de aclaración con el piloto.

## B. Las 12 brechas de KSeed para V1
Archivo aparte, compacto y priorizado: `precision-kseed-v1-gaps-2026-10-15.md`. Cada brecha trae tema, por qué Precision lo necesita, pregunta que habilita, tipo de fuente ideal, fuente sugerida **NO APROBADA TODAVÍA**, riesgo, mínimo necesario para V1, qué sostiene (comprensión, profundidad de categoría, orientación o paso al especialista) y quién lo revisa en The Hive. Orden: 1 formas jurídicas · 2 constitución y registro · 3 precios de transferencia · 4 modelos de contratación · 5 IMSS y registro patronal · 6 condición migratoria · 7 regímenes aduaneros · 8 puertos y cruces · 9 IVA · 10 ISR empresarial · 11 prestaciones de ley · 12 inversión extranjera. Las primeras seis salen del caso portugués obligatorio.

Estado real de KSeed: 6 de 27 necesidades cubiertas, 5 parciales, 16 sin material; de las 12 necesarias para V1, ninguna cubierta (hay contexto institucional parcial, pero ninguna fuente oficial primaria). Precision no investiga estas brechas en vivo: tú o The Hive aportan o aprueban el material.

## C. Material adicional que necesitamos de ti
1. **«Doing business in Mexico»** (mañana): el PDF y su URL pública HTTPS. Al llegar se corre **una sola operación** (`onboard-country-guide`): registra la fuente curada de beeside, ingiere el PDF como material curado (versionado, con procedencia), crea el recurso de México con su URL HTTPS (editable en Admin) y desactiva ediciones anteriores sin borrarlas. Es idempotente. Queda disponible desde Understanding como oferta opcional (una vez, nunca obligatoria, el enlace no va en el texto del chat) y como contexto orientador citando la guía. Una guía curada **nunca** fundamenta obligaciones legales, fiscales o laborales; solo contexto.
2. **ICE 2026** (no bloquea): cuando tengas los archivos, entra como edición nueva de la serie.
3. **The Hive:** confirmar las fuentes oficiales a curar y quién revisa cada área (legal, fiscal, laboral, aduanas, logística). La lista de fuentes de la sección B es solo una propuesta.
4. Alcance de países: **no hay nada que decidir**; V1 es México primero, no solo México (ver D).

## Arquitectura — qué cambió
**Ediciones por serie.** Una publicación mantiene un título de serie y la edición es un campo aparte: «ICE 2025», «ICE-2026_Boletas» entran en la misma serie. La edición más reciente es la activa; la anterior pasa a histórica con su procedencia y nunca se borra ni se sobrescribe. Si llega una edición **más vieja** después de una más nueva, se guarda como histórica y la activa sigue siendo la nueva. La cadena se respeta (2024 → 2025 → 2026). Migración 0039 ajusta la guarda de base de datos (se permite sustituir por versión **o** edición más nueva, misma publicación). Hay un comparador de ediciones de solo lectura (agregados, quitados, valor o posición cambiados, y si necesita revisión humana) y vistas de Admin: ediciones, comparación y candidatos del agente.

**Knowledge Layer: no manual por defecto.** La arquitectura futura queda preservada (monitoreo de fuentes aprobadas → investigación fuera del diálogo con el cliente → extracción y detección de cambios → versionado → clasificación de riesgo → validación y publicación). La revisión humana es **por riesgo**:
- **Fuerte** (un especialista del área decide antes de publicar): fuentes de riesgo alto, fuentes que fundamentan obligaciones, y contenido de impuestos, aduanas, derecho corporativo, seguridad social, migración, regulación o inversión extranjera de fuentes oficiales.
- **Estándar** (un revisor): fuentes marcadas para revisión, fuentes no primarias de riesgo medio, temas de alto riesgo de fuentes no primarias, y contenido que no se puede clasificar (nunca se trata como ligero).
- **Ligera** (terminología, alias, definiciones generales, contexto no regulatorio de fuentes de bajo riesgo): se aplica con gobierno —registro de auditoría, procedencia, versión nueva sin sobrescribir, reversible y listado para muestreo—, sin compuerta humana previa.
El nivel y el motivo quedan en cada candidato.

**Nada de esto abre la web a Precision:** la guarda de arquitectura que prohíbe clientes de red y búsqueda en módulos de conversación sigue verde.

## D. Referencia portuguesa y México-primero
- **Caso portugués:** de punta a punta por la API real sobre PostgreSQL y Operation Hub simulado (con lectura de vuelta): Understanding → prioridad → My Service Map → categorías con herencia → Preview → envío. Sigue en verde tras este bloque.
- **México primero, no solo México (nuevo, probado E2E):** proyecto con destino Chile y sin conocimiento preparado: Precision sigue entendiendo, reconoce el límite en lenguaje de cliente, no toma prestado conocimiento de México, registra la demanda con país **CL** (sin texto del cliente, sin PII), avisa al especialista y no publica nada. Cuando exista conocimiento aprobado de ese país, se usa sin cambios de código.
- Nota de citas: al guardar la serie sin el año en el título, la cita queda «Índice de Competitividad Estatal (2025), p. 81»; las series ya guardadas con año en el título lo conservan.
- Hueco real detectado y corregido: preguntas cuyo único indicio es un término específico («¿Qué es el IMMEX?») no se orientaban desde el conocimiento aprobado aunque sí se registraban como demanda; ahora ambos usan la misma lectura de tema.

## E. Regresión
Backend unit **1,748 ✔** (+22) · integración en base limpia **289 ✔** (más 5 de IMCO real con los PDFs ✔) · SQL de Precision **339 ✔** con K17–K18 nuevos (ediciones históricas y misma publicación) · eslint, tsc y chequeo de DTOs limpios · sin cambios de frontend en este bloque (151 ✔ del bloque anterior). Pruebas nuevas: series y ediciones (5, incluida la continuación de series guardadas antes con el año en el título), nivel de revisión por riesgo (5), plan de brechas V1 (2), incorporación de guía país (5), siembra genérica (5), PostgreSQL de ediciones (1), México-primero con Chile (1), Admin de ediciones y guía (1).

## Bloqueos externos para Public Ready (sin cambio)
Contrato canónico de Discovery · KB Beta · modelo real/ZDR y credenciales (ensayo con modelo real) · Stripe sandbox · credenciales ClickUp y aceptación real de OH del bloque `understanding` · política de retención (Legal/privacidad).
