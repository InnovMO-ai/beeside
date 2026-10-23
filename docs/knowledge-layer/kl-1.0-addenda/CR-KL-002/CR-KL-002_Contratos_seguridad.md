# CR-KL-002 · Contratos de seguridad y persistencia

Complementa a `CR-KL-002.md`. Los nombres de objetos son normativos. Code decide la implementación interna siempre que se cumplan los contratos y las pruebas de `CR-KL-002_Pruebas.md`.

## 1. Topología

| Proceso | Base y rol | Qué hace |
|---|---|---|
| Backend compartido (web) | `beeside` con `app` (sin cambios); `beeside_kl` con `kl_app` y `kl_reader_precision` | KL Admin API, certificación, conciliación, puerto `knowledge` de Precision, `openEdition`, estado público de edición |
| `kl-worker` (Cloud Run Job, misma imagen, punto de entrada propio) | `beeside_kl` con `kl_agent` y `kl_knowledge`; **sin credenciales de `beeside`** | Agentes recolector y de conocimiento, planificador, compilación de RAM, render del PDF |
| `kl-migrate` (Cloud Run Job) | `beeside_kl` con `kl_owner` | Migraciones y exportación previa |
| Worker compartido | `beeside` con `app` | Sin cambios; no recibe secretos de KL |

Diagrama: `CR-KL-002_Arquitectura.svg`.

## 2. Identidad · `kl.principal` (B1)

| Columna | Tipo y regla |
|---|---|
| `principal_id` | `uuid` PK. Para `admin_user` es exactamente su `admin_user_id`; para servicios es un UUID fijo sembrado por migración |
| `kind` | `admin_user` \| `service` |
| `auth_identity` | `text` UNIQUE. Correo en minúsculas para `admin_user`; `kl-agent@beeside.internal`, `kl-knowledge@beeside.internal` y `kl-bootstrap@beeside.internal` para servicios |
| `active` | `boolean` NOT NULL |
| `first_seen_at`, `last_attested_at`, `last_reconciled_at`, `deactivated_at` | `timestamptz` |
| `deactivation_source` | `reconciliation` \| `attestation` |

**Reglas impuestas en la base:**

- Sin `DELETE`.
- `principal_id`, `kind`, `auth_identity` y `first_seen_at` son inmutables (trigger equivalente a `admin_user_guard`).
- Ningún rol tiene `INSERT` ni `UPDATE` directo. Solo se escribe con `kl.attest`, `kl.reconcile_principal` y `kl.bootstrap_admin`, cada una `SECURITY DEFINER` de `kl_owner` con `SET search_path = kl, pg_temp`.
- Toda columna de actor de KL es `uuid` con llave foránea a `kl.principal(principal_id)`:
  - `publication.owner_user_id`
  - `source_exception.approved_by`
  - `file_object.uploaded_by`
  - `ingest_batch.uploaded_by`
  - `unit_version.authored_by` y `approved_by`
  - `card_locale_variant.reviewed_by`
  - `validator.admin_user_id` y `registered_by`
  - `specialist_validation.recorded_by`
  - `demand_decision.decided_by`
  - `edition.approved_by`
  - `change_notice.decided_by`
  - `role_grant.admin_user_id` y `granted_by`
  - autor de `setting_version`
  - `audit_event.actor_principal_id`
  - `job.requested_by`
- Los validadores externos no son principales. Su validación la registra un principal interno, como dice el diseño congelado.
- Las claves de catálogo, servicios, industrias y geografía siguen sin llave foránea (son arreglos o texto validados al publicar, AC-12). No cambia nada respecto del diseño congelado.

## 3. Autorización transaccional (B2)

