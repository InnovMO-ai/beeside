# PRECISION V2.0 — Runbook del ensayo en clon temporal de Cloud SQL

Fecha: 2026-10-17 · Proyecto `beeside-discovery-prod` · Región `northamerica-south1` · Fuente `discovery-db` (PostgreSQL 16, ENTERPRISE, REGIONAL, db-custom-1-3840, 20 GB SSD)

**Estado: PREPARADO, NO AUTORIZADO, NO EJECUTADO.** Crear el clon y cualquier paso de este documento requieren la autorización escrita de Mike. Nada aquí modifica `discovery-db`, la base `discovery`, Cloud Run, IAM, secretos ni GitHub.

Herramientas (en el repositorio, rama `integration/reconcile-discovery-precision`):

| Archivo | Para qué | Prueba |
|---|---|---|
| `infra/db/rehearsal/clone-rehearsal.sh` | ciclo de vida del clon: `plan`, `preflight`, `create`, `harden`, `mark`, `resize`, `status`, `teardown` | 15 pruebas con `gcloud` simulado |
| `infra/db/rehearsal/rehearse-on-clone.sh` | todo el lado SQL (aprovisionar, migrar, 17/17, sync, permisos, bypass de privacidad, endurecimiento, rollback, re-aprovisionar) | 97/97 contra el simulador alineado con Q13 |
| `infra/db/provision-beeside.sh`, `canonical-db-provision`, `domain-data-sync`, `domain-roles-prepare` | las mismas herramientas de producción | ya probadas (27/27 y 43/43 locales, 21 y 8 unitarias) |

## 1. Qué prueba el clon que el simulador no pudo

1. El modelo real de roles de Cloud SQL: quién administra `beeside_runtime_role` (decide si el paso POST necesita al dueño legacy), atributos reales de `postgres` y `discovery_migrate`, dueño real de `discovery` (`cloudsqlsuperuser`) y si el endurecimiento reversible funciona con ese dueño.
2. Collation y codificación reales al crear `beeside` (`CREATE DATABASE` con las mismas que `discovery`).
3. Que la restauración por clon con punto en el tiempo (PITR) funciona, y cuánto tarda (el RTO real).
4. Tiempos reales de migración (52) y de copia de datos.
5. Con la redimensión opcional: reinicio real y `max_connections` real con 7,5 GB (alimenta GN4).

Fuera del alcance del clon (se prueba en otra puerta, con otra autorización): la condición IAM de `cloudsql.client` (exige un cambio de IAM del proyecto), Cloud Run/IAP/exposición (S1–S4b), la conmutación por falla de la instancia regional, y la no regresión de la aplicación de Discovery sobre `beeside` (GN8).

## 2. Configuración del clon

| Parámetro | Valor | Razón |
|---|---|---|
| Nombre | `discovery-db-rehearsal-<TAG>` (el script exige `^discovery-db-rehearsal-[0-9a-z-]+$` y que no sea la fuente) | imposible confundirlo con producción |
| Origen | clon con punto en el tiempo = ahora − 15 min (`--point-in-time`) de `discovery-db`; mismo proyecto (los clones solo se permiten dentro del proyecto) | sirve a la vez de ensayo de restauración; no escribe nada en la fuente |
| Al crear | hereda HA REGIONAL, flags, tier, usuarios **y sus contraseñas**; recibe IP nuevas; no recibe respaldos | hechos de la documentación de Cloud SQL |
| Tras crear (`harden`) | ZONAL, sin PITR ni respaldos automáticos (PITR se apaga primero: exige respaldos), etiquetas `purpose=rehearsal`, `expires_utc`, `owner`; contraseñas nuevas aleatorias para `postgres`, `discovery_migrate`, `discovery_runtime` | la mitad del costo; sin respaldos que sobrevivan; las credenciales de producción no se usan |
| Red | sin redes autorizadas (el script se detiene si las hay); solo TLS (hereda `ENCRYPTED_ONLY`); acceso únicamente por Cloud SQL Auth Proxy local en el puerto 5435 | la fuente no tiene redes autorizadas; el clon no amplía exposición |
| Vida | por defecto 8 h, máximo duro 24 h (el script rechaza más) | costo acotado |
| Cloud Run, Secret Manager, IAM | **no se usa ninguno** | cero cambios fuera de la instancia del clon |

