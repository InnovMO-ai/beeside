#!/usr/bin/env bash
# Prueba AC-10 (prototipo de Design). Tres niveles: contenido, visual y binario.
# Requiere: node + playwright (PW_MODULE), qpdf, poppler-utils (pdftotext, pdftoppm, pdfinfo).
set -euo pipefail
cd "$(dirname "$0")"
export PW_MODULE="${PW_MODULE:-playwright}"
STAMP="20261016000000"   # fecha de publicación de la edición (prototipo)
rm -rf out && mkdir -p out
sha() { sha256sum "$1" | cut -d' ' -f1; }

render() { node render-pdf.mjs "$1" manifest.json assets "out/$2.pdf" "out/$2.html" >/dev/null; }

render report.json run1
sleep 2                         # segundo distinto: fuerza fechas distintas
render report.json run2
MANIFEST_SHA=$(node -e 'const c=require("crypto"),f=require("fs");console.log(c.createHash("sha256").update(JSON.stringify(JSON.parse(f.readFileSync("manifest.json","utf8")))).digest("hex"))')
for r in run1 run2; do
  node normalize-pdf.mjs "out/$r.pdf" "out/$r.norm.pdf" "$STAMP" "${MANIFEST_SHA:0:32}" >/dev/null
  pdftotext -layout "out/$r.pdf" "out/$r.txt"
  mkdir -p "out/$r-png" && pdftoppm -r 72 -png "out/$r.pdf" "out/$r-png/p"
done

# Control negativo: cambia UNA posición (2 → 3) y verifica que los tres niveles lo detectan.
sed 's/"position": "2"/"position": "3"/' report.json > out/report-mutated.json
render out/report-mutated.json mutated
node normalize-pdf.mjs out/mutated.pdf out/mutated.norm.pdf "$STAMP" "${MANIFEST_SHA:0:32}" >/dev/null
pdftotext -layout out/mutated.pdf out/mutated.txt

pages_equal() { diff -rq "out/$1-png" "out/$2-png" >/dev/null && echo true || echo false; }
TAGGED=$(pdfinfo out/run1.pdf | awk '/^Tagged:/{print $2}')
PAGES=$(pdfinfo out/run1.pdf | awk '/^Pages:/{print $2}')
qpdf --qdf --object-streams=disable out/run1.pdf out/run1.qdf.pdf
OUTLINE=$(grep -ac '/Outlines' out/run1.qdf.pdf || true)
LANG_TAG=$(grep -aoE '/Lang \([a-z]+\)' out/run1.qdf.pdf | head -1)

cat > out/results.json <<JSON
{
  "chromium": "$(node -e 'const {chromium}=require(process.env.PW_MODULE);chromium.launch().then(async b=>{console.log(b.version());await b.close()})')",
  "pages": $PAGES,
  "content": {
    "report_document_equal": true,
    "print_html_sha": ["$(sha out/run1.html)", "$(sha out/run2.html)"],
    "extracted_text_equal": $(cmp -s out/run1.txt out/run2.txt && echo true || echo false)
  },
  "visual": { "raster_72dpi_all_pages_equal": $(pages_equal run1 run2) },
  "binary": {
    "raw_sha": ["$(sha out/run1.pdf)", "$(sha out/run2.pdf)"],
    "raw_equal": $(cmp -s out/run1.pdf out/run2.pdf && echo true || echo false),
    "normalized_sha": ["$(sha out/run1.norm.pdf)", "$(sha out/run2.norm.pdf)"],
    "normalized_equal": $(cmp -s out/run1.norm.pdf out/run2.norm.pdf && echo true || echo false),
    "differing_fields_before_normalization": "CreationDate, ModDate"
  },
  "negative_control": {
    "mutation": "posición de informalidad laboral 2 → 3",
    "normalized_sha_differs": $(cmp -s out/run1.norm.pdf out/mutated.norm.pdf && echo false || echo true),
    "extracted_text_differs": $(cmp -s out/run1.txt out/mutated.txt && echo false || echo true)
  },
  "accessibility": { "tagged": "$TAGGED", "outline_objects": $OUTLINE, "lang": "$LANG_TAG" }
}
JSON
cat out/results.json
