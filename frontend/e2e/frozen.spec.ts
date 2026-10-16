import { expect, test } from '@playwright/test';
import { journeyA, journeyB } from '@beeside/fa-public-engine/testing';
import { noHorizontalOverflow, open, seed, touchTargetsOk } from './helpers';

/** VERIFY M6: frozen Design alignment at the reference viewports (375 / 768 / 1024 / 1440). Screenshots are kept for the PR review. */
const shot = (page: import('@playwright/test').Page, name: string, project: string) => page.screenshot({ path: `../docs/fa4/visual/${name}-${project}.png`, fullPage: true });

test('Fronts: desktop shows ONE combined table (status + support + critical date); mobile keeps separate lighter steps', async ({ page, request }, info) => {
  const token = await seed(request, journeyB('es', 'unknown'), 'fronts_status');
  await open(page, token);
  await expect(page.getByRole('heading', { name: 'Estos son los temas de tu proyecto. ¿En qué punto está cada uno?' })).toBeVisible();
  const table = page.locator('.ftable');
  if (['laptop-1024', 'desktop-1440'].includes(info.project.name)) {
    await expect(table.first()).toBeVisible();
    await expect(page.getByText('¿Quieres apoyo aquí?').first()).toBeVisible();
    await expect(page.getByText(/¿Listo antes de/).first()).toBeVisible();
    await shot(page, 'fronts-table', info.project.name);
    await page.getByRole('button', { name: 'Continuar' }).click();
    // support and critical-date steps were answered inside the table, so they are skipped
    await expect(page.getByRole('heading', { name: /apoyo|Algo más|ruta|carga/i }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /¿Dónde quieres apoyo/ })).toHaveCount(0);
  } else {
    await expect(table).toHaveCount(0);
    await shot(page, 'fronts-status', info.project.name);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { name: /apoye/i }).first()).toBeVisible();
  }
});

test('Journey A result: "De un vistazo" shows one chip row per topic and the count of topics that do not apply', async ({ page, request }, info) => {
  const token = await seed(request, journeyA(), 'extra');
  await open(page, token);
  await page.getByRole('button', { name: /Ver mi resultado|Ver resultado/i }).click();
  await expect(page.locator('.glance .topic-row').first()).toBeVisible();
  expect(await page.locator('.glance .topic-row').count()).toBe(4);
  await expect(page.locator('.glance')).toContainText('Otros 4 temas no aplican a tu proyecto. El detalle, abajo.');
  await noHorizontalOverflow(page);
  await shot(page, 'resultA', info.project.name);
});
