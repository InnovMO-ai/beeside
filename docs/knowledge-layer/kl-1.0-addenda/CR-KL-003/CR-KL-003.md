# CR-KL-003 · Instancia Cloud SQL dedicada para `beeside_kl` y desviaciones de implementación verificadas

> **BORRADOR v0.1 — NO APROBADO.** Propuesto a partir de la evidencia real de G1–G2 en dev (16 y 17-oct-2026). No tiene vigencia normativa hasta la aprobación expresa del PO. **No modifica CR-KL-002**, que sigue íntegro y vigente salvo en lo que este documento, una vez aprobado, sustituya de forma explícita (§5).

| Campo | Valor |
|---|---|
| Identificador | CR-KL-003 · versión 0.1 (borrador) |
| Tipo | Cambio arquitectónico y de infraestructura (precisa y corrige CR-KL-002) |
| Estado | **Borrador, pendiente de aprobación del PO** |
| Plataforma | Knowledge Layer 1.0 · MVP1 |
| Base de referencia (sin modificar) | CR-KL-002 v1.0, manifiesto `08520b6a42721521c77b72b0920d1be1006f5a00a08c33cd21e3ac37049dbc6b` · diseño congelado `kl-design-1.0-frozen` (`69f211a`), manifiesto `8901ecfa25db28acde1445399774ab614f9e046fbefb935a86214d17ad5f4afe` |
| Decisión del PO que lo origina | Opción A «instancia dedicada `beeside-dev-kl-db`», 16-oct-2026, tras el ensayo D2 de G1 |
| Evidencia | `docs/knowledge-layer/kl-1.0-code/` — `G1_G2_PLAN.md` §9–§10 y §12, `G2_FASE5_PROCEDIMIENTO.md`, `G2_FASE7_WORKER_Y_PRUEBAS.md`, `G2_D9_CLOUD_SCHEDULER.md`, `G1_G2_ESTADO_GENERAL.md`, y `evidence/G1-*`, `evidence/X24-*` |
| Código y rama | `feat/kl-1.0-code`, commit de referencia `e0e3931` |

## 1. Decisión propuesta

Knowledge Layer usa una **instancia Cloud SQL PostgreSQL 16 dedicada por entorno** (`beeside-<entorno>-kl-db`) en lugar de una base dentro de la instancia canónica de la plataforma. Todo lo demás de CR-KL-002 se conserva: la base se sigue llamando `beeside_kl`, el esquema `kl`, los cinco roles `kl_*`, sus secretos, el journal y las migraciones `KL-NNNN` propios, la certificación transaccional, la auditoría correlacionada, `kl-worker` y las condiciones G1–G4.

## 2. Por qué: evidencia que CR-KL-002 daba por abierta

CR-KL-002 §12 dejó como riesgo **abierto** «posible escalada desde `cloudsqlsuperuser`» y Contratos de seguridad §8.3 hizo de su resultado la condición G1: si E2, E4, E5 u E8 no fallaban, KL no se habilitaba en ese entorno. Se ejecutó el protocolo en una instancia desechable que reproduce la semántica de Cloud SQL (`gcloud`, PG16) con los mismos principales que la instancia canónica:

| Principal ajeno a KL | Resultado de E1–E15 |
|---|---|
| `beeside_app` (creado por la API, miembro de `cloudsqlsuperuser`; es el usuario de **runtime y de migración** de la plataforma) | **Escala por completo:** `GRANT kl_owner`, `SET ROLE`, `ALTER ROLE … PASSWORD/NOLOGIN`, `CREATE ROLE … IN ROLE/ADMIN`, `ALTER DATABASE … OWNER` y `DROP DATABASE` tienen éxito; E7 = todo `true`; E8 = 5 filas |
| `postgres` (miembro de `cloudsqlsuperuser`) | `GRANT kl_owner` y `ALTER ROLE` con éxito; termina sesiones de `kl_*` |
| Rol simple creado por SQL (sin `cloudsqlsuperuser`) | **Todo falla** como exige §8.3 |
| `beeside_app` degradado (`REVOKE cloudsqlsuperuser`, sin CREATEROLE/CREATEDB) | Todo falla |
| Roles creados **por la API** (usuarios de Cloud SQL) o **usuarios IAM de base de datos** | **También los controla** cualquier miembro de `cloudsqlsuperuser` (probado con ambos) |

Conclusiones: (a) en Cloud SQL **todo miembro de `cloudsqlsuperuser` administra todo rol no superusuario de la instancia**, sin necesidad de `ADMIN OPTION` explícito; (b) crear los roles por SQL **no basta** y la autenticación IAM de base de datos —la corrección que §8.3 sugería— **tampoco**; (c) en la instancia canónica de dev, `beeside_app` y `postgres` son miembros, y el servicio de la plataforma corre con `beeside_app`. La condición G1 **no podía cumplirse en la instancia compartida** sin modificar a otras plataformas.

