import { expect, test } from '@playwright/test';
import { axeViolations, noHorizontalOverflow } from './helpers';

test('English: language is chosen on the cover only; the whole first steps render in English', async ({ page }) => {
  await page.goto('/fa4');
  await page.getByRole('button', { name: 'Cambiar idioma a English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your expansion starts with a clearer view.');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Tell us a little about yourself.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Switch language|Cambiar idioma/ })).toHaveCount(0);                 // no language switcher after the cover
  await expect(page.getByRole('button', { name: 'Español' })).toHaveCount(0);
  await page.getByLabel('Name', { exact: true }).fill('Ana');
  await page.getByLabel('Company').fill('Acme');
  await page.getByLabel('Email address').fill('ana@acme.example');
  await page.getByLabel('I do', { exact: true }).check();
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByLabel(/I acknowledge the Privacy/).check();
    // legal links open in a new tab so progress is kept (CHK-1 configuration point)
  const links = page.locator('a[href*="termsandconditions"], a[href*="/privacy"]');
  await expect(links).toHaveCount(2);                                             // Terms + Privacy only (no third legal document)
  await expect(links.nth(0)).toHaveAttribute('href', 'https://beeside.you/termsandconditions');
  await expect(links.nth(1)).toHaveAttribute('href', /www\.beeside\.you\/privacy/);
  for (const l of await links.all()) await expect(l).toHaveAttribute('rel', /noopener/);
  await noHorizontalOverflow(page);
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Is your company currently operating?' })).toBeVisible();
  await expect(page.getByText('Your company').filter({ visible: true }).first()).toBeVisible();   // progress shows the stage name in EN
});

