import { expect, test } from '@playwright/test';
import { UI } from '../src/fa4/copy/ui';
import { axeViolations, noHorizontalOverflow } from './helpers';
import { answerTopics, expectNoRawOrInternal, startNortica } from './walk';

/** Journey A through the real UI (ES): hire only, presence "not sure". VT-03: the only question left (regulation) is ONE neutral screen, nothing else. */
test('Journey A — hire only: one neutral regulation screen, topics, YEV with the planned team', async ({ page }) => {
  await startNortica(page, 'es');
  await page.getByRole('checkbox', { name: UI.acts.hire.es, exact: true }).check();
  await expect(page.getByText(UI.withTitle.es.replace('{country}', 'México'))).toHaveCount(0);   // hire only → no "with what"
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('radio', { name: UI.pres.open.es, exact: true }).first().check();
  await page.getByRole('radio', { name: UI.permOpts.open.es, exact: true }).last().check();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('radio', { name: UI.exist.nothing.es }).check();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText(/En México quieres contratar personas/)).toBeVisible();
  await page.getByRole('button', { name: UI.r1Confirm.es }).click();
  await page.getByRole('checkbox', { name: UI.reasons.talent.es }).check();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('radio', { name: UI.dec.decided.es }).check();
  await page.getByRole('radio', { name: UI.starts['6m'].es }).check();
  await page.getByRole('radio', { name: 'No', exact: true }).check();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText(UI.scaleWhy.es)).toBeVisible();
  await page.getByLabel(/¿Cuántas personas contratarías en México/).fill('3 a 5 personas');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  // VT-03: only regulation applies (nothing to sell, no premises) → a single screen titled by the question itself
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(UI.regulated.es);
  await expect(page.getByText(UI.sellsTo.es.replace('{country}', 'México'))).toHaveCount(0);
  await expect(page.getByText(UI.carries.es)).toHaveCount(0);
  await page.getByRole('radio', { name: 'No', exact: true }).check();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Banco y pagos en el país')).toBeVisible();                       // listed under "depends"
  await answerTopics(page, 'es', () => 'pending', 'yes');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();                   // support values (skippable)
  await page.getByRole('button', { name: UI.seeResult.es }).click();

  const result = page.getByTestId('result-screen');
  await expect(result).toBeVisible({ timeout: 20_000 });
  const text = await result.innerText();
  expect(text).toContain('Equipo previsto: 3 a 5 personas');
  expect(text).not.toMatch(/Sin espacio propio|Presupuesto/);
  expect(text).toContain('Depende de cómo decidas operar');
  await expectNoRawOrInternal(page);
  const order = await result.evaluate((root) => ['#yev-title', '[data-testid=beeside-value-section]', '[data-testid=premium-continuation]'].map((s) => root.querySelector(s)!.getBoundingClientRect().top + window.scrollY));
  expect(order[0]!).toBeLessThan(order[1]!); expect(order[1]!).toBeLessThan(order[2]!);
  await noHorizontalOverflow(page);
  expect(await axeViolations(page)).toEqual([]);
  // Premium continuation is an explicit request on the same email; the YEV email is confirmed by the server
  await page.getByRole('button', { name: UI.continueWith.es }).click();
  await expect(page.getByText(/tu solicitud quedó registrada/)).toBeVisible();
  await page.getByRole('button', { name: UI.emailResult.es }).click();
  await expect(page.getByText(/Te enviamos tu Your Expansion View a lucia@nortica\.example/)).toBeVisible();
});
