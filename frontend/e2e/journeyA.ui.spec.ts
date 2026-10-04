import { expect, test } from '@playwright/test';
import { axeViolations, noHorizontalOverflow } from './helpers';

/** Journey A end-to-end through the real UI (ES): identity → project → fronts → Your Expansion View. */
test('Journey A — simple project, full UI walk-through', async ({ page }) => {
  await page.goto('/fa4');
  await page.getByRole('button', { name: 'Empezar' }).click();

  // identity (right after the cover; same email is reused everywhere)
  await page.getByLabel('Nombre').fill('Laura');
  await page.getByLabel('Empresa').fill('Nubia Software');
  await page.getByLabel('Correo de trabajo').fill('laura@nubia.example');
  await page.getByLabel('Yo', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled();       // terms + privacy are mandatory and separate
  await page.getByLabel(/Acepto los Términos/).check();
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  await page.getByLabel(/Reconozco la Política/).check();
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Continuar' }).click();

  // company (eligibility gate + progress "1 of 6")
  await expect(page.getByRole('heading', { name: '¿Quiénes son?' })).toBeVisible();
  await page.getByLabel('Sí', { exact: true }).check();
  await page.getByLabel('¿Qué hace tu empresa?').fill('Desarrollo de software');
  await page.getByLabel('11–50').check();
  await page.getByPlaceholder('Busca un país').fill('Espa');
  await page.getByRole('button', { name: 'España' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // destinations
  await page.getByPlaceholder('Busca un país').fill('Méx');
  await page.getByRole('button', { name: 'México' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // activity: hire only → no "with what" question (frozen question: "¿Qué quieres hacer allí?")
  await expect(page.getByRole('heading', { name: '¿Qué quieres hacer allí?' })).toBeVisible();
  await page.getByLabel('Contratar personas').check();
  await expect(page.getByText('¿Con qué?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar' }).click();
  // presence
  await page.getByLabel('Aún no está definido').check();
  await page.getByLabel('Aún no lo sé').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  // existing
  await page.getByLabel('Nada todavía').check();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // R1 reflection → confirm
  await expect(page.getByText('Esto es lo que entendemos')).toBeVisible();
  await expect(page.getByText(/En México quieres contratar personas/)).toBeVisible();
  await page.getByRole('button', { name: 'Sí, es así' }).click();

  // why now (mirrors the user's words)
  await page.getByLabel('Acceso a talento').check();
  await page.getByLabel(/Escríbelo con tus palabras/).fill('Nos cuesta encontrar perfiles senior en España.');
  await expect(page.getByText('“Nos cuesta encontrar perfiles senior en España.”')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  // decision
  await page.getByLabel(/Está decidido/).check();
  await page.getByRole('radio', { name: 'En unos 6 meses' }).click();
  await page.getByRole('radio', { name: 'No', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  // scale (hire-only → people proxy, with "why we ask" and decline option)
  await expect(page.getByText(/Sólo para dimensionar/)).toBeVisible();
  await page.getByLabel(/¿Cuántas personas contratarías en México/).fill('3 a 5 personas');
  await page.getByRole('button', { name: 'Continuar' }).click();
  // activators: only "regulated" applies (nothing to sell, no premises) → one short step
  await expect(page.getByText('¿Tu producto o actividad está regulado?')).toBeVisible();
  await expect(page.getByText('¿A quién vendes?')).toHaveCount(0);
  await expect(page.getByText(/¿Qué llevarás desde el país de origen/)).toHaveCount(0);
  await page.getByLabel('No', { exact: true }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // topics: 3 apply + 1 depends; status per topic
  await expect(page.getByRole('heading', { name: 'Esto es lo que toca tu proyecto' })).toBeVisible();
  await expect(page.getByText('Banco y pagos en el país')).toBeVisible();                      // shown under "depends"
  await page.getByRole('button', { name: 'Aún no he empezado nada' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  // support: yes, yes, not sure  ("No" does not mean "do not delegate")
  await expect(page.getByText(/«No» no significa/)).toBeVisible();
  const rows = page.locator('.topic');
  await rows.nth(0).getByRole('radio', { name: 'Sí' }).click();          // legal
  await rows.nth(1).getByRole('radio', { name: 'Sí' }).click();          // recruitment? order: legal, recruitment, employment
  await rows.nth(1).getByRole('radio', { name: 'No lo sé' }).click();
  await rows.nth(2).getByRole('radio', { name: 'Sí' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // support values, extra, result
  await page.getByLabel('En tus palabras (opcional)').fill('Entender cómo contratar sin complicar la empresa.');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Ver mi resultado' }).click();

  // ===== result: YourExpansionView → BeesideValueSection → PremiumContinuation =====
  const result = page.getByTestId('result-screen');
  await expect(result).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Un equipo de 3 a 5 personas en México');
  await expect(result.getByText('beeside puede ayudarte').first()).toBeVisible();
  await expect(result.getByText('Tu beeside Sherpa buscará y validará la mejor opción para ti').first()).toBeVisible();
  await expect(result.getByText('Depende de cómo decidas operar').first()).toBeVisible();
  const order = await result.evaluate((root) => ['#yev-title', '[data-testid=beeside-value-section]', '[data-testid=premium-continuation]'].map((s) => { const e = root.querySelector(s)!; return e.getBoundingClientRect().top + window.scrollY; }));
  expect(order[0]!).toBeLessThan(order[1]!); expect(order[1]!).toBeLessThan(order[2]!);
  await expect(page.getByText('Expande tu negocio.')).toBeVisible();                           // institutional block is in Journey A too
  await expect(page.getByTestId('beeside-value-section').locator('[data-component]')).toHaveCount(4);
  for (const t of ['Un Sherpa a tu lado', 'Especialistas seleccionados', 'Todo en un solo lugar', 'Strategic Advisory']) await expect(page.getByTestId('beeside-value-section').getByText(t, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar con beeside' })).toBeVisible();
  await expect(page.getByText('Antes de Premium, no compartimos tu proyecto con proveedores.')).toBeVisible();
  for (const bad of ['Por confirmar', 'Sin servicio', 'Snapshot', 'SOURCEABLE', 'NOT_OFFERED']) await expect(page.locator('body')).not.toContainText(bad);
  await noHorizontalOverflow(page);
  expect(await axeViolations(page)).toEqual([]);

  // Premium continuation uses the same email; nothing is asked again
  await page.getByRole('button', { name: 'Continuar con beeside' }).click();
  await expect(page.getByText(/tu solicitud quedó registrada/)).toBeVisible();
  await page.getByRole('button', { name: 'Recibir este resultado por email' }).click();
  await expect(page.getByText('Te lo enviamos al correo que nos diste.')).toBeVisible();
});
