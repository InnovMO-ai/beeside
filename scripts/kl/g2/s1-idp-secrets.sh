#!/usr/bin/env bash
# S1 · Secretos e IAM para el Admin API / IdP de dev (opción A: Google Workspace). G2_FASE6B_ADMIN_API_E_IDP_DEV.md §4.
# Lo ejecuta el OWNER del proyecto. Ningún valor secreto se imprime, se pasa por argumentos ni se escribe a disco: el secreto de sesión se
# genera y se sube por tubería; el secreto del cliente OAuth se pide de forma OCULTA en el terminal del Owner (nunca por chat).
#   bash scripts/kl/g2/s1-idp-secrets.sh plan             solo lectura: estado actual y qué haría cada subcomando
#   bash scripts/kl/g2/s1-idp-secrets.sh session          crea beeside-dev-admin-session-secret (aleatorio, 48 bytes) si no existe y le agrega una versión
#   bash scripts/kl/g2/s1-idp-secrets.sh client-secret    pide el client secret OAuth (oculto) y lo agrega como versión de beeside-dev-sso-client-secret
#   bash scripts/kl/g2/s1-idp-secrets.sh iam              concede secretAccessor a la cuenta del backend SOLO sobre esos dos secretos
#   bash scripts/kl/g2/s1-idp-secrets.sh verify           solo lectura: versiones habilitadas y miembros de IAM (nunca lee el contenido)
# Los subcomandos que escriben exigen S1_CONFIRM=yes. Idempotente: repetirlo no duplica nada (cada ejecución de session/client-secret SÍ agrega una versión nueva).
set -euo pipefail
P="${KL_PROJECT:-beeside-dev-508220}"; R="${KL_REGION:-northamerica-south1}"
SSO=beeside-dev-sso-client-secret; SESSION=beeside-dev-admin-session-secret
BACKEND_SA="$(gcloud run services describe beeside-dev-backend-api --region "$R" --project "$P" --format='value(spec.template.spec.serviceAccountName)')"
[[ -n "$BACKEND_SA" ]] || { echo "no se pudo leer la cuenta de servicio del backend" >&2; exit 1; }
need_confirm() { [[ "${S1_CONFIRM:-}" == "yes" ]] || { echo "STOP: este subcomando escribe en Secret Manager/IAM; repite con S1_CONFIRM=yes" >&2; exit 2; }; }
exists() { gcloud secrets describe "$1" --project "$P" >/dev/null 2>&1; }

case "${1:-}" in
  plan)
    echo "cuenta activa: $(gcloud config get-value account 2>/dev/null) · proyecto: $P · cuenta del backend: $BACKEND_SA"
    for s in "$SSO" "$SESSION"; do
      if exists "$s"; then echo "- $s: existe; versiones: $(gcloud secrets versions list "$s" --project "$P" --format='value(name,state)' | tr '\n' ' ' || true)"; else echo "- $s: NO existe"; fi
    done
    echo "haría: session → crear $SESSION + 1 versión aleatoria · client-secret → 1 versión de $SSO (valor tecleado por el Owner) · iam → secretAccessor de $BACKEND_SA en ambos"
    ;;
  session)
    need_confirm
    exists "$SESSION" || gcloud secrets create "$SESSION" --project "$P" --replication-policy=automatic --labels=environment=dev,purpose=admin-session-signing
    openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add "$SESSION" --project "$P" --data-file=-
    ;;
  client-secret)
    need_confirm
    [[ -t 0 ]] || { echo "STOP: ejecútalo en un terminal interactivo (el valor se pide oculto)" >&2; exit 2; }
    exists "$SSO" || { echo "STOP: $SSO no existe" >&2; exit 1; }
    read -r -s -p "Client secret OAuth de Google (no se muestra): " CS; echo
    [[ ${#CS} -ge 20 ]] || { echo "STOP: valor demasiado corto; no se escribió nada" >&2; exit 1; }
    printf '%s' "$CS" | gcloud secrets versions add "$SSO" --project "$P" --data-file=-
    unset CS
    ;;
  iam)
    need_confirm
    for s in "$SSO" "$SESSION"; do
      exists "$s" || { echo "STOP: $s no existe todavía" >&2; exit 1; }
      gcloud secrets add-iam-policy-binding "$s" --project "$P" --member "serviceAccount:$BACKEND_SA" --role roles/secretmanager.secretAccessor --condition=None >/dev/null
      echo "secretAccessor concedido a $BACKEND_SA sobre $s"
    done
    ;;
  verify)
    for s in "$SSO" "$SESSION"; do
      echo "== $s"; gcloud secrets versions list "$s" --project "$P" --format='table(name,state,createTime.date())'
      gcloud secrets get-iam-policy "$s" --project "$P" --format='value(bindings.members)'
    done
    ;;
  *) echo "uso: $0 plan|session|client-secret|iam|verify" >&2; exit 2 ;;
esac
