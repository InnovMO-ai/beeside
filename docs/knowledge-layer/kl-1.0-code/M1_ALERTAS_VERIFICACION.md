# M1-cierre · Verificación de las cuatro alertas de Monitoring (21-oct-2026)

Prueba controlada con `scripts/kl/m1/alerts-test.sh`, solo sobre recursos exclusivos de KL en DEV (Cloud Run Job `beeside-dev-kl-worker` con argumentos sustituidos, schedule `beeside-dev-kl-worker-tick` pausado temporalmente, schedule temporal `beeside-dev-kl-alerttest` eliminado al terminar). No se tocó `beeside_kl`, el export diario, el backend, respaldos ni recursos de otras plataformas. Evidencia: `evidence/M1-alertas-2026-10-21/`.

| # | Alerta | Provocación | Resultado |
|---|---|---|---|
| 3 | worker sin ejecuciones 20 min | tick pausado 23:13 UTC | **VERIFICADA**: abierta 23:39:14 (26 min), cerrada 23:44:56 al reanudar |
| 1 | ejecución fallida | 2 ejecuciones con `process.exit(1)` | **VERIFICADA**: abierta 23:44:56, cerrada 23:49:51 |
| 4 | error de Cloud Scheduler KL | job temporal con destino inexistente (404) | **VERIFICADA**: abierta 00:07:13 (sigue abierta; las alertas por log se cierran solas, por omisión a los 7 días) |
| 2 | intentos fallidos repetidos | las mismas 2 ejecuciones (4 intentos) | primera prueba: **no se disparó (defecto del filtro)**. Corregida y aplicada el 22-oct (`failed` OR `retried`); segunda prueba: **VERIFICADA**, abierta 01:49:04 UTC |

## Defecto hallado en la alerta 2
Datos reales de `completed_task_attempt_count`: de los 4 intentos, 2 salieron como `result="retried"` y 2 como `result="failed"`. Cloud Run solo marca `failed` el último intento de una ejecución. El filtro contaba solo `failed` (igual que la alerta 1) con umbral >2, así que nunca cubría su propósito (reintentos que ocultan fallos). **Corrección preparada** en `infra/terraform/modules/kl-alerting/main.tf`: contar `failed` y `retried`. **No aplicada**: Terraform no tiene credenciales de aplicación vigentes (`invalid_rapt`); requiere `gcloud auth application-default login` y luego `terraform plan/apply` en `envs/dev-kl`. Hasta entonces la alerta 2 es redundante con la 1.

## Estado de lo verificado y lo pendiente
- Verificado: disparo y cierre de las alertas 1, 3 y 4 en Cloud Monitoring (API `alerts`). Tick y export quedaron `ENABLED`; el job temporal ya no existe.
- Entrega de correo: el PO confirmó el 21-oct-2026 haber recibido en `<correo-del-PO>` los correos de las alertas 3, 1 y 4 (confirmación del PO; no verificable por la API).
- Pendiente: aplicar la corrección de la alerta 2 y repetir su prueba.
- **M1 NO está completo**: faltan las pruebas reales del estado público y de la descarga autenticada (el backend apunta a `beeside_kl`; reapuntarlo es un cambio de servicio compartido), y la segunda identidad humana.

## Actualización 22-oct-2026
- **Alerta 2**: filtro corregido en `modules/kl-alerting` y aplicado en `envs/dev-kl` (plan: 1 recurso a modificar, 0 crear, 0 destruir; sin deriva posterior). Prueba real repetida: se abrió a las 01:49:04 UTC.
- **Defecto nuevo en la alerta 3 (falso positivo)**: abrió un incidente a las 00:09 UTC con el tick ejecutándose cada 5 min. Causa: sin `cross_series_reducer`, la ausencia se evalúa por serie (`result=failed/retried/succeeded`); la serie `failed` creada por la prueba dejó de reportar y disparó la alerta 20 min después. Habría ocurrido tras cualquier fallo aislado real. Corregido con `REDUCE_SUM` y aplicado (1 recurso, sin deriva); el incidente falso se cerró solo. Re-verificación de la alerta 3 (pausa real del tick, política corregida): **incidente nuevo abierto a las 02:19:07 UTC**, 27 min tras pausar el tick; tick reanudado (`evidence/M1-alertas-2026-10-21/a3-segunda-prueba-tras-reducer.log`). Correcciones de redacción: la primera apertura de la alerta 3 (23:39:14) se cerró a las 23:44:56 al reaparecer ejecuciones completadas (no «al reanudar»); los correos confirmados por el PO son los de las alertas 3, 1 y 4 (no se confirmó el de la 2).
