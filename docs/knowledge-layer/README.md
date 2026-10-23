# Knowledge Layer 1.0 · Design congelado (MVP1)

Referencia versionada del Design de beeside Knowledge Layer 1.0, aprobado por el Product Owner el 16-oct-2026 en estado **DESIGN FROZEN / CODE READY**. Es solo documentación: este commit no cambia código.

## Punto de entrada para Code

1. `kl-1.0-design-frozen/DESIGN_FREEZE_KL_1.0.md`: estado, referencia, rama base y comprobaciones previas.
2. `kl-1.0-design-frozen/design/KL_1.0_Code_Handoff_Pack.md`: alcance, orden R1→R2→R3, banderas, reglas, UI-R1 y condiciones A/B/C.
3. Documentos rectores, en orden de prevalencia:
   - `specs/KL_1.0_Master_Spec_MVP1.md` (canon v1.4) y `handoff/`.
   - `design/KL_1.0_Design_Spec.md`.
   - `design/KL_1.0_Contratos_kl.v1.md`.
   - `design/KL_1.0_Matriz_Implementacion_Pruebas.md`.
   - `design/CR-KL-001_R10_Precision.md`.
4. Prototipos y evidencia: `design/prototipos/` (KL Admin y generador del PDF), `design/evidencia/` (responsive UI-R1, AC-10 y R10) y `design/DB2026/`.
5. `kl-1.0-freeze-meta/MIGRATIONS_RECONCILIATION.md`: identificadores provisionales y reconciliación después de P5.

## Antes de desarrollar

```bash
bash docs/knowledge-layer/kl-1.0-freeze-meta/verify.sh           # integridad: 88 archivos contra el manifiesto original (115)
bash docs/knowledge-layer/kl-1.0-freeze-meta/check-base.sh --fetch # base bc3f527 vigente o cambios que revisar
git switch -c feature/kl-1.0-r1 kl-design-1.0-frozen              # base = bc3f527 + esta documentación
```

En el Mac del PO también se puede verificar el snapshot completo: `verify.sh --full ~/Developer/beeside/KnowledgeLayer`.

## Qué no está aquí y por qué

27 archivos del snapshot se excluyeron:

- Material de IMCO con derechos reservados.
- Versiones históricas.
- Duplicados `.docx`.
- Fuentes Public Sans y Open Sans, que se recuperan idénticas desde `a8f8f3e`.

Su huella sigue en `kl-1.0-freeze-meta/excluded.sha256`; el detalle está en `INVENTORY.md`.

## Reglas

- **Contenido congelado:** el contenido de `kl-1.0-design-frozen/` no se edita. Un cambio de Design exige una nueva aprobación, un nuevo manifiesto y una nueva etiqueta.
- **Etiqueta:** `kl-design-1.0-frozen` es inmutable; no se mueve ni se reutiliza.
- **Ramas:** esta rama no se fusiona en `main` sin decisión del PO; Code ramifica desde la etiqueta.
