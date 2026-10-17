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

---

## 9. S2 preparado (2026-10-17) · NO ejecutado — dos datos faltan

### Discrepancias detectadas al preparar S2 (solo lectura)
1. **El ID de cliente no llegó:** el mensaje del PO trajo el marcador literal `[PEGAR]`.
2. **`beeside-dev-sso-client-secret` sigue sin ninguna versión.** `gcloud secrets versions list` devuelve 0 elementos (dos lecturas) y el registro de auditoría de Secret Manager (actividad de administración) solo muestra, en las últimas 3 h, `AddSecretVersion` sobre `beeside-dev-admin-session-secret/versions/1` hecho por KL; **no hay ningún `AddSecretVersion` sobre el secreto SSO**. Posibles causas: el subcomando `client-secret` no llegó a completarse (p. ej. se canceló o rechazó por tener menos de 20 caracteres), se ejecutó con otra cuenta/proyecto de `gcloud`, o se ejecutó en otro secreto. Hay que repetirlo en el terminal del Owner y comprobar con `verify`.

### Estado actual relevante del servicio (valores no secretos)
`NODE_ENV=development`, `APP_BASE_URL` = URL del frontend (`https://beeside-dev-frontend-app-amwsj4v5uq-pv.a.run.app`), `ALLOWED_ORIGINS` incluye esa URL y la forma `…-640247497574.northamerica-south1.run.app`, `TRUST_PROXY_HOPS=2` (frontend → backend). El frontend tiene `API_UPSTREAM_URL` apuntando al backend; `GET /admin` → 200 y `GET /api/admin/me` vía frontend → 404 (Admin API apagado). Observación aparte: `SECURITY_HASH_SECRET` está como variable literal, no como referencia a Secret Manager (ajeno a KL; conviene corregirlo en Plataforma).
Nota: el navegador debe usar **una sola** de las dos URLs del frontend; `ADMIN_APP_ORIGIN` y la URI de redireccionamiento registrada en Google deben corresponder a esa misma (aquí se usa la forma `…-amwsj4v5uq-pv.a.run.app`).

### Script de S2: `scripts/kl/g2/s2-enable-admin-api.sh`
```bash
OIDC_CLIENT_ID=<id>.apps.googleusercontent.com bash scripts/kl/g2/s2-enable-admin-api.sh plan      # solo lectura
S2_CONFIRM=yes OIDC_CLIENT_ID=<id>.apps.googleusercontent.com bash scripts/kl/g2/s2-enable-admin-api.sh apply
```
Precondiciones que comprueba y que **hoy fallan en la segunda** (probado): formato del ID de cliente; secreto SSO con una versión habilitada; secreto de sesión habilitado; `secretAccessor` de la cuenta del backend en ambos; `ADMIN_API_ENABLED` aún no definido. `apply` crea **una** revisión de `beeside-dev-backend-api` con la **misma imagen** (`main`, sin KL) añadiendo los dos secretos montados y `ADMIN_API_ENABLED=true`, `ADMIN_APP_ORIGIN`, `ADMIN_OIDC_ISSUER=https://accounts.google.com`, `ADMIN_OIDC_CLIENT_ID`, `ADMIN_OIDC_REDIRECT_URI=<origen>/api/admin/auth/callback`, `ADMIN_ALLOWED_EMAIL_DOMAINS=beeside.you`. Verifica `/health`, `/health/ready`, `/api/admin/me` sin sesión (401/403), y que `/api/admin/auth/login` redirige a Google con el `client_id`, `code_challenge_method=S256` y la `redirect_uri` esperados; **si algo falla, devuelve el 100 % del tráfico a la revisión previa** (`beeside-dev-backend-api-00007-gtk`). Después queda **S3**: el inicio de sesión real lo hace el titular de `mo@beeside.you` en su navegador.

### 9.1 S1 COMPLETO y S2 LISTO PARA APPLY (2026-10-17) · no ejecutado
Verificación independiente de KL (solo metadatos; el contenido de los secretos no se lee): `beeside-dev-sso-client-secret` versión 1 **habilitada** (creada 14:57:46) y `beeside-dev-admin-session-secret` versión 1 **habilitada** (14:13:10); ambos con `secretAccessor` únicamente para `640247497574-compute@developer.gserviceaccount.com`. Cliente OAuth: ID `640247497574-05msqa6kpbh6iense14hb11r78mjjvdh.apps.googleusercontent.com` (no secreto; el prefijo es el número del proyecto DEV).
`OIDC_CLIENT_ID=… bash scripts/kl/g2/s2-enable-admin-api.sh plan` → **todas las precondiciones OK**: revisión actual para rollback `beeside-dev-backend-api-00007-gtk`; emisor `https://accounts.google.com`; origen `https://beeside-dev-frontend-app-amwsj4v5uq-pv.a.run.app`; redirect URI `…/api/admin/auth/callback`; dominios `beeside.you`; `ADMIN_API_ENABLED` aún no definido. El servicio sigue en la revisión 00007. **Comando de ejecución (requiere autorización expresa):**
`S2_CONFIRM=yes OIDC_CLIENT_ID=640247497574-05msqa6kpbh6iense14hb11r78mjjvdh.apps.googleusercontent.com bash scripts/kl/g2/s2-enable-admin-api.sh apply`

