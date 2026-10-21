# L1 v3 · Guardas de CI de Knowledge Layer

Cierra los cuatro hallazgos de la primera validación (20-oct-2026) y los tres de la validación independiente de L1 v2 (B1–B3). Alcance: solo el gate de KL; sin cambios de producto, migraciones, despliegues ni de otras plataformas.

## Principio
**La rama que pide fusionarse no decide si sus propios controles son válidos.** El gate corre con scripts de `main`, el árbol de la rama solo se lee, la aprobación se verifica con la API de GitHub y el origen de cada check se contrasta con GitHub. Todo error o dato ausente **bloquea**.

## Qué hace cada pieza
| Pieza | Función |
|---|---|
| `.github/workflows/kl-preflight.yml` | `pull_request_target` (GitHub ejecuta el archivo de `main`). Job siempre presente: `kl-gate` en PR, `kl-gate-push` en push. Checkout de `main` en `trusted/` y de la rama en `pr/` sin credenciales. Permisos de solo lectura. |
| `scripts/kl/gate-run.sh` | Decide por **evento** (`pull_request_target` → `--ci --pr-gate`; `push` → `--ci`; cualquier otro → STOP). Solo el literal `verified` cuenta como aprobación; todo lo demás es `missing`. |
| `scripts/kl/preflight.sh` | En eventos de PR el gate de PR es obligatorio **aunque falte la bandera** y **nunca** usa el modo heredado (`feat/kl-1.0-code` ⇒ STOP). `approval_gate` acepta solo `verified` con `pull_request_target` o `deferred` con `push`. Todo lo que cuelga de `.github/` (workflows de CI, publicación y despliegue, CODEOWNERS) es control protegido en modo main, también para PR de otras plataformas. |
| `scripts/kl/verify-approval.sh` | Siempre imprime `verified` o `missing`: error, respuesta vacía/HTML/JSON de error, variables ausentes, sin `python3` o sin lista de aprobadores ⇒ `missing`. Exige revisión APPROVED sobre el commit exacto, de un login de `po-approvers.txt`, distinto del autor. |
| `scripts/kl/require-kl-ci.sh` | `kl-tests` y `kl-images` deben terminar en `success` en un run de `kl-ci.yml`, evento `pull_request`, mismo commit, mismo repositorio, y jobs con ese `head_sha`, `run_id` y `workflow_name`. |
| `scripts/kl/verify-check-origin.sh` | Sobre el commit exacto: todo check llamado `kl-gate`, `kl-gate-push`, `kl-tests` o `kl-images` debe venir de la app GitHub Actions (id 15368) y de un run del workflow esperado de este repositorio; ningún estado de commit (Statuses API) puede llevar esos nombres. |
| `scripts/kl/ruleset/*.json` | Rulesets propuestos (no aplicados) con `integration_id: 15368`. |

## Los siete hallazgos
1. `exit 0` en `preflight.sh` → scripts de `main`; el autoexamen desde el árbol se rechaza; modificarlo exige aprobación verificada.
2. `kl-ci.yml` debilitable → es control protegido (como todo `.github/`).
3. `kl-ci` en `kl/*` → se exige su resultado `success` por API, no solo que corra.
4. PENDIENTE no bloqueaba → bloquea en CI.
5. **B1** modo heredado alcanzable por nombre de rama → el gate de PR lo rechaza siempre.
6. **B2** fallo abierto de la aprobación → toda ruta de error produce `missing`/STOP; `deferred` solo vale en push.
7. **B3** sustitución de checks/workflows → `.github/**` protegido, `integration_id`, comprobación de origen, nombres de check distintos para PR y push.

## Compatibilidad
- **Discovery/Precision**: un PR de otra plataforma pasa si no toca rutas de KL ni `.github/`. Si modifica workflows, CODEOWNERS o `.github/`, requiere aprobación verificada (decisión del PO: ver abajo).
- **KL**: ramas `kl/*` desde `main`; el desarrollo normal no pide aprobación. Actualizar con rebase (un merge de `main` en la rama da STOP por «commit de merge»).
- **`feat/kl-1.0-code`**: sigue funcionando en push (informativo). No se fusiona por PR.
- **Despliegues**: intactos; `DEPLOY_DEV_ENABLED=false`.

## Qué solo se valida con GitHub real (no con mocks)
Las pruebas locales simulan la API con JSON. Quedan sin demostrar, y se cubren con los PR canario de `L1_PRIMERA_INTEGRACION.md`:
1. Que `pull_request_target` ejecute el archivo de `main` y no el de la rama, incluso en forks.
2. Que los campos reales (`path`, `event`, `head_sha`, `repository.full_name` del run; `head_sha`, `run_id`, `workflow_name` del job; `app.id` y `details_url` del check-run) coincidan con lo que lee el código.
3. Que `integration_id: 15368` impida satisfacer un check con un estado de commit o con otra app.
4. Qué hace GitHub con dos checks del mismo nombre (el diseño evita depender de ello, pero no se demuestra).
5. Que una revisión APPROVED se descarte al hacer push y que `require_last_push_approval` funcione como se espera.
6. Que el rerun del job tras aprobar relea las revisiones en vivo.
7. El comportamiento de PR desde forks (repositorio público) y la política de aprobación de workflows de forks.
8. Que `GITHUB_EVENT_NAME` y `GITHUB_HEAD_REF` tengan en `pull_request_target` los valores que el código espera.

## Riesgos residuales
- Una rama puede borrar o desactivar **pruebas** de KL (`__tests__`) sin tocar controles protegidos; lo cubre la revisión humana.
- Un contribuyente con permiso de escritura puede publicar un commit status; `integration_id` y la comprobación de origen lo neutralizan solo si el ruleset está activo.
- La lista de aprobadores es tan fuerte como las cuentas que contiene. Está **vacía a propósito**.
- Las acciones (`actions/checkout@v4`) están fijadas por tag, no por SHA.
- Ventana de carrera: un check falsificado después de que `verify-check-origin.sh` terminó solo lo frena el ruleset.
- `gate-tests.sh` no corre en ningún CI (añadirlo a `kl-ci.yml` exige aprobación verificada).

## Decisiones que sí requieren al Product Owner
1. Quién es la segunda identidad y los logins de `po-approvers.txt` (no se inventan aquí).
2. Quién es code owner (plantilla `CODEOWNERS.propuesto`).
3. Registrar las **siete** aprobaciones PENDIENTE de `shared-changes.txt` (`preflight.sh`, `kl-preflight.yml`, `verify-approval.sh`, `require-kl-ci.sh`, `po-approvers.txt`, `verify-check-origin.sh`, `gate-run.sh`).
4. Aceptar que los cambios a `.github/` de Discovery/Precision pasen por aprobación verificada, o restringir esa regla a KL.
5. Autorizar la aplicación de los rulesets y la política de bypass.

## Pruebas
`bash scripts/kl/tests/gate-tests.sh` (opcional `KL_LEGACY_BASE=<sha de feat/kl-1.0-code>`).
