import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UI } from './copy/ui';

/**
 * Copy gate. Every customer-facing string must live in copy/ui.ts (or the engine's i18n) as an L()/NC() pair so that the inventory
 * captures it and ES/EN parity can be checked. These tests fail on inline language ternaries and on literal text inside JSX.
 */
const root = join(__dirname);
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\.|test-helpers/.test(f) && !p.includes('/copy/') ? [p] : [];
});

describe('copy gate', () => {
  it('no component picks wording with an inline language ternary', () => {
    const offenders = files(root).filter((f) => /\b(locale|loc|l)\s*===\s*['"](es|en)['"]\s*\?/.test(readFileSync(f, 'utf8').replace(/aria-checked=\{locale === l\}/g, '')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
  });

  it('no literal prose between JSX tags in components', () => {
    const offenders: string[] = [];
    for (const f of files(root).filter((x) => x.endsWith('.tsx'))) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // text directly between > and < that contains a letter (excludes {expressions}, entities and punctuation-only separators)
        for (const m of line.matchAll(/>([^<>{}]*[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}[^<>{}]*)</g)) {
          if (!/^\s*$/.test(m[1]!) && !/=>|&&|\|\||Promise|^(LOGO|beeside)$/.test(m[1]!.trim())) offenders.push(`${f.replace(root, '')}:${i + 1}: ${m[1]!.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('ES/EN parity: every UI entry has both languages, non-empty, with the same placeholders', () => {
    const bad: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (v && typeof v === 'object' && 'es' in v && 'en' in v) {
        const { es, en } = v as { es: string; en: string };
        if (!es.trim() || !en.trim()) bad.push(`${path}: empty`);
        const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
        if (ph(es) !== ph(en)) bad.push(`${path}: placeholders differ`);
      } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(UI, 'UI');
    expect(bad).toEqual([]);
  });
});
