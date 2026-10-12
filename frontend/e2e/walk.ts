import { expect, type Page } from "@playwright/test";
import { UI } from "../src/fa4/copy/ui";

type Loc = "es" | "en";
const t = (l: { es: string; en: string }, loc: Loc) => l[loc];
const next = (p: Page, loc: Loc) => p.getByRole("button", { name: t(UI.next, loc), exact: true });

/** Cover → Identity → Company for the (fictitious) Nórtica Envases route, through the real UI. */
export async function startNortica(page: Page, loc: Loc) {
  await page.goto("/fa4");
  if (loc === "en") await page.getByRole("button", { name: /English/ }).click();
  await page.getByRole("button", { name: t(UI.coverCta, loc) }).click();
  await page.getByLabel(t(UI.name, loc)).fill("Lucía");
  await page.getByLabel(t(UI.company, loc), { exact: true }).fill("Nórtica Envases");
  await page.getByLabel(t(UI.email, loc)).fill("lucia@nortica.example");
  await page.getByLabel(t(UI.role, loc)).fill(loc === "es" ? "Directora de Desarrollo de Negocio" : "Business Development Director");
  await page.getByRole("radio", { name: t(UI.deciderOpts.shared, loc) }).check();
  await page.getByLabel(t(UI.terms, loc)).check();
  await page.getByLabel(t(UI.privacy, loc)).check();
  await page.getByRole("button", { name: t(UI.acceptContinue, loc) }).click();
  // company
  await page.getByRole("radio", { name: t(UI.yes, loc), exact: true }).check();
  await page.getByLabel(t(UI.sector, loc)).fill(loc === "es" ? "Fabricación de envases sostenibles para alimentación" : "Manufacturing of sustainable food packaging");
  await page.getByRole("radio", { name: "51–250" }).check();
  for (const [q, name] of loc === "es" ? [["Espa", "España"], ["Port", "Portugal"]] : [["Spa", "Spain"], ["Port", "Portugal"]]) {
    await page.getByPlaceholder(t(UI.searchCountry, loc)).fill(q!); await page.getByRole("button", { name: name!, exact: true }).click();
  }
  await next(page, loc).click();
  // destination
  await page.getByPlaceholder(t(UI.searchCountry, loc)).fill(loc === "es" ? "Méx" : "Mex");
  await page.getByRole("button", { name: loc === "es" ? "México" : "Mexico", exact: true }).click();
  await next(page, loc).click();
}

export async function answerNorticaProject(page: Page, loc: Loc) {
  await page.getByRole("checkbox", { name: t(UI.acts.sell, loc), exact: true }).check();
  await page.getByRole("checkbox", { name: t(UI.acts.hire, loc), exact: true }).check();
  await page.getByRole("checkbox", { name: t(UI.withs.goods, loc), exact: true }).check();
  await next(page, loc).click();
  await page.getByRole("radio", { name: t(UI.pres.own_physical, loc) }).check();
  await page.getByRole("radio", { name: t(UI.permOpts.permanent, loc) }).check();
  await next(page, loc).click();
  await page.getByRole("radio", { name: t(UI.exist.via_third, loc) }).check();
  await next(page, loc).click();
  await page.getByRole("button", { name: t(UI.r1Confirm, loc) }).click();
  // why / when
  await page.getByRole("checkbox", { name: t(UI.reasons.follow_clients, loc) }).check();
  await page.getByRole("checkbox", { name: t(UI.reasons.growth, loc) }).check();
  await next(page, loc).click();
  await page.getByRole("radio", { name: t(UI.dec.decided, loc) }).check();
  await page.getByRole("radio", { name: t(UI.starts["6m"], loc) }).check();
  await page.getByRole("radio", { name: t(UI.no, loc), exact: true }).check();
  await next(page, loc).click();
  // size: D-149 → people (sell + hire)
  await page.getByLabel(new RegExp(t(UI.scaleQ.people, loc))).fill(loc === "es" ? "8 personas" : "8 people");
  await next(page, loc).click();
}

