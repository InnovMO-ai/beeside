# M1 · Cierre técnico (22-oct-2026, hora UTC; la sesión fue la noche del 21 en México)

Alcance: `GcsObjectStore` (D8), cableado del backend y del worker, alertas de Monitoring y verificación de punta a punta del estado público y de la descarga autenticada **de vista previa del administrador**. Solo recursos de KL en DEV. No se tocó L1, `main`, el PR #7, el backend real, IAM, secretos ni `beeside_kl`.

> **Corrección de una afirmación previa (hallazgo B1 de la auditoría).** Se dijo que el servicio temporal era «privado (IAM)». **No lo era**: el clon heredó del backend la anotación `run.googleapis.com/invoker-iam-disabled: 'true'` (`/private/tmp/kl-m1-verify/verify.yaml:6`), por lo que cualquiera en Internet podía invocarlo; la única barrera fue la autenticación de la aplicación (401 sin sesión). Ventana: del despliegue (~00:39 UTC) a la retirada (01:44 UTC). **Revisión de todos los registros de Cloud Run del servicio (23 peticiones): todas proceden de la IP del PO (curl, `cloud-run-proxy` y el navegador); no hay tráfico ajeno.** Las pruebas enviaron `Authorization: Bearer` sin necesitarlo, por eso no lo detectaron. Corregido en `scripts/kl/m1/clone-backend-yaml.js` y `verify-public-download.sh` (elimina la anotación, comprueba que una petición sin credenciales recibe 403 y borra el servicio si no); **el script corregido no se ha vuelto a ejecutar** (el servicio ya no existe).

## Verificado con pruebas reales
| Capacidad | Evidencia |
|---|---|
| Almacén GCS desde Cloud Run (put idempotente, conflicto, not_found, hash de render = AC-10) | `M1_PUBLICACION_E2E.md` |
| Edición sintética: composición, vista previa, aprobación por otra persona, render ES/EN en Cloud Run, PDF final en el bucket con hash íntegro | `db-edition.txt`, `db-preview.txt`, `M1_PUBLICACION_E2E.md` |
| **Estado público real** `/api/public/editions/<verification id>/status`: `current` con código y fecha, cabeceras `no-store`/`noindex`/`nosniff`; tras revocar ⇒ `revoked` | `t1-estado-publico.txt`, `t5-estado-revocado.txt` |
| **Descarga autenticada de vista previa** (`/api/admin/kl/editions/:id/preview/:locale/pdf`): sin sesión y con cookie inválida ⇒ 401; con sesión Google OIDC real del PO ⇒ 200, 364 240 B, 8 páginas; SHA-256 `2e0e8a45…baa95` coincide con la fila `kl.file_object` y con el objeto del bucket (`cmp` byte a byte); rol del PO = solo `KL_REVIEWER`; auditoría ALLOWED en la base principal (01:40:29) y petición registrada en Cloud Run (GET 200, 01:40:28) | `t3`, `descarga-verificacion-db.txt`, `descarga-log-integridad.txt` |
| Alertas 1 y 4 provocadas y abiertas; alerta 2 corregida y re-probada (abierta 01:49:04); correos de las alertas 3, 1 y 4 confirmados por el PO | `M1_ALERTAS_VERIFICACION.md`, `evidence/M1-alertas-2026-10-21/` |
| Retirada: servicio eliminado, base `beeside_kl_e2e` eliminada, sin usuarios temporales | `retirada.txt` |

**Alerta 3 re-verificada con la política corregida (`REDUCE_SUM`)**: con el tick realmente pausado (01:51:51 UTC) se abrió un incidente **nuevo** a las 02:19:07 (27 min), posterior al inicio de la prueba; el tick se reanudó y quedó `ENABLED` (`a3-segunda-prueba-tras-reducer.log`, `estado-final.txt`). Límite: la ausencia de falso positivo ante un fallo aislado no se aisló con una prueba propia (el tick estaba pausado); se apoya en que el incidente falso previo se cerró al aplicar la corrección.

## Defectos hallados durante el cierre
1. Alerta 2 contaba solo `failed`; los reintentos salen como `retried`. **Corregida y aplicada** (Terraform: 1 recurso, sin deriva).
2. Alerta 3 evaluaba la ausencia por serie ⇒ falso positivo (00:09 UTC) tras un fallo aislado. **Corregida y aplicada** (`REDUCE_SUM`).
3. Servicio temporal público por herencia de `invoker-iam-disabled` (B1, arriba). **Corregido en el script.**
4. Caché de token de `GcsObjectStore`: sobrescribía la caducidad real (`expires_in`) con 50 min y no descartaba un token rechazado (401). **Corregido en el código con 2 pruebas nuevas; decisión del PO de incorporarlo (22-oct). NO desplegado** (la imagen en Cloud Run conserva el defecto).
5. Estado público ante falla de la base de datos: devolvía `{"status":"unknown"}` 200. **Ahora 503** `{"error":"UNAVAILABLE"}` con `Retry-After: 30`, `no-store`, sin detalle interno; `unknown` queda solo para identificadores sin edición. 3 pruebas nuevas. **NO desplegado.**

