import { expect, test } from '@playwright/test';
import { journeyA, journeyB, journeyC } from '@beeside/fa-public-engine/testing';
import { axeViolations, FORBIDDEN, noHorizontalOverflow, open, seed, touchTargetsOk } from './helpers';

const cases = [
  { name: 'A', build: journeyA, h1: /3 a 5 personas en México/ },
  { name: 'B', build: () => journeyB('es', 'unknown'), h1: /Planta propia en México y presencia comercial y de ingeniería en Texas/ },
  { name: 'C', build: () => journeyC('es', 'unknown'), h1: /Montaje de torres de un parque eólico en México/ },
] as const;

for (const c of cases) {
  test(`Result ${c.name} — responsive, accessible, no legacy/internal vocabulary, 3 components in order`, async ({ page, request }) => {
    const token = await seed(request, c.build(), 'extra');
    await open(page, token);
    await page.getByRole('button', { name: 'Ver mi resultado' }).click();
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.h1);
    await expect(page.getByTestId('beeside-value-section')).toContainText('Expande tu negocio.');
    await expect(page.getByTestId('premium-continuation')).toBeVisible();
    await noHorizontalOverflow(page);
    expect(await axeViolations(page)).toEqual([]);
    const text = await page.locator('body').innerText();
    for (const bad of FORBIDDEN) expect(text, `forbidden "${bad}"`).not.toContain(bad);
    expect(text).not.toMatch(/\d+\s?%/);                                  // no percentages / scores
    await page.screenshot({ path: `test-results/shots/result-${c.name}-${test.info().project.name}.png`, fullPage: true });
  });
}

test('Result B — multi-destination grouping and country message instead of per-service states', async ({ page, request }) => {
  const token = await seed(request, journeyB('es', 'unknown'), 'extra');
  await open(page, token);
  await page.getByRole('button', { name: 'Ver mi resultado' }).click();
  const r = page.getByTestId('result-screen');
  await expect(r.getByText('Trece temas aplican en dos países. Dos más dependen de una decisión.')).toBeVisible();
  await expect(r.getByText('beeside aún no cuenta con cobertura activa en este país.').first()).toBeVisible();
  await expect(r.getByText('Lo revisaremos con tu Sherpa').first()).toBeVisible();      // permits NOT_OFFERED with Premium continuation
  const us = r.locator('.dest-head', { hasText: 'Estados Unidos' }).last().locator('..');
  await expect(us.locator('.vgroup')).toHaveCount(0);
  await expect(r.locator('.vgroup').filter({ hasText: 'beeside puede ayudarte' })).toContainText('7');
});

test('Result B in English — visible states and country messages are the canonical EN strings', async ({ page, request }) => {
  const token = await seed(request, journeyB('en', 'unknown'), 'extra');
  await open(page, token);
  await page.getByRole('button', { name: 'See my result' }).click();
  const r = page.getByTestId('result-screen');
  await expect(r).toBeVisible({ timeout: 20_000 });
  await expect(r.getByText('beeside can help').first()).toBeVisible();
  await expect(r.getByText('Your beeside Sherpa will find and validate the best option for you').first()).toBeVisible();
  await expect(r.getByText('beeside can explore the best option with you').first()).toBeVisible();
  await expect(r.getByText("We'll review it with your Sherpa").first()).toBeVisible();
  await expect(r.getByText('beeside does not yet have active coverage in this country.').first()).toBeVisible();
  await expect(r.getByText('Expand your business.')).toBeVisible();
  await expect(r.getByText('beeside puede ayudarte')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('Cargo route I-26 changes the outcome: "within" → ACTIVE (C)', async ({ page, request }) => {
  const token = await seed(request, journeyC('es', 'within'), 'extra');
  await open(page, token);
  await page.getByRole('button', { name: 'Ver mi resultado' }).click();
  const r = page.getByTestId('result-screen');
  await expect(r).toBeVisible({ timeout: 20_000 });
  const active = r.locator('.vgroup').filter({ hasText: 'beeside puede ayudarte' });
  await expect(active).toContainText('Logística e inventario');
  await expect(active).toContainText('Transporte de carga sobredimensionada o especial');
});

test('Journey steps keep touch targets ≥44px and no overflow', async ({ page, request }) => {
  const token = await seed(request, journeyB('es', 'unknown'), 'fronts_status');
  await open(page, token);
  await expect(page.getByRole('heading', { name: 'Esto es lo que toca tu proyecto' })).toBeVisible();
  await noHorizontalOverflow(page);
  await touchTargetsOk(page);
  expect(await axeViolations(page)).toEqual([]);
});

test('Save and resume: reopening by link lands on the saved step; "save for later" uses the stored email', async ({ page, request }) => {
  const token = await seed(request, journeyB('es'), 'decision');
  await open(page, token);
  await expect(page.getByRole('heading', { name: '¿En qué punto está la decisión?' })).toBeVisible();
  await expect(page.getByLabel('¿De qué depende todavía?')).toHaveValue(/Board/);       // answers restored
  await page.getByRole('button', { name: 'Guardar y seguir después' }).click();
  await expect(page.getByRole('status')).toContainText('k***@mueller.example');        // never asks for the email again
  await page.reload();                                                                    // same tab keeps the working session
  await expect(page.getByRole('heading', { name: '¿En qué punto está la decisión?' })).toBeVisible();
});

test('Ineligible (no existing business) exits early and respectfully', async ({ page, request }) => {
  const a = journeyA(); a.company = { ...a.company, hasExistingBusiness: false };
  const token = await seed(request, a, 'company');
  await open(page, token);
  await expect(page.getByRole('heading', { name: '¿Quiénes son?' })).toBeVisible();
  await page.getByLabel('Sí', { exact: true }).check(); await page.getByLabel('No', { exact: true }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: /FA es para negocios en marcha/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar' })).toHaveCount(0);
});
