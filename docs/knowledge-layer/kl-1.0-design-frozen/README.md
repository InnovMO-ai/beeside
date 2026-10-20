# beeside Knowledge Layer 1.0 (KL)

Carpeta de trabajo del proyecto Knowledge Layer. Workspace cerrado formalmente el 16-oct-2026. Siguiente fase: Design, en un ambiente independiente. Punto de entrada: `handoff/KL_1.0_Design_Handoff_Pack.md`.

## Documentos canónicos

| Documento | Dónde |
|---|---|
| Master Product & Operating Specification v1.4 (reglas, canónica) | `specs/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.4.docx` (copia en Markdown: `specs/KL_1.0_Master_Spec_MVP1.md`; original en el proyecto "Knowledge Layer" de claude.ai) |
| KL 1.0 → Precision MVP1 · Canonical Architecture Handoff (contrato para Claude trabajando en Precision) | `handoff/KL_1.0_Precision_MVP1_Handoff.md` · https://claude.ai/code/artifact/a602f040-947b-4a48-99e0-c95dbf10fd9d |
| Doing Business beeside México · Product Specification (Producto 01; aprobada el 16-oct, D20–D26; snapshot en `handoff/referencia/`) | https://claude.ai/code/artifact/8c8c2421-9e6c-4c36-9d0f-759d87af3b01 |
| Workspace Consolidation & Readiness (Decision Register, inventario de Precision, Source Registry México, Ingestión y recuperación, plan) | https://claude.ai/code/artifact/f95a2dd1-f13e-4df4-aac3-37bad4e272a1 |

## Histórico

- `historico/beeside_Knowledge_Layer_1.0_Workspace_MVP1_v1.0.docx`: especificación v1.0 (corregida de "2.0" a "1.0").
- `historico/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.1.docx`: especificación v1.1 (14-oct-2026).
- `historico/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.2.docx`: especificación v1.2 (15-oct-2026).
- `historico/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.3.docx`: especificación v1.3 (15-oct-2026).

## Pruebas de Workspace

- `pruebas/ice2025/`: estructuración de ICE 2025 y prueba A/B/C de recuperación (reproducible; ver su README).

## Design (congelado, versión 3 · 16-oct-2026)

- `design/KL_1.0_Code_Handoff_Pack.md`: entrega a Code (alcance, orden, banderas, reglas, pendientes y condiciones A/B/C). Code inicia con la aprobación del PO.
- `design/KL_1.0_Design_Spec.md`: Design Specification v3, resoluciones PO-1 a PO-7.
- `design/KL_1.0_Contratos_kl.v1.md`: contratos técnicos v3 (compuerta de CR-KL-001, periodicidad y enlaces).
- `design/KL_1.0_Matriz_Implementacion_Pruebas.md`: piezas I1–I24, pruebas, A01–A10, AC-01–AC-14 y condiciones A/B/C.
- `design/CR-KL-001_R10_Precision.md`: propuesta técnica aprobada por el PO, pendiente de aceptación del responsable de Precision.
- `design/DB2026/`: paquete editorial Doing Business México 2026 (evaluación, mapeo, trazabilidad, prototipo definitivo; exploración A/B en `historico/`).
- `design/evidencia/`: corrección responsive de KL Admin (`responsive/`: antes y después, PDF de prototipos y prueba de regresión), prueba AC-10 (incluye `AC10_artefacto_tecnico_carta.pdf`, artefacto técnico, no referencia editorial) y prueba del comparador de R10.
- `design/prototipos/`: generador del PDF de Doing Business (`db2026-gen/`) y fuentes del canvas "KL 1.0 · Design".
- `design/historico/`: borrador 1 y versiones 2.

## Siguiente bloque

Code R1 Núcleo en aislamiento (datos sintéticos, fuentes desactivadas), tras la aprobación del PO. En paralelo: especificación de la RAM en Precision (P7).

`handoff/referencia/`) | https://claude.ai/code/artifact/8c8c2421-9e6c-4c36-9d0f-759d87af3b01 |
| Workspace Consolidation & Readiness (Decision Register, inventario de Precision, Source Registry México, Ingestión y recuperación, plan) | https://claude.ai/code/artifact/f95a2dd1-f13e-4df4-aac3-37bad4e272a1 |

## Histórico

- `historico/beeside_Knowledge_Layer_1.0_Workspace_MVP1_v1.0.docx`: especificación v1.0 (corregida de "2.0" a "1.0").
- `historico/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.1.docx`: especificación v1.1 (14-oct-2026).
- `historico/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.2.docx`: especificación v1.2 (15-oct-2026).
- `historico/beeside_Knowledge_Layer_1.0_Master_Spec_MVP1_v1.3.docx`: especificación v1.3 (15-oct-2026).

## Pruebas de Workspace

- `pruebas/ice2025/`: estructuración de ICE 2025 y prueba A/B/C de recuperación (reproducible; ver su README).

## Design (en curso)

- `design/KL_1.0_Design_Spec.md`: Design Specification v2 (16-oct-2026), resoluciones PO-1–PO-3 incorporadas; pendiente de aprobación de cierre.
- `design/KL_1.0_Contratos_kl.v1.md`: contratos técnicos y límites de integración.
- `design/KL_1.0_Matriz_Implementacion_Pruebas.md`: piezas, incrementos de Code, pruebas, A01–A10 y AC-01–AC-14.
- `design/CR-KL-001_R10_Precision.md`: change request de R10 para el responsable de Precision.
- `design/evidencia/`: corrección responsive de KL Admin (`responsive/`: antes y después, PDF de prototipos y prueba de regresión), prueba AC-10 (PDF determinista) y prueba del comparador de R10.
- `design/prototipos/`: PDF de prototipo y fuentes de los prototipos HTML del canvas "KL 1.0 · Design" (claude.ai).
- `design/historico/`: borrador 1.

## Siguiente bloque

Design (macrobloque 2) a partir de `handoff/KL_1.0_Design_Handoff_Pack.md`. En paralelo: especificación de la RAM en Precision (P7).

`handoff/referencia/` contiene snapshots del 16-oct de los documentos de Claude Docs; los canónicos son los enlaces.

Nota: esta carpeta está excluida de git solo en esta máquina (`.git/info/exclude`) para no mezclarse con el código de Discovery y Precision. Para versionarla, quita la línea `/KnowledgeLayer/` de ese archivo.