## Implementado vs desplegado (22-oct-2026)
| Corrección | Implementada | Desplegada en DEV |
|---|---|---|
| Alerta 2 (`failed` + `retried`) | sí | **sí** (Terraform `envs/dev-kl`, sin deriva) |
| Alerta 3 (`REDUCE_SUM`) | sí | **sí** (Terraform `envs/dev-kl`, sin deriva) |
| Caché de token de `GcsObjectStore` + reintento ante 401 | sí (commit local) | **no** |
| Estado público 503 ante falla de BD | sí (commit local) | **no** |
| Servicio temporal privado (script) | sí | no aplica (servicio retirado; sin re-ejecutar) |

Las dos correcciones de código siguen **solo en local**: `feat/kl-1.0-code` está en `6595557` en GitHub y la consolidación L1 (PR #7, borrador «NO FUSIONAR», `consolidate/main-v1` en `a2badcc`) continúa restringida. Información para Arquitectura: `M1_CORRECCIONES_PARA_INTEGRACION.md`.

## Auditoría independiente (3 perfiles) · hallazgos y disposición
| Hallazgo | Perfil | Disposición |
|---|---|---|
| Servicio temporal no era privado | Cloud | Corregido en script; incidente descrito arriba; sin tráfico ajeno |
| Re-verificación de alerta 3 / log de alerta 2 sin archivar | Cloud, QA | Alerta 2 archivada (`a12-segunda-corrida-alerta2.log`, `terraform-alerta2-apply.txt`); alerta 3 ver arriba |
| URI OAuth `http://localhost:8081/api/admin/auth/callback` sigue en el cliente real; el PO tiene sesiones abiertas en la base principal | Cloud | **URI retirada: el PO confirmó el 22-oct-2026 haberla eliminado de Google Cloud Console.** Las sesiones de prueba caducan solas (8 h / 30 min de inactividad) |
| «Descarga autenticada» = solo vista previa de administración; la descarga de la edición publicada para el consumidor (`createEditionDownloadHandler`) no está cableada | Backend | **Reformulado.** Pendiente para la integración con Precision (M3) |
| `unpublished` se devuelve como `superseded`; no se probó en vivo | Backend, QA | Declarado; sin prueba real |
| `get()` sin reintento durante la lectura del cuerpo; objeto ausente ⇒ 500 en vez de 404; `UNAVAILABLE` sin auditoría | Backend | No bloqueante; backlog |
| Estado público: error de BD ⇒ `unknown` HTTP 200 (podría ocultar una revocación durante una caída); límite de tasa abierto | Backend | **Decisión del PO (22-oct): 503.** Implementado y probado en local; **no desplegado**. El límite de tasa abierto queda como está |
| 403 por rol insuficiente, `unpublished`, vista previa inexistente, integridad corrupta: sin prueba real | QA | Pendientes; el 403 exige una segunda identidad |
| Evidencia de pruebas negativas sin cuerpos, `svc-iam.txt` vacío, scripts de alerta de las pruebas 3/1/4 distintos del comprometido | QA | Script corregido (aserciones, cuerpos, filtro T0); `svc-iam.txt` **no concluyente** y reemplazado por la comprobación explícita de 403 en el script |
| Retención de 30 días del bucket sin bloqueo (`is_locked=false`): un administrador puede quitarla | Cloud | Aceptado; el texto «no se pueden borrar» vale solo para el flujo normal |
| Alertas: 4 no cubre fallos del export asíncrono; 3 no detecta un worker que falla en bucle (lo cubre la 1); umbral de la 2 (>2) no dispara con una sola ejecución fallida; canal único | Cloud | No bloqueante; documentado |
| `/private/tmp/kl-m1-verify` conserva `backend.yaml` (con un secreto literal) | Cloud | Se elimina al final de esta sesión |

## Limitaciones declaradas
- No se probó un 403 (no hay segunda identidad humana), ni `unpublished`, ni la descarga de la edición publicada para el consumidor.
- El servicio temporal usó la base principal de sesiones del Control Center: dejó filas de sesión y un evento de auditoría permanente del PO.
- Los PDF de ensayo quedan en el bucket 30 días (versionado + retención no bloqueada).

## Pendiente fuera de M1
Publicación de Doing Business real, UI de administración (M2), KSeed real y Precision (M3), agentes y G3 (M4), retención de `kl.request_attestation`, D3, X26. L1/PR #7: Arquitectura.
