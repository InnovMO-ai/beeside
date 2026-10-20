# CR-KL-002 · Base de datos independiente `beeside_kl` (opción B)

| Campo | Valor |
|---|---|
| Identificador | CR-KL-002 · versión 1.0 |
| Tipo | Cambio arquitectónico |
| Estado | **Aprobado por el PO** (16-oct-2026, Ciudad de México) |
| Plataforma | Knowledge Layer 1.0 · MVP1 |
| Base de referencia (sin modificar) | Etiqueta `kl-design-1.0-frozen` · objeto `02198ebd426a1935cad9c8176edc65586bfb7e20` → commit `69f211a11f9c95ea5f5288c61b4d263d354910fa` · manifiesto `8901ecfa25db28acde1445399774ab614f9e046fbefb935a86214d17ad5f4afe` |
| Documentos de este cambio | `CR-KL-002.md` (este) · `CR-KL-002_Contratos_seguridad.md` · `CR-KL-002_Pruebas.md` · `CR-KL-002_Code_Handoff.md` · `CR-KL-002_Arquitectura.svg` · `MANIFEST.sha256` |

## 1. Decisión

Knowledge Layer tiene una base PostgreSQL propia, `beeside_kl`, dentro de la instancia Cloud SQL existente de cada entorno. Tiene credenciales, permisos, migraciones, journal y exportaciones propios. Dentro de `beeside_kl` se conserva el esquema `kl`, así que todos los nombres de objetos de los contratos (`kl.unit`, `kl.v_consumable`, `kl.record_signal`, …) siguen siendo válidos.

Este cambio sustituye **solo** lo que establecía una base compartida con esquema `kl`, en T1 y en los contratos congelados (§4).

## 2. Lo que se mantiene sin cambios

- El backend compartido durante MVP1: mismo repositorio, misma imagen y módulo `backend/src/kl/` (DD-01).
- El contrato `kl.v1`, sus DTO, el puerto `knowledge`, la bandera `PRECISION_KNOWLEDGE_PROVIDER` (por defecto `off`) y CR-KL-001.
- Flujos funcionales, máquinas de estado, roles de negocio (KL_ADMIN, KL_EDITOR, KL_REVIEWER, SPECIALIST_VALIDATOR), reglas de negocio D1–D26 y T2–T19, y el diseño visual aprobado.
- La separación de KL respecto de los datos privados de Precision y Discovery (D18, D19, DD-14).
- La prohibición de búsquedas web abiertas desde las conversaciones de Precision.
- El acceso de Precision al conocimiento solo mediante interfaces controladas (vistas publicadas y funciones), sin privilegios generales sobre la persistencia interna de KL.

## 3. Reglas normativas

Cada regla tiene su contrato detallado en `CR-KL-002_Contratos_seguridad.md` y sus pruebas en `CR-KL-002_Pruebas.md`.

| # | Regla | Contrato |
|---|---|---|
| B1 | **Identidad.** `kl.principal` replica en `beeside_kl` la identidad mínima de cada `admin_user` y de cada cuenta de servicio de KL. Todas las columnas de actor de KL tienen llave foránea a `kl.principal`. La identidad es inmutable y nunca se borra. | §2 |
| B2 | **Autorización transaccional por rol y dominio.** Toda operación sensible pasa por funciones de `kl` que exigen un principal activo, una certificación de la transacción en curso y una concesión vigente en `kl.role_grant` para el rol y el dominio requeridos. Los triggers de doble intervención del diseño congelado se mantienen tal cual. | §3 |
| B3 | **Certificación y conciliación.** La certificación se emite solo dentro de la misma transacción y la misma petición, después de resolver la sesión del Control Center en la base principal. La conciliación periódica marca como inactivos a los principales desactivados en el Control Center. Es una defensa adicional; **nunca autoriza nada**. | §4 |
| B4 | **Arranque auditado de KL_ADMIN.** La primera concesión de KL_ADMIN no se hace por migración. La hace un comando de arranque de un solo uso que verifica al titular en la base principal, se niega si ya existe un KL_ADMIN y queda auditado en ambas bases. | §5 |
| B5 | **Auditoría correlacionada.** `kl.audit_event` se escribe en la misma transacción que el cambio (integridad garantizada por la base). El registro de accesos sigue en `admin_audit_event` mediante el router del Control Center. Ambos llevan el mismo `request_id`. | §6 |
| B6 | **Jobs y cola propios.** Los agentes, el compilador de RAM, el planificador y el renderizador del PDF usan una cola y arrendamientos en `beeside_kl` (`kl.job` con `SKIP LOCKED`) y corren en un runtime propio de KL (`kl-worker`): misma imagen, punto de entrada propio y cuenta de servicio propia. El worker compartido no recibe credenciales de KL. | §7 |
| B7 | **Conexiones, infraestructura, migraciones y respaldos propios.** Base `beeside_kl`, cinco roles de KL con secretos propios, job de migración propio con `kl_owner`, journal propio y exportación programada de la base. | §8–§10 |
| B8 | **Fallo seguro.** Si no se puede validar la identidad o los permisos, la operación se rechaza. Una certificación que no pertenezca a la transacción en curso nunca basta para una operación sensible. Si la base principal o `beeside_kl` no están disponibles, KL Admin rechaza y Precision recibe `availability: "unavailable"` sin crear demanda. | §4.3 |
| B9 | **Salida a red controlada en la red.** Solo `kl-worker` (el agente recolector y el de conocimiento) puede salir a Internet, y solo hacia los dominios aprobados del Source Registry y el proveedor del modelo, mediante egreso por VPC y política de firewall con objetos FQDN. Una regla en el código (lint) no se considera aislamiento de red. | §11 |
| B10 | **Migraciones.** KL ya no comparte journal ni numeración con Discovery y Precision. Sus migraciones viven en `backend/src/kl/db/migrations/`, con numeración `KL-NNNN` y pareja `_integrity`, y se aplican solo a `beeside_kl`. **El choque 0017–0023 entre Discovery y Precision sigue abierto y no es un riesgo de KL.** | §9 |

