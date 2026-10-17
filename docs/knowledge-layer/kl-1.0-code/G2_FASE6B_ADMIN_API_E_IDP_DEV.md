# G2 · Fase 6B · Habilitar el Admin API y el proveedor de identidad (IdP) en dev — opciones, requisitos, riesgos y decisores

Estado: **PREPARADO. NADA SE HA EJECUTADO** (solo lecturas de código y de metadatos de GCP). Es el bloqueo **B1** del cableado de KL: sin `ADMIN_API_ENABLED=true` el backend no monta el módulo de KL, y sin un IdP nadie puede iniciar sesión (mo@beeside.you ya es `admin_user` ADMIN y KL_ADMIN, pero su identidad no está enlazada: `auth_subject` vacío).

## 1. Qué es lo que realmente se habilita (alcance real)

El Admin API **no es de KL**: es el **Control Center de la plataforma** (`backend/src/admin/admin-router.ts`, en `main` desde antes de KL). Encenderlo en el backend público de dev expone, tras iniciar sesión, **todo** el Control Center: proyectos y respuestas, instantáneas, premium, entregas de correo e integraciones, ejecución manual de jobs, analítica y comentarios, además de `/api/admin/kl/*`. KL solo se monta encima (`klRuntimeFromEnv` exige ese Admin API). Por eso es una decisión de **Plataforma**, no un cambio de KL.

Datos útiles verificados:
- La imagen que corre hoy (`backend-api:bc3f527…` = `main`) **ya contiene** el Admin API: habilitarlo **no requiere** una imagen de la rama KL. Se puede hacer primero y por separado (paso S2) y luego, en otro paso, cablear KL.
- Autorización de dos capas: OIDC válido **y** fila en `admin_user` con `active` y `login_enabled`. Hoy hay 2 filas: la identidad técnica `@beeside.internal` (sin login) y `mo@beeside.you` (ADMIN). Nadie más puede entrar aunque el IdP los autentique.
- El flujo: Authorization Code + PKCE (S256), `state`, `nonce`, token verificado localmente contra el JWKS (RS256/ES256), `iss`, `aud`, `exp`, `nonce` y **`email_verified = true`**; restricción opcional por dominio (`ADMIN_ALLOWED_EMAIL_DOMAINS`). Alcance pedido: `openid email`. Autenticación del cliente en el endpoint de token: `client_secret` en el cuerpo (`client_secret_post`).
- Sesión: token opaco en cookie `HttpOnly`, `SameSite=Strict`, `Secure`; requiere **un único origen** para navegador y API. El frontend de dev (`beeside-dev-frontend-app`) ya tiene `API_UPSTREAM_URL` (proxy de `/api` al backend), así que el origen del Control Center es la URL del frontend: `https://beeside-dev-frontend-app-amwsj4v5uq-pv.a.run.app`. Las escrituras exigen la cabecera `x-beeside-admin: 1` y `Origin` igual a `ADMIN_APP_ORIGIN`.
- Organización de GCP: `beeside.you` (Google Workspace/Cloud Identity); `mo@beeside.you` es la cuenta Owner. `iap.googleapis.com` está habilitada (no se verificó si se usa). Único secreto relacionado hoy: `beeside-dev-sso-client-secret` (placeholder **sin versión**).

## 2. Variables que exige el backend (`adminDepsFromEnv`)

