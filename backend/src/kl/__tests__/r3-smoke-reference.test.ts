import * as fs from "node:fs";
import * as path from "node:path";
import { launchChromium, BrowserLike } from "../products/render/pdf";
import { renderSmokeOnce, smokeBaselineKey } from "../products/render/smoke";
import { resolveFontFamily } from "../products/render/fonts";
import { describeKl } from "../testing/env";

/**
 * Documento de referencia mínimo (el mismo que usa el humo del contenedor): su huella en el host de CI se registra en
 * `ac10-smoke-baseline.json` y el humo de la imagen `runtime-kl-worker` la compara. Así se sabe si el render dentro del contenedor es el
 * mismo que el del host (misma tipografía incrustada, mismo Chromium) y no solo "determinista consigo mismo".
 */
describeKl("AC-10 · documento de referencia del humo (host)", () => {
  let browser: BrowserLike;
  beforeAll(async () => {
    browser = await launchChromium();
  });
  afterAll(async () => {
    await browser.close();
  });
  const BASELINE = path.join(__dirname, "..", "products", "ac10-smoke-baseline.json");

  it("es repetible y coincide con la línea de referencia de este motor y plataforma (si existe)", async () => {
    expect((await resolveFontFamily(browser, "lato")).family).toBe("lato");
    const a = await renderSmokeOnce(browser);
    const b = await renderSmokeOnce(browser);
    expect(a.header).toBe("%PDF-");
    expect(a.blockedRequests).toEqual([]);
    expect(a.pdfSha256).toBe(b.pdfSha256);
    const key = smokeBaselineKey(browser);
    const baseline = JSON.parse(fs.existsSync(BASELINE) ? fs.readFileSync(BASELINE, "utf8") : "{}") as Record<string, { pdfSha256: string; pages: number }>;
    const current = { pdfSha256: a.pdfSha256, pages: a.pages };
    if (process.env.KL_UPDATE_AC10_BASELINE === "1") {
      fs.writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, [key]: current }, null, 2)}\n`);
      return;
    }
    if (baseline[key]) expect(current).toEqual(baseline[key]);
    else process.stderr.write(`[aviso] sin línea de referencia del documento de humo para ${key}\n`);
  });
});
