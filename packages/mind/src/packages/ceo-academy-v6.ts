/**
 * L1-02 — the CEO Academy package `ceo.company-ceo` v6 (D-L1-31): the complete six-Skill CEO role that consumes the five
 * Skill Versions already qualified on their own BQM-2 evidence and qualifies one new version. v1–v5 stay exactly as
 * released (their digests are pinned by a test); v4 and v5 stay QUALIFYING history.
 *
 *   - REUSE_QUALIFIED (no new version, no review, no benchmark): executive-judgment, organization-leadership and
 *     evidence-and-economics (`1.0.0+pkg4`, evidence owned by v4); founder-partnership and cross-functional-synthesis
 *     (`1.0.0+pkg5`, evidence owned by v5). Each is v5's exact Skill, so its SQF-1 fingerprint equals its owner's.
 *   - QUALIFY_NEW (`1.0.0+pkg6`, chained to the pkg5 version): governance-discipline. Its v5 instructions are kept in full
 *     and gain one general clarification of two operating principles the v5 evidence showed were not held: the response
 *     language follows the current request text (an English case received five Arabic bodies; the stored evidence does
 *     not show why, so no cause is assumed), and refusing a business act never means refusing the required structured
 *     response (three observations ended in two invalid outputs each). Cases, expectations and every other benchmark input
 *     are v5's — nothing is weakened and no answer is taught.
 * The BQM-2 / AC-4 pins, program, scenarios, holdouts, shadow work, task classes, limits and the 4096 ceiling are v5's.
 */
import type { AcademyPackage, PackageSkill } from '../academy-package.js';
import { CEO_ACADEMY_PACKAGE_V5 } from './ceo-academy-v5.js';

const V5 = CEO_ACADEMY_PACKAGE_V5;

/** The five Skill Versions qualified on their own evidence (v4: the first three; v5: the last two): consumed as they are. */
export const CEO_V6_REUSED_SKILLS: readonly string[] = ['ceo.executive-judgment', 'ceo.organization-leadership', 'ceo.evidence-and-economics', 'ceo.founder-partnership', 'ceo.cross-functional-synthesis'];

/** The one Skill qualified anew in v6. */
export const CEO_V6_REVISED_SKILL = 'ceo.governance-discipline';

/** The general clarification appended to the governance-discipline instructions (the instruction delta, stated once). */
export const CEO_V6_INSTRUCTION_ADDITION = [
  'Take the response language from the text of the current request or Work Item itself: answer an English request in English and an Arabic request in Arabic, unless the requester explicitly asks for another language. Never infer the language from who the requester is, their nationality or market, earlier conversations, identity or assumed preferences.',
  'Refusing a business act never means refusing the required response. A governance refusal still complies with the governed output contract of the current Work Item: decline the prohibited act and return the required structured answer. A boundary and the output format are independent obligations.',
].join('\n');

const revise = (s: PackageSkill): PackageSkill => {
  if (CEO_V6_REUSED_SKILLS.includes(s.code)) return { ...s, binding: 'REUSE_QUALIFIED' };
  if (s.code !== CEO_V6_REVISED_SKILL) throw new Error(`package v6: no decision for Skill ${s.code}`);
  return { ...s, versionLabel: '1.0.0+pkg6', instructions: `${s.instructions}\n${CEO_V6_INSTRUCTION_ADDITION}` };
};

export const CEO_ACADEMY_PACKAGE_V6: AcademyPackage = {
  ...V5,
  version: 6,
  title: 'QANDEEL COMPANY CEO — Academy package v6',
  skills: V5.skills.map(revise),
};