- `kl.permission_role(permission, role, requires_domain)`: tabla sembrada por migración con la matriz exacta de Design Spec §7. Solo cambia con una migración nueva.
- `kl.require(p_permission text, p_domain text DEFAULT NULL) RETURNS uuid` devuelve el principal. Rechaza (`BV403`) si falta cualquiera de estas condiciones:
  1. Existe una fila en `kl.request_attestation` con `txid = txid_current()` y `attested_at = now()`, es decir, emitida en esta transacción (§4).
  2. `kl.principal.active = true`.
  3. El `kind` corresponde al permiso:
     - los permisos humanos exigen `admin_user`;
     - los de agente exigen `service`;
     - **ningún `service` puede aprobar, validar, conceder, revocar ni publicar**.
  4. Existe una concesión en `kl.role_grant` con `revoked_at IS NULL` y `granted_at <= now()` para un rol con ese permiso. Para SPECIALIST_VALIDATOR, además, `p_domain` debe estar en `domains`.
  5. Los permisos de solo lectura de SUPERVISOR se toman del `platform_role` certificado, nunca de una concesión de KL.
- Toda mutación pasa por funciones `kl.*` que llaman primero a `kl.require`. Las tablas no conceden DML a `kl_app`, `kl_agent` ni `kl_knowledge`.
- Los triggers de guarda rechazan DML sin el indicador local de transacción `kl.mutation_authorized`. Es el mismo patrón que `config_set_write_authorized` del repositorio, y aplica también al dueño.
- **Doble intervención:** sin cambios respecto de Design Spec §7, comparando `principal_id`. Por coherencia con la misma regla de no usar roles sobre lo propio, se agrega que nadie puede concederse ni revocarse un rol a sí mismo (`granted_by ≠ admin_user_id`).

## 4. Certificación, conciliación y fallo seguro (B3, B8)

### 4.1 Certificación por petición

Cada petición a `/api/admin/kl/*` sigue estos pasos:

1. `resolveAdminSession` contra `beeside`, **sin caché**. Ya revisa `active`, `login_enabled`, cambio de rol y revocación.
2. Se abre la transacción en `beeside_kl`.
3. `kl.attest(p_principal_id, p_auth_identity, p_platform_role, p_session_ref, p_request_id)`, donde `p_session_ref = sha256(session_id)`:
   - inserta en `kl.request_attestation` (`txid`, `principal_id`, `session_ref`, `platform_role`, `request_id`, `attested_at = now()`);
   - si el principal no existe, lo crea con `active = true`; si existe, exige que `auth_identity` coincida (de lo contrario rechaza y audita);
   - fija `active = true` y `last_attested_at`;
   - fija los valores locales de transacción `kl.actor` y `kl.request_id`.
4. Se ejecutan las operaciones y se confirma.

`kl.request_attestation` es de solo inserción y se conserva para auditoría.

### 4.2 Conciliación (defensa adicional; no autoriza)

- Corre en el backend: intervalo de 5 minutos con bloqueo consultivo para que lo ejecute una sola instancia.
- Lee `admin_user (admin_user_id, auth_identity, active, login_enabled)` con la conexión principal que el backend ya tiene.
- Llama a `kl.reconcile_principal(id, active_and_login_enabled)` con `kl_app`. Solo puede **desactivar**; la reactivación solo ocurre por una certificación válida.
- No requiere cambios en Discovery, en Precision ni en `admin-users.ts`.

### 4.3 Fallo seguro

| Situación | Resultado |
|---|---|
| `beeside` no responde o la sesión no se resuelve | 401/503. No se abre la transacción de KL y se audita el rechazo si se puede |
| `beeside_kl` no responde | 503 en KL Admin. Precision recibe `availability: "unavailable"`, sin afirmaciones y sin señal de demanda |
| Certificación de otra transacción, petición o momento | `kl.require` rechaza |
| Principal inactivo, concesión revocada o dominio que no corresponde | Rechazo (`BV403`) |
| Identidad que no coincide con el principal existente | Rechazo y auditoría `kl.identity_mismatch` |
| Transacción abierta demasiado tiempo | `idle_in_transaction_session_timeout` y `statement_timeout` para `kl_app` (30 s). La certificación muere con la transacción |
| Falla al escribir `admin_audit_event` después de confirmar en KL | Registro de error con `request_id`. El job diario de correlación lo reporta (§6) |

