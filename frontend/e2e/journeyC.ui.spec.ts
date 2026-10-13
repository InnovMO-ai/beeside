import { expect, test } from '@playwright/test';
import { emptyAnswers } from '@beeside/fa-public-engine';
import { journeyC } from '@beeside/fa-public-engine/testing';
import { axeViolations, noHorizontalOverflow, open, seed } from './helpers';

/** Journey C through the UI: "I already know what I need" shortcut → NOT INDICATED semantics preserved (D-079). */
test('Journey C — shortcut: mark what you need; unmarked stays NOT INDICATED', async ({ page, request }) => {
  const c = journeyC();
  const a = { ...c, knowsNeeds: null, projectConfirmed: false, reasons: [], reasonText: '', decision: null, startWhen: null, externalDate: { has: null }, regulated: null,
    fronts: {}, addedNeeds: [], scale: {}, supportWords: '', keepWords: '', context: emptyAnswers().context, cargoRoute: {},
    components: c.components.map((x) => ({ ...x, location: null, carries: [] })) };
  const token = await seed(request, a, 'reflection');
  await open(page, token);

  // the saved step_key 'reflection' belongs to a screen that no longer exists → the user lands on the LAST project screen (compat map)
  await expect(page.getByTestId('clarity-question')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('esto es lo que entendemos');
  await page.getByTestId('clarity-question').getByRole('radio', { name: 'Sí', exact: true }).check();   // YES → the «mark the topics» shortcut (D-079)
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await page.getByLabel('Ejecutar un contrato ganado').check();
  await page.getByLabel(/Escríbelo con tus palabras/).fill('ganamos un contrato');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Ya está en marcha').check();
  await page.getByRole('radio', { name: 'Cuanto antes' }).click();
  await page.getByRole('radio', { name: 'Sí', exact: true }).click();
  await page.getByRole('combobox', { name: 'Mes' }).selectOption('12');
  await page.getByRole('combobox', { name: 'Año' }).selectOption('2026');
  await page.getByLabel('¿Qué ocurre ese día?').fill('Movilización');
  await page.getByRole('button', { name: 'Continuar' }).click();

  // no "scale" step in the shortcut; activators split in two thematic steps, BEFORE the list
  // VT-03: regulation is the only sell-side question → one neutral screen titled by the question itself
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('¿Tu producto o actividad está sujeto a alguna regulación específica?');
  await page.getByLabel('No lo sé', { exact: true }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Sobre tu operación en México' })).toBeVisible();
  await expect(page.getByText('¿Ya sabes dónde estará la obra?')).toBeVisible();      // frozen Journey C wording
  await page.getByLabel('Aún no', { exact: true }).check();
  await page.getByLabel('Personas de tu equipo').check();
  await page.getByLabel('Maquinaria, herramientas o equipos').check();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // mark what you need + add in your own words (keyword mapping, no AI)
  await expect(page.getByRole('heading', { name: 'Marca los temas en los que necesitas apoyo' })).toBeVisible();
  const add = async (text: string) => { await page.getByLabel('¿Buscas algo concreto? Escríbelo').fill(text); await page.getByRole('button', { name: 'Añadir' }).click(); };
  await add('grúas de gran capacidad');
  await expect(page.getByText('Lo relacionamos con')).toBeVisible();
  await expect(page.getByText('Encontrar y validar proveedores').first()).toBeVisible();
  await add('transporte especializado (sobredimensionado, rutas, permisos)');
  // I-26 cargo route: a BLOCK at the start of this screen — it appears once oversized cargo is relevant (the need just added) and no route was declared
  const cargo = page.getByTestId('topics-cargo');
  await expect(cargo.getByRole('heading', { name: '¿Dónde necesitas mover la carga?' })).toBeVisible();
  await expect(cargo.getByLabel('Dentro de México')).toBeVisible(); await expect(cargo.getByLabel('Hacia México desde otro país')).toBeVisible();
  await cargo.getByLabel('Aún no lo sé', { exact: true }).check();
  await add('alojamiento');
  for (const t of ['Estructura legal, impuestos y contabilidad', 'Encontrar a las personas', 'Contratar legalmente y pagar nómina', 'Tu equipo que viaja o se traslada', 'Seguros'])
    await page.locator('label.choice', { hasText: t }).first().locator('input').check();
  await expect(page.getByRole('status').filter({ hasText: 'Marcados 8' })).toContainText('No indicado 4');
  await expect(page.getByText(/Posible/).first()).toBeVisible();                              // regulatory "not sure" is shown as possible, not asked
  await page.getByRole('button', { name: 'Continuar' }).click();

  // critical dates (calendar declared): 4 topics
  for (const t of ['Encontrar a las personas', 'Tu equipo que viaja o se traslada', 'Logística e inventario', 'Encontrar y validar proveedores'])
    await page.locator('label.choice', { hasText: t }).first().locator('input').check();
  await page.getByRole('button', { name: 'Continuar' }).click();

  await page.getByRole('button', { name: 'Continuar' }).click();                              // support values (skippable)
  await page.getByRole('button', { name: 'Ver mi resultado' }).click();

  const result = page.getByTestId('result-screen');
  await expect(result).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('México');
  const glance = result.locator('.res-hero');
  await expect(glance).toContainText('Marcados');
  await expect(result.getByText('Doce temas aplican a tu proyecto. Marcaste ocho.')).toBeVisible();
  await expect(result.locator('.vgroup').filter({ hasText: 'beeside puede ayudarte' })).toContainText('3');
  await expect(result.getByText('«grúas de gran capacidad»')).toBeVisible();                   // the user's vocabulary is preserved
  await expect(result.getByText('No indicado no significa resuelto', { exact: false }).or(result.getByText(/«No indicado» no significa resuelto/))).toBeVisible();
  await noHorizontalOverflow(page);
  expect(await axeViolations(page)).toEqual([]);
});
