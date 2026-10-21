#!/usr/bin/env bash
# Verifica con la API de GitHub (no con archivos de la rama) que el PR tiene una revisión APPROVED del PO sobre el commit exacto.
# Entorno: REPO, PR, HEAD_SHA, AUTHOR, APPROVERS_FILE (de la referencia protegida), GH_TOKEN. En pruebas: KL_API_DIR con respuestas JSON.
# Salida (stdout): "verified" o "missing"; el motivo va a stderr. Siempre termina con 0: decide el preflight.
set -u
: "${REPO:?}" "${PR:?}" "${HEAD_SHA:?}" "${AUTHOR:?}" "${APPROVERS_FILE:?}"
api() { if [ -n "${KL_API_DIR:-}" ]; then cat "$KL_API_DIR/$(printf '%s' "$1" | tr '/?&=' '____').json" 2>/dev/null; else gh api --paginate "$1" 2>/dev/null; fi; }
[ -f "$APPROVERS_FILE" ] || { echo "sin lista de aprobadores ($APPROVERS_FILE)" >&2; echo missing; exit 0; }
JSON="$(api "repos/$REPO/pulls/$PR/reviews?per_page=100")" || JSON=""
[ -n "$JSON" ] || { echo "no se pudieron leer las revisiones del PR" >&2; echo missing; exit 0; }
printf '%s' "$JSON" | python3 -I -c '
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
for r in sorted(data,key=lambda r:r.get("submitted_at") or ""):
    u=(r.get("user") or {}).get("login","").lower()
    if r.get("state") in ("APPROVED","CHANGES_REQUESTED","DISMISSED"): last[u]=r
ok=[u for u,r in last.items() if r["state"]=="APPROVED" and r.get("commit_id")==sha and u in approvers and u!=author]
if ok: print("verified")
else:
    print("missing"); sys.stderr.write("ninguna revisión APPROVED vigente sobre %s de un aprobador de la lista (aprobadores: %d, autor excluido)\n"%(sha[:12],len(approvers)))
' "$APPROVERS_FILE" "$HEAD_SHA" "$AUTHOR"
exit 0