| Variable | Valor / origen |
|---|---|
| `ADMIN_API_ENABLED` | `true` |
| `ADMIN_APP_ORIGIN` | `https://beeside-dev-frontend-app-amwsj4v5uq-pv.a.run.app` (sin barra final) |
| `ADMIN_OIDC_ISSUER` | depende del IdP (opción A: `https://accounts.google.com`, debe coincidir **exactamente** con el `issuer` del documento de descubrimiento) |
| `ADMIN_OIDC_CLIENT_ID` | del IdP (no es secreto) |
| `ADMIN_OIDC_CLIENT_SECRET` | **secreto** → Secret Manager (`beeside-dev-sso-client-secret`, hoy sin versión) |
| `ADMIN_OIDC_REDIRECT_URI` | `https://beeside-dev-frontend-app-amwsj4v5uq-pv.a.run.app/api/admin/auth/callback` (a registrar en el IdP; pasa por el proxy del frontend) |
| `ADMIN_SESSION_SECRET` | **secreto** nuevo ≥ 32 caracteres → Secret Manager (p. ej. `beeside-dev-admin-session-secret`, aleatorio) |
| `ADMIN_ALLOWED_EMAIL_DOMAINS` | `beeside.you` (recomendado) |
| ya presentes | `DATABASE_URL`, `APP_BASE_URL`, `NODE_ENV`, `SECURITY_HASH_SECRET`, `TRUST_PROXY_HOPS`, `ALLOWED_ORIGINS` |

## 3. Opciones de IdP

| | Opción | Qué hace falta | Pros | Contras |
|---|---|---|---|---|
| **A** | **Google (Workspace `beeside.you`) como proveedor OIDC** — *recomendada para dev* | Crear un **cliente OAuth 2.0 «Aplicación web»** en la consola de Google Cloud (APIs y servicios → Credenciales) con pantalla de consentimiento **Interna** a la organización y la URI de redireccionamiento anterior; guardar el *client secret* en Secret Manager. La creación del cliente OAuth **es manual en la consola** (no hay Terraform/`gcloud` soportado para clientes OAuth web genéricos) | Sin costo ni servicio nuevo; el correo del titular ya es una cuenta Google verificada; cumple lo que valida el código (discovery, `email_verified`, RS256, PKCE); restringible por dominio | Acopla el Control Center a Google; dev/prod deberían usar clientes distintos; 2FA/ política de sesión las gobierna Workspace, no la plataforma |
| **B** | IdP corporativo distinto (Okta/Entra ID/Auth0…) | Alta y configuración en ese proveedor, DNS/redirects, costo y responsable | Desacopla, SSO empresarial | Más tiempo, costo y un tercero; **no hay decisión tomada** (`docs/deployment/README.md` §4) |
| **C** | Proveedor OIDC local de desarrollo (`dev-oidc-provider.ts`) | Nada en la nube; corre en `127.0.0.1` | Sirve para ejercitar el flujo y KL Admin **localmente**, sin exponer nada | **No** se despliega nunca (se niega en producción, sin almacén de usuarios); no resuelve el uso en Cloud Run. Para usarlo con datos reales de dev habría que apuntar un backend local a las dos bases por proxy (escribe sesiones en la base principal de dev) |

Recomendación: **A para dev**, con un cliente OAuth exclusivo de dev; B queda como decisión de Plataforma para staging/producción (no bloquear KL por ello). C solo como prueba local previa si se quiere verificar KL Admin antes de tocar la nube.

## 4. Secuencia propuesta (cada paso requiere autorización expresa)

