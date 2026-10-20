# Prueba de regresión responsive · KL Admin

Defecto corregido (16-oct-2026): en Review (KL-04b) y Editorial approval (KL-07a) los valores del panel lateral se partían letra por letra.

**Causa raíz.** La regla copiada del Control Center `.admin-kv div { grid-template-columns: minmax(9rem, 14rem) 1fr }` reserva hasta 14rem para la etiqueta y deja el valor en `1fr`, cuyo mínimo es el min-content del `<dd>`. Como el `<dd>` lleva `overflow-wrap: anywhere`, ese mínimo es un carácter. En un panel de ~18rem el valor queda en ~1rem. Además el selector descendiente `div` alcanzaba divs anidados. Hallazgos secundarios con la misma familia de causa: tablas comprimidas por debajo de una palabra, `.visually-hidden` (posición absoluta) dentro de tablas desplazables que generaba scroll horizontal de página, y códigos con guion (AC-02, 25-nov-2026) partidos en el guion.

**Corrección** (`prototipos/canvas/kl-control-center.css`, PARTE 3; Code la lleva a la hoja de estilos de KL, sin cambiar el comportamiento del Control Center fuera de KL):

1. `.admin-kv` es contenedor (`container-type: inline-size`); filas `> div` con `minmax(8rem, 14rem) minmax(0, 1fr)`; por debajo de 30rem de contenedor, etiqueta y valor se apilan.
2. Texto normal: `overflow-wrap: break-word` (no reduce el min-content). Nunca `word-break: break-all` ni `overflow-wrap: anywhere` en texto normal.
3. Identificadores, hashes, claves y correos (`code`, `.kl-id`): `overflow-wrap: anywhere`; en tablas con `min-width: 12ch`.
4. Paneles: `.kl-main` mínimo `min(100%, 22rem)`, `.kl-side` mínimo `min(100%, 18rem)`; `.admin-grid` y `.kl-stats` con `minmax(min(100%, X), 1fr)`; `min-width: 0` en contenedores flex/grid acompañado de esos mínimos.
5. Tablas: ancho mínimo según número de columnas (34/46/58/72rem para ≥3/5/7/9 columnas); si no caben, desplazamiento horizontal local en `.admin-table-wrap` (`overflow-x: auto; position: relative`).
6. `.kl-nowrap` en fechas y códigos con guion.

**Prueba** (`responsive-audit.mjs`): 18 pantallas × 1440, 1280, 768 y 390 px. Falla si encuentra (a) una palabra de texto normal repartida en más de una línea, (b) un elemento con texto en columna < 64 px y > 80 px de alto, (c) un elemento con `overflow: hidden` recortando contenido (salvo campos de formulario) o (d) scroll horizontal de la página. El desplazamiento local de tablas se reporta (`localScroll`) y es correcto.

Resultado: antes 24 de 72 vistas con hallazgos; después 0. Texto de todas las pantallas idéntico antes y después (comparación automática); única excepción deliberada: la lista «Check frequency» de 02a se alinea con la periodicidad aprobada (PO-6), que había quedado con la opción de calendario anterior.
