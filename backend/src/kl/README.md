# Knowledge Layer 1.0 · módulo `backend/src/kl` (R1 Núcleo)

Implementa R1 sobre **Design congelado** (`kl-design-1.0-frozen` @ `69f211a`) y **CR-KL-002** (base independiente `beeside_kl`).
Nada de este módulo toca Discovery, Precision ni `backend/db/migrations`.

## Mapa

| Carpeta | Contenido |
|---|---|
| `db/migrations/` | `KL-NNNN_<tema>.sql` + `KL-NNNN_<tema>_integrity.sql`. Solo se aplican a `beeside_kl` con `kl_owner`. |
| `db/runner.ts`, `db/lint.ts` | Runner con journal propio (`kl.__kl_migrations`, SHA-256) y lint (solo esquema `kl`). |
| `db/attested-tx.ts` | Transacciones certificadas (`kl.attest` / `kl.attest_service`). |
| `read/` | Lado KL de `kl.v1` (consulta, paquetes, señales, uso). Sin cliente HTTP. |
| `worker/` | `kl-worker`: cola `kl.job`, **agentes sin manejador**. |
| `identity/` | Conciliación (solo desactiva) y comando `kl:bootstrap-admin`. |
| `ingest/`, `seed/`, `packages/` | Canal de carga, KSeed **sintético** y compilador de RAM. |
| `../admin/kl/router.ts` | `/api/admin/kl/*` (montado en `index.ts` solo con `KL_DB_URL_APP` y `KL_DB_URL_READER`). |
| `testing/`, `__tests__/` | Clúster PostgreSQL 16 efímero y pruebas. |

## Cómo se prueba (sin tocar nada compartido)

Requiere PostgreSQL **16** (la 18 de Postgres.app no sirve). Opciones:

```bash
# A) binarios aislados (sin Docker ni brew), p. ej. el paquete npm @embedded-postgres/darwin-arm64@16.x instalado fuera del repo
export KL_PG_BIN=~/Developer/beeside-kl-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin
npm run kl:test --workspace=backend

# B) un servicio externo efímero (CI): superusuario del clúster
KL_TEST_PG_URL=postgres://postgres:ci@127.0.0.1:5432/postgres npm run kl:test --workspace=backend
```

El arnés crea los roles `kl_*` (`db/bootstrap/roles.sql`), una `beeside` efímera con las migraciones de `bc3f527` y una
`beeside_kl` nueva por suite. Sin clúster, las suites de base de datos se omiten (las de la CI de Discovery y Precision no lo necesitan).

## Variables de conexión (nombres normativos)

`KL_DB_URL_APP` y `KL_DB_URL_READER` (backend) · `KL_DB_URL_AGENT` y `KL_DB_URL_KNOWLEDGE` (`kl-worker`) · `KL_DB_URL_OWNER`
(`kl-migrate`, `kl:bootstrap-admin`). Cada proceso se niega a arrancar si encuentra una variable que no le corresponde.
`PRECISION_KNOWLEDGE_PROVIDER` debe ser `off` y los agentes (`KL_AGENTS_ENABLED`) no se pueden encender en R1.

## Decisiones técnicas de R1 (reversibles)

- Rechazos que deben auditarse (`kl.identity_mismatch`, `kl.r10_claims.rejected`) **devuelven un estado** en lugar de lanzar,
  porque una excepción revertiría el propio evento de auditoría. Los rechazos de permiso sí lanzan `BV403` y se auditan en `admin_audit_event`.
- `kl.audit_event.actor_principal_id` es siempre un principal. En la conciliación el actor es el propio principal desactivado.
- El permiso `EXECUTE` de las funciones que usa una vista se comprueba contra quien consulta: `kl.can_read()` (vistas `v_admin_*`) y
  `kl.r10_claims_enabled()` (`v_flags`) tienen su GRANT mínimo.
- La certificación no bloquea filas compartidas (`kl.attest*` no hace `FOR UPDATE` sobre el principal): las peticiones y workers concurrentes no se serializan.
- Un job se completa con su `lease_token`, no solo con la identidad del servicio (dos workers comparten principal).
- `normalizeText` de las afirmaciones aprobadas es una aproximación documentada; debe alinearse con la de Precision antes de encender la compuerta (CR-KL-001).
