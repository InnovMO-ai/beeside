# CR-KL-003 · Recomendación a Plataforma: degradar `beeside_app` y cerrar el vector de escalada en la instancia canónica

> **Documento de recomendación — NO normativo para KL, NO enviado, NO ejecutado.** Preparado por Knowledge Layer Code a petición del PO (decisión 4 del 17-oct-2026) para que lo entregue a quien responda por la plataforma (Discovery, Precision, FA4, Control Center). KL **no** modifica la instancia canónica ni a `beeside_app`.

## 1. Hallazgo
En la instancia Cloud SQL canónica (`beeside-dev-canonical-db`, PG16) los usuarios `beeside_app` y `postgres` son miembros de `cloudsqlsuperuser` (todo usuario creado por la API lo es). En Cloud SQL, **un miembro de `cloudsqlsuperuser` administra por completo cualquier rol no superusuario de la instancia**: `GRANT <rol>`, `SET ROLE`, `ALTER ROLE … PASSWORD/NOLOGIN`, `CREATE ROLE`, `ALTER DATABASE … OWNER` y `DROP DATABASE`. Se comprobó en una instancia desechable que reproduce la semántica de Cloud SQL (evidencia: `docs/knowledge-layer/kl-1.0-code/evidence/G1-rehearsal-2026-10-16/`, resumen en `G1_G2_PLAN.md` §9).

`beeside_app` es hoy, a la vez: **usuario de runtime** del backend (secreto `beeside-dev-database-url`), **usuario de migración** (`beeside-dev-migration-database-url`, job `beeside-dev-migrate` y `fa4-staging-prepare`), **dueño** de la base `beeside` y miembro de `cloudsqlsuperuser` con `CREATEROLE`/`CREATEDB`. Consecuencia: una vulnerabilidad en el backend que permita ejecutar SQL (inyección, función insegura) daría control sobre **todos los roles y bases de la instancia**, incluida `fa4_staging`, sin necesidad de salir del proceso.

El propio backend ya lo advierte: al arrancar registra «runtime database user can create databases / can create objects in schema public / owns application tables (it is the migration user) / can write the migration registry» (verificado en las revisiones `00007` a `00010` de `beeside-dev-backend-api`). La comprobación `DB_PRIVILEGE_CHECK` **solo avisa en dev y rechazaría servir en producción**; `docs/deployment/README.md` §1 ya documenta la separación pendiente.

## 2. Recomendación
1. **Separar runtime y migración** (ya diseñado en la migración `0014` y en `docs/deployment` §1): crear por SQL un rol de login `beeside_runtime` (sin `CREATEROLE`/`CREATEDB`, miembro de `beeside_runtime_role`) con su secreto, y que el backend lo use; el job de migración conserva un usuario propio.
2. **Degradar `beeside_app`:** `REVOKE cloudsqlsuperuser FROM beeside_app; ALTER ROLE beeside_app NOCREATEROLE NOCREATEDB;`. **Ensayado** en la instancia desechable: conserva acceso a sus propias tablas y DDL como dueño; E1–E15 contra los roles de otra base pasan limpios.
3. **Resolver la dependencia de `fa4-staging-prepare`**, que usa `beeside_app` para `CREATE ROLE`: pasar esa operación privilegiada a un procedimiento acotado (usuario de API de vida corta, autorización expresa y eliminación verificada, el mismo patrón usado por KL) o a un rol administrativo separado.
4. **Higiene de la instancia:** `postgres` sin contraseña registrada; **prohibir crear usuarios por API** salvo los temporales; vigilar en Cloud Audit Logs `cloudsql.users.create/update/delete`.
5. **Aplicarlo en staging y producción antes de recibir datos reales**; hoy esos entornos son andamios sin aplicar.

## 3. Prerrequisitos y riesgos (antes de ejecutar nada)
- **Recuperación del privilegio:** la degradación se revierte con `GRANT cloudsqlsuperuser TO beeside_app` ejecutado por `postgres`, cuya contraseña **no está guardada en ningún sitio**. Antes de degradar, el Owner debe poder restablecerla (`gcloud sql users set-password postgres …`, permiso `cloudsql.users.update`) y probar que puede conectarse; de lo contrario no hay vuelta atrás operativa.
- **Impacto en otras plataformas:** cambio en un entorno vivo; coordinar con Discovery, Precision y FA4. Romperá `fa4-staging-prepare` y cualquier proceso que cree roles con `beeside_app`.
- **Orden:** primero el rol `beeside_runtime` y el cambio de secreto del backend (con rollback a la revisión anterior), después la degradación, y al final la verificación (`DB_PRIVILEGE_CHECK` sin avisos, `/health/ready`, migraciones del job).
- **Rollback:** restaurar la membresía y el secreto anterior; ventana corta.

## 4. Defectos relacionados de la plataforma, con propuesta lista
| # | Defecto | Estado / propuesta |
|---|---|---|
| 1 | Cookie de estado de inicio de sesión del Control Center emitida `SameSite=Strict`: el retorno desde un IdP externo (Google) llega sin ella y falla con `invalid_login_state` | Parche `docs/knowledge-layer/kl-1.0-code/patches/admin-login-cookie-samesite-lax.patch` (2 archivos y una prueba). Hoy solo está en la rama de KL y desplegado en dev; **llevar a `main`** antes de usar un IdP externo en staging/producción |
| 2 | Analytics del Control Center se queda en blanco al pasar de *Funnel* a *Journey health*, *Friction* u *Operational metrics* | Rama local `fix/admin-analytics-tab-switch-blank-screen` (1 commit sobre `main`, 105/105 pruebas); la descripción del PR está en el mensaje del commit. **No subida** |
| 3 | El Control Center no tiene *error boundary*: cualquier excepción de render deja la página en blanco | Sugerencia: envolver las vistas |
| 4 | `SECURITY_HASH_SECRET` del servicio de dev es una variable literal, no una referencia a Secret Manager | Pasarlo a secreto |
| 5 | La cuenta compute por defecto la comparten `beeside-dev-*` y `fa4-*`, y es la que lee los secretos de la plataforma | Cuenta de servicio propia por servicio |
| 6 | `DEPLOY_DEV_ENABLED=true`: un merge a `main` dispara `deploy-dev.yml` | Coordinar cualquier fusión (incluida la de la rama de KL) |
| 7 | Node 20 fuera de soporte desde abril de 2026 | Migrar a Node 22 LTS |

## 5. Lo que KL pide y lo que no
KL **no** requiere que Plataforma haga esto para cumplir G1 (su instancia es propia y está aislada). Se recomienda porque el mismo vector expone a las demás plataformas y porque KL comparte proyecto, red de Secret Manager y cuenta compute con ellas.
