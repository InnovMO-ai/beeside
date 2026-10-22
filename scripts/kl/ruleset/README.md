# Rulesets propuestos para L1 (NO aplicados)

Nada de esto se ha aplicado. Cada comando modifica la configuración remota del repositorio y requiere autorización expresa del PO.

| Archivo | Cuándo | Qué hace |
|---|---|---|
| `1-bootstrap-main.ruleset.json` | **Antes** de abrir L1 a revisión | PR obligatorio, 1 aprobación de alguien distinto del último push, sin force-push ni borrado, sin bypass; los 11 checks (`ci.yml` + `kl-tests` + `kl-images`) fijados a GitHub Actions (`integration_id 15368`). No exige `kl-gate` (aún no existe en `main`) ni code owners (el CODEOWNERS de `main` aún no incluye a castaneda-a: GitHub evalúa el de la rama base). |
| `2-final-main.ruleset.json` | Tras fusionar L1 **y** con los canarios C0–C4 en verde, en lugar del 1 | Añade `kl-gate` y la revisión obligatoria de code owners (`.github/CODEOWNERS`: @InnovMO-ai y @castaneda-a, decisión D1). |
| `3-tags.ruleset.json` | Antes de fusionar | Impide borrar/mover `kl-design-1.0-frozen` y `kl-publish-*`. Sin bypass. |
| `3b-tags-publish-creation.ruleset.json` | Antes de fusionar | Solo el rol administrador puede crear `kl-publish-*` (excepción mínima, queda registrada en Rule insights). |
| `4-legacy-branch.ruleset.json` | Antes de fusionar | Impide borrar o reescribir `feat/kl-1.0-code` mientras exista. |
| `5-release.ruleset.json` | **Después** de crear `release/discovery-v1` | `release/*` solo cambia por PR revisado (code owners, último push) con los checks de `ci.yml`; sin borrado ni force-push; sin bypass. |
| `5b-release-creation.ruleset.json` | Después de crear `release/discovery-v1` | Solo el rol administrador puede crear nuevas `release/*` (excepción mínima y auditable). |

D4: no hay bypass en `main` ni en las reglas de actualización; las únicas excepciones son de **creación**, para el rol administrador, y GitHub las registra. Nada se desactiva de forma general.

## Aplicar (cuando el PO lo autorice)
```
gh api -X POST repos/InnovMO-ai/beeside/rulesets --input scripts/kl/ruleset/1-bootstrap-main.ruleset.json
```
Para pasar del 1 al 2: `gh api repos/InnovMO-ai/beeside/rulesets` (anotar el id del bootstrap), `gh api -X PUT repos/InnovMO-ai/beeside/rulesets/<id> --input scripts/kl/ruleset/2-final-main.ruleset.json`.

## Qué no se puede fijar aquí
- «Require workflows» (fijar el archivo y la referencia del workflow) es una regla de **organización**; el repositorio es de usuario. Se compensa con el control de `.github/` del preflight, `integration_id` y la comprobación de origen (`verify-check-origin.sh`).
- «Restringir pushes»: la regla `pull_request` ya obliga a pasar por PR; una regla `update` bloquearía también la fusión. Las únicas excepciones son las de creación (3b, 5b) para el rol administrador (D4).
- `enforcement: evaluate` (modo de prueba) solo existe en planes Enterprise.
