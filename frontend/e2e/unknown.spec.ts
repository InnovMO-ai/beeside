import { expect, test } from "@playwright/test";
import { axeViolations, noHorizontalOverflow } from "./helpers";
import { expectNoRawOrInternal, walkUnknown } from "./walk";

/** Route «No lo sé» (Product Handoff §7): VT-02 (presence "not sure" is never a decision) and VT-03 (no empty thematic screen). */
for (const loc of ["es", "en"] as const) {
  test(`Ruta «No lo sé» (${loc}): one thematic screen, no «Sin espacio propio», presence goes to «Todavía abierto»`, async ({ page }, info) => {
    await walkUnknown(page, loc);
    const result = page.getByTestId("result-screen");
    await expect(result).toBeVisible({ timeout: 20_000 });
    const text = await result.innerText();
    expect(text).not.toMatch(/Sin espacio propio|No premises of your own|No abrirás oficina|You won't open an office/);          // VT-02
    expect(text).toContain(loc === "es" ? "Cómo estarás presente en México" : "How you will be present in Mexico");                 // → Still open
    expect(text).toContain(loc === "es" ? "Duración de la presencia" : "Length of the presence");
    expect(text).not.toMatch(/Presupuesto|Budget/);
    await expectNoRawOrInternal(page);
    await noHorizontalOverflow(page);
    expect(await axeViolations(page)).toEqual([]);
    await page.screenshot({ path: `test-results/shots/unknown-${loc}-${info.project.name}.png`, fullPage: true });
  });
}