### 9.2 S2 EJECUTADO (2026-10-17) · estado: HECHO, detenido antes de S3
`S2_CONFIRM=yes OIDC_CLIENT_ID=640247497574-05msqa6kpbh6iense14hb11r78mjjvdh.apps.googleusercontent.com bash scripts/kl/g2/s2-enable-admin-api.sh apply` (autorizado por el PO). Resultado: **revisión `beeside-dev-backend-api-00008-l7p` sirviendo el 100 % del tráfico**; la revisión previa `00007-gtk` queda disponible para rollback. **Misma imagen** (`backend-api:bc3f52760a5c427c0b057a1e2bb0d71d8d0034d3`, `main`, sin KL). Variables añadidas: `ADMIN_API_ENABLED=true`, `ADMIN_APP_ORIGIN`, `ADMIN_OIDC_ISSUER=https://accounts.google.com`, `ADMIN_OIDC_CLIENT_ID`, `ADMIN_OIDC_REDIRECT_URI=…/api/admin/auth/callback`, `ADMIN_ALLOWED_EMAIL_DOMAINS=beeside.you`; `ADMIN_OIDC_CLIENT_SECRET` y `ADMIN_SESSION_SECRET` montados **por referencia a Secret Manager** (no literales). Verificación del script (sin rollback necesario) y verificación independiente desde el origen del navegador (frontend): `/health` 200; `/admin` 200; `/api/admin/me` sin sesión **401**; `/api/admin/auth/login` → **302** a `accounts.google.com/o/oauth2/v2/auth` con `client_id` correcto, `redirect_uri` exacta, `response_type=code`, `scope=openid email`, `code_challenge_method=S256` y `state`/`nonce`/`code_challenge` presentes; cookie de login `HttpOnly; SameSite=Strict; Secure; Path=/api/admin/auth; Max-Age=600`. Los demás servicios (`frontend-app`, `fa4-*`) no cambiaron de revisión. Los avisos «database privilege check» del arranque son **los mismos que ya tenía la revisión 00007** (el usuario de runtime `beeside_app` es el migrador, puede crear bases y objetos en `public`); no los introduce este cambio.
**Rollback:** `gcloud run services update-traffic beeside-dev-backend-api --region northamerica-south1 --project beeside-dev-508220 --to-revisions beeside-dev-backend-api-00007-gtk=100` (y, si se quiere retirar la configuración, `gcloud run services update … --remove-env-vars ADMIN_API_ENABLED,… --remove-secrets ADMIN_OIDC_CLIENT_SECRET,ADMIN_SESSION_SECRET`).
**Siguiente: S3** — el inicio de sesión real lo hace el titular de `mo@beeside.you` en su navegador; KL solo verifica después (solo lectura) que `auth_subject` quedó enlazado y que existen la sesión y su evento de auditoría.

---

## 10. Diagnóstico de S3 (2026-10-17, ~09:21 CDMX = 15:21 UTC) · causa raíz identificada; corrección PENDIENTE de excepción

**Síntoma:** tras autenticarse en Google, el Control Center muestra «Sign-in could not be completed. Please try again.» (`/admin?login=failed`).

