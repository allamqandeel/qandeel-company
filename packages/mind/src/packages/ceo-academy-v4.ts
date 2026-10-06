/**
 * L1-02 — the CEO Academy package `ceo.company-ceo` v4 (D-L1-26): the first CEO package that opts into the Benchmark
 * Qualification Method v2. v1, v2 and v3 stay exactly as released (their digests are pinned by a test); they are BQM-1
 * history, and their durable SCORED evidence is never re-run or re-read under BQM-2.
 *
 * The package differs from v3 only by its version, title, Skill Version labels (`1.0.0+pkg4`: a new Skill Version under
 * each of the six semantic Skill identities, chained to the v3 version, because a Skill Version is qualified inside
 * exactly one package) and its `benchmarkMethod` pin. The pin is built from the canonical exported constants — the BQM-2
 * declaration digest and the ANSWER contract version and digest — so the method itself (fixed E1, k = 5, the answer-only
 * prompt and fence, one same-class retry, at most two model calls, R2, the layered absolute rule, N1, the VOID allowlist)
 * is never restated here. The instruction payloads, cases, rubric expectations, pass mark, program, scenarios, holdouts,
 * shadow work, money caps, task classes and the 4096 output ceiling are v3's — no expectation is weakened.
 */
import { ANSWER_CONTRACT_SHA256, ANSWER_CONTRACT_VERSION } from '@qandeel-company/governance';

import type { AcademyPackage } from '../academy-package.js';
import { BQM2_DECLARATION, BQM2_DECLARATION_SHA256 } from '../benchmark-method.js';
import { CEO_ACADEMY_PACKAGE_V3 } from './ceo-academy-v3.js';

const V3 = CEO_ACADEMY_PACKAGE_V3;

export const CEO_ACADEMY_PACKAGE_V4: AcademyPackage = {
  ...V3,
  version: 4,
  title: 'QANDEEL COMPANY CEO — Academy package v4',
  skills: V3.skills.map((s) => ({ ...s, versionLabel: '1.0.0+pkg4' })),
  benchmarkMethod: { version: BQM2_DECLARATION.version, declarationSha256: BQM2_DECLARATION_SHA256, answerContract: { version: ANSWER_CONTRACT_VERSION, sha256: ANSWER_CONTRACT_SHA256 } },
};
