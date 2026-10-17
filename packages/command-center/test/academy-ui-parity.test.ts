/**
 * COMPANY-MAJED-ACADEMY-01 — the seat case's assessment prompt (`@qandeel-company/command-center-ui` academyUi) states the
 * number the release's own programs require, and the activation registry carries it. The browser bundle cannot import
 * the contracts, so this is where drift would show.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { academyUi } from '@qandeel-company/command-center-ui';
import { CEO_ACADEMY_PACKAGE_V1, CEO_ACADEMY_PACKAGE_V2, CEO_ACADEMY_PACKAGE_V3, CEO_ACADEMY_PACKAGE_V4, CEO_ACADEMY_PACKAGE_V5, CEO_ACADEMY_PACKAGE_V6, CEO_ACADEMY_PACKAGE_V7 } from '@qandeel-company/mind';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

describe('COMPANY-MAJED-ACADEMY-01: the assessment prompt matches the programs', () => {
  test('every CEO package states its own assessmentTrials (3)', () => {
    for (const p of [CEO_ACADEMY_PACKAGE_V1, CEO_ACADEMY_PACKAGE_V2, CEO_ACADEMY_PACKAGE_V3, CEO_ACADEMY_PACKAGE_V4, CEO_ACADEMY_PACKAGE_V5, CEO_ACADEMY_PACKAGE_V6, CEO_ACADEMY_PACKAGE_V7]) {
      assert.equal(p.program.assessmentTrials, 3, `v${p.version}`);
      assert.equal(academyUi.assessmentPrompt(p.program.assessmentTrials), 'Start an assessment (the program needs 3 passed, including a clean hidden holdout)');
    }
  });

  test('the activation registry hands the panel each package\'s assessmentTrials and shadow assignments', () => {
    const api = readFileSync(path.join(srcDir, 'api.ts'), 'utf8');
    assert.match(api, /assessmentTrials: p\.program\.assessmentTrials,/);
    assert.match(api, /shadowAssignments: p\.shadowAssignments\.map\(\(a\) => \(\{ code: a\.code, objective: a\.objective \}\)\),/);
  });
});
