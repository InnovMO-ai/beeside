# KL 1.0 · R3 · Evidencia del generador de PDF (reproducible y seguro)

Generada el 17-oct-2026 en el worktree `~/Developer/beeside-kl` (rama `feat/kl-1.0-code`), con datos **sintéticos**. No es una edición de Doing Business México ni contiene contenido factual: es la prueba del mecanismo.

## Motor y tipografía (B6, B7)

| Elemento | Valor |
|---|---|
| Chromium | 153.0.8010.12 (el que fija `playwright-core` 1.63.0 del lockfile), `darwin-arm64` |
| Parámetros | `--font-render-hinting=none --disable-lcd-text --force-color-profile=srgb --disable-gpu`; contexto sin conexión, zona horaria UTC |
| PDF | A4 vertical (594.96 × 841.92 pt), `tagged: true`, `outline: true`, `/Lang` por documento |
| Lato | Disponible (4 pesos, huellas en el manifiesto de cada edición), licencia **SIL OFL 1.1** (archivo incluido), compatible: incrustada en el PDF etiquetado y con los caracteres de ES/EN. **Verificada → es la tipografía de la edición** |
| Public Sans | Disponible (2 pesos), licencia **SIL OFL 1.1**, compatible; misma estructura de salida (mismo número de páginas y de bloques). **Alternativa segura**: se elige en el manifiesto antes de enviar a aprobación; el worker no cambia de tipografía en silencio |

Huellas SHA-256 de los archivos de fuente empaquetados:

- `lato-latin-300-normal.woff2` `115f6a62…2429` · `-400-` `918b7dc3…e537` · `-700-` `c447dd76…0de49` · `-900-` `08664859…bd92`
- `public-sans-latin-400-normal.woff2` `9707fd1d…21ad` · `-700-` `39dc2fce…2d4e`

## Reproducibilidad (AC-10)

Instantánea sintética fija (2 idiomas × 7 páginas), dos corridas separadas por más de 1 s:

| Nivel | Resultado |
|---|---|
| Contenido | `ReportDocument` y HTML de impresión idénticos (misma huella); texto extraído idéntico |
| Visual | Las páginas rasterizadas, idénticas una a una |
| Binario **sin** normalizar | Distinto entre corridas; difiere **solo** en `/CreationDate` y `/ModDate` (prueba que enmascara esos campos y compara el resto) |
| Binario normalizado | **Idéntico byte a byte** (`/CreationDate` y `/ModDate` fijados a la fecha de corte de la edición, sin cambiar longitudes) |
| Control negativo | Cambiar una cifra o el identificador de verificación cambia la huella del documento y la del PDF |
| Línea de referencia | `products/ac10-baseline.json` guarda las huellas para `darwin-arm64` + Chromium 153.0.8010.12 + Lato; la prueba las exige iguales. Otra plataforma o versión de Chromium solo exige regenerar su entrada (`KL_UPDATE_AC10_BASELINE=1`); las ediciones publicadas no cambian porque están congeladas |

Huellas de la línea de referencia (normalizadas): ES `998731fe…ddcda` (345 007 bytes) · EN `935b76de…431f1` (344 061 bytes).

## Seguridad del render

- **X19**: HTML hostil con `<img>`, `<link>`, `@import`, `url()`, `fetch`, `new Image` y `sendBeacon` hacia un dominio externo: **todas** las peticiones se abortan (≥ 3 registradas) y el PDF se genera igual. El render de una edición real registra **0** peticiones bloqueadas.
- **Inyección**: todo texto del contenido se escapa; un `<script>` en un párrafo no se ejecuta ni genera tráfico.
- **Falla cerrada**: un bloque indivisible más alto que una página, un párrafo más alto que una página, un desglose que no suma, un `cta_link` sin enlace configurado o una `ref` sin entrada en el directorio detienen la composición (nunca se reduce letra ni se recorta). El lint de la paginación (elementos fuera de página, recortes, desborde) debe salir vacío.
- **Sin IA y sin reloj**: el constructor del documento y el HTML son funciones puras (prueba estática: sin `Date`, `Math.random`, `Intl`, `process.env` ni red).

## Cifras trazables (AC-01/02/04)

Con pdf.js (instalado fuera del repo) se extrae el texto del PDF: contiene cada cifra `display_<idioma>` de las fichas del manifiesto, el identificador de verificación impreso y **no** contiene la marca de vista previa; tiene marcadores, 7 páginas A4 y título del documento. ES y EN tienen las mismas piezas, citas y cifras por sección.

## Límites que se declaran

- **PDF/UA**: no hay validador instalable en este entorno; AC-13 se cumple con etiquetado, estructura de encabezados (`H2`/`P`), idioma, marcadores y fuentes incrustadas, y queda **pendiente la revisión con lector de pantalla** documentada (AC-13 es «parcial» en la Matriz).
- **Antimalware (B8) y bucket (B9)**: el almacén local es solo de desarrollo; el adaptador de producción llega con G2.
- **Chromium en CI/imagen**: se instala con `playwright-core install chromium` (paso agregado a `kl-ci.yml`); el paquete `playwright-core` debe declararse como dependencia del backend (cambio compartido solicitado, aún no ejecutado).
