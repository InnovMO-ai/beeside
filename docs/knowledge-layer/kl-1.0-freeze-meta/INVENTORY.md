# Inventario del Design congelado en Git · KL 1.0

Origen: `~/Developer/beeside/KnowledgeLayer/` (Mac del PO), manifiesto `DESIGN_FREEZE_KL_1.0.sha256` (115 archivos, SHA-256 `8901ecfa25db28acde1445399774ab614f9e046fbefb935a86214d17ad5f4afe`).
Versionados: **88** archivos en `docs/knowledge-layer/kl-1.0-design-frozen/`, byte a byte idénticos y con las mismas rutas relativas. Excluidos: **27**, con su huella conservada en `excluded.sha256`. La partición es exacta (88 + 27 = 115) y la comprueba `verify.sh`. Además se versionan, en la raíz del mismo directorio, el registro `DESIGN_FREEZE_KL_1.0.md` (SHA-256 `96c2b7d508636e9922bca167fa63301e59d9181eb5eaab932b910f94598c90ea`) y el manifiesto `DESIGN_FREEZE_KL_1.0.sha256`, que quedan fuera de los 115 porque los describen. `verify.sh` comprueba ambos.
No se modificó ningún archivo congelado. El paquete de respaldo `KL_1.0_Design_FROZEN_2026-10-16.tar.gz` (SHA-256 `2fc9f4d6ab1fa177ded4a38ac521be343f474c73a242afe83d4e5000bce14b2d`) queda solo en el Mac porque contiene archivos excluidos.

## Versionados