**Alternativas evaluadas.** **A (adoptada):** instancia dedicada; los únicos `cloudsqlsuperuser` son los del propio KL. **B:** degradar `beeside_app` en la instancia compartida (ensayada y viable, pero modifica un entorno vivo de Discovery/Precision/FA4, rompe `fa4-staging-prepare`, y cualquier usuario creado luego por API reabre el riesgo). **C:** no hacer nada (incompatible con G1).

## 3. Lo que se mantiene sin cambios
CR-KL-002 §2 completo; reglas B1–B6, B8–B10; el contrato `kl.v1`; la base `beeside_kl` y su esquema; el modelo de roles de negocio; el preflight y la regla de que KL no toca `backend/db/migrations/`.

## 4. Reglas normativas propuestas

| # | Regla |
|---|---|
| **C1** | **Instancia dedicada por entorno.** `beeside-<entorno>-kl-db`, PostgreSQL 16, acceso solo por conector/Auth Proxy con certificado de cliente (`TRUSTED_CLIENT_CERTIFICATE_REQUIRED`), respaldos automáticos y recuperación a un punto en el tiempo propios, protección contra borrado activa en Terraform (`deletion_protection`). La instancia solo aloja `beeside_kl` (y bases de restauración efímeras). |
| **C2** | **Aislamiento de `cloudsqlsuperuser` (control continuo de G1).** En esa instancia los únicos miembros de `cloudsqlsuperuser` son `postgres` (**sin contraseña**: no puede iniciar sesión) y los roles internos de Cloud SQL. **Está prohibido crear usuarios por API o IAM de base de datos** salvo los temporales de C4. Se verifica con `SELECT member::regrole FROM pg_auth_members WHERE roleid='cloudsqlsuperuser'::regrole` después de cada operación privilegiada y se vigila en Cloud Audit Logs `cloudsql.users.create/update/delete`. Quien tenga `cloudsql.users.update` en el proyecto puede restablecer la contraseña de `postgres` o crear usuarios: es un riesgo de plano IAM ya aceptado en CR-KL-002 §12 y se mantiene acotado al propietario del proyecto. |
| **C3** | **Roles por SQL, no por la API.** Los cinco roles `kl_*` se crean por SQL (`backend/src/kl/db/bootstrap/roles.sql`) como `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`, con un **aprovisionador de un solo uso** que se elimina al terminar; Terraform gestiona sus contraseñas y sus secretos (una conexión `/cloudsql` por rol) pero **no** declara `google_sql_user` para ellos (la API los haría `cloudsqlsuperuser`). La base `beeside_kl` se crea con dueño `kl_owner` (concesión temporal de `kl_owner` al aprovisionador, retirada de inmediato). Topes de conexión de referencia: `kl_owner 4`, `kl_app 12`, `kl_reader_precision 12`, `kl_agent 4`, `kl_knowledge 4` (suma 36 de las 47 conexiones utilizables con `max_connections = 50` del nivel `db-g1-small`). |
| **C4** | **Operaciones privilegiadas acotadas.** Cualquier cambio que exija `CREATEROLE`/`cloudsqlsuperuser` (ajustar límites, crear una base de restauración, aprovisionamiento inicial) se hace con un **usuario de API de vida corta**, con autorización expresa del PO, en una ventana de segundos, con eliminación **verificada** del usuario y de cualquier membresía, y con registro en la evidencia. |
| **C5** | **G1 se verifica por entorno y se repite.** El protocolo E1–E15 (E11–E15 son ampliaciones de CR-KL-003: `DROP DATABASE`, terminar sesiones, `GRANT CONNECT`, privilegios de los `kl_*` y lectura de `pg_authid`) se ejecuta con un **rol simple** ajeno a KL antes de la primera migración y se **repite tras toda migración que cambie privilegios**, con la salida archivada. Script: `scripts/kl/g1/run-e.sh`. |
| **C6** | **Exportación programada y restauración probada (G2).** Exportación SQL diaria de `beeside_kl` a un bucket privado versionado (`gs://<proyecto>-beeside-<entorno>-kl-exports/daily/`) por Cloud Scheduler con una cuenta de servicio de **un solo permiso** (`cloudsql.instances.export`, condicionado a la instancia de KL) y exportación previa a cada migración. La restauración (X24) se prueba importando como `kl_owner` en `beeside_kl_restore` y **comparando** recuento y huella por tabla, columnas, funciones, vistas, ACL, triggers, índices, restricciones (por tabla) y diario; un error en cualquier consulta de comparación invalida la prueba. Se admite únicamente la normalización de paréntesis de expresiones `AND` en restricciones `CHECK`, documentada. Script: `scripts/kl/g2/x24-restore.sh`. |
| **C7** | **Ubicación de Cloud Scheduler.** Los schedules de KL pueden vivir en una región distinta de la del destino cuando la del entorno no está soportada (los destinos son APIs HTTPS). En dev (`northamerica-south1`, Querétaro, no soportada por Cloud Scheduler) se usa **`us-south1`**. Solo residen allí metadatos del schedule (nombre, cron, URL de la API); ningún dato de KL. Se revisa si Google añade la región. |
| **C8** | **Almacén de objetos del worker fuera de producción.** Con `NODE_ENV ≠ production` el worker usa el almacén local de desarrollo (`KL_STORAGE_DIR=/tmp/kl-storage`, efímero): sirve para verificar el arranque y la tubería, **no** para publicar ediciones. Con `NODE_ENV = production` el worker se niega a renderizar (`KlConfigError`) hasta que exista el adaptador de almacenamiento de Cloud Storage con retención (B9/D8). **Ninguna edición se publica en un entorno sin ese adaptador.** |
| **C9** | **Conexión del worker en frío.** Los pools de `kl-worker` esperan hasta 10 s la primera conexión por el socket de Cloud SQL (el backend interactivo mantiene 2 s). El job conserva `max_retries = 1`, pero un intento fallido por conexión debe tratarse como defecto observable (`retriedCount`). |

