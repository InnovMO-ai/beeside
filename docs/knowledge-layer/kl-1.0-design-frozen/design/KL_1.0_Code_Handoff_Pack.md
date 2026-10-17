# KL 1.0 · Code Handoff Pack

16-oct-2026 · Emite: Design de Knowledge Layer 1.0 · Para: Code · Product Owner: Mike
Estado: **Design congelado (versión 3, con la corrección responsive de KL Admin del 16-oct)**. Code empieza cuando el PO lo apruebe (condición A1). Este paquete no modifica Workspace ni Precision.

---

## 1. Veredicto de congelamiento

Design puede declararse congelado:

- **Decisiones:** no quedan decisiones de producto abiertas. PO-1 a PO-7 están resueltas e incorporadas.
- **Contradicciones fundacionales:** no hay ninguna abierta.
- **Ajustes de consolidación del 16-oct, integrados:**
  1. Public Sans se mantiene como tipografía provisional; no se incorpora Work Sans.
  2. El PDF carta pasa a ser el artefacto técnico de AC-10.
  3. El inglés de KL Admin queda como decisión provisional; el A4 aplica a Doing Business.
  4. CR-KL-001 queda como propuesta técnica aprobada, pendiente de aceptación de Precision, con una compuerta segura en KL.
  5. P7 entra a las dependencias.
- **Corrección visual obligatoria, cerrada:** los valores del panel lateral de Review (04b) y Editorial approval (07a) se partían letra por letra. Causa raíz y corrección en §5 bis; las 18 pantallas pasan la prueba a 4 anchos (de 24 vistas con hallazgos a 0).
- **Pendientes:** lo que falta es técnico (de Code) o de operación y publicación. Ninguno es de Design.

Una reconciliación, sin contradicción de fondo. El ajuste 1 pide no incorporar otra tipografía sin verificarla, y la opción B elegida por el PO se diseñó sobre Lato, la familia del v3. La regla queda así:

- Public Sans es la provisional.
- Lato entra al tema de Doing Business solo cuando Code repita en el worker la verificación hecha en Design: disponibilidad, licencia OFL y compatibilidad.
- El mismo tema ya está probado con Public Sans: igual número de páginas, 0 errores, 0 hallazgos de lint y salida determinista.

## 2. Documentos que manda Code (orden de prevalencia)

1. Canon: Master Spec v1.4 (adenda 16-oct), Canonical Architecture Handoff `kl.v1`, Doing Business México Product Specification.
2. `design/KL_1.0_Design_Spec.md` (v3): decisiones DD, modelo `kl`, estados, RBAC, PDF, R2, R3, seguridad y periodicidad (§5.9).
3. `design/KL_1.0_Contratos_kl.v1.md` (v3): tipos, reglas de servicio, compuerta de CR-KL-001 (§3), periodicidad y enlaces (§9), manifiesto de edición (§10).
4. `design/KL_1.0_Matriz_Implementacion_Pruebas.md` (v3): piezas I1–I24, pruebas, A01–A10, AC-01–AC-14 y condiciones A/B/C (§6).
5. `design/CR-KL-001_R10_Precision.md`: propuesta para Precision; Code de KL no la implementa en Precision.
6. `design/DB2026/`: paquete editorial (evaluación, mapeo 6 pilares ↔ 12 capítulos, trazabilidad, componentes) y `prototipos/db2026-gen/` (contenido, tema, paginador, lint y render de referencia).
7. Prototipos de KL Admin: canvas "KL 1.0 · Design" y copia en `design/prototipos/canvas/`.

## 3. Qué puede empezar ya (con A1–A2) y en qué condiciones

Arranque en desarrollo aislado:

- **Datos y fuentes:** datos sintéticos, fuentes desactivadas, agentes apagados y sin publicar.
- **Banderas:** `PRECISION_KNOWLEDGE_PROVIDER = off` y `kl.r10_claims_enabled = false`.
- **Migraciones:** solo en local o en CI con base de datos efímera.

No exige titulares, validadores, licencias editoriales ni P5/P7.

| Incremento | Piezas | Notas |
|---|---|---|
| R1 Núcleo | I1 esquema y triggers · I2 repositorio · I3 consulta `kl.v1` · I5 paquetes (lado KL, con consumidor de prueba) · I6 lado KL con la compuerta apagada · I7 señales · I8 canal de carga con archivos sintéticos · I9 KSeed en local | I4 (puerto en Precision) espera a P5 (B1) |
| R2 Automatización y Admin | I10 fuentes · I11 recolector (sin red hasta B10) · I12 conocimiento · I13 KL Admin · I14 concesiones · I15 validación · I23 periodicidad y planificador | La interfaz en inglés es provisional |
| R3 Producto 01 | I16 composición · I17 builder `knowledge_guide` · I22 tema `db.v3b`, bloques, paginador y lint · I18 render · I19 controles · I20 estado público · I24 enlaces | I21 lo implementa el responsable de Precision |

## 4. Banderas y valores por defecto (todos seguros)

