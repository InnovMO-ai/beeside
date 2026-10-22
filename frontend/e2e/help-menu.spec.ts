import { expect, test } from '@playwright/test';
import { journeyA } from '@beeside/fa-public-engine/testing';
import { noHorizontalOverflow, open, seed } from './helpers';

// DSC-37 / DSC-38 — layout, keyboard and isolation in the real browser (375 / 768 / 1024 / 1440 projects).
test('DSC-37: help trigger is 44px, panel fits the viewport, stays above the Back/Continue bar, never scrolls the page behind', async ({ page, request }) => {
  const token = await seed(request, journeyA(), 'company');
  await open(page, token);
  const trigger = page.locator('.topbar').getByRole('button', { name: 'Ayuda' });
  const tb = (await trigger.boundingBox())!; expect(tb.height).toBeGreaterThanOrEqual(43.5); expect(tb.width).toBeGreaterThanOrEqual(43.5);
  await trigger.click();
  const panel = page.getByTestId('help-panel'); await expect(panel).toBeVisible();
  for (const q of await panel.locator('.ha-q').all()) await q.click();                         // all answers open: the worst case
  const vp = page.viewportSize()!; const pb = (await panel.boundingBox())!;
  expect(pb.x).toBeGreaterThanOrEqual(0); expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width + 0.5); expect(pb.y).toBeGreaterThanOrEqual(0);
  const bar = await page.locator('.navbar').boundingBox();
  if (bar) expect(pb.y + pb.height).toBeLessThanOrEqual(bar.y - 7.5);                          // AUD-02: ≥ 8 px above the bar
  expect(await panel.locator('.ha-body').evaluate((e) => getComputedStyle(e).overscrollBehaviorY)).toBe('contain');   // AUD-07
  await noHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
});

test('DSC-37: moving to another screen closes the panel and puts the focus on the new title', async ({ page, request }) => {
  const token = await seed(request, journeyA(), 'company');
  await open(page, token);
  await page.locator('.topbar').getByRole('button', { name: 'Ayuda' }).click();
  await page.getByRole('button', { name: 'Atrás' }).click();
  await expect(page.getByTestId('help-panel')).toHaveCount(0);
  await expect(page.locator('main h1').first()).toBeFocused();
});

test('DSC-38: cover link opens the dialog on the e-mail field; Escape returns to the link; same answer for any address', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.clear(); } catch { /* */ } });
  await page.goto('/fa4');
  const link = page.getByRole('button', { name: /¿Ya empezaste\? Recibe un enlace para continuar/ });
  await expect(link).toBeVisible();
  const lb = (await link.boundingBox())!; expect(lb.height).toBeGreaterThanOrEqual(43.5);
  await link.click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('Correo electrónico')).toBeFocused();
  await noHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0); await expect(link).toBeFocused();
  await link.click();
  await page.getByRole('dialog').getByLabel('Correo electrónico').fill('nadie-conocido@ejemplo.test');
  await page.getByRole('dialog').getByRole('button', { name: 'Enviarme un enlace nuevo' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Si ese correo tiene un proyecto');
});