## 5. Secciones de CR-KL-002 que se sustituyen (una vez aprobado)
| Documento | Sección | Texto vigente según CR-KL-003 |
|---|---|---|
| `CR-KL-002.md` | §1 Decisión | «…una base PostgreSQL propia, `beeside_kl`, **en una instancia Cloud SQL dedicada de cada entorno** (C1)…» |
| `CR-KL-002.md` | §3 · B7 | «Base `beeside_kl` **en la instancia dedicada de KL**, cinco roles con secretos propios, job de migración, journal y exportación programada.» |
| `CR-KL-002.md` | §5 · G1 y G2 | G1 se cumple **por construcción de la instancia dedicada** y se verifica con C2/C5. G2: instancia, secretos, cuentas, buckets, jobs y schedules por Terraform; **roles y base por SQL de un solo uso (C3)**; exportación programada y restauración probada (C6). |
| `CR-KL-002.md` | §6 «Instancia separada … Diferida» y «Base de datos: sin servidor nuevo» | **Adoptada.** Costo incremental: una instancia `db-g1-small` en dev (orden de 28 USD/mes según un agregador público para `northamerica-south1`; **sin verificar** contra la calculadora oficial) más almacenamiento y respaldos; para staging/producción se dimensionará aparte (nivel dedicado y alta disponibilidad). |
| `CR-KL-002.md` | §6 «Credenciales IAM de base de datos … se recomienda evaluarlo en G2» | **Evaluado y descartado como remedio** (C2): los usuarios IAM también los controla `cloudsqlsuperuser`. |
| `CR-KL-002_Contratos_seguridad.md` | §8.1 «Todos los roles son usuarios de Cloud SQL» | «Los roles son roles de PostgreSQL **creados por SQL** (C3), con un secreto propio por rol en Secret Manager.» |
| `CR-KL-002_Contratos_seguridad.md` | §8.3 (párrafo final) | El riesgo se resuelve con la **instancia dedicada (C1/C2)**; no se elige «usuarios IAM» ni «recrear `app`». |
| `CR-KL-002_Contratos_seguridad.md` | §10 Conexiones y Respaldos | Medido `max_connections = 50`; topes de C3. Respaldos automáticos y PITR **propios de la instancia dedicada** (ya no compartidos con `beeside`/`fa4_staging`); exportación y restauración según C6 (importación como `kl_owner`). |
| `CR-KL-002_Contratos_seguridad.md` | §12 Riesgos residuales | «Roles globales a la instancia / escalada desde `cloudsqlsuperuser`»: **cerrado por C1–C2** (control continuo). «IAM `cloudsql.client`, PITR, mantenimiento y caídas compartidos por instancia»: PITR, mantenimiento y capacidad **ya no se comparten**; `roles/cloudsql.client` sigue siendo de **nivel de proyecto** (único alcance posible) y por tanto compartido. |
| `CR-KL-002_Pruebas.md` | X23, X24, X26, X27 | X23 según C5; X24 según C6; X26: por política (sin prueba empírica; pendiente); X27: probada desde la identidad del worker. |

