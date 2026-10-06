/**
 * L1-02 — the CEO Academy package `ceo.company-ceo` v7 (D-L1-35A): v6 with one change — the governance-discipline
 * instructions no longer carry any wording that selects the response language. v1–v6 stay exactly as released (their
 * digests are pinned by a test); v4, v5 and v6 stay QUALIFYING history.
 *
 *   - REUSE_QUALIFIED (no new version, no review, no benchmark): v6's five reused Skills, unchanged — executive-judgment,
 *     organization-leadership and evidence-and-economics (`1.0.0+pkg4`, evidence owned by v4); founder-partnership and
 *     cross-functional-synthesis (`1.0.0+pkg5`, evidence owned by v5). Their SQF-1 fingerprints equal their owners'.
 *   - QUALIFY_NEW (`1.0.0+pkg7`, chained to the pkg6 version): governance-discipline = the pkg6 instructions with the
 *     language-direction wording removed (three exact spans, nothing added); the principle that refusing an act never
 *     means refusing the required structured answer is kept. The D-L1-34 diagnostic (not qualification evidence) ran this
 *     exact text against the pkg6 text: the answers followed the case language. Language remains governed by the AC-4
 *     ANSWER contract alone.
 * Cases, expectations, the BQM-2 / R2 / AC-4 pins, program, scenarios, holdouts, shadow work, task classes, limits and the
 * 4096 ceiling are v6's.
 */
import type { AcademyPackage, PackageSkill } from '../academy-package.js';
import { CEO_ACADEMY_PACKAGE_V6 } from './ceo-academy-v6.js';

const V6 = CEO_ACADEMY_PACKAGE_V6;

/** The five Skill Versions qualified on their own evidence (v4: the first three; v5: the last two): consumed as they are. */
export const CEO_V7_REUSED_SKILLS: readonly string[] = ['ceo.executive-judgment', 'ceo.organization-leadership', 'ceo.evidence-and-economics', 'ceo.founder-partnership', 'ceo.cross-functional-synthesis'];

/** The one Skill qualified anew in v7. */
export const CEO_V7_REVISED_SKILL = 'ceo.governance-discipline';

/** The exact language-direction spans removed from the pkg6 governance instructions (each present exactly once). */
export const CEO_V7_LANGUAGE_DIRECTION_REMOVALS: readonly { readonly from: string; readonly to: string }[] = [
  { from: 'Answer in the language of the request or work case unless the requester explicitly asks for another language. ', to: '' },
  { from: 'closest safe alternative in that same language.', to: 'closest safe alternative.' },
  { from: '\nTake the response language from the text of the current request or Work Item itself: answer an English request in English and an Arabic request in Arabic, unless the requester explicitly asks for another language. Never infer the language from who the requester is, their nationality or market, earlier conversations, identity or assumed preferences.', to: '' },
];

/** The pkg6 instructions minus the language-direction spans (fails closed when a span is not present exactly once). */
export function withoutLanguageDirection(instructions: string): string {
  let out = instructions;
  for (const r of CEO_V7_LANGUAGE_DIRECTION_REMOVALS) {
    if (out.split(r.from).length !== 2) throw new Error('package v7: a language-direction span is not present exactly once');
    out = out.replace(r.from, () => r.to);
  }
  return out;
}

const revise = (s: PackageSkill): PackageSkill => {
  if (CEO_V7_REUSED_SKILLS.includes(s.code)) return { ...s, binding: 'REUSE_QUALIFIED' };
  if (s.code !== CEO_V7_REVISED_SKILL) throw new Error(`package v7: no decision for Skill ${s.code}`);
  return { ...s, versionLabel: '1.0.0+pkg7', instructions: withoutLanguageDirection(s.instructions) };
};

export const CEO_ACADEMY_PACKAGE_V7: AcademyPackage = {
  ...V6,
  version: 7,
  title: 'QANDEEL COMPANY CEO — Academy package v7',
  skills: V6.skills.map(revise),
};