## 4. Secciones sustituidas

La versión congelada no se edita. Las secciones listadas se leen como queda indicado; todo lo demás sigue vigente sin cambio.

| Documento congelado | Sección | Texto vigente según CR-KL-002 |
|---|---|---|
| Master Spec v1.4 · registro de decisiones | T1 ("esquema `kl` en el PostgreSQL existente, consumido por API") | "KL es un módulo de servicio propio dentro del backend compartido, con **base propia `beeside_kl` (esquema `kl`) en la instancia Cloud SQL existente**; Precision lo consume solo por el contrato `kl.v1`. Separable como servicio sin tocar Precision (CR-KL-002)." |
| Master Spec v1.4 | Arquitectura física ("módulo con esquema propio en el PostgreSQL existente") | Igual que T1 arriba. |
| Design Handoff Pack (Workspace) | Física (T1) | Igual que T1 arriba. |
| Precision MVP1 Handoff (referencia) | Punto 15 y §10 "Mismo backend, módulo propio … misma base PostgreSQL" | "Mismo backend, módulo propio, **base propia `beeside_kl`**; Precision lee solo vistas publicadas y funciones con el rol `kl_reader_precision`." |
| Design Spec | §2, párrafo de alcance ("esquema `kl` en el mismo PostgreSQL") | "…base propia `beeside_kl` (esquema `kl`) en la instancia Cloud SQL existente…" |
| Design Spec | §3, H3 ("tabla aditiva `kl.role_grant` sobre `admin_users`") | "`kl.role_grant` sobre `kl.principal` (B1); el rol de plataforma no se toca." |
| Design Spec | DD-07 | Roles y alcances iguales, definidos en `beeside_kl`. Se agregan `kl_owner` como dueño de todos los objetos y los controles de CONNECT de Contratos de seguridad §8. |
| Design Spec | DD-08 ("agentes en el worker existente … salida a Internet solo desde el worker") | "Agentes en el runtime propio `kl-worker` (misma imagen, punto de entrada propio), cola `kl.job` con `SKIP LOCKED` en `beeside_kl`. Salida a Internet solo de `kl-worker`, impuesta por egreso VPC con firewall FQDN (B9)." |
| Design Spec | DD-10 ("ejecutado en el worker") | "Ejecutado en `kl-worker`, sin salida a red durante el render." |
| Design Spec | §4.1 Topología | Diagrama `CR-KL-002_Arquitectura.svg`. |
| Design Spec | §5, párrafo inicial ("PostgreSQL existente, esquema propio `kl`, migraciones a mano en `backend/db/migrations` (pareja `00NN_kl_*`)") | "Base `beeside_kl`, esquema `kl`; migraciones a mano en `backend/src/kl/db/migrations` (pareja `KL-NNNN_*.sql` + `KL-NNNN_*_integrity.sql`), journal propio, Drizzle para tipos." El resto del párrafo sigue vigente. |
| Design Spec | §5.8 Gobierno | Se agregan `kl.principal`, `kl.request_attestation` y `kl.job` (Contratos de seguridad §2, §4 y §7). En `kl.audit_event` se agregan `actor_principal_id` (llave foránea) y `request_id`. |
| Design Spec | §7, "la concesión inicial al PO va por migración" | "La concesión inicial va por el comando de arranque auditado (B4)." |
| Design Spec | §11 Seguridad, "Frontera web" | Se agrega: "y control de red B9; la regla de lint se mantiene como defensa adicional." |
| Contratos `kl.v1` | §1, filas "Rol de BD" | La autenticación es contra `beeside_kl` con el rol indicado. La fila de agentes queda como "`kl-worker` · cola `kl.job` · cuentas `kl-agent` y `kl-knowledge`". |
| Contratos `kl.v1` | §8 Roles | Se sustituye por la matriz de roles de Contratos de seguridad §8. |
| Code Handoff Pack | §2, orden de prevalencia | CR-KL-002 prevalece sobre los documentos congelados **solo dentro de su alcance** (§4 de este documento). |
| Code Handoff Pack | §3, "Migraciones: solo en local o en CI con base de datos efímera" | Igual, contra una `beeside_kl` local o efímera y con su journal propio. |
| Matriz de implementación | I1, I11, I12, I14, I18, I23 | Ver `CR-KL-002_Pruebas.md` §1 (nuevas dependencias X). |
| Matriz de implementación | A3 | Sustituida por las condiciones G1–G4 (§5 de este documento). |
| Registro de congelamiento y `MIGRATIONS_RECONCILIATION.md` | Criterio "numeración final tras P5" y A3 | Sustituido por B10. P5 deja de ser una dependencia de KL. |
| Lienzos `Main.dc.html` y `ModeloDatos.dc.html` | Etiquetas "esquema kl en el PostgreSQL existente" | "Base `beeside_kl` · esquema `kl` (CR-KL-002)". El modelo agrega `kl.principal`, `kl.request_attestation` y `kl.job`. |

