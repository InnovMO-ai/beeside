#!/usr/bin/env bash
# Verificación de integridad · KL 1.0 Design congelado (16-oct-2026).
# Uso:
#   bash verify.sh                      # comprueba los 88 archivos versionados contra el manifiesto original
#   bash verify.sh --restore-fonts      # además reconstruye las 8 fuentes excluidas desde git (a8f8f3e) y las verifica
#   bash verify.sh --full <KnowledgeLayer>   # en el Mac: comprueba los 115 archivos del snapshot original y el paquete .tar.gz
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FROZEN="$HERE/../kl-1.0-design-frozen"
MANIFEST="$FROZEN/DESIGN_FREEZE_KL_1.0.sha256"
EXPECTED_MANIFEST_SHA="8901ecfa25db28acde1445399774ab614f9e046fbefb935a86214d17ad5f4afe"
EXPECTED_RECORD_SHA="96c2b7d508636e9922bca167fa63301e59d9181eb5eaab932b910f94598c90ea"   # DESIGN_FREEZE_KL_1.0.md (registro, fuera del manifiesto)
EXPECTED_TARBALL_SHA="2fc9f4d6ab1fa177ded4a38ac521be343f474c73a242afe83d4e5000bce14b2d"
FONT_SOURCE_COMMIT="a8f8f3e"   # origin/feature/precision-v2-f5 (incluye LICENSE-*-OFL.txt junto a las fuentes)
FONT_SOURCE_DIR="frontend/src/precision/assets/fonts"

sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
check() { if command -v sha256sum >/dev/null; then sha256sum -c --quiet "$1"; else shasum -a 256 -c --quiet "$1"; fi; }
fail() { echo "FALLA: $*" >&2; exit 1; }

# 1 · El manifiesto original no cambió
got="$(sha "$MANIFEST" | cut -d' ' -f1)"
[ "$got" = "$EXPECTED_MANIFEST_SHA" ] || fail "manifiesto alterado ($got)"
echo "OK  manifiesto original 115 archivos · $EXPECTED_MANIFEST_SHA"
got="$(sha "$FROZEN/DESIGN_FREEZE_KL_1.0.md" | cut -d' ' -f1)"
[ "$got" = "$EXPECTED_RECORD_SHA" ] || fail "registro de congelamiento alterado ($got)"
echo "OK  registro de congelamiento · $EXPECTED_RECORD_SHA"

# 2 · Incluidos + excluidos = manifiesto, sin líneas inventadas
total=$(wc -l < "$MANIFEST" | tr -d ' ')
inc=$(wc -l < "$HERE/included.sha256" | tr -d ' '); exc=$(wc -l < "$HERE/excluded.sha256" | tr -d ' ')
[ "$total" -eq 115 ] && [ $((inc + exc)) -eq "$total" ] || fail "conteo inconsistente: $inc + $exc ≠ $total"
diff <(LC_ALL=C sort "$MANIFEST") <(LC_ALL=C sort "$HERE/included.sha256" "$HERE/excluded.sha256") >/dev/null || fail "incluidos/excluidos no coinciden con el manifiesto"
echo "OK  partición exacta: $inc versionados + $exc excluidos = $total"

# 3 · Los archivos versionados son byte a byte los congelados
( cd "$FROZEN" && check "$HERE/included.sha256" ) || fail "algún archivo versionado difiere del congelado"
echo "OK  $inc archivos versionados idénticos al snapshot congelado"

# 4 · Ningún archivo extra dentro del directorio congelado
extra=$(cd "$FROZEN" && find . -type f | sed 's#^\./##' | LC_ALL=C sort | comm -23 - <({ awk '{print $2}' "$HERE/included.sha256"; printf 'DESIGN_FREEZE_KL_1.0.md\nDESIGN_FREEZE_KL_1.0.sha256\n'; } | LC_ALL=C sort))
[ -z "$extra" ] || fail "archivos no inventariados en el directorio congelado: $extra"
echo "OK  sin archivos ajenos al inventario"

if [ "${1:-}" = "--restore-fonts" ]; then
  git cat-file -e "$FONT_SOURCE_COMMIT^{commit}" 2>/dev/null || fail "falta el commit $FONT_SOURCE_COMMIT (git fetch origin feature/precision-v2-f5)"
  grep '\.woff2$' "$HERE/excluded.sha256" | while read -r h p; do
    mkdir -p "$FROZEN/$(dirname "$p")"
    git show "$FONT_SOURCE_COMMIT:$FONT_SOURCE_DIR/$(basename "$p")" > "$FROZEN/$p"
    [ "$(sha "$FROZEN/$p" | cut -d' ' -f1)" = "$h" ] || fail "fuente reconstruida distinta: $p"
  done
  echo "OK  8 fuentes OFL reconstruidas desde $FONT_SOURCE_COMMIT y verificadas (licencias en $FONT_SOURCE_DIR/LICENSE-*-OFL.txt)"
  echo "    Nota: las fuentes reconstruidas no se versionan; el paso 4 fallará si se vuelve a correr sin quitarlas."
fi

if [ "${1:-}" = "--full" ]; then
  KL="${2:?ruta a KnowledgeLayer}"
  ( cd "$KL" && check DESIGN_FREEZE_KL_1.0.sha256 ) || fail "el snapshot original del Mac difiere"
  echo "OK  snapshot original del Mac: 115 archivos idénticos"
  t="$KL/KL_1.0_Design_FROZEN_2026-10-16.tar.gz"
  [ "$(sha "$t" | cut -d' ' -f1)" = "$EXPECTED_TARBALL_SHA" ] || fail "paquete de respaldo alterado"
  echo "OK  paquete de respaldo · $EXPECTED_TARBALL_SHA"
fi
echo "VERIFICACIÓN COMPLETA"