## 3. Costo máximo y duración máxima

Precios de lista de Iowa (México **no verificado**); regional 1 vCPU/3,75 GB + 20 GB SSD ≈ 0,144 USD/h, zonal ≈ la mitad, 2 vCPU/7,5 GB ≈ 0,28 USD/h regional.

| Escenario | Costo |
|---|---|
| Nominal (0,6 h regional al crear y endurecer + 7,4 h zonal = 8 h) | ≈ 0,62 USD (0,80 con +30 % de prima por región) |
| Peor caso dentro del plan: 8 h todas regionales + prima | ≈ 1,50 USD (1,67 con 1 h de tier de 2 vCPU) |
| **Tope autorizable propuesto** | **5 USD** (cubre 24 h regionales con prima: 4,49 USD) |
| Si se olvida (no hay borrado automático): por día | ≈ 3,46 USD regional, 1,73 USD zonal; una semana ≈ 24 USD |

Duración: preflight 2 min · clon 10–25 min (no medido) · harden 10 min · proxy y marca 5 min · ensayo SQL 20–60 min de máquina y 1–2 h de revisión · redimensión opcional 45 min · teardown 10 min. **Plan: 4–6 h. Máximo: 8 h. Hard stop: 24 h.** Control contra el olvido: `status` marca `EXPIRED`; Mike pone un recordatorio al crear (o lo agenda Claude si lo autorizas).

## 4. Protección de datos y credenciales

1. El clon contiene una copia de los datos de prueba de `discovery` (54 proyectos, correos incluidos; 17 con dominios distintos de `beeside.you`). Está en el mismo proyecto y bajo el mismo IAM que la fuente, sin redes autorizadas, solo TLS, y vive menos de un día; el log de evidencia no imprime correos (verificado: 0 apariciones).
2. Las contraseñas heredadas de producción **se reemplazan en el clon** antes de cualquier uso. Ninguna contraseña de producción se lee, escribe ni teclea en este ensayo (no se toca `postgres-root-password` ni `migration-db-url`).
3. Las contraseñas nuevas se generan con `openssl rand` y viven solo en `~/.beeside-rehearsal/<clon>/` (directorio 0700, archivos 0600). No van a Secret Manager, a chat ni a la evidencia. Al fijarlas, `gcloud ... --password` las muestra unos segundos en la lista de procesos de tu Mac; solo abren el clon.
4. Las contraseñas de los logins nuevos (`beeside_migrate`, etc.) se generan localmente por `provision-beeside.sh` con `SECRET_STORE=dir:` (no en Secret Manager) y viajan al servidor como verificadores SCRAM.
5. La evidencia (`~/Downloads/rehearsal-evidence-<fecha>/log.txt`) se escanea al final: si algún valor secreto aparece, el ensayo falla.
6. `teardown` sobrescribe (`shred -u` o `rm -P`) y borra el directorio de secretos.

## 5. Controles contra intervención accidental sobre producción

| Control | Cómo funciona |
|---|---|
| Solo impresión por defecto | sin `RUN=1` el script imprime los comandos y no ejecuta nada, ni lecturas |
| Aprobación | toda fase que escribe exige `APPROVAL=CLONE_REHEARSAL_APPROVED` además de `RUN=1`; sin ella aborta antes de llamar a `gcloud` |
| Nombre | el clon debe empezar por `discovery-db-rehearsal-`; la fuente nunca puede ser objetivo; la prueba verifica que ningún `patch`, `delete` o `set-password` nombra `discovery-db` |
| Borrado | exige `CONFIRM_DELETE=<nombre exacto>` y que la instancia tenga la etiqueta `purpose=rehearsal` |
| Proyecto | rechaza cualquier proyecto distinto de `beeside-discovery-prod` |
| Puerto | rechaza 5434 (el de los scripts de producción); el ensayo usa 5435 |
| Credenciales | solo funcionan en el clon: si el proxy apuntara por error a producción, el inicio de sesión fallaría porque la contraseña no es la de producción |
| Marca | `mark` crea el rol `rehearsal_marker_<aleatorio>`; `rehearse-on-clone.sh` aborta antes de cualquier SQL si el servidor no lo tiene |
| Un clon a la vez | `preflight` aborta si ya existe uno |
| Alcance | cero cambios de IAM, Cloud Run, secretos, red de la fuente, respaldos de la fuente o datos |

