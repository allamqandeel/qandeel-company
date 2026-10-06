/**
 * L1-02 — the CEO Academy package `ceo.company-ceo` v3 (D-L1-22): the revision after package v2 truthfully failed two
 * with-skill benchmark cases. v1 and v2 stay exactly as released (their digests are pinned by a test) and stay failed
 * history; their durable SCORED evidence is never re-run.
 *
 * What changes, and why (from v2's durable evidence): both failed cases answered the primary act's irreversibility
 * correctly in the body but set the structured `reversible` facet for the recommended next step (gather evidence, delay
 * the launch). That ambiguity is closed OUTSIDE the package, in the shared ANSWER contract (`ANSWER_REVERSIBLE_SEMANTICS`,
 * D-L1-22), so it applies to every answer-bearing Work Item, not to this benchmark only.
 *
 * The package itself differs from v2 only by its version, title and Skill Version labels: every Skill gets a NEW Skill
 * Version under the same semantic Skill identity (`1.0.0+pkg3`, chained to the v2 version), because a Skill Version is
 * qualified inside exactly one package. The instruction payloads, cases, rubric expectations, pass mark, program,
 * scenarios, money caps and the 4096 output ceiling are v2's — no failed expectation is weakened.
 */
import type { AcademyPackage } from '../academy-package.js';
import { CEO_ACADEMY_PACKAGE_V2 } from './ceo-academy-v2.js';

const V2 = CEO_ACADEMY_PACKAGE_V2;

export const CEO_ACADEMY_PACKAGE_V3: AcademyPackage = {
  ...V2,
  version: 3,
  title: 'QANDEEL COMPANY CEO — Academy package v3',
  skills: V2.skills.map((s) => ({ ...s, versionLabel: '1.0.0+pkg3' })),
};