/** Answers every topic row in whichever layout the viewport uses (combined table ≥1024, separate steps below). */
export async function answerTopics(page: Page, loc: Loc, status: (name: string) => "resolved" | "in_progress" | "pending" | "unknown", support: "yes" | "no" | "unknown") {
  await page.locator(".ftable-row, .topic").first().waitFor();   // the layout (table vs steps) is decided by the viewport once the step has rendered
  const table = page.locator(".ftable-row");
  if (await table.count()) {
    for (let i = 0; i < (await table.count()); i++) {
      const row = table.nth(i);
      const name = (await row.locator(".name").innerText()).trim();
      await row.getByRole("radio", { name: t(UI.statuses[status(name)], loc), exact: true }).first().check();
      const sup = row.getByRole("radiogroup", { name: new RegExp(t(UI.colSupport, loc)) });
      if (await sup.count()) await sup.getByRole("radio", { name: t(support === "yes" ? UI.yes : support === "no" ? UI.no : UI.unknown, loc), exact: true }).check();
    }
    await next(page, loc).click();
  } else {
    const rows = page.locator(".topic");
    for (let i = 0; i < (await rows.count()); i++) {
      const row = rows.nth(i);
      const name = (await row.innerText()).split("\n")[0]!.trim();
      await row.getByRole("radio", { name: t(UI.statuses[status(name)], loc), exact: true }).first().check();
    }
    await next(page, loc).click();
    const rows2 = page.locator(".topic");
    for (let i = 0; i < (await rows2.count()); i++)
      await rows2.nth(i).getByRole("radio", { name: t(support === "yes" ? UI.yes : support === "no" ? UI.no : UI.unknown, loc), exact: true }).check();
    await next(page, loc).click();
  }
}

export async function expectNoRawOrInternal(page: Page) {
  const body = await page.locator("body").innerText();
  for (const bad of ["SOURCEABLE", "NOT_OFFERED", "UNMAPPED_NEED", "NO_ACTIVE_COVERAGE", "DEPENDENT", "undefined", "[object", "beeside.example", "Precision Assessment", "Por confirmar", "NEEDS_CANONICAL", "Snapshot", "noreply@"])
    expect(body, `forbidden text: ${bad}`).not.toContain(bad);
}

/** "No lo sé" route (Product Handoff §7): sell only, every undecided answer left as "not sure". Stops on the result screen. */
export async function walkUnknown(page: Page, loc: Loc) {
  await startNortica(page, loc);
  await page.getByRole("checkbox", { name: t(UI.acts.sell, loc), exact: true }).check();
  await page.getByRole("checkbox", { name: t(UI.withs.goods, loc), exact: true }).check();
  await next(page, loc).click();
  await page.getByRole("radio", { name: t(UI.pres.open, loc), exact: true }).first().check();
  await page.getByRole("radio", { name: t(UI.permOpts.open, loc), exact: true }).last().check();
  await next(page, loc).click();
  await page.getByRole("radio", { name: t(UI.exist.via_third, loc) }).check();
  await next(page, loc).click();
  await page.getByRole("button", { name: t(UI.r1Confirm, loc) }).click();
  await page.getByRole("checkbox", { name: t(UI.reasons.follow_clients, loc) }).check();
  await next(page, loc).click();
  await page.getByRole("radio", { name: t(UI.dec.exploring, loc) }).check();
  await page.getByRole("radio", { name: t(UI.starts.unknown, loc) }).check();
  await page.getByRole("radio", { name: t(UI.no, loc), exact: true }).check();
  await next(page, loc).click();
  // size: sell only → products; "not sure"
  await page.getByRole("button", { name: t(UI.scaleUnknown, loc), exact: true }).click();
  await next(page, loc).click();
  // VT-03: a single thematic screen ("about what you sell"); no empty "about your operation" screen
  await expect(page.getByRole("heading", { level: 1 })).toContainText(t(UI.sellTitle, loc));
  await page.getByRole("radio", { name: t(UI.unknown, loc), exact: true }).first().check();
  await page.getByRole("radio", { name: t(UI.sellsToOpts.companies, loc) }).check();
  await page.getByRole("radio", { name: t(UI.yes, loc), exact: true }).last().check();
  await next(page, loc).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(t(UI.topicsTitle, loc));
  await answerTopics(page, loc, () => "unknown", "unknown");
  await page.getByRole("radio", { name: loc === "es" ? "Aún no lo sé" : "Not sure yet", exact: true }).check();
  await next(page, loc).click();
  await next(page, loc).click();   // values (skipped)
  await page.getByRole("button", { name: t(UI.seeResult, loc) }).click();
}