## 5. Arranque de KL_ADMIN (B4)

- Comando `kl:bootstrap-admin --email <correo>`, ejecutado una sola vez por Plataforma como un job dedicado `kl-bootstrap`. Recibe solo dos credenciales: la de lectura de `beeside` que ya usa la plataforma y `kl_owner`. Después de ejecutarse, se retira su acceso a ambos secretos. `kl-migrate` nunca recibe credenciales de `beeside`.
- **Verificaciones previas:**
  - el `admin_user` existe, `active = true` y `login_enabled = true`;
  - no es una identidad técnica (`@beeside.internal`).
- **`kl.bootstrap_admin`** (solo `kl_owner`):
  - se niega si ya existe una concesión KL_ADMIN no revocada;
  - crea el principal, la concesión KL_ADMIN (`granted_by` = principal de servicio `kl-bootstrap`) y `kl.audit_event` (`kl.bootstrap_admin`).
- El comando escribe además `admin_audit_event` (`actor_type = SYSTEM`, acción `kl.bootstrap_admin`) con la función existente `recordAudit`, sin cambiar su código.
- Las concesiones posteriores se hacen solo desde KL Admin por un KL_ADMIN (I14).

## 6. Auditoría correlacionada (B5)

- En `kl.audit_event` se agregan `actor_principal_id` (llave foránea), `request_id` y `session_ref`. El evento se escribe en la misma transacción que el cambio; es de solo inserción y nadie puede borrarlo.
- El acceso (ALLOWED, DENIED o FAILED) se sigue registrando en `admin_audit_event` con el router existente. Acción con formato `kl.<recurso>.<verbo>` y `request_id` en `details`.
- **Orden:** primero se confirma en KL; después `recordAudit` registra ALLOWED. Si falla KL, se registra FAILED o DENIED. Los rechazos de permiso se registran solo en la base principal, sin transacción de KL.
- **Job diario de correlación** (en el backend): lista los `request_id` de `kl.audit_event` sin su par en `admin_audit_event`, y al revés para acciones `kl.*` con ALLOWED. El resultado aparece en Governance & Settings.

## 7. Jobs y cola de KL (B6)

- `kl.job`:
  - columnas: `job_id`, `kind`, `payload jsonb` (lista blanca por tipo; nunca datos de clientes), `status`, `run_after`, `lease_until`, `attempts`, `requested_by` (principal), `agent_run_id`;
  - se toma con `FOR UPDATE SKIP LOCKED`.
- Las acciones manuales «Revisar ahora» y «Edición extraordinaria» encolan un `kl.job` con `kl_app`, previa certificación.
- **`kl-worker`:** Cloud Run Job ejecutado por Cloud Scheduler cada 5 minutos, que procesa la cola y termina. Una acción manual queda en espera como máximo un ciclo.
- **Cuentas de servicio y secretos:**
  - cuenta propia `kl-worker@…`, con acceso solo a los secretos de `kl_agent` y `kl_knowledge`, y al bucket de KL;
  - la cuenta del backend solo puede leer los secretos de `kl_app` y `kl_reader_precision`, y los PDF publicados del bucket (para `openEdition`).
- **Render:** dentro de `kl-worker`, con Chromium y todas las peticiones de red bloqueadas, excepto los recursos locales empaquetados.

## 8. Roles, permisos y aislamiento (B7)

### 8.1 Matriz

Todos los roles son usuarios de Cloud SQL con su secreto propio en Secret Manager.

| Rol | Usado por | Permisos en `beeside_kl` |
|---|---|---|
| `kl_owner` | `kl-migrate` | Dueño de la base, del esquema `kl` y de todos los objetos. Solo migraciones, `kl.bootstrap_admin` y exportación |
| `kl_app` | Backend | `CONNECT`; `EXECUTE` en las funciones de administración, `kl.attest` y `kl.reconcile_principal`; `SELECT` en las vistas de lectura de administración |
| `kl_reader_precision` | Backend | `CONNECT`; `SELECT` en `kl.v_consumable_*`, `kl.v_package_status` y `kl.v_edition_current`; `EXECUTE` en `kl.record_signal`, `kl.record_usage`, `kl.record_distribution` y `kl.edition_public_status` |
| `kl_agent` | `kl-worker` | `CONNECT`; `EXECUTE` en las funciones del agente recolector y de la cola |
| `kl_knowledge` | `kl-worker` | `CONNECT`; `EXECUTE` en las funciones de compilación, promoción, demanda y cola; `SELECT` en publicado |

