import { createRequire } from "node:module";

/**
 * Render de PDF con Chromium (Playwright). El HTML de impresión llega completo y autosuficiente: fuentes y logotipo incrustados. Durante el
 * render TODA petición que no sea local se aborta (X19), y además el contexto trabaja sin conexión: el resultado no depende de la red.
 * Un bloque que no cabe o un hallazgo del lint detiene el render (falla cerrada); nunca se reduce letra ni se recorta.
 */
export type RenderErrorCode = "renderer_unavailable" | "layout_failed" | "network_attempt" | "render_failed";

export class RenderError extends Error {
  constructor(readonly code: RenderErrorCode, message: string, readonly details: unknown = null) {
    super(message);
    this.name = "RenderError";
  }
}

interface PageLike {
  route(url: string, handler: (route: RouteLike) => void): Promise<void>;
  setContent(html: string, options: { waitUntil: "load" }): Promise<void>;
  emulateMedia(options: { media: "print" }): Promise<void>;
  evaluate<T>(fn: (() => T) | string): Promise<T>;
  addScriptTag(options: { content: string }): Promise<unknown>;
  content(): Promise<string>;
  pdf(options: Record<string, unknown>): Promise<Buffer>;
  $$(selector: string): Promise<{ screenshot(options: { type: "png" }): Promise<Buffer> }[]>;
  close(): Promise<void>;
}
interface RouteLike {
  request(): { url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}
export interface BrowserLike {
  version(): string;
  newContext(options: Record<string, unknown>): Promise<{ newPage(): Promise<PageLike>; close(): Promise<void> }>;
  close(): Promise<void>;
}

export async function launchChromium(options: { executablePath?: string; env?: NodeJS.ProcessEnv } = {}): Promise<BrowserLike> {
  const env = options.env ?? process.env;
  let chromium: { launch(o: Record<string, unknown>): Promise<BrowserLike> };
  try {
    chromium = createRequire(__filename)("playwright-core").chromium;
  } catch (error) {
    throw new RenderError("renderer_unavailable", "playwright-core no está instalado", String(error));
  }
  const args = ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--disable-gpu"];
  if (env.KL_CHROMIUM_NO_SANDBOX === "true") args.push("--no-sandbox");
  try {
    return await chromium.launch({ args, ...(options.executablePath ?? env.KL_CHROMIUM_PATH ? { executablePath: options.executablePath ?? env.KL_CHROMIUM_PATH } : {}) });
  } catch (error) {
    throw new RenderError("renderer_unavailable", "no se pudo iniciar Chromium", String(error).slice(0, 300));
  }
}

export interface PdfResult {
  pdf: Buffer;
  pagedHtml: string;
  pages: number;
  /** Peticiones no locales que se intentaron y se abortaron. */
  blockedRequests: string[];
  chromium: string;
  /** Rasterización de cada página (nivel «visual» de AC-10); solo si se pide. */
  pagePng?: Buffer[];
}

export async function renderPdf(input: { html: string; paginateJs: string; screenshots?: boolean }, browser: BrowserLike): Promise<PdfResult> {
  const context = await browser.newContext({ viewport: { width: 794, height: 1123 }, offline: true, serviceWorkers: "block", javaScriptEnabled: true, deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC" });
  const blocked: string[] = [];
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url === "about:blank") void route.continue();
      else {
        blocked.push(url);
        void route.abort();
      }
    });
    await page.setContent(input.html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.evaluate("document.fonts.ready");
    await page.addScriptTag({ content: input.paginateJs });
    const report = await page.evaluate<{ pages: number; errors: unknown[]; lint: unknown[] }>("window.__paginate()");
    if (report.errors.length > 0 || report.lint.length > 0) throw new RenderError("layout_failed", "la paginación no cumple: un bloque no cabe o el lint encontró hallazgos", { errors: report.errors, lint: report.lint });
    const pagedHtml = await page.content();
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true, outline: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    const result: PdfResult = { pdf, pagedHtml, pages: report.pages, blockedRequests: blocked, chromium: browser.version() };
    if (input.screenshots) {
      const els = await page.$$(".page");
      result.pagePng = [];
      for (const el of els) result.pagePng.push(await el.screenshot({ type: "png" }));
    }
    return result;
  } catch (error) {
    if (error instanceof RenderError) throw error;
    throw new RenderError("render_failed", "falló el render", String(error).slice(0, 300));
  } finally {
    await context.close().catch(() => undefined);
  }
}
