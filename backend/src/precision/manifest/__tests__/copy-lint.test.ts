import fs from "node:fs";
import path from "node:path";
import { lintCopy, lintFixedCopy, parseFixedCopy } from "../copy-lint";

const VOICE = process.env.VOICE_PACK || path.resolve(__dirname, "../../../../../docs/f5/source/voice-pack.md");

describe("copy-lint (voice pack R1, R2, R3, R4, R7, glossary)", () => {
  it("detects each rule class", () => {
    expect(lintCopy("x", "Usted debería contratar un agente.").some((f) => f.rule === "R1")).toBe(true);
    expect(lintCopy("x", "¡Genial! Cuéntame todo 😊").some((f) => f.rule === "R2")).toBe(true);
    expect(lintCopy("x", "¿Cuál es tu volumen? ¿Y tu frecuencia?").some((f) => f.rule === "R3")).toBe(true);
    expect(lintCopy("x", Array(40).fill("palabra").join(" ") + ".").some((f) => f.rule === "R4")).toBe(true);
    expect(lintCopy("x", "Tu proyecto está listo para cotizar.").some((f) => f.rule === "R7")).toBe(true);
    expect(lintCopy("x", "Eso no lo tenemos: no tenemos ese servicio.").some((f) => f.rule === "R7")).toBe(true);
    expect(lintCopy("add_service_cta", "+ Agregar una categoría").some((f) => f.rule === "G")).toBe(true);
  });
  it("accepts the approved examples and the approved state label", () => {
    for (const t of [
      "Gracias. Para armar tu mapa de servicios necesito entender primero qué quieres lograr en el destino.",
      "¿Cuántos envíos esperas hacer al mes durante el primer año?",
      "Tienes definidos los datos esenciales de esta categoría. Falta confirmar el alcance de almacenaje.",
      "Datos validados",
    ])
      expect(lintCopy("ok", t)).toEqual([]);
  });
  it("fixed-copy inventory parses (>= 40 items)", () => {
    const rows = parseFixedCopy(fs.readFileSync(VOICE, "utf8"));
    const items = rows.reduce((a, r) => a + r.texts.length, 0);
    expect(items).toBeGreaterThanOrEqual(40);
  });
  it("ALL fixed copy passes the automatic checks", () => {
    const { items, findings } = lintFixedCopy(fs.readFileSync(VOICE, "utf8"));
    expect(items).toBeGreaterThan(0);
    expect(findings).toEqual([]);
  });
});