| # | Paso | Quién | Cambia |
|---|---|---|---|
| S0 | Decisiones: IdP (A/B), aceptar la exposición del Control Center completo en la URL pública de dev, dominio permitido | **PO/Plataforma** | — |
| S1 | Crear el cliente OAuth (consola) y registrar la URI de redireccionamiento; crear versiones de `beeside-dev-sso-client-secret` (secreto del cliente) y de `beeside-dev-admin-session-secret` (aleatorio); conceder `secretAccessor` por secreto a la cuenta del backend | Titular de la consola (Owner) + operador | Credenciales OAuth del proyecto; 2 secretos (el segundo nuevo); IAM por secreto |
| S2 | **Habilitar el Admin API sobre la imagen actual de `main`** (sin KL): `gcloud run services update beeside-dev-backend-api --update-secrets ADMIN_OIDC_CLIENT_SECRET=beeside-dev-sso-client-secret:latest,ADMIN_SESSION_SECRET=beeside-dev-admin-session-secret:latest --update-env-vars ADMIN_API_ENABLED=true,ADMIN_APP_ORIGIN=…,ADMIN_OIDC_ISSUER=…,ADMIN_OIDC_CLIENT_ID=…,ADMIN_OIDC_REDIRECT_URI=…,ADMIN_ALLOWED_EMAIL_DOMAINS=beeside.you`. Guardar antes el nombre de la revisión actual (`beeside-dev-backend-api-00007-gtk`) | Operador | Una revisión nueva del servicio compartido (misma imagen) |
| S3 | **Verificación**: `/health` y `/health/ready` 200; `GET /api/admin/me` sin sesión → 401; abrir `…/admin` y entrar con `mo@beeside.you` (la persona misma, en su navegador); comprobar `auth_subject` enlazado, `admin_session` creada y `admin_audit_event` de inicio de sesión; un correo de otro dominio o sin `admin_user` es rechazado | PO (titular) + operador | Filas de sesión/auditoría en la base principal |
| S4 | **Cableado de KL (Fase 6B original)**: cambiar a `kl-backend:<sha>` y añadir `beeside-dev-kl-db`, `KL_DB_URL_APP/READER` y `PRECISION_KNOWLEDGE_PROVIDER=off`, según `G2_FASE6_BOOTSTRAP_Y_CABLEADO.md` §B; resolver antes los topes de conexión (9 vs 8) y la deriva del módulo | Operador | Otra revisión del servicio compartido |
| S5 | Verificar KL Admin con `mo@beeside.you` (KL_ADMIN) y que la ruta pública de ediciones responde `unknown` | PO + operador | — |

**Rollback (S2/S4):** `gcloud run services update-traffic beeside-dev-backend-api --to-revisions beeside-dev-backend-api-00007-gtk=100` devuelve el tráfico a la revisión previa de inmediato; después, `--remove-env-vars`/`--remove-secrets` de lo añadido. Si la revisión nueva no arranca (variable faltante), Cloud Run no le envía tráfico. Retirar el acceso: borrar el cliente OAuth y las versiones de secreto; `admin_user.login_enabled=false` bloquea al usuario sin tocar el IdP.

## 5. Riesgos

| Riesgo | Detalle / mitigación |
|---|---|
| **Superficie pública mayor** | El Control Center completo queda alcanzable en una URL pública (`--no-invoker-iam-check`). Capas: OIDC + dominio + `admin_user` (solo 1 humano) + cookie `Strict/Secure` + cabecera/origen en escrituras + límites de tasa. Datos de dev. Mitigar con `ADMIN_ALLOWED_EMAIL_DOMAINS=beeside.you` y revisar `admin_user` antes de S2 |
| El emisor no coincide | El código exige `issuer` configurado == `issuer` del descubrimiento. Con Google: `https://accounts.google.com` exacto; un error deja el inicio de sesión en «unavailable», sin efecto de seguridad |
| Redirect URI mal registrada | Falla el callback (Google lo rechaza); sin daño |
| Cuenta equivocada enlazada | La identidad se **enlaza en el primer inicio de sesión** (`auth_subject`). Debe hacerla el titular real de `mo@beeside.you`; una vez enlazada, un `sub` distinto no entra. No simular sesiones |
| Secreto de cliente/sesión | Solo en Secret Manager con acceso por secreto; el valor no debe pasar por chat, commits ni logs |
| Servicio compartido | Cada cambio crea una revisión de `beeside-dev-backend-api` (Discovery/Precision/FA4 usan ese backend o comparten identidad). Rollback inmediato; ventanas cortas |
| Deriva de Terraform | `modules/cloud-run` ignora deriva de `env`/`image` pero no de secretos montados ni de volúmenes; hoy dev se despliega con `gcloud`, no `apply`. Registrar el cambio y, si Plataforma quiere gestionarlo en Terraform, incorporar las variables al módulo (cambio compartido a aprobar) |
| Segundo administrador | `padmin@beeside.you` sigue **sin aprovisionar** y sin usarse para doble intervención hasta confirmar su titular individual y su autenticación |
| Producción | Nada de esto define producción: allí no hay script de aprovisionamiento; los usuarios los crea un ADMIN desde el Control Center con el IdP corporativo elegido |

