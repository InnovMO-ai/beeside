import { expect, test } from '@playwright/test';
import { journeyA } from '@beeside/fa-public-engine/testing';
import { open, seed } from './helpers';

// DSC-40 · objective contrast of the WHITE text / controls over the hero photograph + dark-blue veil, at the four widths.
// Method: hide every foreground element of the hero, screenshot the bare backdrop, and for each element take the LIGHTEST decile of the pixels under its box
// (the worst case for white text). Ratio = WCAG relative luminance of #fff against that backdrop. Text ≥ 4.5 (≥ 3 for large text); UI component boundary ≥ 3.
const lum = (r: number, g: number, b: number) => { const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };

test('DSC-40: white hero text and controls meet the contrast minimum', async ({ page, request }, info) => {
  const token = await seed(request, journeyA(), 'extra');
  await open(page, token);
  await page.getByRole('button', { name: 'Ver mi resultado' }).click();
  await page.getByTestId('result-screen').waitFor({ timeout: 20_000 });
  const hero = page.locator('.res-hero.photo');
  await hero.scrollIntoViewIfNeeded();
  const targets: Array<{ name: string; sel: string; min: number }> = [
    { name: 'eyebrow', sel: '.res-hero .eyebrow', min: 4.5 },
    { name: 'h1', sel: '.res-hero h1', min: 3 },
    { name: 'sub', sel: '.res-hero .sub', min: 4.5 },
    { name: 'help trigger', sel: '.res-hero .ha-trigger', min: 3 },
    { name: 'logo', sel: '.res-hero .hero-top .logo', min: 3 },
  ];
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const t of targets) { const b = await page.locator(t.sel).first().boundingBox(); if (b) boxes[t.name] = { x: b.x, y: b.y, w: b.width, h: b.height }; }
  // bare backdrop: foreground hidden, trigger background neutralised
  await page.addStyleTag({ content: '.res-hero.photo .in { visibility: hidden !important; }' });
  const hb = (await hero.boundingBox())!;
  const shot = (await page.screenshot({ clip: { x: hb.x, y: hb.y, width: hb.width, height: hb.height } })).toString('base64');
  const rows: string[] = [];
  const p90s = await page.evaluate(async ({ shot, hb, boxes }) => {
    const img = new Image(); img.src = `data:image/png;base64,${shot}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
    const sc = img.width / hb.width; const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const out: Record<string, number> = {};
    for (const [name, b] of Object.entries(boxes)) {
      const x0 = Math.max(0, Math.floor((b.x - hb.x) * sc)), y0 = Math.max(0, Math.floor((b.y - hb.y) * sc));
      const w = Math.max(1, Math.min(img.width - x0, Math.ceil(b.w * sc))), h = Math.max(1, Math.min(img.height - y0, Math.ceil(b.h * sc)));
      const d = g.getImageData(x0, y0, w, h).data; const ls: number[] = [];
      for (let i = 0; i < d.length; i += 8) ls.push(0.2126 * f(d[i]!) + 0.7152 * f(d[i + 1]!) + 0.0722 * f(d[i + 2]!));
      ls.sort((a, z) => a - z); out[name] = ls[Math.floor(ls.length * 0.9)] ?? 0;
    }
    return out;
  }, { shot, hb, boxes });
  for (const t of targets) {
    const p90 = p90s[t.name]; if (p90 === undefined) continue;
    const ratio = 1.05 / (p90 + 0.05);
    rows.push(`${info.project.name}\t${t.name}\t${ratio.toFixed(2)}\tmin ${t.min}`);
    expect.soft(ratio, `${info.project.name} · ${t.name}`).toBeGreaterThanOrEqual(t.min);
  }
  console.log('CONTRAST\n' + rows.join('\n'));
});
