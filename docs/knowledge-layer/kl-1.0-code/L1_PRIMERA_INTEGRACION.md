# L1 · Procedimiento de primera integración

**Problema:** `main` real (`bc3f527`) no contiene el gate; el PR que lo introduce no puede ser juzgado por él (`pull_request_target` toma el workflow de `main`, que aún no existe). **Solución:** sustituir la confianza en el gate por una cadena de controles que no dependen de él: un commit fijado por hash, verificado de forma independiente, revisado por una segunda persona sobre ese mismo commit, con la rama `main` protegida antes de fusionar y verificada después con PR canario.

Nada de lo de abajo se ejecuta sin autorización expresa del PO. Los comandos de configuración remota están en `scripts/kl/ruleset/README.md`.

## Fase 0 · Decisiones del PO (antes de tocar GitHub)
- [ ] Segunda identidad humana y logins para `scripts/kl/po-approvers.txt` y para code owners.
- [ ] Registrar las siete aprobaciones PENDIENTE de `shared-changes.txt` (acto del PO; el paquete no lo hace).
- [ ] Política de bypass del ruleset (por omisión: ninguna).
- [ ] Decisión 4 de `L1_GUARDAS_CI.md` (cambios a `.github/` de otras plataformas).

## Fase 1 · Verificación independiente del commit (controles técnicos)
Quien valida **no** es quien redactó el parche. Con el paquete `KL-validacion-L1-v3`:
1. `bash validar-kl.sh` → integridad, parches 0001–0004, blobs, pruebas del gate.
2. `bash primera-integracion.sh --expected-head <SHA> --expected-tree <TREE> --main <bc3f527…>` → comprueba que `origin/main` no se movió, que `main` es ancestro del commit, que el árbol es el esperado, que los 10 controles son los validados, y lista por plataforma los archivos que cambian (el diff contra `main` es enorme; los **controles protegidos** y `.github/`, `infra/`, `deploy/`, `backend/db/migrations/` se revisan línea a línea).
3. El validador deja un registro (SHA-256 del reporte) y emite GO/NO-GO por escrito.

## Fase 2 · Protección previa de `main` (con autorización del PO)
Aplicar `3-tags`, `4-legacy-branch` y `1-bootstrap-main` (PR + 1 aprobación sobre el último push + sin force-push/borrado + `kl-tests`/`kl-images` fijados a Actions). El bootstrap **no** exige `kl-gate`.

## Fase 3 · Publicación
1. Publicar el commit validado en una rama `kl/l1-integracion` (push de esa rama; sin `--force`). El hash publicado debe ser el esperado: `git ls-remote origin refs/heads/kl/l1-integracion`.
2. Abrir el PR hacia `main`. No habrá `kl-gate` (el workflow aún no está en `main`); sí correrán `kl-ci.yml` e `ci.yml` por `pull_request`. Son informativos para el gate, obligatorios por el ruleset bootstrap para `kl-tests`/`kl-images`.

## Fase 4 · Revisión y fusión (controles manuales)
- La segunda persona revisa los archivos protegidos y marca **Approve sobre el SHA exacto** (GitHub descarta la aprobación si hay un push nuevo).
- Antes de pulsar «Merge», repetir `primera-integracion.sh`: `origin/main` sin moverse, SHA del PR = esperado, árbol = esperado. Si `main` avanzó, volver a la Fase 1 con el delta.
- Fusionar con **merge commit** (nunca squash ni rebase: alterarían el árbol validado).
- Verificación posterior: `git rev-parse origin/main^{tree}` debe igualar el árbol esperado.
- `DEPLOY_DEV_ENABLED` debe seguir en `false` antes y después (la fusión dispara `push` a `main`).

## Fase 5 · Activación del gate (inmediatamente después)
1. Sustituir el ruleset bootstrap por `2-final-main` y registrar los logins en un PR **ya sujeto al gate** (también es el primer canario).
2. **PR canario** (GitHub real; cerrar sin fusionar). Resultado esperado de cada uno:

| # | PR | Esperado |
|---|---|---|
| K1 | `kl/canario-limpio`: cambia un archivo de `backend/src/kl` | `kl-gate`, `kl-tests`, `kl-images` verdes |
| K2 | `kl/canario-ci`: debilita `kl-ci.yml` | `kl-gate` rojo (STOP: control protegido) |
| K3 | rama `feat/kl-1.0-code` hacia `main` | `kl-gate` rojo («NO admite el modo heredado») |
| K4 | `feature/canario-wf`: añade un workflow con un job `kl-gate` | `kl-gate` rojo; origen de checks rojo |
| K5 | `feature/canario-disc`: toca solo `backend/src/fa4` | `kl-gate` verde |
| K6 | commit status `kl-gate`=success publicado con `gh api` sobre un canario | `kl-gate` rojo (Statuses API) y el merge sigue bloqueado |
| K7 | canario con aprobación de la propia cuenta autora | no cuenta |
| K8 | `kl-gate` con la API fallando (token sin `pull-requests: read` en un fork de prueba) | `missing`/STOP, nunca verde |
| K9 | PR desde un fork de prueba, rama llamada `feat/kl-1.0-code` y rama `kl/x` | `kl-gate` rojo / sin escalar permisos |

Si algún canario no da el resultado esperado: restaurar el ruleset bootstrap, abrir un PR de reversión sujeto a revisión humana y volver a la Fase 1.

## Qué controla cada riesgo
| Riesgo | Control técnico | Control manual |
|---|---|---|
| Fusionar un commit distinto del validado | SHA y árbol fijados; `primera-integracion.sh` | Aprobación sobre el SHA exacto |
| `main` cambió tras validar | Comprobación de deriva | Revalidar el delta |
| Código del gate alterado | Blobs de los 10 controles contra el paquete | Revisión línea a línea de protegidos |
| Despliegue involuntario | `DEPLOY_DEV_ENABLED=false` comprobado antes y después | PO |
| Fusión sin segunda persona | Ruleset bootstrap (1 aprobación, último push) | Segunda identidad |