| Grupo | Archivo | Bytes | SHA-256 (12) |
|---|---|---:|---|
| Benchmark ICE 2025 (metadatos y scripts) | `pruebas/ice2025/README.md` | 1,476 | `3f80c0bdf972` |
| Benchmark ICE 2025 (metadatos y scripts) | `pruebas/ice2025/abc_results.json` | 7,458 | `53caccce9531` |
| Benchmark ICE 2025 (metadatos y scripts) | `pruebas/ice2025/abc_test.py` | 10,901 | `097cf9ffb49e` |
| Benchmark ICE 2025 (metadatos y scripts) | `pruebas/ice2025/extract_ice.py` | 14,127 | `06c7db82d53f` |
| Benchmark ICE 2025 (metadatos y scripts) | `pruebas/ice2025/ice2025_qa.json` | 6,092 | `dfd8dd57084d` |
| Canon | `specs/KL_1.0_Master_Spec_MVP1.md` | 51,292 | `52ec3549911c` |
| Canon (snapshots) | `handoff/KL_1.0_Design_Handoff_Pack.md` | 18,129 | `e72ad1d190ed` |
| Canon (snapshots) | `handoff/KL_1.0_Precision_MVP1_Handoff.md` | 38,961 | `417eb3dd7128` |
| Canon (snapshots) | `handoff/referencia/Doing_Business_Mexico_Product_Specification.md` | 27,114 | `50b7d30d6ede` |
| Canon (snapshots) | `handoff/referencia/KL_1.0_Ingestion_y_Recuperacion.md` | 20,573 | `22ef51507a90` |
| Canon (snapshots) | `handoff/referencia/KL_1.0_Precision_MVP1_Handoff.md` | 38,961 | `417eb3dd7128` |
| Canon (snapshots) | `handoff/referencia/KL_1.0_Source_Registry_Mexico.md` | 20,174 | `6285cc7e75e6` |
| Canon (snapshots) | `handoff/referencia/KL_1.0_Workspace_Consolidation_Readiness.md` | 34,871 | `71cb9ec12a43` |
| Design (documentos rectores) | `design/CR-KL-001_R10_Precision.md` | 11,713 | `28c176f079a6` |
| Design (documentos rectores) | `design/KL_1.0_Code_Handoff_Pack.md` | 9,415 | `f556793d68c4` |
| Design (documentos rectores) | `design/KL_1.0_Contratos_kl.v1.md` | 17,889 | `edf821ed097b` |
| Design (documentos rectores) | `design/KL_1.0_Design_Spec.md` | 54,293 | `0ee16d05cef1` |
| Design (documentos rectores) | `design/KL_1.0_Matriz_Implementacion_Pruebas.md` | 16,113 | `0ae8b95f89c8` |
| Evidencia AC-10 | `design/evidencia/ac10/AC10_artefacto_tecnico_carta.pdf` | 313,365 | `af947d7b5f44` |
| Evidencia AC-10 | `design/evidencia/ac10/README.md` | 1,309 | `36fe43e936c3` |
| Evidencia AC-10 | `design/evidencia/ac10/assets/beeside-logo.png` | 101,504 | `033ed43d4c00` |
| Evidencia AC-10 | `design/evidencia/ac10/manifest.json` | 858 | `6b821b5bf869` |
| Evidencia AC-10 | `design/evidencia/ac10/normalize-pdf.mjs` | 1,381 | `4d6f4166045e` |
| Evidencia AC-10 | `design/evidencia/ac10/render-html.mjs` | 10,508 | `c01adcddc537` |
| Evidencia AC-10 | `design/evidencia/ac10/render-pdf.mjs` | 1,903 | `726084f52a52` |
| Evidencia AC-10 | `design/evidencia/ac10/report.json` | 14,650 | `fcae010a41e3` |
| Evidencia AC-10 | `design/evidencia/ac10/results.json` | 1,050 | `62102e1071ce` |
| Evidencia AC-10 | `design/evidencia/ac10/run-ac10.sh` | 3,181 | `6f071d50104f` |
| Evidencia R10 | `design/evidencia/r10/r10-claims-proto.mjs` | 5,417 | `7152f6199051` |
| Evidencia R10 | `design/evidencia/r10/result.txt` | 3,113 | `edbd9bfef726` |
| Evidencia responsive (UI-R1) | `design/evidencia/responsive/KL_Admin_prototipos_responsive.pdf` | 2,842,992 | `5d60600039b3` |
| Evidencia responsive (UI-R1) | `design/evidencia/responsive/README.md` | 2,733 | `f1e4c2e47ab6` |
| Evidencia responsive (UI-R1) | `design/evidencia/responsive/antes-despues/KL-04b-UploadReview_desktop_antes_despues.png` | 263,305 | `ca448ef3ad2d` |
| Evidencia responsive (UI-R1) | `design/evidencia/responsive/antes-despues/KL-04b-UploadReview_mobile_antes_despues.png` | 265,101 | `6cd934682924` |
| Evidencia responsive (UI-R1) | `design/evidencia/responsive/antes-despues/KL-04b-UploadReview_tablet_antes_despues.png` | 252,448 | `a27ed7b98e4c` |
| Evidencia responsive (UI-R1) | `design/evidencia/responsive/antes-despues/KL-07a-EditionApprove_desktop_antes_despues.png` | 143,946 | `f8a601484f27` |
| Evidencia responsive (UI-R1) | `design/evidencia/responsive/antes-despues/KL-07a-EditionApprove_mobile_antes_despues.png` | 206,688 | `f2d0fb9d85b6` |
| Evidencia responsive (UI-R1) | `design/evidencia/responsive/antes-despues/KL-07a-EditionApprove_tablet_antes_despues.png` | 114,706 | `5bedab1be519` |
| Evidencia responsive (UI-R1) | `design/evidencia/responsive/report-antes.json` | 16,826 | `d721ad80b812` |
| Evidencia responsive (UI-R1) | `design/evidencia/responsive/report-despues.json` | 11,777 | `46cfa6f1f289` |
| Evidencia responsive (UI-R1) | `design/evidencia/responsive/responsive-audit.mjs` | 4,687 | `32cdaf64e24b` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/README.md` | 1,138 | `49ee705963f0` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/bee_lockup.png` | 104,760 | `4149bc5af15d` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/compose.mjs` | 6,469 | `355c6deb84f6` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/content.en.json` | 11,201 | `8205ecaae77e` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/content.stress.json` | 11,440 | `05e23ae12aba` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/fonts/LICENSE` | 4,462 | `3439c676af69` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/fonts/lato-latin-300-normal.woff2` | 23,236 | `115f6a626ca1` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/fonts/lato-latin-400-italic.woff2` | 24,408 | `bca1d88ada54` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/fonts/lato-latin-400-normal.woff2` | 23,580 | `918b7dc3e2e2` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/fonts/lato-latin-700-normal.woff2` | 23,040 | `c447dd7677b4` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/fonts/lato-latin-900-normal.woff2` | 22,504 | `08664859baab` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/logo_lockup_correct.png` | 133,150 | `4ca830bcc8f6` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/measure.mjs` | 486 | `3a58b437ecd4` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/normalize-pdf.mjs` | 1,381 | `4d6f4166045e` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/paginate.js` | 4,677 | `d48f9f125ec6` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/render-stress.mjs` | 2,046 | `67a3887008a8` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/render.mjs` | 2,042 | `b80f9e2f9527` |
| Generador PDF Doing Business | `design/prototipos/db2026-gen/theme.css` | 5,561 | `04093497c90b` |
| Paquete editorial DB2026 | `design/DB2026/DB2026_Design_Paquete_Editorial.md` | 13,553 | `8754914a5ba5` |
| Paquete editorial DB2026 | `design/DB2026/DB2026_Trazabilidad_Fuentes.xlsx` | 28,281 | `c7714a88bd01` |
| Paquete editorial DB2026 | `design/DB2026/DB2026_prototipo_definitivo.pdf` | 415,993 | `5bdc28ff88d0` |
| Prototipos KL Admin | `design/prototipos/canvas/Decisiones.dc.html` | 8,812 | `6a511c51e7d6` |
| Prototipos KL Admin | `design/prototipos/canvas/Entrega.dc.html` | 4,865 | `34ae90bf28aa` |
| Prototipos KL Admin | `design/prototipos/canvas/Estados.dc.html` | 39,214 | `ddbbe6591420` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-01-Overview.dc.html` | 5,853 | `cb30a362cf3e` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-02-Sources.dc.html` | 6,762 | `5d3e7936c5e2` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-02a-SourceApprove.dc.html` | 5,783 | `8e3141ca8114` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-03-Agents.dc.html` | 4,343 | `1495c92088b9` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-03a-ChangeReview.dc.html` | 4,820 | `0fe95c7daa5c` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-04-Repository.dc.html` | 4,608 | `e2ded40da761` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-04a-Upload.dc.html` | 5,204 | `448a512448b1` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-04b-UploadReview.dc.html` | 7,730 | `4a5b8aa6b0f5` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-04c-Unit.dc.html` | 4,448 | `5fe5c4c0ab92` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-05-Demand.dc.html` | 3,371 | `7f9400f33c16` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-05a-DemandDecide.dc.html` | 4,995 | `7cdbef33c99d` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-06-Seed.dc.html` | 4,492 | `8979a2fcfd3a` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-07-Products.dc.html` | 6,813 | `08115c886ad0` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-07a-EditionApprove.dc.html` | 4,488 | `22d678cebe0f` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-07b-Validation.dc.html` | 5,844 | `3f75d713a3dd` |
| Prototipos KL Admin | `design/prototipos/canvas/KL-08-Settings.dc.html` | 6,904 | `c5e34dd8b933` |
| Prototipos KL Admin | `design/prototipos/canvas/Main.dc.html` | 20,094 | `41c38594ade4` |
| Prototipos KL Admin | `design/prototipos/canvas/ModeloDatos.dc.html` | 8,113 | `a1b835c50db4` |
| Prototipos KL Admin | `design/prototipos/canvas/PUB-Verify.dc.html` | 6,472 | `24967bfebea1` |
| Prototipos KL Admin | `design/prototipos/canvas/PZ-RevocationNotice.dc.html` | 5,564 | `06678bf983de` |
| Prototipos KL Admin | `design/prototipos/canvas/canvas.json` | 4,449 | `6b876d6e6eed` |
| Prototipos KL Admin | `design/prototipos/canvas/kl-control-center.css` | 11,492 | `7794b1d5fd9b` |
| Registro de congelamiento | `README.md` | 5,452 | `5e6d00c002a3` |

