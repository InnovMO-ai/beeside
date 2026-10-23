# CR-KL-002 · Pruebas adicionales

Estas pruebas se suman a la Matriz de implementación y pruebas congelada; no reemplazan ninguna. Las pruebas X que tienen R1 en la columna "Entrega" se corren contra una `beeside_kl` local o efímera de CI y una `beeside` efímera con el esquema de `origin/main` (`bc3f527`) para la sesión del Control Center. Las pruebas de G corren en el entorno destino.

## 1. Cambios en filas de la Matriz

| Fila | Cambio |
|---|---|
| I1 | Base `beeside_kl`, migraciones `KL-NNNN` con runner propio, `kl.principal`, `kl.request_attestation`, `kl.permission_role` y `kl.job`. Pruebas X01–X12 y X20–X22 |
| I11 / I12 / I23 | Corren en `kl-worker` con la cola `kl.job`. Pruebas X17–X19 y X25 |
| I14 | Concesiones sobre `kl.principal` y arranque B4. Pruebas X13–X16 |
| I18 | Render en `kl-worker` sin red. Prueba X19 |
| A3 | Sustituida por G1–G4 (pruebas X23–X27) |

## 2. Casos

| # | Prueba | Esperado | Entrega |
|---|---|---|---|
| X01 | Insertar en cualquier tabla de `kl` un actor que no existe en `kl.principal` | Rechazo por llave foránea | R1 |
| X02 | `DELETE` o cambio de `principal_id`, `kind` o `auth_identity` en `kl.principal`, incluso como `kl_owner` | Rechazo por trigger | R1 |
| X03 | DML directo sobre cualquier tabla de `kl` como `kl_app`, `kl_agent`, `kl_knowledge` o `kl_reader_precision` | `permission denied` | R1 |
| X04 | Llamar a una función de mutación sin `kl.attest` en la misma transacción | `BV403` | R1 |
| X05 | Certificar en la transacción A y operar en la transacción B (misma conexión y mismo principal) | `BV403`: la certificación no se reutiliza | R1 |
| X06 | Certificar un principal desactivado por conciliación | La certificación lo reactiva solo si la sesión es válida en `beeside`; con `admin_user.active = false` la sesión no se resuelve y no hay transacción en KL | R1 |
| X07 | `kl.attest` con un `auth_identity` distinto del registrado para ese `principal_id` | Rechazo y `kl.audit_event` con `kl.identity_mismatch` | R1 |
| X08 | Cada fila de la matriz de Design Spec §7: permitido y denegado por rol, incluido SUPERVISOR solo lectura | Coincide exactamente con la matriz | R1 |
| X09 | SPECIALIST_VALIDATOR fuera de su dominio | `BV403` | R1 |
| X10 | Un principal `service` intenta aprobar, validar, conceder, publicar o revocar | `BV403` | R1 |
| X11 | Triggers de doble intervención (autor = aprobador, quien sube = quien aprueba, quien registra = autor, editor = aprobador editorial) | Rechazo en la base, aun con roles acumulados | R1 |
| X12 | Concesión revocada (`revoked_at` en el pasado) usada en una operación | `BV403` | R1 |
| X13 | `kl.bootstrap_admin` cuando ya existe un KL_ADMIN no revocado | Rechazo | R1 |
| X14 | Arranque con un `admin_user` inactivo, sin `login_enabled` o con identidad `@beeside.internal` | Rechazo antes de escribir | R1 |
| X15 | Arranque exitoso | Principal, concesión, `kl.audit_event` y `admin_audit_event` (SYSTEM) con el mismo `request_id` | R1 |
| X16 | Un KL_ADMIN se concede o se revoca un rol a sí mismo | Rechazo | R1 |
| X17 | Dos ejecuciones de `kl-worker` en paralelo sobre la misma cola | Cada job lo procesa una sola ejecución (`SKIP LOCKED`) y los arrendamientos vencidos se recuperan | R1 |
| X18 | `payload` de `kl.job` con un campo fuera de la lista blanca o con texto libre del cliente | Rechazo | R1 |
| X19 | Render con red: cualquier petición que no sea local durante `page.pdf` | Abortada; el render no depende de la red | R3 |
| X20 | Runner de migraciones: archivo aplicado modificado, hueco en la numeración y número menor que el último | Falla sin aplicar nada | R1 |
| X21 | Lint de migraciones: referencia a `public.*`, a otra base o a tablas de Discovery o Precision | Falla | R1 |
| X22 | Conciliación: `admin_user` desactivado en `beeside` | `kl.principal.active = false` en el siguiente ciclo; la conciliación nunca reactiva | R1 |
| X23 | Protocolo E1–E10 (Contratos de seguridad §8.3) en el entorno destino | Todos los casos con el resultado exigido; evidencia guardada | G1 |
| X24 | Exportación de `beeside_kl` y restauración en `beeside_kl_restore` | Recuento y huellas de tablas idénticos; Precision resuelve como `unknown` las referencias que ya no existen | G2 |
| X25 | Desde `kl-worker`: dominio aprobado, dominio no aprobado, IP directa y redirección hacia un dominio no aprobado | Solo el dominio aprobado responde; los demás se bloquean en la red (no solo en la aplicación) | G3 |
| X26 | Desde el backend: conexión con las credenciales de `kl-worker` | Imposible: la cuenta del backend no puede leer esos secretos | G2 |
| X27 | Desde `kl-worker`: conexión a `beeside` | Imposible: sin credencial ni secreto | G2 |
| X28 | Caída de `beeside_kl` durante una conversación de Precision con `PRECISION_KNOWLEDGE_PROVIDER = kl` | `availability: "unavailable"`, sin afirmaciones, sin señal de demanda y sin error en el turno | R1 (lado KL) |
| X29 | Caída de `beeside` durante una petición de KL Admin | 503; no se abre la transacción de KL | R1 |
| X30 | Job diario de correlación de auditoría con un evento de KL sin par en `admin_audit_event` | Aparece en el reporte de Governance & Settings | R2 |
| X31 | Preflight: cambio en cualquier archivo de `docs/knowledge-layer/kl-1.0-addenda/CR-KL-002/` | STOP | Ya activo |

## 3. Se mantienen sin cambios

Las pruebas congeladas de minimización (DTO con nombre de empresa que no aparece en ninguna tabla de `kl`) y de frontera web (lint de `kl/retrieval` y prueba de tráfico saliente) siguen vigentes. Ahora se ejecutan contra `beeside_kl`.
