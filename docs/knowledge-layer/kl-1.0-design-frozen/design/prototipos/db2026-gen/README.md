# Generador de prototipo · Doing Business México (Design, no es código de producto)

Contenido estructurado (`content.en.json`, 5 páginas literales de v3 con los términos canónicos registrados en `editorialChanges`) → `compose.mjs` (función pura, sin IA) → `paginate.js` en Chromium (paginación determinista + lint) → PDF A4 etiquetado.

- `node render.mjs <salida>`: tema definitivo `theme.css` (opción B, PO-4) con Lato.
- `KL_PDF_FONT=publicsans node render.mjs <salida>`: misma composición con Public Sans (tipografía provisional del sistema de reportes). Lato solo se activa tras verificar disponibilidad, licencia OFL y compatibilidad en el worker.
- `node render-stress.mjs <salida>`: contenido de estrés (tablas partidas, encabezado repetido).
- `node normalize-pdf.mjs <in> <out> <YYYYMMDDHHmmSS> <hex32>`: normalización AC-10.

Resultado de referencia (Chromium 141): 5 páginas, 0 errores, 0 lint; dos corridas con `paged.html`, PNG y PDF normalizado idénticos; estrés 7 páginas sin hallazgos; igual con Public Sans.
Los temas A/B de la exploración y el comparativo están en `design/DB2026/historico/`.
