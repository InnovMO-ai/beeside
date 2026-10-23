import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lintCopy, lintFixedCopy, parseFixedCopy } from "../validator/copy-lint.mjs";
const VOICE = process.env.VOICE_PACK || new URL("../voice/f2-voice-pack-current.md", import.meta.url).pathname;

test("linter detects each rule class (R1, R2, R3, R4, R7, glossary)", () => {
  assert.ok(lintCopy("x", "Usted debería contratar un agente.").some((f) => f.rule === "R1"));
  assert.ok(lintCopy("x", "¡Genial! Cuéntame todo 😊").some((f) => f.rule === "R2"));
  assert.ok(lintCopy("x", "¿Cuál es tu volumen? ¿Y tu frecuencia?").some((f) => f.rule === "R3"));
  assert.ok(lintCopy("x", Array(40).fill("palabra").join(" ") + ".").some((f) => f.rule === "R4"));
  assert.ok(lintCopy("x", "Tu proyecto está listo para cotizar.").some((f) => f.rule === "R7"));
  assert.ok(lintCopy("x", "Eso no lo tenemos: no tenemos ese servicio.").some((f) => f.rule === "R7"));
  assert.ok(lintCopy("add_service_cta", "+ Agregar una categoría").some((f) => f.rule === "G"));
});
test("linter accepts the approved 'Sí' examples", () => {
  for (const t of ["Gracias. Para armar tu mapa de servicios necesito entender primero qué quieres lograr en el destino.", "¿Cuántos envíos esperas hacer al mes durante el primer año?", "Tienes definidos los datos esenciales de esta categoría. Falta confirmar el alcance de almacenaje."])
    assert.deepEqual(lintCopy("ok", t), [], t);
});
test("fixed-copy inventory parses (≥ 40 items)", () => {
  const rows = parseFixedCopy(fs.readFileSync(VOICE, "utf8")); const items = rows.reduce((a, r) => a + r.texts.length, 0);
  assert.ok(items >= 40, `items=${items}`);
});
test("ALL fixed copy passes R1, R2, R3, R4, R7 and glossary checks (100 % automatic checks, per F2 §4 threshold for fixed copy)", () => {
  const { items, findings } = lintFixedCopy(fs.readFileSync(VOICE, "utf8"));
  assert.deepEqual(findings, [], `${items} items; findings: ${JSON.stringify(findings)}`);
});
