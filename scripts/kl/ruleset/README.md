# Rulesets propuestos para L1 (NO aplicados)

Nada de esto se ha aplicado. Cada comando modifica la configuración remota del repositorio y requiere autorización expresa del PO.

| Archivo | Cuándo | Qué hace |
|---|---|---|
| `1-bootstrap-main.ruleset.json` | **Antes** de fusionar L1 | PR obligatorio con 1 aprobación sobre el último push, sin force-push ni borrado, checks `kl-tests` y `kl-images` fijados a GitHub Actions. No exige `kl-gate` (aún no existe en `main`) ni code owners (aún no hay segunda identidad definida). |
| `2-final-main.ruleset.json` | **Justo después** de fusionar L1, en lugar del 1 | Añade `kl-gate` y la revisión de code owners. Cada check lleva `integration_id: 15368` (la app GitHub Actions; verificado con `gh api apps/github-actions`). |
| `3-tags.ruleset.json` | Antes de fusionar | Impide borrar/mover `kl-design-1.0-frozen` y `kl-publish-*`. |
| `4-legacy-branch.ruleset.json` | Antes de fusionar | Impide borrar o reescribir `feat/kl-1.0-code` mientras exista. |
| `CODEOWNERS.propuesto` | Con el 2 | Plantilla con marcador `<IDENTIDAD-2>`; el PO decide quién. |

## Aplicar (cuando el PO lo autorice)
```
gh api -X POST repos/InnovMO-ai/beeside/rulesets --input scripts/kl/ruleset/1-bootstrap-main.ruleset.json
```
Para pasar del 1 al 2: `gh api repos/InnovMO-ai/beeside/rulesets` (anotar el id del bootstrap), `gh api -X PUT repos/InnovMO-ai/beeside/rulesets/<id> --input scripts/kl/ruleset/2-final-main.ruleset.json`.

## Qué no se puede fijar aquí
- «Require workflows» (fijar el archivo y la referencia del workflow) es una regla de **organización**; el repositorio es de usuario. Se compensa con el control de `.github/` del preflight, `integration_id` y la comprobación de origen (`verify-check-origin.sh`).
- «Restringir pushes»: la regla `pull_request` ya obliga a pasar por PR; una regla `update` bloquearía también la fusión. El bypass queda vacío a propósito: cualquier excepción debe ser una decisión explícita y auditable del PO.
- `enforcement: evaluate` (modo de prueba) solo existe en planes Enterprise.
