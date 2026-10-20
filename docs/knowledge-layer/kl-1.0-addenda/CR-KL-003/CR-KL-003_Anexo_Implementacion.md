# CR-KL-003 · Anexo de implementación (aprobado por el PO el 17-oct-2026)

> Parte de CR-KL-003 (decisión 1 del PO, 17-oct-2026: separar las reglas operativas C7–C9 del cuerpo). **No modifica CR-KL-002.** Aprobado junto con `CR-KL-003.md`; puede revisarse sin reabrir las reglas C1–C6. Evidencia: `docs/knowledge-layer/kl-1.0-code/G2_D9_CLOUD_SCHEDULER.md` y `G2_FASE7_WORKER_Y_PRUEBAS.md`.

| # | Regla (antes) | Texto |
|---|---|---|
| **AI-1** | Ubicación de Cloud Scheduler (C7) | Los schedules de KL pueden vivir en una región distinta de la del destino cuando la del entorno no está soportada (los destinos son APIs HTTPS). En dev (`northamerica-south1`, Querétaro, no soportada por Cloud Scheduler) se usa **`us-south1`**. Solo residen allí metadatos del schedule (nombre, cron, URL de la API); ningún dato de KL. Se revisa si Google añade la región. |
| **AI-2** | Almacén de objetos fuera de producción (C8) | Con `NODE_ENV ≠ production` el worker usa el almacén local de desarrollo (`KL_STORAGE_DIR=/tmp/kl-storage`, efímero): sirve para verificar el arranque y la tubería, **no** para publicar ediciones. Con `NODE_ENV = production` el worker se niega a renderizar (`KlConfigError`) hasta que exista el adaptador de almacenamiento de Cloud Storage con retención (B9/D8). **Ninguna edición se publica en un entorno sin ese adaptador.** |
| **AI-3** | Conexión del worker en frío (C9) | Los pools de `kl-worker` esperan hasta 10 s la primera conexión por el socket de Cloud SQL (el backend interactivo mantiene 2 s). El job conserva `max_retries = 1`, pero un intento fallido por conexión debe tratarse como defecto observable (`retriedCount`). |

## Verificación en dev (17-oct-2026)
- **AI-1:** `cloudscheduler.googleapis.com` habilitada; `beeside-dev-kl-worker-tick` (`*/5 * * * *`) y `beeside-dev-kl-daily-export` (`30 8 * * *`) en `us-south1`; ejecuciones reales verificadas (5 sin fallos ni reintentos; export con la cuenta del scheduler y permiso + condición IAM probados).
- **AI-2:** el primer ciclo falló con `EACCES … mkdir './.kl-storage'` y se corrigió con `KL_STORAGE_DIR=/tmp/kl-storage`; el worker completó ciclos sin reclamar trabajos. **Ninguna edición publicada.**
- **AI-3:** un primer intento falló por `knowledge layer database unavailable` y el reintento lo resolvió; tras subir el tiempo a 10 s, cinco ejecuciones consecutivas sin fallos (evidencia no estadística).
