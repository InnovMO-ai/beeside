# Prueba ICE 2025 · KL 1.0 Workspace (15-oct-2026)

Evidencia del bloque Source Registry + Ingestión + Recuperación. No es código de producto.

- `fuentes_texto/`: texto extraído de `ICE-2025_Boletas-.pdf` y `ICE-2025-Anexo-Metodologico.pdf` (documentos del proyecto KL; IMCO, derechos reservados, uso interno).
- `extract_ice.py`: estructura los 53 indicadores × 32 estados con localizador, periodo del anexo y controles de calidad.
- `abc_test.py`: compara A (documento, BM25 top-3), B (estructurado) y C (híbrido) en 23 preguntas.
- `ice2025_records.json`, `ice2025_qa.json`, `abc_results.json`: resultados.

Reproducir (Python 3, sin dependencias externas):

```
mkdir ice && cp fuentes_texto/* ice/
python3 -I extract_ice.py ice
python3 -I abc_test.py ice
```

Resultados de referencia: 1,696/1,696 registros; aciertos A 20, B 21, C 23 de 23; contexto mediano 5,505 / 339 / 392 caracteres.
Uso aprobado por el PO (15-oct-2026): benchmark inicial de recuperación, no prueba definitiva de la calidad conversacional de Precision. Este paquete se conserva íntegro (23 casos en `abc_results.json`, resultados, scripts y limitaciones).

Límites: en A, "acierto" = la cifra correcta estaba en las 3 páginas recuperadas (un modelo aún debe leerla); no se ejecutó ningún modelo; latencias en memoria local sin red ni base de datos; tokens estimados como caracteres/4.

Detalle en "KL 1.0 · Workspace Consolidation & Readiness", pestaña Ingestión y recuperación.
