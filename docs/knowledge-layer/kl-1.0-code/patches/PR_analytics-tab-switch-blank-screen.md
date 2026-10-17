# PR (propuesta, NO abierto): fix(admin-ui): Analytics se queda en blanco al cambiar de pestaña

**Rama local lista:** `fix/admin-analytics-tab-switch-blank-screen` (1 commit sobre `origin/main` = `bc3f527`; **no se ha subido ni abierto ningún PR**). Destinatario: responsable de Plataforma / Control Center. Origen: hallazgo durante la verificación de S3 de Knowledge Layer en dev (17-oct-2026); **no está relacionado con KL**.

## Problema
En *Control Center → Analytics*, pulsar **Journey health**, **Friction** u **Operational metrics** deja la página en blanco (hay que recargar). **User feedback** no falla.

## Causa raíz (`frontend/src/admin/AnalyticsView.tsx`)
Al cambiar de pestaña, el primer render usa el `tab` nuevo con el `data` de la pestaña anterior: el `useEffect` que lo limpia corre *después* de ese render. Con la forma de otra pestaña, `Object.entries(data.outcomes | data.signals | …)` recibe `undefined` y `data.retention.purgedInRange` lanza `TypeError`. La app no tiene *error boundary*, así que React desmonta todo. *User feedback* sobrevive porque usa accesos tolerantes (`?? []`, `num(undefined)`). Ocurre con **cualquier** dato; en el servidor no hay errores y esas pestañas ni siquiera llegan a pedir datos (evidencia en los logs de Cloud Run: solo se solicitaron `funnel` y `feedback`).

## Cambio
- `AnalyticsView.tsx`: se guarda a qué pestaña pertenece el dato cargado (`loadedTab`) y solo se usa si coincide con la pestaña actual (`data = loadedTab === tab ? loaded : null`). Sin cambios de API ni de contrato, sin cambios visuales (mientras carga se ve «Loading…», igual que ya ocurre al cargar por primera vez).
- `AnalyticsView.test.tsx` (nuevo, 5 pruebas): Funnel → Journey health / Friction / Operational metrics / User feedback, y User feedback → Funnel.

## Verificación
- La prueba nueva **falla sin el cambio** con los errores reales (`Cannot convert undefined or null to object`, `Cannot read properties of undefined (reading 'purgedInRange')`) y **pasa con él**.
- Sobre `main` + cambio: `vitest` del frontend **105/105** (19 archivos), `tsc --noEmit` y `eslint` limpios.

## Riesgo y rollback
Riesgo bajo: lógica de presentación local a un componente. Rollback: revertir el commit.

## Sugerencia complementaria (no incluida)
Añadir un *error boundary* alrededor de las vistas del Control Center para que un fallo de render muestre un mensaje en lugar de una página en blanco.

## Nota para Plataforma (relacionada, en otro cambio)
Durante la misma verificación se encontró otro defecto del Control Center en `main`: la cookie de estado del inicio de sesión se emitía `SameSite=Strict` y el retorno desde un IdP externo (Google) llegaba sin ella → `invalid_login_state`. El parche está en `docs/knowledge-layer/kl-1.0-code/patches/admin-login-cookie-samesite-lax.patch`; hoy solo está aplicado en la rama de KL y desplegado en dev. Conviene llevarlo a `main` antes de usar un IdP externo en staging/producción.