## 6. Procedimiento operativo exacto

Todo en tu Terminal. Dos ventanas: **T1** operador y **T2** proxy. Fija el identificador una sola vez en T1: `export TAG=r1` (el clon será `discovery-db-rehearsal-r1`).

**Paso 0. Requisitos (sin tocar GCP).**

```
git clone --branch integration/reconcile-discovery-precision https://github.com/InnovMO-ai/beeside.git ~/beeside-rehearsal-src
cd ~/beeside-rehearsal-src && git rev-parse HEAD        # debe coincidir con el SHA de cierre (SHA256SUMS)
npm ci && npm run build --workspace=shared/canonical-fields && npm run build --workspace=shared/fa-public-engine && npm run build --workspace=backend
which psql node cloud-sql-proxy gcloud openssl
gcloud auth list                                         # la cuenta activa debe ser la propietaria del proyecto
```

**Paso 1. Plan impreso (nada se ejecuta).**

```
bash infra/db/rehearsal/clone-rehearsal.sh plan
```

**Paso 2. Preflight de solo lectura.** Autorización requerida: lectura de `discovery-db`.

```
RUN=1 bash infra/db/rehearsal/clone-rehearsal.sh preflight
```

Debe terminar con `preflight ok` (fuente RUNNABLE, PostgreSQL 16, PITR activo, ningún clon previo, y tu versión de `gcloud` documenta todas las banderas que se usarán; si no, `gcloud components update`).

**Paso 3. Crear el clon (ensayo de restauración).** Aquí empieza el costo. Anota la hora de inicio y fin: es el RTO.

```
RUN=1 APPROVAL=CLONE_REHEARSAL_APPROVED bash infra/db/rehearsal/clone-rehearsal.sh create
```

**Paso 4. Endurecer.**

```
RUN=1 APPROVAL=CLONE_REHEARSAL_APPROVED bash infra/db/rehearsal/clone-rehearsal.sh harden
```

Se detiene si hay redes autorizadas. Termina con las tres contraseñas reemplazadas.

**Paso 5. Proxy y marca.** En T2 (déjala abierta):

```
cloud-sql-proxy beeside-discovery-prod:northamerica-south1:discovery-db-rehearsal-r1 --port 5435
```

En T1:

```
RUN=1 APPROVAL=CLONE_REHEARSAL_APPROVED bash infra/db/rehearsal/clone-rehearsal.sh mark
```

**Paso 6. Ensayo SQL completo.**

```
CLONE=discovery-db-rehearsal-r1 bash infra/db/rehearsal/rehearse-on-clone.sh
```

Secuencia: S0 puerta y fidelidad (marca, versión, datos contra la evidencia de la Parte B, miembros reales de `beeside_runtime_role`) · S1 PRE → migrar a 52 → POST → 17/17 (con negativos y GN6) · S2 copia, idempotencia, escrituras tardías, reconciliación · S3 permisos de los dos runtimes · S4 bypass de privacidad · S5 replay inverso (rollback de datos) · S6 endurecimiento legacy y su reversión · S7 rollback del aprovisionamiento (borra `beeside` y los roles nuevos, prueba que `discovery` quedó intacta) y reaprovisionar · S8 repetir PRE/POST · S9 escaneo de fugas. Termina con `SUMMARY pass=N fail=0`.

**Paso 7. Redimensión opcional (alimenta GN4).**

```
RUN=1 APPROVAL=CLONE_REHEARSAL_APPROVED bash infra/db/rehearsal/clone-rehearsal.sh resize
```