| Bandera o valor | Defecto | Quién lo cambia y con qué control |
|---|---|---|
| `PRECISION_KNOWLEDGE_PROVIDER` | `off` | PO + Precision, con B1, B2 y la línea base R5 |
| `kl.r10_claims_enabled` | `false` | KL_ADMIN, solo con la referencia de aceptación de CR-KL-001 registrada (B3) |
| Fuentes | `proposed` / candidatas | KL_ADMIN por publicación (B10); sin aprobación no hay salida de red |
| `kl.product.review_periodicity` | `semiannual` para Doing Business | KL_ADMIN; enumerado sin valor diario |
| `kl.publication.check_frequency` | `inherit` | KL_ADMIN |
| Promoción automática de RAM | Apagada | KL_ADMIN (post-MVP1) |
| Tipografía del PDF | Public Sans | Lato tras B7 |
| `kl.links.discovery_start` | `https://beeside.you` | Cambio de configuración al pasar a producción (C9) |
| Publicación de ediciones | Imposible sin ES y EN aprobados, validaciones vigentes y `claimIds` aprobados | Controles I19 en servidor |

## 5. Reglas que Code no puede relajar

- No modificar Precision ni Workspace desde KL. I6 (lado Precision) e I21 los implementa el responsable de Precision.
- Ninguna IA en la composición del PDF: el HTML de impresión es una función pura del manifiesto. Cifras, normas y afirmaciones salen solo de unidades publicadas (`claimIds`). El prólogo del fundador y el journey son bloques fijos con huella.
- No cambiar IDs canónicos (S01–S10, R1–R34) ni los del registro del Excel (MX-S, MX-D); la correspondencia está en `DB2026/DB2026_Trazabilidad_Fuentes.xlsx`.
- Ningún registro del Excel activa una fuente ni aprueba contenido.
- La marca va sin alterar: lockup del handoff para la portada, abeja recortada del mismo lockup para el pie y ninguna recoloración.
- Paginación: nunca reducir letra ni recortar. Un bloque indivisible que no cabe en una página vacía detiene la publicación, y el lint debe salir vacío.
- AC-10: Chromium fijado, fuentes empaquetadas, red bloqueada al renderizar y PDF normalizado idéntico entre corridas.

## 5 bis. KL Admin responsive (obligatorio en Code)

Defecto encontrado en los prototipos y corregido en Design; Code no debe reproducirlo.

- **Causa raíz:** la regla del Control Center `.admin-kv div { grid-template-columns: minmax(9rem, 14rem) 1fr }` deja el valor en `1fr`, y el `<dd>` lleva `overflow-wrap: anywhere`. Con eso, el ancho mínimo del valor es un solo carácter, y en un panel lateral de unos 18rem el texto se parte letra por letra.
- **Dónde va la corrección:** las reglas de `design/prototipos/canvas/kl-control-center.css` (PARTE 3) se llevan a la hoja de estilos de KL. No se cambia el Control Center fuera de KL.
- **Las reglas:**
  - `.admin-kv` es contenedor (`container-type: inline-size`) y sus filas usan `minmax(8rem, 14rem) minmax(0, 1fr)`; por debajo de 30rem, etiqueta y valor se apilan.
  - Texto normal con `overflow-wrap: break-word`; nunca `word-break: break-all` ni `anywhere` en texto normal.
  - Solo los identificadores, hashes, claves y correos (`code`, `.kl-id`) pueden cortarse en cualquier punto.
  - Los paneles principal y lateral tienen ancho mínimo (`min(100%, 22rem)` y `min(100%, 18rem)`) y se apilan cuando no caben.
  - Las tablas tienen un ancho mínimo según su número de columnas; si no caben, se desplazan dentro de su contenedor (`position: relative`, para contener el texto oculto de accesibilidad), nunca la página.
  - Fechas y códigos con guion no se parten (`.kl-nowrap`).
- **Prueba de regresión UI-R1 (Matriz, I13):** se reutiliza la sonda de `design/evidencia/responsive/responsive-audit.mjs` en las pruebas de Playwright de cada ruta de KL Admin, a 1440, 1280, 768 y 390 px. Falla con cualquier palabra partida, columna ilegible, recorte o scroll horizontal de la página.

## 6. Pendientes técnicos (de Code)

- **Verificaciones en el worker:** Lato (B7) y Chromium fijado (B6).
- **PDF/UA:** validador automático si se puede instalar; si no, revisión documentada (AC-13).
- **Línea base R5:** con el tokenizador real, antes de encender el puerto.
- **Bloques de la edición completa:** los que el prototipo aún no cubre (`timeline`, `bar_breakdown` con leyenda, `sources_directory`, `publication_notes`) se construyen con las reglas de `DB2026/` §4.

## 7. Condiciones de operación y publicación (no son de Code)

Están en la Matriz §6, grupo C: titulares, validadores, derechos y licencias, ICE 2026, verificación de las 27 afirmaciones de Doing Business (17 de riesgo alto), autoridades vigentes y notas del DOF, texto ES/EN aprobado, presupuestos R5, enlace de producción y, opcionalmente, el maestro vectorial del logotipo.

## 8. Dependencias de integración

| Dependencia | Afecta | Mientras no esté |
|---|---|---|
| P5 Precision 2.0 en `main` | I4 puerto `knowledge` | KL se construye y prueba sin Precision |
| P7 especificación de la RAM en Precision | Consumo de paquetes en Precision; prompt de afirmaciones citables | KL compila paquetes y los prueba con un consumidor de prueba |
| CR-KL-001 aceptado e implementado | `approvedClaims` hacia R10 | `approvedClaims: []`; R10 conserva su comportamiento seguro |
| P6 y O5 | Claves de catálogo definitivas | Catálogo provisional versionado |
