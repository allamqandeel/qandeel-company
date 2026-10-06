/**
 * L1-02 — the CEO Academy package `ceo.company-ceo` v2 (D-L1-19): the revision after package v1 truthfully failed its
 * Skill Version qualification. v1 stays exactly as released (its digest is pinned by a test) and stays failed history.
 *
 * What changes, and why (from v1's durable evidence):
 *   - Every Skill gets a NEW Skill Version under the same semantic Skill identity (`1.0.0+pkg2`, chained to the v1 version):
 *     a Skill Version is qualified inside exactly one package, so v2's evidence can never be confused with v1's. The
 *     instruction payloads are unchanged — v1's one scored failure was not a Skill weakness (see the L1-02 report).
 *   - The benchmark output ceiling admits every answer the ANSWER contract accepts: a body of up to 6000 characters at
 *     the densest observed language (Arabic, ~2.23 characters per output token) needs ~2691 tokens, plus the JSON
 *     envelope. v1's 1536 could not hold a legal Arabic answer and truncated every thinking-class retry that reached it.
 * Nothing else changes: the cases, rubric expectations, pass mark, program, scenarios and per-run money cap are v1's.
 */
import type { AcademyPackage } from '../academy-package.js';
import { CEO_ACADEMY_PACKAGE_V1 } from './ceo-academy-v1.js';

const V1 = CEO_ACADEMY_PACKAGE_V1;

export const CEO_ACADEMY_PACKAGE_V2: AcademyPackage = {
  ...V1,
  version: 2,
  title: 'QANDEEL COMPANY CEO — Academy package v2',
  skills: V1.skills.map((s) => ({ ...s, versionLabel: '1.0.0+pkg2' })),
  limits: { ...V1.limits, benchmarkMaxOutputTokens: 2_816 },
};