Imprime `max_connections` con db-custom-2-7680 y vuelve al tier original. Anota la duración de cada `patch`.

**Paso 8. Evaluar go/no-go (sección 7) antes de borrar.** Guarda `~/Downloads/rehearsal-evidence-*/log.txt`.

**Paso 9. Eliminación segura.**

```
RUN=1 APPROVAL=CLONE_REHEARSAL_APPROVED CONFIRM_DELETE=discovery-db-rehearsal-r1 bash infra/db/rehearsal/clone-rehearsal.sh teardown
```

Cierra el proxy de T2 (Ctrl-C). Luego:

```
RUN=1 bash infra/db/rehearsal/clone-rehearsal.sh status                 # no debe listar ningún clon
gcloud sql instances describe discovery-db --project beeside-discovery-prod --format='value(name,state)'   # discovery-db RUNNABLE
gcloud sql backups list --instance discovery-db-rehearsal-r1 --project beeside-discovery-prod   # informativo: si lista algo, avísame; no se borra nada sin tu instrucción
```

Si algo falla a mitad de camino: `status` y `teardown` son seguros en cualquier momento y no dependen del resto.

## 7. Criterios go / no-go del ensayo

| # | Criterio | Pasa si |
|---|---|---|
| R1 | Restauración por clon | el clon queda RUNNABLE en ≤ 60 min (RTO medido y registrado), sin redes autorizadas |
| R2 | Ensayo SQL | `rehearse-on-clone.sh` sale con código 0, `fail=0`; cada WARN revisado y explicado |
| R3 | Contrato | migraciones = 52 y `--check` seguro; 17/17 en `domain-roles-prepare`; GN6 (el migrador no es superusuario ni miembro de `cloudsqlsuperuser`, sin CREATEROLE ni CREATEDB, sin fila en los grupos); los logins legacy no entran a `beeside`; bypass de privacidad operativo en `beeside` y en `discovery` |
| R4 | Datos y rollback | checksums iguales en las 14 tablas; segunda corrida sin cambios; replay inverso devuelve lo escrito en `beeside`; tras el rollback del aprovisionamiento `discovery` y la membresía de `discovery_runtime` quedan idénticos y `beeside` se reaprovisiona limpio |
| R5 | Desconocidos resueltos y registrados | quién administra `beeside_runtime_role` (si POST requiere al dueño legacy), collation y codificación, dueño de `discovery`, el endurecimiento legacy funciona con ese dueño, `max_connections` y reinicio del tier de 2 vCPU (si se hizo el paso 7) |
| R6 | Seguridad | escaneo de fugas sin hallazgos; la fuente `discovery-db` sigue RUNNABLE y sin cambios |
| R7 | Cierre | clon eliminado y verificado; directorio de secretos destruido; costo ≤ 5 USD; duración ≤ 8 h |

**NO-GO inmediato (detener, `teardown`, informar):** cualquier FAIL; falta la marca; el clon tiene redes autorizadas; cualquier comando que apunte a `discovery-db` con escritura; un valor secreto en la evidencia; el RTO supera 60 min sin explicación.

**Qué desbloquea un ensayo en verde:** GN3 (parte de restauración por clon), GN5 y GN6 quedan cerrados con evidencia real; R5 fija el diseño definitivo de T4/T6. **No equivale a GO de ESTABILIZACIÓN**: siguen GN4 (decidir el resize), GN9 (auditoría y cuenta de emergencia) y GN10 (decisiones de Mike), más las autorizaciones de T2–T7.

## 8. Autorizaciones que se piden para ejecutar este ensayo (no concedidas)

1. Crear `discovery-db-rehearsal-<TAG>` por clon con punto en el tiempo de `discovery-db`, con tope de 5 USD y 8 h.
2. Modificar solo ese clon (zonal, sin respaldos, etiquetas, contraseñas nuevas, redimensión opcional) y borrarlo al terminar.
3. Leer `discovery-db` (describe, lista, tiempo de recuperación) para el preflight.
