import { expect, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import { axeSeriousOrCritical, expectNoHorizontalOverflow, expectTargets44 } from "../../precision/helpers";
import { ORIGIN, type ApiRecorder } from "./qa";

export { expectNoHorizontalOverflow, expectTargets44, axeSeriousOrCritical };
export type Loc = "en" | "es";

/** Opens the one-time access path in a clean page, with the language the client chose (EN/ES switch is remembered by the app). */
export async function openWithCode(page: Page, code: string, locale: Loc, path = "/precision"): Promise<void> {
  await page.addInitScript((l) => { try { if (!localStorage.getItem("beeside.precision.locale")) localStorage.setItem("beeside.precision.locale", l); } catch { /* blocked */ } }, locale);
  await page.goto(`${path}?code=${encodeURIComponent(code)}`);
}

/** Clicks a navigation entry; on a phone the navigation lives in the menu drawer, which is opened first. */
export async function navTo(page: Page, name: RegExp): Promise<void> {
  const menu = page.getByRole("button", { name: /^(Open menu|Abrir menú)$/ });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation").getByRole("link", { name }).first().click();
}

export const T = {
  en: {
    coverH1: /Your project, defined with precision/,
    cont: /^Continue/,
    mapCta: /Review My Service Map/,
    confirmMap: /^Confirm My Service Map/,
    mapConfirmed: /confirmed/i,
    reviewSummary: /^Review summary/,
    confirmCrp: /^Confirm CRP/,
    crpConfirmed: /CRP confirmed/,
    preview: /Preview before Send/,
    send: /^Send to Operation Hub/,
    sentH1: /Sent to Operation Hub/,
    tryAgain: /^Try again/,
    pending: /Pending Information/,
  },
  es: {
    coverH1: /Tu proyecto, definido con precisión/,
    cont: /^Continuar/,
    mapCta: /Revisar My Service Map/,
    confirmMap: /^Confirmar My Service Map/,
    mapConfirmed: /confirmad[oa]/i,
    reviewSummary: /^Revisar resumen/,
    confirmCrp: /^Confirmar CRP/,
    crpConfirmed: /CRP confirmado/,
    preview: /Vista previa antes de enviar/,
    send: /^Enviar a Operation Hub/,
    sentH1: /Enviado a Operation Hub/,
    tryAgain: /^Intentar de nuevo/,
    pending: /Información pendiente/,
  },
} as const;

// ------------------------------------------------------------------ forbidden terms (Track A contract section 0)
const FORBIDDEN: { id: string; re: RegExp }[] = [
  { id: "MOCK/STUB/SIM", re: /\b(MOCK|STUB|SIMULATOR|SIMULATED|SANDBOX|simulator|simulated|sandbox)\b/ },
  { id: "internal acronyms", re: /\b(PSM|MSM|OH|PbyC|PA|FA|FA4|CCIR)\b/ },
  { id: "internal keys", re: /(_generic|\bnew:[a-z_]|CONTEXT_ONLY|\bBV4\d\d\b|\bundefined\b|\bNaN\b|\[object|"error"\s*:|stack trace|Traceback)/ },
  { id: "reopen", re: /\b(reopen|reabrir)\b/i },
  { id: "labels", re: /\b(Out of Scope|Unmapped|Discovery)\b/ },
  { id: "vendors", re: /\b(ClickUp|Stripe|Anthropic|OpenAI|Claude|GPT)\b/i },
  { id: "exclamation", re: /[!¡]/ },
  { id: "emoji", re: /\p{Extended_Pictographic}/u },
  { id: "quality", re: /\b(ready|validated|excellent|listo|lista|listos|listas|validado|validada|excelente)\b/i },
  { id: "version", re: /\b(v\d+(\.\d+)?|version \d+|versión \d+)\b/i },
];
export function scanForbidden(text: string, opts: { allowSherpa?: boolean } = {}): string[] {
  const hits: string[] = [];
  for (const f of FORBIDDEN) { const m = f.re.exec(text); if (m) hits.push(`${f.id}: "${m[0]}"`); }
  if (!opts.allowSherpa && /\bsherpa\b/i.test(text)) hits.push(`sherpa: "${/\bsherpa\b/i.exec(text)![0]}"`);
  return hits;
}

/** Visible text of the whole page minus the process-answer turns, where explaining the Sherpa role is allowed (Voice v1.1 A). */
export async function pageText(page: Page): Promise<string> {
  // innerText of a clone is layout-free, so read the live element and subtract the process answers by their own text.
  return page.evaluate(() => {
    let text = document.body.innerText;
    // the client's own words are not product copy either
    document.querySelectorAll<HTMLElement>('[data-kind="process_question"] .pz-turn-text, .pz-turn-client .pz-bubble').forEach((el) => { text = text.split(el.innerText.trim()).join(" "); });
    return text;
  });
}

export interface Ctx { page: Page; rec: ApiRecorder; dir: string; locale: Loc; errors: string[] }

/** Screen checks: axe (serious/critical = 0), no horizontal overflow, clean copy, and a screenshot. Targets are checked on request. */
export async function checkScreen(c: Ctx, name: string, opts: { targets?: boolean; allowSherpa?: boolean; idle?: boolean } = {}): Promise<void> {
  const { page } = c;
  if (opts.idle !== false) await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(700); // smooth scrolling and transitions settle
  await page.screenshot({ path: `${c.dir}/${name}.png`, fullPage: false });
  const axe = await axeSeriousOrCritical(page);
  expect(axe, `axe serious/critical on ${name}`).toEqual([]);
  await expectNoHorizontalOverflow(page, name);
  const hits = scanForbidden(await pageText(page), { allowSherpa: opts.allowSherpa });
  expect(hits, `forbidden/raw text on ${name}`).toEqual([]);
  if (opts.targets) await expectTargets44(page, name);
}

// ------------------------------------------------------------------ conversation
export const log = (page: Page): Locator => page.getByRole("log");
export const assistantTurns = (page: Page): Locator => page.locator(".pz-turn-assistant");
export const clientBubbles = (page: Page, text?: string | RegExp): Locator => (text ? page.locator(".pz-turn-client .pz-bubble").filter({ hasText: text }) : page.locator(".pz-turn-client .pz-bubble"));
export const composer = (page: Page): Locator => page.locator("#pz-msg");

/** Waits until the assistant has answered the last client turn (no waiting row, composer ready or a closing panel visible). */
export async function settled(page: Page): Promise<void> {
  await expect(page.locator(".pz-wait")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".pz-retry")).toHaveCount(0);
}

export async function say(page: Page, text: string): Promise<void> {
  const before = await assistantTurns(page).count();
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(assistantTurns(page)).not.toHaveCount(before, { timeout: 30_000 });
  await settled(page);
}
export async function pick(page: Page, label: string | RegExp): Promise<void> {
  const before = await assistantTurns(page).count();
  await page.getByRole("group", { name: /Suggested answers|Respuestas sugeridas/ }).getByRole("button", { name: label }).click();
  await expect(assistantTurns(page)).not.toHaveCount(before, { timeout: 30_000 });
  await settled(page);
}
export async function confirmCard(page: Page, label: string | RegExp): Promise<void> {
  const before = await assistantTurns(page).count();
  await page.locator(".pz-confirm").last().getByRole("button", { name: label }).click();
  await expect(assistantTurns(page)).not.toHaveCount(before, { timeout: 30_000 });
  await settled(page);
}
export const lastAssistant = async (page: Page): Promise<string> => (await assistantTurns(page).last().locator(".pz-turn-text").innerText()).trim();

// ------------------------------------------------------------------ the demo route script (docs/f5/demo-route.md section D)
export const SCRIPT = {
  en: {
    understanding: ["We make dry packaged food products with a long shelf life, mainly snacks and cereals", "We plan to set up a local company in Mexico", "April 2027"],
    processQ: [
      "What is a Category Requirement Pack (CRP)?",
      "What happens after I confirm it?",
      "What is sent to Operation Hub?",
      "What does a Sherpa do?",
      "Why are you asking me this?",
      "Can I change this later?",
    ],
    logistics: ["Third-party logistics provider", "No", "Third-party logistics and Freight transportation", "General cargo", "Chile", "Mexico", "Packaged dry food products", "20 pallets", "Monthly", "Ocean", "No"],
    unknown: "Not sure yet",
    yes: /Yes, that is correct/,
  },
  es: {
    understanding: ["Fabricamos alimentos secos empacados de larga vida útil, sobre todo botanas y cereales", "Vamos a constituir una empresa local en México", "Abril de 2027"],
    processQ: [
      "¿Qué es un Category Requirement Pack (CRP)?",
      "¿Qué pasa después de que lo confirmo?",
      "¿Qué se envía a Operation Hub?",
      "¿Qué hace un Sherpa?",
      "¿Por qué me preguntas esto?",
      "¿Puedo cambiar esto después?",
    ],
    logistics: ["Proveedor logístico externo", "No", "Logística con terceros y Transporte de carga", "Carga general", "Chile", "México", "Alimentos secos empacados", "20 pallets", "Mensual", "Marítimo", "No"],
    unknown: "Todavía no lo sé",
    yes: /Sí, es correcto/,
  },
} as const;

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(file.replace(/\/[^/]+$/, ""), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
}
export { ORIGIN };

// ------------------------------------------------------------------ API response scan (customer-visible strings only)
const MACHINE_KEYS = new Set(["id", "token", "iconKey", "kind", "state", "status", "surface", "scopeId", "createdAt", "asOf", "confirmedAt", "previewChecksum", "intent", "code", "categoryId", "composition", "sendState", "clientAction", "error", "mode", "readOnlyUntil", "sessionToken", "expiresAt", "blockedReason", "locale", "screen", "url", "helpCenterUrl", "contactUrl", "email", "priority", "timing", "turnKey", "text_en"]);
/** Collects the customer-facing strings of a JSON answer (machine identifiers and enumerations are skipped). */
export function collectStrings(node: unknown, out: string[] = [], key = "", parent?: Record<string, unknown>): string[] {
  if (typeof node === "string") {
    if (MACHINE_KEYS.has(key)) return out;
    if (key === "value" && parent && "intent" in parent) return out; // quick reply machine value
    out.push(node);
  } else if (Array.isArray(node)) node.forEach((n) => collectStrings(n, out, key, parent));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) collectStrings(v, out, k, node as Record<string, unknown>);
  return out;
}
export function scanApiBodies(rec: ApiRecorder, opts: { allowSherpa?: boolean } = {}): string[] {
  const hits: string[] = [];
  for (const b of rec.bodies) {
    if (b.url.includes("/internal/")) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(b.text); } catch { hits.push(`${b.method} ${b.url}: not JSON`); continue; }
    const strings = collectStrings(parsed);
    // process answers (and the first-send explanation) may explain what a Sherpa is: only a assistant `process_question` turn is allowed that.
    for (const s of strings) for (const h of scanForbidden(s, { allowSherpa: opts.allowSherpa })) hits.push(`${b.method} ${b.url}: ${h} in "${s.slice(0, 80)}"`);
  }
  return hits;
}