## 6. Desviaciones de implementación registradas (informativas)
| # | Desviación | Estado |
|---|---|---|
| 1 | Roles y base creados por SQL y no por Terraform | Normativa (C3) |
| 2 | Cloud Scheduler en `us-south1` | Normativa (C7) |
| 3 | Almacén local en dev; sin adaptador GCS | Normativa (C8); **abierta** hasta D8 |
| 4 | El backend compartido de dev despliega una imagen de la rama KL (`main` + KL + 8 archivos compartidos aprobados) y mantiene habilitado el Admin API con Google como IdP de dev | Operativa; decisión de Plataforma, **no** forma parte de este CR |
| 5 | Importación con `gcloud sql import sql --user=kl_owner` | Verificada en X24; sin conceder nada a `cloudsqlimportexport` |

## 7. Condiciones G1–G4 según este addendum
| # | Estado en dev al 17-oct-2026 | Pendiente |
|---|---|---|
| G1 | **Cumplida** para KL-0001…0005: E1–E15 limpios antes y después de migrar | Repetir tras cada migración que cambie privilegios; control continuo C2; replicar en staging/producción |
| G2 | **Cumplida con las desviaciones 1–3**: X24 idéntica salvo una restricción equivalente por paréntesis | Verificar la primera exportación programada (18-oct 08:30 UTC) |
| G3 | **No iniciada** (sin agentes ni tráfico externo) | Antes de encender cualquier agente con red |
| G4 | **Parcial:** primer KL_ADMIN (`mo@beeside.you`) ejecutado y verificado de extremo a extremo | Titulares y autenticación de los demás roles (p. ej. segundo administrador) |

## 8. Riesgos residuales y puntos abiertos
- **Plano IAM compartido** (C2): propietario del proyecto, `roles/cloudsql.client` y Secret Manager por secreto; la cuenta compute por defecto es **compartida con servicios de otras plataformas** (decisión D3 abierta: cuenta propia del backend).
- **Procesos de fondo de KL en el backend compartido** (reconciliador cada 5 min, correlación diaria — X30) no son fiables con escala a cero y CPU estrangulada; requieren instancia mínima con CPU asignada o un job.
- **Sin alertas** de Monitoring sobre fallos del worker o de la exportación.
- **X26** sin prueba empírica; **AC-13** (accesibilidad del PDF) sin revisión manual; **Node 20** fuera de soporte; contenido factual de Doing Business México **sin validar**.
- La instancia canónica sigue con `beeside_app` como `cloudsqlsuperuser` y runtime/migrador a la vez: **recomendación a Plataforma, independiente de KL**, de degradarlo a un rol simple (se ensayó).

## 9. Evaluación
- **Seguridad:** G1 deja de depender de la disciplina sobre usuarios de otras plataformas; el aislamiento es estructural. A cambio, aparece la regla C2 (nadie crea usuarios por API en esa instancia) que debe vigilarse.
- **Costo/mantenimiento:** una instancia más por entorno, con su respaldo y su ventana de mantenimiento; Terraform propio (`envs/dev-kl`, estado propio) que no toca `envs/dev`.
- **Reversibilidad:** la instancia puede retirarse con `terraform destroy` (tras desactivar la protección) sin afectar a otras plataformas; la exportación diaria y la restauración probada acotan el riesgo de datos.

## 10. Trazabilidad y aprobación
| Elemento | Referencia |
|---|---|
| Este documento | `docs/knowledge-layer/kl-1.0-addenda/CR-KL-003/CR-KL-003.md` en la rama `feat/kl-1.0-code` (borrador) |
| Integridad | **Pendiente:** al aprobarse se generará `MANIFEST.sha256` de la carpeta y se decidirá si se fija su huella en `scripts/kl/preflight.sh` y `scripts/kl/kl.fingerprint` (archivos de guarda: requieren su propia aprobación y huella declarada). **No se ha tocado ningún archivo de guarda ni CR-KL-002.** |
| Modificaciones | Cualquier cambio posterior exige CR-KL-003 v1.1 o un CR nuevo aprobado por el PO |
| **Aprobación del PO** | **Pendiente** — fecha: ____ · decisión: ____ |

### Preguntas abiertas para el PO al revisar este borrador
1. ¿Se aprueba C1–C9 tal como están o se separan C7–C9 (operativas) en un anexo de implementación?
2. ¿La regla C4 (usuarios de API de vida corta) requiere autorización por operación o una autorización marco por entorno?
3. ¿Qué nivel y alta disponibilidad se exigen para la instancia dedicada de staging y producción?
4. ¿Se traslada a Plataforma, como recomendación formal, la degradación de `beeside_app` en la instancia canónica?
5. ¿Se fija este CR en el preflight (huella en `kl.fingerprint`) al aprobarlo?