### 8.2 Controles obligatorios (migración KL-0001)

- `REVOKE ALL ON DATABASE beeside_kl FROM PUBLIC`, y `GRANT CONNECT` solo a los cinco roles.
- `REVOKE ALL ON SCHEMA public FROM PUBLIC` dentro de `beeside_kl`; ningún objeto de KL se crea en `public`.
- `ALTER DEFAULT PRIVILEGES` de `kl_owner`: nada para PUBLIC.
- Límite de conexiones (`CONNECTION LIMIT`) y `statement_timeout` por rol: `kl_reader_precision` 1 s; `kl_app` 30 s.
- Ninguna tabla se concede directamente. El acceso es solo por vistas y funciones.

### 8.3 Protocolo de verificación contra la escalada de privilegios (condición G1)

Se ejecuta en cada entorno destino como `app` y como cada usuario de la instancia que no sea de KL. Se guarda la salida como evidencia. **Todos los casos deben fallar** salvo E7–E9, que deben devolver la condición indicada.

| Caso | Intento como principal ajeno a KL | Resultado exigido |
|---|---|---|
| E1 | Conectarse a `beeside_kl` | `permission denied for database` |
| E2 | `GRANT kl_owner TO app` (y cada `kl_*`) | Error |
| E3 | `SET ROLE kl_owner` (y cada `kl_*`) | Error |
| E4 | `ALTER ROLE kl_app PASSWORD …` / `… LOGIN` / `DROP ROLE kl_app` (cada `kl_*`) | Error |
| E5 | `CREATE ROLE x IN ROLE kl_owner` / `… ADMIN kl_owner` | Error |
| E6 | `ALTER DATABASE beeside_kl OWNER TO app` | Error |
| E7 | `pg_has_role(<principal>, 'kl_*', 'MEMBER')`, recursivo | `false` para todos |
| E8 | `pg_auth_members` con `admin_option` sobre los roles `kl_*` para `cloudsqlsuperuser` o `app` | Ninguna fila |
| E9 | Dueños de la base y de todos los objetos en `beeside_kl` | Solo `kl_owner` |
| E10 | Inverso: cada `kl_*` intenta leer cualquier tabla de `beeside` | Error de permiso. Plataforma decide además revocar CONNECT de PUBLIC en `beeside` |

Si E2, E4, E5 u E8 no fallan, por ejemplo porque `cloudsqlsuperuser` tiene ADMIN sobre los roles creados por la API, **G1 no se cumple** y KL no se habilita en ese entorno. Plataforma decide la corrección, por ejemplo usuarios de KL con autenticación IAM de base de datos, o `app` recreado como rol sin CREATEROLE. KL no lo resuelve ni lo debilita por su cuenta.

## 9. Migraciones (B10)

- **Ubicación:** `backend/src/kl/db/migrations/`. El preflight bloquea `backend/db/migrations/`.
- **Nombres:** `KL-NNNN_<tema>.sql` y `KL-NNNN_<tema>_integrity.sql`. La numeración es propia y no depende de P5.
- **Runner propio de KL:**
  - registra en `kl.__kl_migrations` el número, el nombre, el SHA-256 y la fecha;
  - falla si hay un hueco, si un archivo ya aplicado cambió o si aparece un número menor que el último aplicado;
  - **nunca omite una migración por su fecha**. Esto evita el comportamiento observado en el migrador de Drizzle.
