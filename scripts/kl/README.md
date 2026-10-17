# scripts/kl · Guardas de Knowledge Layer Code

| Archivo | Función |
|---|---|
| `preflight.sh` | Verifica identidad (plataforma, repo, worktree, rama), referencia de Design y ancestría, Design congelado, fingerprint y límites entre plataformas. Exit 1 = STOP. |
| `kl.fingerprint` | Fingerprint KL: referencia congelada de Design + módulo de implementación (`backend/src/kl`, `planned`). |
| `shared-changes.txt` | Declaración de cambios propuestos en componentes compartidos (requiere justificación; la aprobación es del PO). |

## Uso obligatorio en Code
1. Al iniciar cada sesión: `KL_PLATFORM=knowledge-layer-code bash scripts/kl/preflight.sh --remote`
2. Antes de cada commit: `KL_PLATFORM=knowledge-layer-code bash scripts/kl/preflight.sh --gate`
3. Si la salida es `RESULTADO: STOP`, no se escribe nada y se informa al PO.

## Clases de cambio
- **KL** (permitido): `backend/src/kl/`, `frontend/src/kl/`, `backend/src/admin/kl/`, `frontend/src/admin/kl/`, `scripts/kl/`, `.github/workflows/kl-*`, `docs/knowledge-layer/` fuera de lo congelado.
- **Compartido** (REVISAR; en `--gate` exige declaración): cualquier otra ruta, p. ej. `backend/src/reports/`, `backend/src/admin/`, `package.json`, `backend/db/schema/`.
- **Guarda** (REVISAR; exige declaración): cambios a `preflight.sh`, `kl.fingerprint` o `kl-preflight.yml` después del commit de instalación.
- **Bloqueado** (STOP siempre): Precision, Discovery, `backend/db/migrations/` y `docs/knowledge-layer/kl-1.0-design-frozen|kl-1.0-freeze-meta`.

No se instalan git hooks: los hooks y la config son compartidos entre worktrees y afectarían a Discovery.
