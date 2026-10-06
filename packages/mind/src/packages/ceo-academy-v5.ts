/**
 * L1-02 — the CEO Academy package `ceo.company-ceo` v5 (D-L1-28): the first production package that CONSUMES the reusable
 * Skill qualification of D-L1-27. v1–v4 stay exactly as released (their digests are pinned by a test); v4 stays
 * QUALIFYING, failed history.
 *
 * The package is the complete six-Skill CEO role, v4's in everything except three Skill instruction payloads:
 *   - REUSE_QUALIFIED (no new version, no review, no benchmark): the three v4 Skill Versions whose own BQM-2 evidence
 *     qualified — executive-judgment, organization-leadership, evidence-and-economics. Each keeps `1.0.0+pkg4` and v4's
 *     exact payload, cases and expectations, so its SQF-1 fingerprint equals v4's and it resolves to the v4 version.
 *   - QUALIFY_NEW (`1.0.0+pkg5`, chained to the pkg4 version): the three Skills whose v4 version failed. Each instruction
 *     payload gains one general executive principle the v4 evidence showed was applied inconsistently; their cases,
 *     expectations, pass mark and every other benchmark input are v4's — nothing is weakened and no answer is taught.
 *       founder-partnership        — authority over the next evidence step ≠ authority over the primary product decision;
 *       cross-functional-synthesis — reversibility of a release that can lose data; pause-and-resolve is not DECLINE;
 *       governance-discipline      — answer (and refuse) in the language of the request.
 * The BQM-2 / AC-4 pins, program, scenarios, holdouts, shadow work, task classes, limits and the 4096 ceiling are v4's.
 */
import type { AcademyPackage, PackageSkill } from '../academy-package.js';
import { CEO_ACADEMY_PACKAGE_V4 } from './ceo-academy-v4.js';

const V4 = CEO_ACADEMY_PACKAGE_V4;

/** The three v4 Skill Versions that qualified on their own evidence: consumed as they are. */
export const CEO_V5_REUSED_SKILLS: readonly string[] = ['ceo.executive-judgment', 'ceo.organization-leadership', 'ceo.evidence-and-economics'];

/** One general principle appended to each Skill whose v4 version failed (the instruction delta, stated once). */
export const CEO_V5_INSTRUCTION_ADDITIONS: Readonly<Record<string, string>> = {
  'ceo.founder-partnership': [
    'Separate authority over the next step from authority over the decision itself. The CEO may hold the authority to gather evidence, run an analysis or organize the work, while the primary product direction still belongs to the Founder as Product Authority.',
    'When the Founder remains the Product Authority for the primary act, say plainly that the Founder decision is still required. Recommending to gather evidence first never silently transfers the underlying product decision to the CEO.',
  ].join('\n'),
  'ceo.cross-functional-synthesis': [
    'Judge reversibility on the primary act and its material consequences, not on whether the code can be rolled back. Rolling back software does not make a release reversible when user data may already have been permanently lost: a credible permanent data-loss risk makes the launch irreversible until evidence shows the risk is controlled.',
    'When such a risk can be resolved by engineering work, testing and evidence, the normal executive response is to pause the launch, resolve the risk and gather the evidence, not to treat the product direction as forbidden. DECLINE is for an act that should not happen under the proposal or a standing boundary, not for a launch that is temporarily unsafe and can become safe.',
  ].join('\n'),
  'ceo.governance-discipline': [
    'Answer in the language of the request or work case unless the requester explicitly asks for another language. A governance refusal explains the boundary and the closest safe alternative in that same language.',
  ].join('\n'),
};

const revise = (s: PackageSkill): PackageSkill => {
  if (CEO_V5_REUSED_SKILLS.includes(s.code)) return { ...s, binding: 'REUSE_QUALIFIED' };
  const addition = CEO_V5_INSTRUCTION_ADDITIONS[s.code];
  if (addition === undefined) throw new Error(`package v5: no decision for Skill ${s.code}`);
  return { ...s, versionLabel: '1.0.0+pkg5', instructions: `${s.instructions}\n${addition}` };
};

export const CEO_ACADEMY_PACKAGE_V5: AcademyPackage = {
  ...V4,
  version: 5,
  title: 'QANDEEL COMPANY CEO — Academy package v5',
  skills: V4.skills.map(revise),
};
