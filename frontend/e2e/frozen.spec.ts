import { expect, test } from '@playwright/test';
import { journeyA, journeyB } from '@beeside/fa-public-engine/testing';
import { noHorizontalOverflow, open, seed, touchTargetsOk } from './helpers';

/** VERIFY M6: frozen Design alignment at the two reference viewports (375 / 1440). Screenshots are kept for the PR review. */
const shot = (page: import('@playwright/test').Page, name: string, project: string) => page.screenshot({ path: `../docs/fa4/visual/${name}-${project}.png`, fullPage: true });

test('R1: lavender band, headline sentence, white per-destination cards with editable fragments', async ({ page, request }, info) => {
  const token = await seed(request, journeyB('es', 'unknown'), 'reflection');
  await open(page, token);
  await expect(page.locator('.shell.tinted')).toBeVisible();
  await expect(page.locator('.r1-lead')).toContainText('Tu empresa se dedica a');
  expect(await page.locator('.r1-card').count()).toBeGreaterThanOrEqual(2);   // one white card per component/destination
  await expect(page.locator('.r1-card').first()).toContainText('En México');
  expect(await page.locator('.r1 button.frag').count()).toBeGreaterThan(4);
  await expect(page.getByText('¿Ya sabes lo que necesitas?')).toBeVisible();
  await noHorizontalOverflow(page); await touchTargetsOk(page);
  await shot(page, 'R1', info.project.name);
});

test('Fronts: desktop shows ONE combined table (status + support + critical date); mobile keeps separate lighter steps', async ({ page, request }, info) => {
  const token = await seed(request, journeyB('es', 'unknown'), 'fronts_status');
  await open(page, token);
  await expect(page.getByRole('heading', { name: 'Esto es lo que toca tu proyecto' })).toBeVisible();
  const table = page.locator('.ftable');
  if (info.project.name === 'desktop-1440') {
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
    await expect(page.getByRole('heading', { name: /apoyo/i }).first()).toBeVisible();
  }
});

test('Journey A result: "De un vistazo" shows one chip row per topic and the count of topics that do not apply', async ({ page, request }, info) => {
  const token = await seed(request, journeyA(), 'extra');
  await open(page, token);
  await page.getByRole('button', { name: /Ver mi resultado|Ver resultado/i }).click();
  await expect(page.locator('.glance .topic-row').first()).toBeVisible();
  expect(await page.locator('.glance .topic-row').count()).toBe(4);
  await expect(page.locator('.glance')).toContainText('Otros 5 temas no aplican a tu proyecto. El detalle, abajo.');
  await noHorizontalOverflow(page);
  await shot(page, 'resultA', info.project.name);
});