### Evidencia (solo lectura, salvo dos filas de auditoría de diagnóstico, ver abajo)
| Comprobación | Resultado |
|---|---|
| Logs de la revisión `00008-l7p` | `GET /api/admin/auth/login` 302 (15:21:22) → `GET /api/admin/auth/callback?state=…&iss=https://accounts.google.com&code=…` **302** (15:21:32) → `/api/admin/me` 401. Sin errores de aplicación ni de secretos; el servicio arrancó con los dos secretos montados |
| Código de error interno (`admin_audit_event`) | `admin.login · DENIED · {"reason":"invalid_login_state"}` a las 15:21:32.917 |
| Dónde se produce ese motivo | **Antes** de cualquier intercambio con Google: el callback exige la cookie de estado `beeside_admin_login` (sellada con HMAC) y que `state` coincida; si la cookie falta, llega vacía o no se puede abrir, devuelve `invalid_login_state` sin consultar al IdP |
| `redirect_uri` | Correcta: Google devolvió el navegador a `/api/admin/auth/callback` en el origen esperado (con una discordancia habría mostrado `redirect_uri_mismatch` en Google) |
| Secretos | Montados y legibles (el servicio arrancó; las variables `ADMIN_OIDC_CLIENT_SECRET` y `ADMIN_SESSION_SECRET` son referencias a Secret Manager) |
| Estado/nonce/PKCE | El `state` llegó en el callback; el intento de login duró 10 s (la cookie vive 600 s: no es caducidad). El sellado es sin estado en servidor: no depende de qué instancia atienda |
| Vinculación | `mo@beeside.you`: `ADMIN`, `active=true`, `login_enabled=true`, `auth_subject` **sin enlazar**, `admin_session` = 0 filas → el flujo nunca pasó de la validación de estado, por eso no hubo intento de vincular |
| Audience/dominio | Sin evidencia que apunte a ellos: la pantalla de consentimiento de Google se completó y el correo no llegó a evaluarse |
| **Reproducción controlada** | Login por el frontend → callback **con** la cookie y el `state` correctos pero un código falso: llega al intercambio de tokens y falla ahí (`code_rejected`). Mismo callback **sin** la cookie: `invalid_login_state`, idéntico a tu intento |

### Causa raíz
El callback se alcanza mediante una **navegación de nivel superior entre sitios** (accounts.google.com → nuestro origen), y `cookieHeader` emite **todas** las cookies con `SameSite=Strict`, incluida la de estado de inicio de sesión (`backend/src/admin/admin-session.ts`, línea 94). Los navegadores **no envían cookies `Strict`** en una navegación iniciada desde otro sitio, así que el callback nunca ve la cookie → `invalid_login_state`. Es un defecto latente del Control Center de la plataforma (en `main`): no aparecía con el proveedor OIDC de desarrollo local (mismo sitio, `127.0.0.1`) y las pruebas de integración fijan la cookie a mano con supertest, por lo que no lo detectan. **No es un problema del cliente OAuth, de la audiencia, de los secretos ni de la URI.** No se hizo rollback ni se cambió nada de OAuth.

### Corrección propuesta (no aplicada)
Parche mínimo en `docs/knowledge-layer/kl-1.0-code/patches/admin-login-cookie-samesite-lax.patch` (76 líneas; aplica limpio a la rama): `cookieHeader` admite un `sameSite` opcional (por omisión **Strict**, sin cambio para la cookie de sesión); la cookie de estado de login, al emitirse y al limpiarse, usa **`SameSite=Lax`** (el valor estándar para el retorno de OIDC: `HttpOnly`, `Secure`, ruta `/api/admin/auth`, 10 min y sellada con HMAC; la defensa CSRF del callback sigue siendo `state` + sellado + `nonce` + PKCE). Incluye una prueba de regresión (`admin-cookies.test.ts`). Validado en una copia temporal: `tsc` sin errores; `admin-cookies` y `operations-admin` 17/17.

**Excepción que necesita aprobación (no es un cambio de KL):** toca 2 archivos compartidos del Control Center (`backend/src/admin/admin-session.ts`, `admin-router.ts`) y exige **desplegar una imagen nueva** del backend compartido de dev; no hay corrección solo de configuración.
- **Opción X (recomendada para desbloquear dev):** aplicar el parche en `feat/kl-1.0-code` (declararlo en `shared-changes.txt`), publicar `kl-backend:<sha>` con la etiqueta `kl-publish-dev-*` (corre los 19 controles de humo) y actualizar el servicio a esa imagen con las mismas variables de S2. La imagen incluye `main` + KL (inerte: sin `KL_DB_URL_*`) + los 5 archivos compartidos ya aprobados + este parche. Rollback inmediato a `00008-l7p` (imagen `main`). Adelanta el bloqueo B2 del cableado de KL.
- **Opción Y:** proponer el mismo parche como PR a `main` para el responsable de la plataforma y esperar su despliegue normal. Más limpia a largo plazo (el defecto también afectaría a staging/producción), pero no desbloquea dev hoy y un merge dispara `deploy-dev` (`DEPLOY_DEV_ENABLED=true`).
Se recomienda X ahora **y** Y como propuesta a Plataforma.

### Rastro de diagnóstico que dejé en la auditoría de la plataforma (disclosure)
Dos filas `admin.login · DENIED` a las 15:23:45 UTC (`code_rejected` e `invalid_login_state`) generadas por mis llamadas de reproducción con un código falso. No afectan a ninguna sesión ni usuario.

### Cuándo repetir el inicio de sesión
Solo después de que se despliegue la corrección (X o Y) y se verifique; con la imagen actual volvería a fallar igual.