## 6. Quién decide
- **PO / Plataforma (Mike, según los documentos de despliegue):** IdP (A/B), aceptar la exposición del Control Center en dev, dominio permitido, y la creación del cliente OAuth (requiere un Owner de la consola).
- **KL (yo):** solo S4–S5 (cableado y verificación de KL) cuando S1–S3 estén cumplidos; preparo comandos y verificaciones, no decido el IdP.

## 7. Qué necesito para avanzar
1. Elegir A, B o C.
2. Si A: que un Owner cree el cliente OAuth «Aplicación web» (consentimiento Interno) con la redirect URI de la sección 2 y entregue **solo el client id** por chat; el secreto lo coloca directamente en `beeside-dev-sso-client-secret` (yo puedo dejar listo el comando `gcloud secrets versions add … --data-file=-` para que lo ejecute él/ella).
3. Autorización expresa de S1 (parte de secretos/IAM), S2 y S3; S4–S5 después.

---

## 8. S1 con la opción A elegida: pasos exactos para el Owner (PREPARADO, NO EJECUTADO)

Decisión del PO: **opción A — Google Workspace como IdP de dev**. Estado leído hoy (solo lectura): `beeside-dev-sso-client-secret` existe como placeholder **sin versiones ni IAM**; `beeside-dev-admin-session-secret` **no existe**; el backend corre como `640247497574-compute@developer.gserviceaccount.com`; cuenta activa de `gcloud`: `mo@beeside.you` (Owner).

### 8.1 En la consola de Google Cloud (manual; solo el Owner)
1. *APIs y servicios → Pantalla de consentimiento de OAuth* (o *Google Auth Platform → Branding/Audiencia*): tipo de usuario **Interno** (limita el acceso a la organización `beeside.you`); nombre de la app «beeside Control Center (dev)»; correo de soporte; alcances solo **`openid`** y **`email`** (no sensibles).
2. *Credenciales → Crear credenciales → ID de cliente de OAuth* → tipo **Aplicación web**, nombre `beeside-dev-control-center`. **URI de redireccionamiento autorizada** (exacta): `https://beeside-dev-frontend-app-amwsj4v5uq-pv.a.run.app/api/admin/auth/callback`. Orígenes de JavaScript: no se necesitan (el flujo es de servidor).
3. Al crear, la consola muestra el **ID de cliente** y el **secreto**. Entrega por chat **solo el ID de cliente** (no es secreto). **El secreto no sale del terminal del Owner.**
(La interfaz de Google cambia de nombre con frecuencia: si «Pantalla de consentimiento» aparece como «Google Auth Platform», las opciones equivalen.)

### 8.2 Secretos e IAM (terminal del Owner, desde la raíz del repositorio)
```bash
bash scripts/kl/g2/s1-idp-secrets.sh plan                              # solo lectura
S1_CONFIRM=yes bash scripts/kl/g2/s1-idp-secrets.sh session           # crea beeside-dev-admin-session-secret con 48 bytes aleatorios (no se muestra)
S1_CONFIRM=yes bash scripts/kl/g2/s1-idp-secrets.sh client-secret     # pide el client secret de Google OCULTO y lo agrega a beeside-dev-sso-client-secret
S1_CONFIRM=yes bash scripts/kl/g2/s1-idp-secrets.sh iam               # secretAccessor a la cuenta del backend SOLO sobre esos dos secretos
bash scripts/kl/g2/s1-idp-secrets.sh verify                            # versiones habilitadas y miembros de IAM; nunca lee el contenido
```
Los subcomandos que escriben se niegan sin `S1_CONFIRM=yes` (probado: sale con código 2); `client-secret` exige terminal interactivo y rechaza valores de menos de 20 caracteres. El secreto de sesión lo puedo ejecutar yo (sesión de `gcloud` del Owner) si lo autorizas; **el del cliente OAuth lo teclea el Owner**.

