// Screenshots of every rendered email: desktop (700), mobile (375), dark mode, images blocked, plain text.
import { chromium } from "@playwright/test"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(process.cwd(), "../docs/fa4/email-evidence"); fs.mkdirSync(path.join(root, "png"), { recursive: true });
const files = fs.readdirSync(path.join(root, "html")).filter((f) => f.endsWith(".html"));
const b = await chromium.launch();
const pick = (f) => /^(resume-(es|en)\.|yev-(es|en)-premium-(on-full|off-none)|yev-(es|en)-long|talk-(es|en)-(full|minimal))/.test(f);
for (const f of files) {
  const name = f.replace(/\.html$/, "");
  const url = "file://" + path.join(root, "html", f);
  for (const [tag, w, extra] of [["desktop", 700, {}], ["mobile", 375, {}]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, ...extra }); const p = await ctx.newPage();
    await p.goto(url); await p.screenshot({ path: path.join(root, "png", `${name}-${tag}.png`), fullPage: true });
    const sx = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); if (sx) console.log("HORIZONTAL SCROLL", name, tag);
    await ctx.close();
  }
  if (pick(f)) {
    const dark = await b.newContext({ viewport: { width: 700, height: 900 }, colorScheme: "dark" }); const pd = await dark.newPage(); await pd.goto(url); await pd.screenshot({ path: path.join(root, "png", `${name}-dark.png`), fullPage: true }); await dark.close();
    const nb = await b.newContext({ viewport: { width: 700, height: 900 } }); const pn = await nb.newPage(); await pn.route("**/*", (r) => (["image", "font", "stylesheet"].includes(r.request().resourceType()) ? r.abort() : r.continue())); await pn.goto(url);
    const imgs = await pn.evaluate(() => document.images.length); if (imgs) console.log("IMAGES PRESENT", name, imgs);
    await pn.screenshot({ path: path.join(root, "png", `${name}-images-blocked.png`), fullPage: true }); await nb.close();
  }
}
for (const f of fs.readdirSync(path.join(root, "txt")).filter((x) => /^(resume-es\.|yev-es-premium-on-full|talk-es-full|yev-en-premium-off-none)/.test(x))) {
  const ctx = await b.newContext({ viewport: { width: 700, height: 600 } }); const p = await ctx.newPage();
  await p.setContent(`<pre style="font:14px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;padding:16px">${fs.readFileSync(path.join(root, "txt", f), "utf8").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`);
  await p.screenshot({ path: path.join(root, "png", f.replace(/\.txt$/, "-plaintext.png")), fullPage: true }); await ctx.close();
}
await b.close(); console.log("shots:", fs.readdirSync(path.join(root, "png")).length);
