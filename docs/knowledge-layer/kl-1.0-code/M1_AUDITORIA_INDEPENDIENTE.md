# M1 · Dictamen de auditoría independiente (22-oct-2026)

Tres perfiles, sin ver las conclusiones del autor, sobre código, evidencia y estado de GCP (solo lectura).

| Perfil | Veredicto inicial | Hallazgo decisivo | Estado final |
|---|---|---|---|
| Cloud y seguridad | NO-GO provisional | El servicio temporal **no era privado** (`invoker-iam-disabled` heredada) + evidencia de alertas 2/3 sin archivar + URI OAuth y sesiones | Verificado en logs: 23 peticiones, **todas de la IP del PO**, sin tráfico ajeno; script corregido; evidencia archivada; **URI OAuth retirada por el PO (22-oct)**; sesiones caducan solas |
| Backend | GO condicionado | Caché de token ignoraba `expires_in`/401; «descarga autenticada» = solo vista previa; `unpublished` ⇒ `superseded`; `unknown` ante caída de BD | Token y 503: **implementados, no desplegados**; resto documentado |
| QA de integración | NO-GO | Evidencia incompleta (alerta 2, tick/export, cuerpos de pruebas negativas, `svc-iam.txt`) | Evidencia archivada (`terraform-alerta2-apply.txt`, `a12-segunda-corrida-alerta2.log`, `a3-segunda-prueba-tras-reducer.log`, `estado-final.txt`); aserciones añadidas al script |

## Correcciones: implementadas vs desplegadas
| Corrección | Implementada | Desplegada (DEV) |
|---|---|---|
| Alerta 2 y alerta 3 (Terraform) | sí | **sí** |
| Servicio temporal privado (script) | sí | n/a (servicio retirado) |
| Caché de token GCS + 401 | sí | **no** |
| Estado público 503 | sí | **no** |
| Evidencia y documentos | sí | n/a |

## Dictamen
**GO condicionado** para declarar M1 **técnicamente cerrado**:
- Lo funcional está verificado con pruebas reales (almacén, render, estado público `current`/`revoked`, descarga autenticada de vista previa con hash idéntico, cuatro alertas, retirada).
- **Condiciones que impiden hablar de «cerrado y desplegado»:** (1) las dos correcciones de código siguen sin publicarse ni desplegarse (L1 restringida); (2) sin probar 403 por rol, `unpublished` real ni la descarga de la edición publicada para el consumidor (exige segunda identidad / M3).
- Riesgo residual aceptado: retención del bucket no bloqueada; alertas 3/4 con alcance limitado (documentado).