Comandos equivalentes sin el script (por si se prefiere):
```bash
P=beeside-dev-508220; SA=640247497574-compute@developer.gserviceaccount.com
gcloud secrets create beeside-dev-admin-session-secret --project $P --replication-policy=automatic --labels=environment=dev,purpose=admin-session-signing
openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add beeside-dev-admin-session-secret --project $P --data-file=-
read -rs -p "client secret: " CS; echo; printf '%s' "$CS" | gcloud secrets versions add beeside-dev-sso-client-secret --project $P --data-file=-; unset CS
for s in beeside-dev-sso-client-secret beeside-dev-admin-session-secret; do
  gcloud secrets add-iam-policy-binding $s --project $P --member serviceAccount:$SA --role roles/secretmanager.secretAccessor --condition=None
done
```

### 8.3 Efectos y límites de S1
- **Cambia:** 1 secreto nuevo (`beeside-dev-admin-session-secret`, fuera de Terraform; opcionalmente se incorpora después a `modules/secrets`, cambio compartido), 1 versión en el placeholder existente y 2 enlaces de IAM por secreto. **No** cambia el servicio, ni la base, ni KL.
- **Efecto lateral conocido (D3):** la cuenta del backend es la cuenta compute por defecto, compartida con los servicios `fa4-*`; también podrían leer estos dos secretos. Se corrige con una cuenta de servicio propia del backend (decisión abierta).
- **El secreto de sesión firma las sesiones del Control Center:** rotarlo invalida todas las sesiones abiertas.

### 8.4 Rollback de S1
```bash
gcloud secrets versions list beeside-dev-sso-client-secret --project $P                       # identificar la versión
gcloud secrets versions destroy <N> --secret beeside-dev-sso-client-secret --project $P       # o "disable" para poder reactivarla
gcloud secrets delete beeside-dev-admin-session-secret --project $P
gcloud secrets remove-iam-policy-binding <secreto> --project $P --member serviceAccount:$SA --role roles/secretmanager.secretAccessor
```
y borrar el cliente OAuth `beeside-dev-control-center` en la consola. Mientras S2 no se ejecute, S1 no tiene efecto sobre ningún servicio.

### 8.5 Siguiente
Con el ID de cliente y los secretos listos, S2 (habilitar el Admin API sobre la imagen actual de `main`) y S3 (inicio de sesión real de `mo@beeside.you`) requieren su propia autorización expresa.

### 8.6 S1 ejecutado parcialmente (2026-10-17) · lo que hizo KL por autorización del PO
`S1_CONFIRM=yes … session` e `iam` (cuenta `mo@beeside.you`, proyecto `beeside-dev-508220`):
- Creado `beeside-dev-admin-session-secret` (replicación automática; etiquetas `environment=dev`, `purpose=admin-session-signing`) con **versión 1 habilitada**, 48 bytes aleatorios generados y subidos por tubería (no se leyeron ni se imprimieron).
- `roles/secretmanager.secretAccessor` concedido a `640247497574-compute@developer.gserviceaccount.com` **solo** sobre `beeside-dev-sso-client-secret` y `beeside-dev-admin-session-secret` (verificado con `verify`: un único miembro en cada uno).
- El servicio `beeside-dev-backend-api` **no cambió** (revisión `beeside-dev-backend-api-00007-gtk`); no se tocó ninguna base, ni KL, ni el Admin API sigue deshabilitado.

**Pendiente del Owner (no lo hace KL):** (1) crear el cliente OAuth en la consola (§8.1) y compartir **solo el ID de cliente**; (2) `S1_CONFIRM=yes bash scripts/kl/g2/s1-idp-secrets.sh client-secret` en su terminal (el secreto se teclea oculto) y `bash scripts/kl/g2/s1-idp-secrets.sh verify`, que debe mostrar la versión 1 del secreto SSO habilitada. Hasta entonces `beeside-dev-sso-client-secret` sigue sin versión y S2 no puede ejecutarse.
