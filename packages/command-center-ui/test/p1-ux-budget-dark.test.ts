/**
 * P1-UX-BUDGET-DARK-01 — the pure parts of the Company budget editor and the dark surface: the headroom an envelope can
 * still admit, the refusals in words (nothing changed in every case), and the stylesheet's dark contract (dark colour
 * scheme, no light surface left behind, the Employee lens keeping the company readable behind a person's sheet).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { budgetHeadroomMicros, refusalText } from '../src/app/panels.js';
import { DEPARTMENT_COLORS } from '../src/app/view.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const css = readFileSync(path.join(publicDir, 'styles.css'), 'utf8');

describe('P1-UX-BUDGET-DARK-01: the Company budget editor', () => {
  test('headroom is the ceiling less spent and reserved, never below zero', () => {
    assert.equal(budgetHeadroomMicros({ capMoney: 590_000, spentMoney: 120_000, reservedMoney: 30_000 }), 440_000);
    assert.equal(budgetHeadroomMicros({ capMoney: 590_000, spentMoney: 0 }), 590_000, 'no reservation recorded');
    assert.equal(budgetHeadroomMicros({ capMoney: 590_000, spentMoney: 600_000, reservedMoney: 10_000 }), 0, 'an overrun shows no headroom, not a negative one');
  });

  test('every refusal says that nothing changed; budget refusals are named', () => {
    const cases: [string, string, string | null, RegExp][] = [
      ['BUDGET_CEILING', 'FOUNDER_CONFIRMATION_REQUIRED', 'ALREADY_EXPIRED', /expired/],
      ['BUDGET_CEILING', 'FOUNDER_CONFIRMATION_REQUIRED', 'FINGERPRINT_MISMATCH', /no longer matches/],
      ['BUDGET_CEILING', 'FOUNDER_CONFIRMATION_REQUIRED', 'SESSION_MISMATCH', /earlier session/],
      ['BUDGET_CEILING', 'FOUNDER_CONFIRMATION_REQUIRED', 'ALREADY_REJECTED', /already decided/],
      ['BUDGET_CEILING', 'BUDGET_EXHAUSTED', null, /envelope above it .*Raise that one first/],
      ['BUDGET_CEILING', 'VALIDATION_FAILED', null, /spent and reserved/],
      ['BUDGET_CEILING', 'CURRENCY_MISMATCH', null, /own currency/],
      ['GOAL_APPROVE', 'VALIDATION_FAILED', null, /^Not executed \(VALIDATION_FAILED\)/],
    ];
    for (const [intent, code, reason, want] of cases) {
      const text = refusalText(intent, code, reason);
      assert.match(text, want, `${intent} ${code} ${reason ?? ''}`);
      assert.match(text, /Nothing changed/, `${code}: the Founder is told nothing changed`);
    }
  });
});

describe('P1-UX-BUDGET-DARK-01: the dark executive surface', () => {
  test('the page and its native controls are dark by default (no toggle)', () => {
    assert.match(css, /:root \{\s*color-scheme: dark;/);
    for (const page of ['index.html', 'desktop.html', 'launch.html']) assert.match(readFileSync(path.join(publicDir, page), 'utf8'), /<meta name="color-scheme" content="dark">/, page);
    assert.doesNotMatch(css, /data-theme|prefers-color-scheme: light/, 'one design for this version: no light/dark toggle');
  });

  test('no light surface is left behind as a literal', () => {
    // White remains only as ink (lightened text and the initials on a filled avatar), never as a surface.
    const luminance = (hex: string): number => {
      const full = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1);
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const surfaces = [...css.matchAll(/background(?:-color)?:\s*([^;]+);/g)].map((m) => m[1] ?? '');
    // A paper-white field (the light palette's #fffdf7, #f0ede5, … all sit above 0.8) or a strong white wash.
    const light = surfaces.filter((v) => [...v.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)].some((m) => luminance(m[0]) > 0.75) || /rgba\(255, 255, 255, 0\.[3-9]/.test(v));
    assert.deepEqual(light, []);
    assert.doesNotMatch(css, /#f4f2ec|#fbfaf7|rgba\(244, 242, 236/, 'the paper palette is gone');
  });

  test('a person sheet keeps the company readable behind it; the spotlight keeps its own quieting', () => {
    const rule = (selector: string): number => {
      const m = new RegExp(`${selector.replace(/[[\]().*"]/g, '\\$&')} \\{ opacity: ([\\d.]+); \\}`).exec(css);
      assert.ok(m, selector);
      return Number(m[1]);
    };
    const lens = ':root[data-lens="EMPLOYEE"]:not([data-spotlight])';
    assert.ok(rule(`${lens} .card.is-quiet`) >= 0.75, 'people behind the sheet stay legible');
    assert.ok(rule(`${lens} .column.is-quiet`) >= 0.85, 'the five Departments stay in colour');
    assert.ok(rule(`${lens} .goal.is-quiet`) >= 0.75, 'the goals stay legible');
    assert.ok(rule('.card.is-quiet') < 0.6, 'the default quieting (goal focus, spotlight) is unchanged');
    assert.doesNotMatch(css, /\.focus[^{]*\{[^}]*backdrop-filter/, 'no blur behind the sheet');
  });

  test('the five Department accents stay five distinct hues', () => {
    assert.equal(new Set(DEPARTMENT_COLORS).size, 5);
  });
});
