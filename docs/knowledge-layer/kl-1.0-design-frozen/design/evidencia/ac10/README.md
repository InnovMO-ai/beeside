# Prueba AC-10 · PDF determinista (evidencia de Design, no es código de producto)

> **`AC10_artefacto_tecnico_carta.pdf` es un artefacto técnico de la prueba AC-10, no una referencia editorial ni visual aprobada.** Su contenido son marcadores y registros candidatos; su formato carta y su tipografía (Public Sans/Open Sans) corresponden solo a esta prueba. La referencia editorial de Doing Business México es el PDF v3 en A4 vertical; el prototipo vigente está en `design/DB2026/`.

Pipeline de prototipo: `report.json` (ReportDocument "knowledge_guide") → `render-html.mjs` (función pura) → Chromium vía Playwright (`render-pdf.mjs`, red bloqueada, `tagged` y `outline`) → `normalize-pdf.mjs` (fija `/CreationDate` y `/ModDate` a la fecha de la edición, sin cambiar longitudes).

Ejecutar: `PW_MODULE=<ruta a playwright> bash run-ac10.sh` (requiere qpdf y poppler-utils). Resultado de referencia en `results.json` (Chromium 141): contenido, visual y binario normalizado idénticos; control negativo detectado; PDF etiquetado con marcadores y `/Lang (es)`.

`assets/`: fuentes Open Sans y Public Sans y logo, copiados del repo (`frontend/src/precision/assets/fonts`, `frontend/src/assets`). Los valores del capítulo 10 son marcadores o registros candidatos de ICE 2025, rotulados como tales.