## 5. Condiciones obligatorias antes de habilitar entornos compartidos (sustituyen a A3)

| # | Condición | Bloquea | Responsable |
|---|---|---|---|
| G1 | **Sin escalada de privilegios hacia `beeside_kl`.** El protocolo de Contratos de seguridad §8.3 pasa completo en el entorno destino, con evidencia guardada: `app` y cualquier principal ajeno a KL no pueden conectarse, no pertenecen a ningún rol `kl_*`, no pueden concederse esos roles, no pueden cambiar sus contraseñas y no son dueños de nada en `beeside_kl`. | Cualquier migración o despliegue de KL en dev, staging o producción | Plataforma |
| G2 | Base `beeside_kl`, roles, secretos y job de migración aplicados por Terraform. Plan de reversión de la base y exportación programada probada con una restauración. | Primera migración en un entorno compartido | Plataforma |
| G3 | **Control de salida (B9)** activo y probado para `kl-worker`. Prueba X25 en verde. | Encender cualquier agente con red en un entorno compartido | Plataforma |
| G4 | Las identidades de KL Admin con titulares (H4) y el arranque de KL_ADMIN (B4) ejecutados en el entorno. | Operación de KL Admin en ese entorno | PO / Plataforma |

**Registrado para Plataforma, fuera del alcance de KL:** que solo los procesos de KL **puedan** consultar las fuentes externas exige, además, restringir la salida del backend compartido (Precision y Discovery) a sus propios proveedores. Hoy los servicios de Cloud Run salen a Internet directamente, sin VPC. KL no modifica ese backend. Hasta que Plataforma lo resuelva, la garantía para las conversaciones de Precision sigue siendo la del diseño congelado: modelo sin herramientas web, `kl/retrieval` sin cliente HTTP (lint) y la prueba de tráfico saliente. Esto no bloquea a KL; sí debe resolverse antes de afirmar un aislamiento de red total de beeside.

## 6. Evaluación de viabilidad y optimalidad

- **Seguridad:** el aislamiento se apoya en la conexión (CONNECT revocado a PUBLIC), la propiedad (`kl_owner`) y las credenciales por rol. La doble intervención sigue impuesta en la base. Los riesgos residuales están en Contratos de seguridad §12.
- **Costo:**
  - **Base de datos:** sin servidor nuevo. Las exportaciones van a almacenamiento en la nube, con costo despreciable al volumen de MVP1.
  - **Control de salida de `kl-worker`:**
    - Cloud NAT;
    - Cloud NGFW Standard (objetos FQDN): USD 0.0193 por GiB evaluado, sin cargo por hora en ese nivel;
    - con el tráfico de pocos GB al mes de los agentes, el costo es menor a unos pocos dólares mensuales.
  - **Descartado:** Secure Web Proxy, por tener costo fijo por hora sin una ventaja necesaria para MVP1.
- **Mantenimiento:** se agregan un journal, un job de migración, un runtime y cinco credenciales. Todo se gestiona con Terraform y queda protegido por el preflight.
- **Alternativas revisadas sin ventaja suficiente:**
  - **Credenciales IAM de base de datos para los roles de KL:** reduce secretos estáticos y se recomienda evaluarlo en G2. No es obligatorio para MVP1.
  - **Instancia separada:** cuesta el doble en producción; solo se justificaría por una recuperación a un punto en el tiempo independiente. Diferida.

## 7. Trazabilidad

| Elemento | Referencia |
|---|---|
| Versión original congelada | Etiqueta `kl-design-1.0-frozen` y huella `8901ecfa…` (sin cambios) |
| Este cambio | Carpeta `docs/knowledge-layer/kl-1.0-addenda/CR-KL-002/` en la rama `feat/kl-1.0-code` |
| Integridad | `MANIFEST.sha256`; su SHA-256 está fijado en `scripts/kl/preflight.sh` y en `scripts/kl/kl.fingerprint` |
| Modificaciones | Cualquier cambio exige CR-KL-002 v1.1 o un CR nuevo aprobado por el PO; el preflight bloquea cambios no registrados |
