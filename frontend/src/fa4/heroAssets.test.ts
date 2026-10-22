import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** DSC-40 — the approved crops are used EXACTLY (SHA-1 + size); never re-cropped, re-compressed or swapped for an older version. */
const dir = resolve(__dirname, "assets/brand");
const jpegSize = (b: Buffer) => { let i = 2; while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]!; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + b.readUInt16BE(i + 2); } return [0, 0]; };
describe("YEV hero assets (DSC-40)", () => {
  it.each([
    ["yev-hero-torres-wide.jpg", "e5a77fd5bc63f80f74cd6f2a922449ee72846fca", [2600, 1144]],
    ["yev-hero-torres-mobile.jpg", "726560fdd8230cca3338980a7735f04262042b0f", [1100, 1000]],
  ] as const)("%s has the approved SHA-1 and dimensions", (file, sha1, size) => {
    const b = readFileSync(resolve(dir, file));
    expect(createHash("sha1").update(b).digest("hex")).toBe(sha1); expect(jpegSize(b)).toEqual([...size]);
  });
  it("brand.ts points the YEV hero at those files (not at the staircase photographs)", () => {
    const src = readFileSync(resolve(__dirname, "brand.ts"), "utf8");
    expect(src).toContain("assets/brand/yev-hero-torres-wide.jpg"); expect(src).toContain("assets/brand/yev-hero-torres-mobile.jpg");
    expect(src).not.toMatch(/import\s+\w+\s+from\s+'\.\/assets\/brand\/hero-architecture/);
  });
});