- **Lint:** solo objetos del esquema `kl`. Sin referencias a otras bases, a `public`, ni a tablas de Discovery o Precision.
- **Aplicación:** solo `kl-migrate` con `kl_owner`, después de una exportación previa. La reversión se hace con una migración correctiva o con la restauración de esa exportación.
- El concepto de archivos provisionales `KLP-*` queda retirado: ya no hace falta renumerar.
- **El choque 0017–0023 entre Discovery y Precision en `backend/db/migrations` sigue abierto** y es responsabilidad de esas plataformas.

## 10. Conexiones y respaldos (B7)

- **Conexiones:** pools pequeños en dev (`db-g1-small`): backend 3 + 3, `kl-worker` 2 + 2, `kl-migrate` 1. En G2 se comprueba `SHOW max_connections` y que la suma con las plataformas existentes deje margen.
- **Respaldos:**
  - los automáticos y la recuperación a un punto en el tiempo de la instancia cubren también `beeside_kl` (son compartidos);
  - **respaldo propio:** exportación diaria de `beeside_kl` a un bucket privado con retención, más una exportación antes de cada migración. KL no guarda datos de clientes (D19), así que las exportaciones tampoco los contienen.
- **Restauración:** importar en `beeside_kl_restore`, verificar y cambiar la conexión. Las referencias que guarda Precision son por valor; las que ya no existan se resuelven como `unknown`. Se prueba una vez en G2.

## 11. Control de salida a red (B9, condición G3)

- **Red:** `kl-worker` usa egreso Direct VPC con `all-traffic` hacia la VPC del entorno, más Cloud NAT para Internet.
- **Política de firewall de red** (Cloud NGFW Standard), aplicada a la etiqueta de `kl-worker`:
  - permitir los FQDN de las publicaciones aprobadas (`kl.v_egress_allowlist`, derivada de `kl.publication.official_url` con fuente aprobada);
  - permitir el FQDN del proveedor del modelo;
  - permitir las API de Google necesarias (conector de Cloud SQL, Secret Manager, Storage) por acceso privado a Google;
  - **denegar todo lo demás**.
- **Sincronización de la lista:**
  - la aprobación de una publicación por KL_ADMIN **no** abre la red automáticamente;
  - la vista se exporta a una variable de Terraform que revisa y aplica Plataforma;
  - si una publicación está aprobada pero su dominio no está en el firewall, el agente falla de forma segura con `egress_blocked`.
- **Defensas en la aplicación (se mantienen):**
  - el agente rechaza dominios no aprobados;
  - no sigue redirecciones hacia dominios fuera de la lista;
  - `kl/retrieval` no tiene cliente HTTP (lint).
- **Verificación en G3 antes de confiar en la regla:** que la política de firewall se aplique al tráfico Direct VPC de Cloud Run Jobs con la etiqueta usada (prueba X25).
- **Backend compartido:** sin cambios por parte de KL (ver `CR-KL-002.md` §5).

## 12. Riesgos residuales

| Riesgo | Mitigación | Estado |
|---|---|---|
| Roles de PostgreSQL globales a la instancia; posible escalada desde `cloudsqlsuperuser` | Protocolo §8.3 (G1) | Abierto hasta G1 |
| IAM `cloudsql.client`, recuperación a un punto en el tiempo, mantenimiento y caídas compartidos por instancia | Exportación propia; instancia separada diferida | Aceptado en MVP1 |
| El backend tiene en el mismo proceso las credenciales de `beeside` y de `beeside_kl` | Funciones con certificación, sin DML directo, auditoría | Aceptado hasta separar el servicio |
| Desactivación a nivel de base con retraso de hasta un ciclo de conciliación | Autorización por certificación de la transacción en curso; la sesión se revoca de inmediato en el Control Center | Mitigado |
| Las dos auditorías no son atómicas | `request_id` común y job diario de correlación | Mitigado |
| Salida a red del backend compartido sin restringir | Lint, modelo sin herramientas web, prueba de tráfico saliente; decisión de Plataforma | Registrado para Plataforma |
| Lista de salida desfasada respecto de las publicaciones aprobadas | Falla de forma segura (`egress_blocked`) | Mitigado |