## Excluidos (solo huella y metadatos)

| Archivo | Motivo | Cómo recuperarlo | SHA-256 (12) |
|---|---|---|---|
| `design/DB2026/historico/DB2026_comparativo_AB.html` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `f5d4e80aca36` |
| `design/DB2026/historico/DB2026_prototipo_A.pdf` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `bf8672066ee6` |
| `design/DB2026/historico/DB2026_prototipo_B.pdf` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `d6bb7530ded6` |
| `design/DB2026/historico/build-compare.py` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `6cfc3ae3a1d7` |
| `design/DB2026/historico/compare.template.html` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `3df797026c6c` |
| `design/DB2026/historico/theme-a.css` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `11988b207c6d` |
| `design/DB2026/historico/theme-b.css` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `8511edca212f` |
| `design/evidencia/ac10/assets/open-sans-latin-400-normal.woff2` | TERCEROS SIN LICENCIA EN EL SNAPSHOT: fuente OFL; se reconstruye desde @fontsource y se verifica por huella | `verify.sh --restore-fonts`: idéntico desde `a8f8f3e:frontend/src/precision/assets/fonts/`, que trae su licencia OFL | `0e44026ad313` |
| `design/evidencia/ac10/assets/open-sans-latin-600-normal.woff2` | TERCEROS SIN LICENCIA EN EL SNAPSHOT: fuente OFL; se reconstruye desde @fontsource y se verifica por huella | `verify.sh --restore-fonts`: idéntico desde `a8f8f3e:frontend/src/precision/assets/fonts/`, que trae su licencia OFL | `a97a6ed7ef9f` |
| `design/evidencia/ac10/assets/public-sans-latin-400-normal.woff2` | TERCEROS SIN LICENCIA EN EL SNAPSHOT: fuente OFL; se reconstruye desde @fontsource y se verifica por huella | `verify.sh --restore-fonts`: idéntico desde `a8f8f3e:frontend/src/precision/assets/fonts/`, que trae su licencia OFL | `36274b5787b4` |
| `design/evidencia/ac10/assets/public-sans-latin-600-normal.woff2` | TERCEROS SIN LICENCIA EN EL SNAPSHOT: fuente OFL; se reconstruye desde @fontsource y se verifica por huella | `verify.sh --restore-fonts`: idéntico desde `a8f8f3e:frontend/src/precision/assets/fonts/`, que trae su licencia OFL | `c7842f97346d` |
| `design/evidencia/ac10/assets/public-sans-latin-700-normal.woff2` | TERCEROS SIN LICENCIA EN EL SNAPSHOT: fuente OFL; se reconstruye desde @fontsource y se verifica por huella | `verify.sh --restore-fonts`: idéntico desde `a8f8f3e:frontend/src/precision/assets/fonts/`, que trae su licencia OFL | `dace74161369` |
| `design/historico/KL_1.0_Contratos_kl.v1_v2.md` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `c31e09599d71` |
| `design/historico/KL_1.0_Design_Spec_borrador1.md` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `94c3dc918b26` |
| `design/historico/KL_1.0_Design_Spec_v2.md` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `a176f56acaf1` |
| `design/historico/KL_1.0_Matriz_Implementacion_Pruebas_v2.md` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `65d7bd28ef7b` |
| `design/prototipos/db2026-gen/fonts-fallback/public-sans-latin-400-normal.woff2` | TERCEROS SIN LICENCIA EN EL SNAPSHOT: fuente OFL; se reconstruye desde @fontsource y se verifica por huella | `verify.sh --restore-fonts`: idéntico desde `a8f8f3e:frontend/src/precision/assets/fonts/`, que trae su licencia OFL | `36274b5787b4` |
| `design/prototipos/db2026-gen/fonts-fallback/public-sans-latin-600-normal.woff2` | TERCEROS SIN LICENCIA EN EL SNAPSHOT: fuente OFL; se reconstruye desde @fontsource y se verifica por huella | `verify.sh --restore-fonts`: idéntico desde `a8f8f3e:frontend/src/precision/assets/fonts/`, que trae su licencia OFL | `c7842f97346d` |
| `design/prototipos/db2026-gen/fonts-fallback/public-sans-latin-700-normal.woff2` | TERCEROS SIN LICENCIA EN EL SNAPSHOT: fuente OFL; se reconstruye desde @fontsource y se verifica por huella | `verify.sh --restore-fonts`: idéntico desde `a8f8f3e:frontend/src/precision/assets/fonts/`, que trae su licencia OFL | `dace74161369` |
| `historico/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.1.docx` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `d3a5ccb9739a` |
| `historico/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.2.docx` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `f278f2c80cf1` |
| `historico/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.3.docx` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `3fd0c78d0822` |
| `historico/beeside_Knowledge_Layer_1.0_Workspace_MVP1_v1.0.docx` | SUSTITUIDO: versión histórica o exploración descartada | Snapshot del Mac o paquete de respaldo | `bdbc5480ba6f` |
| `pruebas/ice2025/fuentes_texto/ICE-2025_Boletas-.pdf.txt` | TERCEROS: texto íntegro de publicaciones IMCO (derechos reservados, uso interno) | Snapshot del Mac o paquete de respaldo; requiere autorización de derechos de IMCO (C3/P2) para distribuirlo | `8796f1f011c5` |
| `pruebas/ice2025/fuentes_texto/anexo.txt` | TERCEROS: texto íntegro de publicaciones IMCO (derechos reservados, uso interno) | Snapshot del Mac o paquete de respaldo; requiere autorización de derechos de IMCO (C3/P2) para distribuirlo | `7ace61589016` |
| `pruebas/ice2025/ice2025_records.json` | TERCEROS: reproducción de las tablas IMCO ICE 2025 (1,696 registros) | Snapshot del Mac o paquete de respaldo; requiere autorización de derechos de IMCO (C3/P2) para distribuirlo | `7fa6b1b4f14b` |
| `specs/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.4.docx` | DUPLICADO BINARIO: equivalente canónico en specs/KL_1.0_Master_Spec_MVP1.md | Snapshot del Mac o paquete de respaldo | `1546eb3e7197` |

## Revisión de seguridad y derechos

- **Secretos y credenciales:** búsqueda de claves privadas, tokens (`sk-`, `ghp_`, `AKIA`, `xox`), cadenas de conexión con contraseña, `password`, `api_key` y `DATABASE_URL=`: 0 coincidencias en los archivos versionados.
- **Datos personales:** no hay correos reales; solo marcadores como `[editor]@beeside`. No hay datos de clientes.
- **Dependencias instaladas, temporales y artefactos de compilación:** ninguno (sin `node_modules`, `dist` ni `.DS_Store`).
- **Terceros:**
  - IMCO: se excluyeron el texto íntegro y la reproducción de tablas. Quedan solo cifras citadas con atribución, en la evidencia AC-10 y en los prototipos, dentro del uso «cita y paráfrasis» registrado para S01.
  - Fuentes:
    - Lato se versiona con su licencia OFL (`fonts/LICENSE`).
    - Public Sans y Open Sans se excluyen porque el snapshot no trae su licencia; el repositorio ya las tiene con licencia en `a8f8f3e`.
  - La guía Doing Business v3 original (PDF del PO) no forma parte del snapshot.
- **Marca:** logotipos de beeside sin alterar, necesarios para reproducir el PDF.
