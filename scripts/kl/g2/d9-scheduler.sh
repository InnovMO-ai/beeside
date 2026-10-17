#!/usr/bin/env bash
# D9 · Cloud Scheduler para KL en dev: habilita la API y crea (EN PAUSA) dos schedules: el tick del kl-worker (cada 5 min) y la exportación diaria de
# beeside_kl. Todo por el módulo Terraform propio de KL (infra/terraform/envs/dev-kl); no toca recursos de otras plataformas.
#   bash scripts/kl/g2/d9-scheduler.sh plan                      solo lectura: el plan debe ser EXACTAMENTE 6 altas, 0 cambios, 0 destrucciones
#   D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh apply      habilita la API y crea los schedules PAUSADOS (aborta si el plan no es el esperado)
#   bash scripts/kl/g2/d9-scheduler.sh verify                    solo lectura: estado de los schedules, rol e IAM, y plan sin deriva
#   D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh resume     reanuda el tick del worker (cada 5 min). El de exportación se reanuda con: resume export
#   D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh pause      pausa ambos (o uno: pause worker|export)
#   D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh run-now worker|export   ejecución forzada de un schedule (si la API lo rechaza estando en pausa, usar resume)
#   D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh rollback   destruye los 6 recursos de D9 (la API queda habilitada: disable_on_destroy=false)
set -euo pipefail
P="${KL_PROJECT:-beeside-dev-508220}"; LOC="${KL_SCHEDULER_LOCATION:-us-south1}"; TF=infra/terraform/envs/dev-kl
cd "$(git rev-parse --show-toplevel)"
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
tf() { (cd "$TF" && terraform "$@"); }
cleanup() { rm -rf "$TF/.terraform" "$TF/.terraform.lock.hcl" /tmp/d9.tfplan; }; trap cleanup EXIT
init() { tf init -input=false -no-color >/dev/null; }
need() { [[ "${D9_CONFIRM:-}" == "yes" ]] || { echo "STOP: este subcomando cambia recursos; repite con D9_CONFIRM=yes" >&2; exit 2; }; }
job() { case "${1:-}" in worker) echo beeside-dev-kl-worker-tick;; export) echo beeside-dev-kl-daily-export;; *) echo "";; esac; }
FLAGS=(-var scheduler_enabled=true -var scheduler_paused=true)

case "${1:-}" in
  plan)
    init; tf plan -input=false -no-color "${FLAGS[@]}" | grep -E "will be|^Plan:|Error" | sed 's/^ *# //' ;;
  apply)
    need; init
    out="$(tf plan -input=false -no-color -out=/tmp/d9.tfplan "${FLAGS[@]}" | grep -E '^Plan:')"; echo "$out"
    [[ "$out" == "Plan: 6 to add, 0 to change, 0 to destroy." ]] || { echo "STOP: el plan no es el esperado (6/0/0); no se aplica nada" >&2; exit 1; }
    tf apply -input=false -no-color /tmp/d9.tfplan | grep -E "Apply complete|Error"
    "$0" verify ;;
  verify)
    echo "== schedules ($LOC)"; gcloud scheduler jobs list --location "$LOC" --project "$P" --format="table(name.basename(),schedule,state,httpTarget.uri.basename())"
    echo "== rol personalizado"; gcloud iam roles describe klExportOnlyDev --project "$P" --format="value(name,includedPermissions)" 2>&1 | head -2
    echo "== deriva de Terraform (con D9 activo)"; init; set +e; tf plan -input=false -no-color -detailed-exitcode "${FLAGS[@]}" >/dev/null 2>&1; echo "plan exit=$? (0 = sin deriva)"; set -e ;;
  resume|pause)
    need; sel="${2:-}"; names=(); if [[ -z "$sel" ]]; then names=(worker export); else names=("$sel"); fi
    for n in "${names[@]}"; do j="$(job "$n")"; [[ -n "$j" ]] || { echo "uso: $0 $1 [worker|export]" >&2; exit 2; }; gcloud scheduler jobs "$1" "$j" --location "$LOC" --project "$P"; done
    "$0" verify ;;
  run-now)
    need; j="$(job "${2:-}")"; [[ -n "$j" ]] || { echo "uso: $0 run-now worker|export" >&2; exit 2; }
    st="$(gcloud scheduler jobs describe "$j" --location "$LOC" --project "$P" --format='value(state)')"
    [[ "$st" == "ENABLED" ]] || { echo "STOP: $j está en $st. La API de Cloud Scheduler solo permite ejecutar (RunJob) un schedule ENABLED, de modo que probarlo exige reanudarlo (resume): decisión del PO" >&2; exit 3; }
    gcloud scheduler jobs run "$j" --location "$LOC" --project "$P"; echo "disparado; revisa el resultado en Cloud Run (executions) o en el bucket de exportaciones" ;;
  rollback)
    need; init; tf destroy -input=false -no-color -auto-approve "${FLAGS[@]}" -target=module.kl_runtime.google_cloud_scheduler_job.worker_tick -target=module.kl_runtime.google_cloud_scheduler_job.daily_export -target=module.kl_runtime.google_project_iam_member.scheduler_export -target=module.kl_runtime.google_project_iam_custom_role.kl_export -target=module.kl_runtime.google_cloud_run_v2_job_iam_member.scheduler_runs_worker | grep -E "Destroy complete|Error" ;;
  *) echo "uso: $0 plan|apply|verify|resume|pause|run-now|rollback" >&2; exit 2 ;;
esac
