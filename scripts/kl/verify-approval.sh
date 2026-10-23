#!/usr/bin/env bash
# Verifica con la API de GitHub (no con archivos de la rama) que el PR tiene una revisión APPROVED del PO sobre el commit exacto.
# Entorno: REPO, PR, HEAD_SHA, AUTHOR, APPROVERS_FILE (de la referencia protegida), GH_TOKEN. En pruebas: KL_API_DIR con respuestas JSON.
# Salida (stdout): SIEMPRE una sola palabra, "verified" o "missing". Cualquier error, variable ausente, respuesta vacía o ilegible, falta de python3 o de
# la lista de aprobadores => "missing" (falla cerrado). El motivo va a stderr. Termina siempre con 0: decide el preflight.
set -u
api() { if [ -n "${KL_API_DIR:-}" ]; then cat "$KL_API_DIR/$(printf '%s' "$1" | tr '/?&=' '____').json" 2>/dev/null; else gh api --paginate "$1" 2>/dev/null; fi; }
decide() {
  for v in REPO PR HEAD_SHA AUTHOR APPROVERS_FILE; do [ -n "${!v:-}" ] || { echo "falta $v" >&2; return 1; }; done
  [ -f "$APPROVERS_FILE" ] || { echo "sin lista de aprobadores ($APPROVERS_FILE)" >&2; return 1; }
  command -v python3 >/dev/null 2>&1 || { echo "falta python3" >&2; return 1; }
  local json; json="$(api "repos/$REPO/pulls/$PR/reviews?per_page=100")" || return 1
  [ -n "$json" ] || { echo "no se pudieron leer las revisiones del PR" >&2; return 1; }
  # D1: tampoco cuenta quien haya escrito o reescrito commits del PR (autor/committer). Commit sin cuenta asociada, más de 249 commits o lista
  # ilegible => missing. Quién hizo el último push NO aparece en esta API: eso lo garantiza require_last_push_approval del ruleset.
  local cj; cj="$(api "repos/$REPO/pulls/$PR/commits?per_page=100")" || return 1
  [ -n "$cj" ] || { echo "no se pudieron leer los commits del PR" >&2; return 1; }
  local writers; writers="$(printf '%s' "$cj" | python3 -I -c '
import json,sys
raw=sys.stdin.read().strip(); dec=json.JSONDecoder(); i=0; out=set(); n=0
while i<len(raw):
    while i<len(raw) and raw[i].isspace(): i+=1
    if i>=len(raw): break
    o,i=dec.raw_decode(raw,i)
    if not isinstance(o,list): raise ValueError("commits no es una lista")
    for c in o:
        n+=1
        for k in ("author","committer"):
            u=(c.get(k) or {}).get("login")
            if not u: raise ValueError("commit sin cuenta de GitHub asociada: no se puede saber quién lo escribió")
            out.add(u.lower())
if n==0: raise ValueError("PR sin commits")
if n>=250: raise ValueError("la API lista como máximo 250 commits por PR: lista posiblemente incompleta")
print(" ".join(sorted(out)))')" || { echo "commits del PR ilegibles" >&2; return 1; }
  printf '%s' "$json" | WRITERS="$writers" python3 -I -c '
import json,sys
approvers={l.strip().lower() for l in open(sys.argv[1]) if l.strip() and not l.lstrip().startswith("#")}
sha,author=sys.argv[2],sys.argv[3].lower()
raw=sys.stdin.read().strip()
dec=json.JSONDecoder(); data=[]; i=0
while i<len(raw):
    while i<len(raw) and raw[i].isspace(): i+=1
    if i>=len(raw): break
    o,i=dec.raw_decode(raw,i); data+= o if isinstance(o,list) else [o]
last={}
for r in sorted((r for r in data if isinstance(r,dict)),key=lambda r:r.get("submitted_at") or ""):
    u=(r.get("user") or {}).get("login","").lower()
    if r.get("state") in ("APPROVED","CHANGES_REQUESTED","DISMISSED"): last[u]=r
import os
writers=set(os.environ.get("WRITERS","").split())
ok=[u for u,r in last.items() if r["state"]=="APPROVED" and r.get("commit_id")==sha and u in approvers and u!=author and u not in writers]
sys.exit(0 if ok else 1)
' "$APPROVERS_FILE" "$HEAD_SHA" "$AUTHOR"
}
if decide >/dev/null 2>"${KL_APPROVAL_LOG:-/dev/null}"; then echo verified; else echo missing; fi
exit 0
