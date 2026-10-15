#!/usr/bin/env node
/**
 * Rebuilds the Discovery lockups from the OFFICIAL parts, without clipping and without re-sampling a defective composite:
 *   - wordmark: the official vector paths (src/fa4/assets/brand/src/lockup-*.official.svg), unchanged;
 *   - bee: the official 1920×1080 matte (bee-matte-1920x1080.png: crisp, complete incl. antenna bulbs) used as the shape, filled with the official
 *     variant colours (purple on light surfaces, the light wordmark colour on dark surfaces), cropped to its bounding box and stored at ~3× the largest
 *     display size so the browser never down-scales it by a large factor;
 *   - geometry: identical to the official lockup (same viewBox, same wordmark and bee positions) so no layout changes.
 * No clipPath is applied to the bee. Also renders the 3× PNG used in e-mails (clients do not render SVG).
 * TEMPORARY until Brand supplies a native vector (BRAND-1). Run from frontend/: node scripts/build-brand-lockups.mjs (needs @playwright/test).
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const B = path.join(root, 'src/fa4/assets/brand');
const SRC = path.join(B, 'src');
const strip = (s) => s.replace(/<metadata>[\s\S]*?<\/metadata>/g, '');
const wordmark = (file) => {
  const s = strip(fs.readFileSync(path.join(SRC, file), 'utf8'));
  const i = s.indexOf('<g transform="matrix(1, 0, 0, 1, 45, 50)">');
  const clip = s.match(/<clipPath id="[a-f0-9]+"><rect x="0" width="528" y="0" height="150"\/><\/clipPath>/)[0];
  return { clip, body: s.slice(i, s.lastIndexOf('</svg>')) };
};

const matte = fs.readFileSync(path.join(SRC, 'bee-matte-1920x1080.png')).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const bee = await page.evaluate(async ({ matte }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + matte;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
    const l = d.data[(y * c.width + xx) * 4];
    if (l > 24) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const pad = 6; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const colour = (rgb) => {
    const o = document.createElement('canvas');
    o.width = w; o.height = h;
    const ox = o.getContext('2d');
    const od = ox.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const l = d.data[((y + y0) * c.width + (xx + x0)) * 4];
      const i = (y * w + xx) * 4;
      od.data[i] = rgb[0]; od.data[i + 1] = rgb[1]; od.data[i + 2] = rgb[2]; od.data[i + 3] = l;
    }
    ox.putImageData(od, 0, 0);
    // stepwise halving down to ≈ 360 px tall: smooth, no moiré, still ≥ 3× the largest display height (≈ 110 px)
    let cur = o;
    const target = 360;
    while (cur.height / 2 >= target) {
      const n = document.createElement('canvas');
      n.width = Math.round(cur.width / 2); n.height = Math.round(cur.height / 2);
      const nx = n.getContext('2d');
      nx.imageSmoothingQuality = 'high';
      nx.drawImage(cur, 0, 0, n.width, n.height);
      cur = n;
    }
    const f = target / cur.height;
    const n = document.createElement('canvas');
    n.width = Math.round(cur.width * f); n.height = target;
    const nx = n.getContext('2d');
    nx.imageSmoothingQuality = 'high';
    nx.drawImage(cur, 0, 0, n.width, n.height);
    return { png: n.toDataURL('image/png'), w: n.width, h: n.height };
  };
  return { x0, y0, x1, y1, w, h, purple: colour([0x5b, 0x3b, 0xb5]), light: colour([0xf1, 0xf1, 0xfa]) };
}, { matte });
console.log('bee bbox in matte', bee.x0, bee.y0, bee.x1, bee.y1, 'raster', bee.purple.w, 'x', bee.purple.h);

// official placement of the bee inside the lockup viewBox (scale/translate of the official file)
const S = 0.318446, TX = 407.693376, TY = -42.181027;
const bx = TX + S * bee.x0, by = TY + S * bee.y0, bw = S * (bee.x1 - bee.x0 + 1), bh = S * (bee.y1 - bee.y0 + 1);
const VIEW = '0 0 836.88 261.749984';
const lockup = (word, fill, colour) => {
  const w = wordmark(word);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${VIEW}" width="1116" height="349" preserveAspectRatio="xMidYMid meet" role="img" aria-label="beeside"><defs>${w.clip}</defs><image x="${bx.toFixed(3)}" y="${by.toFixed(3)}" width="${bw.toFixed(3)}" height="${bh.toFixed(3)}" preserveAspectRatio="xMidYMid meet" xlink:href="${colour.png}"/>${w.body.replace(/fill="#[0-9a-fA-F]{6}"/g, `fill="${fill}"`)}</svg>\n`;
};
fs.writeFileSync(path.join(B, 'lockup-dark.svg'), lockup('lockup-dark.official.svg', '#000000', bee.purple));
fs.writeFileSync(path.join(B, 'lockup-light.svg'), lockup('lockup-light.official.svg', '#f1f1fa', bee.light));
const mark = (c) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${c.w} ${c.h}" width="${c.w}" height="${c.h}" role="img" aria-label="beeside"><image width="${c.w}" height="${c.h}" xlink:href="${c.png}"/></svg>\n`;
fs.writeFileSync(path.join(B, 'bee-mark-purple.svg'), mark(bee.purple));
fs.writeFileSync(path.join(B, 'bee-mark-white.svg'), mark(bee.light));

// e-mail PNG: 3× of the 160×50 slot (left-aligned, no left margin), rendered by Chromium from the SVG above (transparent)
// the e-mail slot is flush-left with the text under it: drop the lockup's left margin (viewBox starts at the wordmark) and anchor to the left
const svg = fs.readFileSync(path.join(B, 'lockup-dark.svg'), 'utf8').replace('viewBox="0 0 836.88 261.749984"', 'viewBox="45 0 792 261.749984"').replace('preserveAspectRatio="xMidYMid meet" role', 'preserveAspectRatio="xMinYMid meet" role');
const p2 = await browser.newPage({ viewport: { width: 480, height: 150 }, deviceScaleFactor: 3 });
await p2.setContent(`<body style="margin:0;background:transparent"><img id="l" style="width:160px;height:50px;display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body>`);
await p2.evaluate(() => document.getElementById('l').decode());
fs.mkdirSync(path.join(root, 'public/brand'), { recursive: true });
await (await p2.$('#l')).screenshot({ path: path.join(root, 'public/brand/beeside-lockup.png'), omitBackground: true });
await browser.close();
for (const f of ['lockup-dark.svg', 'lockup-light.svg', 'bee-mark-purple.svg', 'bee-mark-white.svg']) console.log(f, fs.statSync(path.join(B, f)).size, 'bytes');
