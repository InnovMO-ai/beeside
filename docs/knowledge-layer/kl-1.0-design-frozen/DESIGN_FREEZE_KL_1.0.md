# beeside Knowledge Layer 1.0 — MVP1 · DESIGN FROZEN / CODE READY

Registro de congelamiento · 16-oct-2026 · Product Owner: Mike (aprobación final de Design recibida el 16-oct-2026; condición A1 cumplida).
Este archivo no modifica ningún documento congelado: los identifica por su huella. No se inició Code ni se modificaron Workspace o Precision.

## 1. Referencia exacta del Design congelado

`KnowledgeLayer/` no está versionado en git: el repositorio lo excluye en `.git/info/exclude` (línea 9: `/KnowledgeLayer/`). Por eso no existe un commit de Design. La referencia exacta es este snapshot por huella:

| Elemento | Valor |
|---|---|
| Manifiesto | `KnowledgeLayer/DESIGN_FREEZE_KL_1.0.sha256`: 115 archivos con su SHA-256 |
| Huella del manifiesto | `8901ecfa25db28acde1445399774ab614f9e046fbefb935a86214d17ad5f4afe` |
| Paquete | `KnowledgeLayer/KL_1.0_Design_FROZEN_2026-10-16.tar.gz`: los 115 archivos más el manifiesto, reproducible (orden, fecha y dueño fijos; gzip sin marca de tiempo) |
| Huella del paquete | `2fc9f4d6ab1fa177ded4a38ac521be343f474c73a242afe83d4e5000bce14b2d` |
| Canvas "KL 1.0 · Design" | Versión 31 (`1792181909-e94c`), con la corrección responsive; copia fiel en `design/prototipos/canvas/` |

Las huellas de los documentos rectores (primeros 12 caracteres; las completas están en el manifiesto):

| Documento | SHA-256 |
|---|---|
| `design/KL_1.0_Code_Handoff_Pack.md` | `f556793d68c4…` |
| `design/KL_1.0_Design_Spec.md` (v3) | `0ee16d05cef1…` |
| `design/KL_1.0_Contratos_kl.v1.md` (v3) | `edf821ed097b…` |
| `design/KL_1.0_Matriz_Implementacion_Pruebas.md` (v3) | `0ae8b95f89c8…` |
| `design/CR-KL-001_R10_Precision.md` | `28c176f079a6…` |
| `design/prototipos/canvas/kl-control-center.css` (PARTE 3 responsive) | `7794b1d5fd9b…` |
| `design/evidencia/responsive/responsive-audit.mjs` (UI-R1) | `32cdaf64e24b…` |
| `design/DB2026/DB2026_prototipo_definitivo.pdf` | `5bdc28ff88d0…` |
| `specs/KL_1.0_Master_Spec_MVP1.md` (canon v1.4) | `52ec3549911c…` |

Comprobación al empezar Code: `sha256sum -c DESIGN_FREEZE_KL_1.0.sha256` desde `KnowledgeLayer/` debe dar 115 «OK». Cualquier diferencia significa que Design cambió después del congelamiento y requiere una nueva aprobación.

## 2. Verificación del Code Handoff Pack

El Code Handoff Pack referencia todo lo que debe y todo existe en el snapshot:

- Spec: §2.2.
- Contratos: §2.3.
- Matriz de implementación y pruebas: §2.4, más UI-R1 en §5 bis.
- CR-KL-001: §2.5.
- Paquete Doing Business y generador: §2.6.
- Prototipos de KL Admin: §2.7.
- Evidencia y prueba responsive: §5 bis, en `design/evidencia/responsive/`.

**Revisión de consistencia:** sin inconsistencias materiales, así que no se modificó ningún documento congelado. Hay dos textos de estado que quedaron atrás y no cambian ninguna regla; los resuelve este registro:

- La cabecera de la Spec dice «para aprobación de cierre de Design».
- El Handoff dice «Code empieza cuando el PO lo apruebe (A1)».

Prevalece lo dicho aquí: Design está aprobado y A1 se cumple. A2 se resuelve en la §4.

## 3. Ubicación y accesibilidad desde el ambiente de Code

| Fuente | Dónde | Accesible desde Code |
|---|---|---|
| Design congelado (115 archivos) | Mac: `~/Developer/beeside/KnowledgeLayer/` (snapshot y paquete) | **Sí**, en un ambiente de Code ligado a esta computadora con esa carpeta conectada. **No** desde un clon de GitHub: la carpeta está excluida de git |
| Código base | `https://github.com/InnovMO-ai/beeside.git` | Sí, con acceso al repositorio |
| Canon en claude.ai | Artifacts listados en `handoff/KL_1.0_Design_Handoff_Pack.md` §1 | Sí, con la cuenta del PO; los snapshots locales en `handoff/referencia/` y `specs/` son la copia congelada |

**Para que un ambiente de Code en la nube (clon de GitHub) lo vea**, se elige una de dos opciones; ninguna se ejecutó aquí:

