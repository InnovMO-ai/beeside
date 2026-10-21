#!/usr/bin/env bash
# Exige que el CI real de KL haya TERMINADO EN SUCCESS para el commit del PR: los jobs kl-tests y kl-images del workflow .github/workflows/kl-ci.yml.
# Un job omitido (skipped), cancelado, ausente o de otro workflow NO cuenta. Evita que un PR pase "omitiendo o desactivando un check".
# Entorno: REPO, HEAD_SHA, GH_TOKEN; opcional KL_CI_TIMEOUT (s, por omisión 2400) y KL_CI_POLL (s, 20). En pruebas: KL_API_DIR.
set -u
: "${REPO:?}" "${HEAD_SHA:?}"
TIMEOUT="${KL_CI_TIMEOUT:-2400}"; POLL="${KL_CI_POLL:-20}"; REQ="kl-tests kl-images"; WF=".github/workflows/kl-ci.yml"
api() { if [ -n "${KL_API_DIR:-}" ]; then cat "$KL_API_DIR/$(printf '%s' "$1" | tr '/?&=' '____').json" 2>/dev/null; else gh api "$1" 2>/dev/null; fi; }
t0=$(date +%s)
while :; do
  RUNS="$(api "repos/$REPO/actions/runs?head_sha=$HEAD_SHA&per_page=100")" || RUNS=""
  RID="$(printf '%s' "${RUNS:-{\}}" | python3 -I -c '
import json,sys
d=json.load(sys.stdin); wf=sys.argv[1]
c=[r for r in d.get("workflow_runs",[]) if r.get("path")==wf and r.get("event") in ("pull_request","push")]
c.sort(key=lambda r:(r.get("created_at",""),r.get("run_attempt",1)))
print(c[-1]["id"] if c else "")' "$WF" 2>/dev/null)"
  if [ -n "$RID" ]; then
    JOBS="$(api "repos/$REPO/actions/runs/$RID/jobs?per_page=100")" || JOBS=""
    V="$(printf '%s' "${JOBS:-{\}}" | python3 -I -c '
import json,sys
d=json.load(sys.stdin); req=sys.argv[1].split()
by={j["name"]:j for j in d.get("jobs",[])}
bad=[];wait=[]
for n in req:
    j=by.get(n)
    if j is None: bad.append(n+": ausente"); continue
    if j.get("status")!="completed": wait.append(n); continue
    if j.get("conclusion")!="success": bad.append("%s: %s"%(n,j.get("conclusion")))
print("FAIL "+"; ".join(bad) if bad else ("WAIT "+",".join(wait) if wait else "PASS"))' "$REQ" 2>/dev/null)"
    case "$V" in
      PASS) echo "OK       KL CI terminó en success para ${HEAD_SHA:0:12}: $REQ (run $RID)"; exit 0 ;;
      FAIL*) echo "STOP     KL CI no es válido para ${HEAD_SHA:0:12}: ${V#FAIL }"; exit 1 ;;
    esac
  fi
  [ $(( $(date +%s) - t0 )) -ge "$TIMEOUT" ] && { echo "STOP     KL CI no apareció o no terminó en ${TIMEOUT}s para ${HEAD_SHA:0:12} (un check omitido o desactivado no cuenta)"; exit 1; }
  sleep "$POLL"
done
