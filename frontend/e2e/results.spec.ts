import { expect, test } from '@playwright/test';
import { journeyA, journeyB, journeyC, journeyNewBusiness } from '@beeside/fa-public-engine/testing';
import { UI } from '../src/fa4/copy/ui';
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
    await expect(page.getByTestId('beeside-value-section')).toContainText('Piensa en grande.');
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
  await expect(r.getByText('Trece temas aplican a tu proyecto en dos países. Uno más depende de una decisión.')).toBeVisible();
  await expect(r.getByText('beeside aún no cuenta con cobertura activa en este país.').first()).toBeVisible();
  await expect(r.getByText('Lo revisaremos con tu Sherpa').first()).toBeVisible();      // permits NOT_OFFERED with Premium continuation
  const us = r.locator('.dest-head', { hasText: 'Estados Unidos' }).last().locator('..');
  await expect(us.locator('.vgroup')).toHaveCount(0);
  await expect(r.locator('.vgroup').filter({ hasText: 'beeside puede ayudarte' })).toContainText('6');
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
  await expect(r.getByText('Think bigger.')).toBeVisible();
  for (const t of ['Your Sherpa', 'The Hive', 'Operation Hub', 'Strategic Advisory']) await expect(r.getByTestId('beeside-value-section').getByText(t, { exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Estos son los temas de tu proyecto. ¿En qué punto está cada uno?' })).toBeVisible();
  await noHorizontalOverflow(page);
  await touchTargetsOk(page);
  expect(await axeViolations(page)).toEqual([]);
});

test('Save and resume: reopening by link lands on the saved step; "save for later" uses the stored email', async ({ page, request }) => {
  const token = await seed(request, journeyB('es'), 'decision');
  await open(page, token);
  await expect(page.getByRole('heading', { name: '¿En qué punto está la decisión sobre este proyecto?' })).toBeVisible();
  await expect(page.getByLabel('¿De qué depende todavía?')).toHaveValue(/Board/);       // answers restored
  await page.getByRole('button', { name: 'Guardar y seguir después' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Guardado/ })).toContainText('k***@mueller.example');   // sent only after the mail server accepted it; never asks for the email again
  await page.reload();                                                                    // same tab keeps the working session
  await expect(page.getByRole('heading', { name: '¿En qué punto está la decisión sobre este proyecto?' })).toBeVisible();
});

test('Save for later: a failed send never says "sent" and offers a retry that works (Queued ≠ Sent, UI)', async ({ page, request }) => {
  const token = await seed(request, journeyB('es'), 'decision');
  await open(page, token);
  let first = true;
  await page.route('**/api/fa4/session/finish-later', (route) => {
    if (first) { first = false; return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'EMAIL_NOT_SENT' }) }); }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Guardar y seguir después' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'no pudimos enviarte el enlace' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Te enviamos a');
  await page.getByRole('button', { name: 'Intentar de nuevo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Te enviamos a k***@mueller.example' })).toBeVisible();
});

test('Hablar con beeside: real submission (success) and honest failure with retry', async ({ page, request }) => {
  const token = await seed(request, journeyA(), 'company');
  await open(page, token);
  await page.getByRole('button', { name: 'Hablar con beeside' }).or(page.getByRole('button', { name: 'Ayuda y contacto' })).first().click();
  if (await page.getByRole('menuitem', { name: 'Hablar con beeside' }).count()) await page.getByRole('menuitem', { name: 'Hablar con beeside' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('Correo de trabajo')).toHaveValue('laura@nubia.example');                       // prefilled
  await dlg.getByLabel('Mensaje').fill('Quisiera hablar con alguien sobre la contratación.');
  let fail = true;
  await page.route('**/api/fa4/session/contact', (route) => { if (fail) { fail = false; return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'EMAIL_NOT_SENT' }) }); } return route.continue(); });
  await dlg.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(dlg.getByRole('alert')).toBeVisible();
  await expect(dlg).not.toContainText('Recibimos tu mensaje');
  await dlg.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(dlg.getByText(/Recibimos tu mensaje. Te responderemos en laura@nubia.example/)).toBeVisible();
});

test('Help opens the Help Center in a new tab and the assessment stays intact', async ({ page, context, request }) => {
  const token = await seed(request, journeyA(), 'company');
  await open(page, token);
  await expect(page.getByRole('heading', { name: '¿Tu empresa se encuentra operando actualmente?' })).toBeVisible();
  const visibleHelp = page.locator('a[href*="helpcenter"]').filter({ visible: true });
  if (!(await visibleHelp.count())) await page.getByRole('button', { name: 'Ayuda y contacto' }).click();
  const link = visibleHelp.first();
  await expect(link).toHaveAttribute('href', 'https://www.beeside.you/helpcenter');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('heading', { name: '¿Tu empresa se encuentra operando actualmente?' })).toBeVisible();
});

test('No business operating today is a VALID case: the same journey continues (no exit), current-operation questions are skipped', async ({ page, request }) => {
  const a = journeyA(); a.company = { ...a.company, hasExistingBusiness: false };
  const token = await seed(request, a, 'company');
  await open(page, token);
  await expect(page.getByRole('heading', { name: '¿Tu empresa se encuentra operando actualmente?' })).toBeVisible();
  await page.getByLabel('Sí', { exact: true }).check();
  await expect(page.getByText('¿En qué países tiene hoy actividad tu empresa?')).toBeVisible();          // «yes» asks the current-operation questions
  await page.getByLabel('No', { exact: true }).check();
  await expect(page.getByText('¿En qué países tiene hoy actividad tu empresa?')).toHaveCount(0);        // «no» skips them (sector, size, countries of activity)
  await expect(page.getByLabel(/sector/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: '¿A qué país o países quieres expandirte?' })).toBeVisible();   // the project journey, not an exit
  await expect(page.locator('body')).not.toContainText(/negocios en marcha|operating businesses/);
});

for (const loc of ['es', 'en'] as const) {
  test(`New business (${loc}): preview → email-result delivery → locked; YEV makes no existing-company claims`, async ({ page, request }) => {
    const a = journeyNewBusiness(loc); a.identity.email = `nb.${loc}.${Date.now()}@example.test`;
    const token = await seed(request, a, 'extra');
    await open(page, token);
    await page.getByRole('button', { name: new RegExp(`^(${UI.next[loc]}|${UI.seeResult[loc]})$`) }).click();
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 20_000 });
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/Fabricación de envases|51[–-]250|undefined|null/);
    await expect(page.getByRole('button', { name: 'Start Your Expansion' })).toBeVisible();
    await page.getByRole('button', { name: UI.emailResult[loc] }).click();
    await expect(page.getByRole('button', { name: UI.fixSomething[loc] })).toHaveCount(0);
    expect((await request.put('/api/fa4/session', { headers: { 'X-Fa4-Session': token }, data: { answers: a, step: 'decision' } })).status()).toBe(409);
    const sealed = await request.get('/api/fa4/session/result', { headers: { 'X-Fa4-Session': token } }); expect(sealed.status()).toBe(200);
  });
}
