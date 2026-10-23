# Precision V1.0 — Checkpoint: continuidad Proyecto → Categorías → Preview → Operation Hub (14-oct-2026)

Rama `feature/precision-continuity-foundation` (sin push). Commits: `7c04cdd` (herencia de categorías), `f882055` (recursos HTTPS + `understanding` v1 + Boletas), y el de pruebas E2E.

## 1. Resultado del caso portugués (obligatorio)
De punta a punta por la API real sobre PostgreSQL y el Operation Hub simulado (con lectura de vuelta del payload recibido):

- Understanding con la narrativa inicial → ~10 preguntas de profundidad sin repetir lo que Discovery sabía → prioridad definida por el cliente → My Service Map confirmado.
- Cada categoría ya contiene, antes de abrirse, lo que el proyecto estableció: p. ej. **fiscal** (servicios en alcance, "hay operaciones intercompañía" = Sí, operaciones Portugal→México de servicios y bienes), **personas y nómina** (20 directas + 40 por un tercero en México), **corporativo/legal** (forma de entidad "por decidir" → etapa "evaluando opciones"), **comercio exterior** (partes relacionadas = Sí por la venta de equipo a la filial).
- La categoría fiscal arranca con "Parto de lo que ya me contaste de tu proyecto (…)" y su **primera pregunta es la que el proyecto no podía saber** (estado del registro fiscal local). Quedó lista para revisión tras esa respuesta; CRP → Preview → envío.
- El Operation Hub simulado recibió: bloque `understanding` v1 (hechos como "60 personas", "3 millones de dólares", hallazgos de especialista: contratación mixta/subcontratada, prestaciones, financiamiento desde la matriz, operaciones intercompañía), prioridad y razones del cliente por necesidad, categorías corporativa/legal, personas/nómina e impuestos con más de 5 necesidades (Discovery aportaba una). Sin residuos conversacionales ni identificadores internos. Un consumidor que ignore el bloque nuevo sigue leyendo un payload completo.

## 2. Herencia y profundidad por categoría (qué se construyó)
- **Regla**: solo hereda lo que el cliente dijo, confirmó, corrigió o Discovery capturó; nunca una propuesta de la IA. Hereda solo cuando el valor significa exactamente lo que el campo pregunta ("por un tercero" no dice si es empleador de registro, staffing o contratistas → la categoría lo pregunta: profundiza, no repite). "No sé" / "prefiero no decir" viajan como conocimiento honesto.
- **Propiedad explícita** (registro `frame_inherited` por categoría): lo escrito desde el Frame se actualiza cuando el Frame cambia (frescura/cambio material); lo que el cliente responde o corrige en la categoría **nunca se sobrescribe**, y el desacuerdo queda registrado como conflicto para el especialista. Idempotente.
- Se aplica tras cada turno de Understanding, tras correcciones del mapa y al abrir/operar un hilo de categoría.
- Pruebas: 6 unitarias de mapeo, 4 de integración (incluye "ninguna pregunta de categoría repite un campo heredado", cambio de Frame, respuesta propia intocable) y 3 casos del corpus (oficina con 5 contrataciones directas hereda modelo y headcount; exportador de café no hereda nada de nómina/entidad/fiscal).

## 3. Comportamiento de la readiness
- La readiness de categoría combina el manifiesto (regla congelada: bloqueantes resueltos) con la profundidad del Frame: un aspecto abierto del proyecto se cierra si el Frame lo respondió **o** el cliente lo respondió en la categoría; los que ninguna categoría puede preguntar viajan al especialista como información pendiente y no bloquean a un cliente que no puede contestarlos ahí.
- Las categorías sin manifiesto autorado (respaldadas por el formulario genérico) siguen exigiendo objetivo, alcance y resultado esperado por necesidad: el formulario genérico no se da por completo con solo nombrar la necesidad. Su siembra con el Frame (necesidad en palabras del cliente, razón, prioridad) queda pendiente como mejora; hoy el flujo "Agregar un servicio" ya registra la necesidad.

## 4. IMCO
- Libro + Anexo ICE 2025 ingeridos (32 estados × 53 indicadores, valor y posición exactos, versionado, procedencia, guardas de granularidad y autoridad). Sin cifras IMCO en prompts.
- **Boletas ICE 2025** (nuevo): contienen exactamente las mismas 1,695 filas que el libro (verificado celda por celda). Se usan como verificación cruzada, no se ingieren dos veces (evitaría hits duplicados).
- **Hallazgo**: la página `imco.org.mx/competitividad-estatal/` hoy se titula **ICE2026** (modificada 23-sep-2026) y enlaza a un sitio de la edición 2026. El ICE 2025 ya no es la edición más reciente. No pude abrir ese sitio (el enlace no llegó textual en tu mensaje); la arquitectura ya soporta la nueva edición como versión que reemplaza a la anterior.

## 5. Recursos de país V1 y OH
- Todo recurso **activo** visible al cliente resuelve a una URL HTTPS; un `document` sin URL queda como borrador inactivo (validación, Admin, resolver, endpoint y restricción en base de datos; migración 0037 desactiva los existentes sin borrarlos). Arquitectura permanente país → recurso → versión → URL configurable en Admin; nada hardcodeado.
- Listo para registrar "Doing business in Mexico" en cuanto envíes el PDF final (URL pública HTTPS configurable en Admin).
- Bloque `understanding` del payload OH: `version: 1`, aditivo, derivado del estado estructurado y con compuerta de higiene.

## 6. Regresión
Backend unit 1,675 ✔ · integración (base limpia) 286 ✔ · SQL 8 suites ✔ (331 en la de Precision) · frontend vitest 151 ✔, tsc y eslint limpios · eslint backend limpio · chequeo de DTOs ✔. IMCO real (5 pruebas con los PDFs) ✔.

## 7. Riesgos / decisión tuya
**Riesgo:** la categoría fiscal del caso portugués queda "lista para revisión" tras una sola pregunta porque la regla congelada solo exige campos bloqueantes; ejercicio fiscal, marco contable y reporte a la matriz quedan como información pendiente para el Sherpa.
**Por qué importa:** tu estándar es profundidad de primera reunión; una categoría "lista" con varios pendientes puede generar rondas de aclaración (KPI).
**Opciones:** (A) mantener la regla y dejar esos pendientes visibles al Sherpa; (B) hacer bloqueantes, por proyecto, los campos requeridos que el Frame marca como materiales (p. ej. documentación de precios de transferencia cuando hay intercompañía).
**Recomendada:** A para V1 (no cambia semántica congelada) y medir rondas con el piloto; B si el KPI lo justifica.

## 8. Brechas para Feature Complete
1. "Doing business in Mexico": falta el PDF final (camino de registro listo).
2. Edición ICE 2026: falta enlace/archivos.
3. Siembra de categorías genéricas desde el Frame (hoy solo vía "Agregar un servicio").
4. Aspectos del Frame que ninguna categoría puede preguntar solo viajan como pendientes (no hay pregunta in-category); aceptado en V1.
5. Estado de readiness del Frame no se muestra aún en la UI de categoría más allá del texto de apertura.

## 9. Bloqueos externos (Public Ready)
Contrato canónico de Discovery · KB Beta · modelo real/ZDR/credenciales (ensayo real del modelo) · Stripe sandbox · credenciales ClickUp y aceptación real de OH del bloque `understanding` · política de retención (Legal/privacidad).