1. **Recomendada:** el PO autoriza versionar el Design en el repositorio. Se crea la rama `docs/kl-1.0-design-frozen` desde `bc3f527`, se copia `KnowledgeLayer/` a `docs/knowledge-layer/` y se hace commit, push y etiqueta `kl-1.0-design-frozen`. Ese commit pasa a ser la referencia git y el manifiesto confirma el contenido.
2. Adjuntar `KL_1.0_Design_FROZEN_2026-10-16.tar.gz` a la sesión de Code y verificar su SHA-256 antes de usarlo.

## 4. Punto de entrada para Code

**Rama base recomendada: una nueva `feature/kl-1.0-r1` desde `origin/main` en `bc3f527`** (4-oct-2026, «Merge pull request #5 … feat/fa4-public-v1»).

| Por qué `bc3f527` | Evidencia |
|---|---|
| Es el ancestro común de las dos líneas activas: `feat/fa4-launch-config` (`e9b258d`, Discovery) y `feature/precision-v2-f5` (`a8f8f3e`, Precision) | `git merge-base e9b258d a8f8f3e = bc3f527` |
| Contiene todo lo que KL reutiliza, idéntico en las tres referencias | `backend/src/admin`, `frontend/src/admin`, `backend/src/reports/report-model.ts` sin diferencias entre `bc3f527`, `e9b258d` y `a8f8f3e`; además `rbac.ts`, `rate-limit.ts`, `worker.ts` y `AdminApp.tsx` presentes |
| No acopla KL a Precision (A2) ni a la estabilización de Discovery | KL R1 no necesita `backend/src/precision`; el puerto `knowledge` (I4) espera a P5 |

**Hallazgo técnico para Code (no es de Design y no bloquea el inicio):** las dos líneas activas ya usan los mismos números de migración con contenido distinto:

- Discovery tiene `0017_fa4_marketing_consent … 0023_fa4_public_v1_envelope_integrity`.
- Precision tiene `0017_precision_persistence … 0026_precision_product_surface_integrity`.

El migrador de drizzle ordena por `_journal.json`. Por eso, las migraciones `00NN_kl_*` y sus entradas del journal:

- se desarrollan con número provisional sobre `bc3f527`;
- se renumeran al integrar, después de que P5 resuelva la convergencia;
- nunca se aplican a una base compartida antes de eso (A3).

**Comprobaciones antes de desarrollar (todas deben pasar):**

1. `sha256sum -c DESIGN_FREEZE_KL_1.0.sha256` → 115 OK.
2. `git rev-parse origin/main` = `bc3f527…`. Si `main` avanzó, se ramifica desde el nuevo `main` solo si sigue sin diferencias en `backend/src/admin`, `frontend/src/admin` y `backend/src/reports/report-model.ts`; si las hay, se revisa contra el Handoff antes de seguir.
3. Instalación y pruebas existentes en verde sobre la rama base, como línea de no regresión.
4. Base de datos local o efímera de CI; ninguna credencial de entorno compartido.
5. Banderas en sus valores seguros (Handoff §4): `PRECISION_KNOWLEDGE_PROVIDER=off`, `kl.r10_claims_enabled=false`, fuentes candidatas, agentes apagados, promoción de RAM apagada y Public Sans.
6. Solo datos sintéticos; ningún archivo real de fuente ni de cliente.
7. CI con la prueba UI-R1 activa en cuanto exista la primera pantalla de KL Admin, y AC-10 en cuanto exista el render.
8. Orden de trabajo: R1 Núcleo (I1–I3, I5, lado KL de I6 con la compuerta apagada, I7–I9), luego R2 y luego R3, según el Handoff §3.

## 5. Condiciones que siguen vigentes (no bloquean el desarrollo inicial)

Las define `design/KL_1.0_Matriz_Implementacion_Pruebas.md` §6 y siguen sin cambios:

- **A**:
  - A1 se cumple: aprobación del PO del 16-oct.
  - A2 se resuelve con la rama base de la §4.
  - A3 sigue vigente: antes de migrar a un entorno compartido hacen falta entorno, rol `kl_owner`, respaldo, reversión y la renumeración posterior a P5.
- **B, por función:**
  - B1: P5.
  - B2: P7, especificación de la RAM en Precision.
  - B3: aceptación de CR-KL-001.
  - B4: encender el puerto.
  - B5: P6 y O5.
  - B6: Chromium en el worker.
  - B7: verificación de Lato.
  - B8: antimalware.
  - B9: bucket privado.
  - B10: aprobación de fuentes por publicación.
  - B11: dominio de la verificación pública.

  Cada una está atada a una bandera o a un control en servidor; ninguna función sensible se activa sin cumplirla.
- **C, operación y publicación:**
  - C1: titulares.
  - C2: validadores.
  - C3: derechos y licencias.
  - C4: ICE 2026.
  - C5: verificación de las 27 afirmaciones de Doing Business, 17 de ellas de riesgo alto.
  - C6: ATDT y notas del DOF.
  - C7: texto ES/EN aprobado.
  - C8: presupuestos de RAM y umbrales (R5).
  - C9: enlace de producción.
  - C10: maestro vectorial del logotipo, opcional.

Desarrollar en aislamiento con datos sintéticos y fuentes desactivadas no requiere B ni C.
