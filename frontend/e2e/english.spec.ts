import { expect, test } from '@playwright/test';
import { axeViolations, noHorizontalOverflow } from './helpers';

test('English: language is chosen on the cover only; the whole first steps render in English', async ({ page }) => {
  await page.goto('/fa4');
  await page.getByRole('button', { name: 'Cambiar idioma a English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your expansion starts with a clearer view.');
  await page.getByRole('button', { name: 'Start your assessment' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Who are you in this project?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Switch language|Cambiar idioma/ })).toHaveCount(0);                 // no language switcher after the cover
  await expect(page.getByRole('button', { name: 'Español' })).toHaveCount(0);
  await page.getByLabel("Your name").fill('Ana');
  await page.getByLabel('Company').fill('Acme');
  await page.getByLabel('Work email').fill('ana@acme.example');
  await page.getByLabel('I do', { exact: true }).check();
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByLabel(/I acknowledge the Privacy/).check();
  await expect(page.getByText("Before Premium, we don't share your project with providers.")).toBeVisible();
  // legal links open in a new tab so progress is kept (CHK-1 configuration point)
  const links = page.locator('a[target="_blank"]');
  await expect(links).toHaveCount(2);
  for (const l of await links.all()) await expect(l).toHaveAttribute('rel', /noopener/);
  await noHorizontalOverflow(page);
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
  await expect(page.getByText('Your company').filter({ visible: true }).first()).toBeVisible();   // progress shows the stage name in EN
});

test('Project reflection: tapping a fragment returns to the source answer (correct from any reflection)', async ({ page, request }) => {
  const { journeyA } = await import('@beeside/fa-public-engine/testing');
  const { seed, open } = await import('./helpers');
  const token = await seed(request, journeyA(), 'reflection');
  await open(page, token);
  await page.getByRole('button', { name: 'contratar personas' }).click();
  await expect(page.getByRole('heading', { name: '¿Qué quieres hacer allí?' })).toBeVisible();
});
