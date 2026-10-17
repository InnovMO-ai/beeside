# KL 1.0 · Handoff para Knowledge Layer Code (con CR-KL-002)

## 1. Qué se lee y en qué orden manda

1. **Este addendum (`docs/knowledge-layer/kl-1.0-addenda/CR-KL-002/`)**, solo dentro de su alcance (CR-KL-002 §4). Fuera de esas secciones no cambia nada.
2. **Design congelado** (`docs/knowledge-layer/kl-1.0-design-frozen/`, etiqueta `kl-design-1.0-frozen` → `69f211a`), con su orden de prevalencia de Code Handoff Pack §2.

Si hay conflicto dentro del alcance del addendum, manda el addendum. Si alguna duda no se resuelve leyendo ambos, se detiene el trabajo y se pregunta al PO; no se interpreta.

## 2. Entorno

| Elemento | Valor |
|---|---|
| Repositorio | `InnovMO-ai/beeside` |
| Worktree | `~/Developer/beeside-kl` |
| Rama | `feat/kl-1.0-code` (sin upstream; sin push mientras no se autorice) |
| Preflight al iniciar cada sesión | `KL_PLATFORM=knowledge-layer-code bash scripts/kl/preflight.sh --remote` |
| Preflight antes de cada commit | `KL_PLATFORM=knowledge-layer-code bash scripts/kl/preflight.sh --gate` |
| Si la salida es STOP | No se escribe nada y se informa al PO |

## 3. Variables de conexión (nombres normativos)

| Variable | Rol | Proceso |
|---|---|---|
| `KL_DB_URL_APP` | `kl_app` | Backend |
| `KL_DB_URL_READER` | `kl_reader_precision` | Backend |
| `KL_DB_URL_AGENT` | `kl_agent` | `kl-worker` |
| `KL_DB_URL_KNOWLEDGE` | `kl_knowledge` | `kl-worker` |
| `KL_DB_URL_OWNER` | `kl_owner` | `kl-migrate` y pruebas |

- **Rechazo al arrancar:** el proceso que encuentra en su entorno una variable que no le corresponde se niega a arrancar. Por ejemplo, `kl-worker` con `DATABASE_URL` o el backend con `KL_DB_URL_AGENT`.
- **Desarrollo local y CI:** un PostgreSQL 16 efímero con dos bases:
  - `beeside`, migrada con `backend/db/migrations` de la base `bc3f527`, **solo lectura para KL**, para resolver sesiones del Control Center;
  - `beeside_kl`, migrada con el runner de KL.
- **Datos:** solo sintéticos.

## 4. Alcance de R1 Núcleo con CR-KL-002 (cuando el PO lo autorice)

| Pieza | Contenido |
|---|---|
| I1 | Runner y lint de migraciones de KL. `KL-0001` (base, roles, controles §8.2, `kl.principal`, `kl.request_attestation`, `kl.permission_role`, `kl.job`, auditoría) y el esquema congelado de Design Spec §5 con los ajustes de CR-KL-002 |
| I2, I3, I5, I6, I7, I8 | Sin cambios funcionales respecto del Code Handoff Pack §3, contra `beeside_kl` |
| B2–B5 | `kl.attest`, `kl.require`, conciliación, `kl.bootstrap_admin` (sin ejecutarse en ningún entorno compartido) y auditoría correlacionada |
| B6 | Cola `kl.job` y punto de entrada `kl-worker` con agentes **apagados** y sin red |
| Pruebas | X01–X18, X20–X22, X28, X29 y X31 en CI aislado |

**Queda fuera de R1:** Terraform, entornos compartidos, G1–G4, salida a red real, KL Admin (UI), Producto 01 y la integración con Precision fuera de `PRECISION_KNOWLEDGE_PROVIDER = off`.

## 5. Cambios en componentes compartidos previsibles

Cada uno se declara en `scripts/kl/shared-changes.txt` con su justificación **antes** del commit. El preflight en modo `--gate` lo exige. Declarar no autoriza: el PO los revisa.

| Ruta probable | Motivo |
|---|---|
| Arranque del backend (registro del router `/api/admin/kl/*`) | KL Admin API en el Control Center |
| `backend/package.json` (scripts `kl:*`) | Runner, lint y bootstrap |
| Configuración de entorno del backend | Lectura de `KL_DB_URL_APP` y `KL_DB_URL_READER` |

**No se puede tocar, el preflight lo bloquea siempre:**

- Precision (`backend/src/precision/**`, `frontend/src/precision/**` y relacionados);
- Discovery (`fa4`, `fa`, `shared/fa-public-engine`, `deploy`, `docs/deployment`);
- `backend/db/migrations/**`;
- el Design congelado y este addendum.

El puerto `knowledge` de Precision (`precision/ports/knowledge.ts`) lo implementa el responsable de Precision según el Code Handoff Pack. KL entrega su lado del contrato y un consumidor de prueba.

## 6. Reglas que Code no puede relajar (se suman a Code Handoff Pack §5)

1. Nada fuera de `beeside_kl`: ninguna tabla de KL en `beeside` y ninguna tabla ajena en `beeside_kl`.
2. Ninguna operación sensible sin `kl.require` en una transacción certificada por la petición en curso.
3. Ningún DML directo concedido a un rol de aplicación.
4. Ningún secreto de KL en el worker compartido; ninguna credencial de `beeside` en `kl-worker`.
5. Ninguna salida a red fuera de `kl-worker`.
6. Ninguna migración fuera de `backend/src/kl/db/migrations/`.

## 7. Criterio de cierre de R1

Pruebas X de R1 y casos congelados de R1 en verde en CI aislado, preflight `--gate` en OK, y un informe al PO con:

- commits;
- cambios compartidos declarados;
- resultados de pruebas;
- riesgos.

Sin push, merge ni migraciones en entornos compartidos.
