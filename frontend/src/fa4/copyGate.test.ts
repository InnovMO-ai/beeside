import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatKeyDate } from '@beeside/fa-public-engine';
import { UI, fill } from './copy/ui';

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

  it('PO-approved wording (VERIFY close) is in place', () => {
    expect(UI.saved.es.includes('{email}') && fill(UI.saved, 'es', { email: 'a***@b.c' })).toBe('Te enviamos el enlace de regreso a a***@b.c.');
    expect(fill(UI.saved, 'en', { email: 'a***@b.c' })).toBe('We sent your return link to a***@b.c.');
    expect(`${UI.coverTitleLead.en} ${UI.coverTitleAccent.en}`).toBe('Your expansion starts with a clearer view.');   // cover (PO design mock)
    expect(UI.coverNoteStrong.en).toBe('Investing 10-15 minutes to plan today will give you weeks of freedom tomorrow.');   // typo "yoy" fixed
    expect(UI.coverNote.en).toBe('You can save and continue later.');                                                     // typo "Yo" fixed
    expect(UI.sizes['251-1000'].es).toBe('251–1,000'); expect(UI.sizes['1000+'].es).toBe('Más de 1,000');
    expect(UI.noPremiumTitle.en).toBe('Your project, with more clarity');
    expect(UI.catalogErrorBody.en).not.toMatch(/lost/i);
    expect(UI.exitBody.es).not.toMatch(/anónim/i);
    expect(UI.headAppliesN.es).toBe('{applies} temas aplican a tu proyecto');
  });
  it('date placeholder examples are inputs the date formatter accepts', () => {
    for (const ex of ['2028-Q1', '2026-12']) expect(formatKeyDate(ex, 'es')).not.toBe(ex);
  });
});
