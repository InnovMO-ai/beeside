# L1 v2 · Guardas de CI de Knowledge Layer

Cierra los cuatro hallazgos de la validación independiente de KL (20-oct-2026) sobre d19f15b + 33cb973. Alcance: solo el gate de KL; no cambia producto, migraciones, despliegues ni otras plataformas.

## Principio

**La rama que pide fusionarse no decide si sus propios controles son válidos.** El gate corre con scripts tomados de `main`, el árbol de la rama solo se lee, y las aprobaciones se verifican con la API de GitHub, no con lo que diga un archivo de la rama.

## Qué cambia

| # | Hallazgo | Corrección | Dónde |
|---|---|---|---|
| 1 | `exit 0` en `preflight.sh` desactiva el control | El workflow usa `pull_request_target` (GitHub ejecuta el archivo tal como está en `main`), hace checkout de `main` en `trusted/` y ejecuta `trusted/scripts/kl/preflight.sh` sobre el árbol de la rama (`pr/`). En modo main el preflight **se niega a correr desde el árbol evaluado**. Además, cualquier cambio a un control protegido exige aprobación verificada. | `kl-preflight.yml`, `preflight.sh` |
| 2 | `kl-ci.yml` se podía debilitar sin aviso | `kl-ci.yml`, `shared-changes.txt`, `po-approvers.txt`, `verify-approval.sh` y `require-kl-ci.sh` son **controles protegidos** (junto con `preflight.sh`, `kl.fingerprint` y `kl-preflight.yml`): modificarlos o borrarlos da STOP salvo aprobación verificada del PO sobre ese commit. `shared-changes.txt` se protege para que una rama no pueda falsificar declaraciones. | `preflight.sh` (`GUARD_FILES_MAIN`) |
| 3 | `kl-ci` en ramas `kl/*` | En la consolidación (`main-v1`) `kl-ci` ya corre en todo PR. Lo que faltaba era **exigirlo**: `require-kl-ci.sh` comprueba por API que el run de `.github/workflows/kl-ci.yml` sobre el commit del PR terminó con **`success` en `kl-tests` y `kl-images`**. Omitido, cancelado, ausente o de otro workflow = STOP. | `require-kl-ci.sh` |
| 4 | `PENDIENTE` no bloqueaba | En `--ci`, una declaración con aprobación que contenga «PENDIENTE» da STOP (modo heredado y modo main). | `preflight.sh` |
| — | Evasión por nombre de rama | Con `--pr-gate`, un PR de una rama que no es `kl/*` ni `feat/kl-1.0-code` pasa solo si **no toca rutas de KL**. | `preflight.sh` |
| — | Código de la rama dentro del gate | Si la documentación congelada cambió, `verify.sh` (código de la rama) **no se ejecuta**. | `preflight.sh` |
| — | Un check «omitido» cuenta como aprobado | El job `kl-gate` no tiene `if` a nivel de job: siempre produce resultado. | `kl-preflight.yml` |

### Aprobación verificada

`verify-approval.sh` consulta `GET /repos/{repo}/pulls/{n}/reviews` y devuelve `verified` solo si un login de `scripts/kl/po-approvers.txt` (leído de `main`) tiene su **última** revisión decisiva en `APPROVED`, sobre el **commit exacto** del PR, y no es el autor. Una solicitud de cambios posterior, un push nuevo o una lista vacía → `missing`. En push (sin PR) el estado es `deferred`: el control se exige en el PR.

## Compatibilidad

- **`feat/kl-1.0-code` (modo heredado)**: misma base (Design), mismas guardas de tres archivos; solo se añade el bloqueo de «PENDIENTE». Probado sobre `6595557` (pruebas L1/L2).
- **Ramas `kl/*` desde `main`**: base = merge-base con `origin/main`; el desarrollo normal (archivos de KL) no pide ninguna aprobación.
- **Despliegues**: sin cambios. `deploy-*.yml` no se tocan; `DEPLOY_DEV_ENABLED` sigue siendo la compuerta.
- **`po-approvers.txt` está vacío a propósito.** Hasta que el PO registre una segunda identidad humana, ningún cambio a controles protegidos puede aprobarse por PR (falla cerrado). Un cambio de estos controles sin esa identidad solo puede entrar por un bypass explícito y auditable del ruleset.

## Lo que NO puede garantizarse solo en el repositorio

Requiere configuración en GitHub (propuesta en `scripts/kl/ruleset/*.json`; **no aplicada**):

1. **Ruleset de `main`**: PR obligatorio, 1 aprobación, revisión de code owners, descartar aprobaciones al hacer push, aprobación del último push, checks requeridos `kl-gate`, `kl-tests`, `kl-images`, sin force-push ni borrado, sin bypass.
2. **CODEOWNERS efectivo**: hoy todas las rutas resuelven a una sola cuenta (`@InnovMO-ai`); la revisión de code owners no se puede satisfacer por el autor. Requiere una segunda identidad o equipo.
3. **Etiquetas protegidas**: `kl-design-1.0-frozen` y `kl-publish-*` sin borrado ni reescritura.
4. **Fijar el workflow requerido** (regla de ruleset «Require workflows to pass», si el plan de la organización la ofrece): impide que otro archivo de workflow emita un check llamado igual a `kl-gate`. Sin ella, una rama podría añadir un workflow que publique un check homónimo; el gate lo detecta como cambio no declarado en `.github/workflows/`, pero el estado se evalúa por nombre.
5. **Raíz de confianza inicial**: el propio PR que instala L1 no puede ser juzgado por un gate que aún no está en `main`; lo revisa el PO a mano.
6. **Rerun tras aprobar**: la aprobación llega después del primer resultado; el PO pulsa «Re-run jobs» del check `kl-gate` (la aprobación se lee en vivo).

## Riesgos residuales

- Una rama puede borrar o desactivar **pruebas** de KL (archivos bajo `__tests__`) sin tocar los controles protegidos; lo cubre la revisión humana, no el gate.
- La lista de aprobadores es tan fuerte como las cuentas que contiene.
- El hash declarado de cada guarda prueba integridad, no autoría; la autoría la da la revisión de GitHub.

## Pruebas

`bash scripts/kl/tests/gate-tests.sh` (opcional `KL_LEGACY_BASE=<sha de feat/kl-1.0-code>`): 37 pruebas (positivas, negativas, aprobación y CI con API simulada, modo heredado). Cada control nuevo fue desactivado a propósito (mutación) y las pruebas específicas fallaron.
