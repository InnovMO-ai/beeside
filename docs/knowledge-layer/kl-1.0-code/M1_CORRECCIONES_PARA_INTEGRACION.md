# M1 · Correcciones listas para integrar (información mínima para Arquitectura)

Estado al 22-oct-2026: todo está **solo en local** (rama `feat/kl-1.0-code`, HEAD local posterior a `6595557`, que sigue siendo el HEAD publicado). No se hizo push ni despliegue; la consolidación L1 (PR #7, borrador «NO FUSIONAR», `consolidate/main-v1` en `a2badcc`) no se tocó. Las correcciones **no alteran** L1 ni los contratos congelados (las respuestas de éxito no cambian; el 503 es una ruta de error nueva que el Design no especifica).

## Paquete (`KL-M1-correcciones/`, con `SHA256SUMS`)
| Parche | Contenido | Archivos | ¿Compartido? |
|---|---|---|---|
| `0001-kl-m1-correcciones-de-codigo.patch` | (a) `GcsObjectStore`: respeta `expires_in` del token de metadatos y descarta el token ante 401; (b) estado público ⇒ **503** `{"error":"UNAVAILABLE"}` (+`Retry-After: 30`) si la BD falla, nunca `unknown`; pruebas (12) | `backend/src/kl/ingest/gcs-object-store.ts`, `read/read-service.ts`, `products/delivery.ts` y 2 pruebas | No: solo `backend/src/kl/**` |
| `0002-kl-m1-alertas-2-y-3-terraform.patch` | Alerta 2 cuenta `failed` + `retried`; alerta 3 con `REDUCE_SUM`. **Ya aplicado en DEV** (`envs/dev-kl`, sin deriva): si `main` no lo lleva, el siguiente `apply` revertiría las alertas | `infra/terraform/modules/kl-alerting/main.tf` | Módulo KL ya declarado en `shared-changes.txt` |
| `0003-kl-m1-herramientas-y-evidencia.patch` | Scripts de prueba de alertas y de verificación pública/descarga, helper de siembra de la nube, documentos de cierre y evidencia | `scripts/kl/m1/**`, `backend/src/kl/testing/cloud-e2e.ts`, `docs/knowledge-layer/kl-1.0-code/**` | No |

## Verificación
- `git apply --check` de los tres sobre `consolidate/main-v1` (`a2badcc`): **sin conflictos**.
- Sobre `a2badcc` con 0001 aplicado: `gcs-object-store` 9/9 en verde. La suite `r3-public-mount` (que arranca `createApp`) **no pudo ejecutarse allí** por dependencias de otras plataformas no instaladas en este equipo (`nodemailer`, `@beeside/fa-public-engine`); sí pasa (5/5) en `feat/kl-1.0-code`. La confirmación completa en la línea consolidada la dará su CI (`kl-tests`).
- Orden sugerido: 0001 y 0002 con L1 (o justo después, mismo PR de KL); 0003 es opcional.
- **Imagen**: 0001 cambia el backend y el worker; requiere publicar imágenes (`kl-publish-dev-<sha>`) tras la integración. Hasta entonces el defecto de caché de token y el `unknown` ante caída siguen en Cloud Run.
