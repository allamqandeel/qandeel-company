/**
 * L1-02 — the CEO Academy package `ceo.company-ceo` v2 (D-L1-19): the revision after package v1 truthfully failed its
 * Skill Version qualification. v1 stays exactly as released (its digest is pinned by a test) and stays failed history.
 *
 * What changes, and why (from v1's durable evidence):
 *   - Every Skill gets a NEW Skill Version under the same semantic Skill identity (`1.0.0+pkg2`, chained to the v1 version):
 *     a Skill Version is qualified inside exactly one package, so v2's evidence can never be confused with v1's. The
 *     instruction payloads are unchanged — v1's one scored failure was not a Skill weakness (see the L1-02 report).
 *   - The benchmark output ceiling is 4096 (D-L1-20): `max_tokens` bounds thinking + answer together; a legal 6000-
 *     character body at the densest observed language (Arabic, ~2.23 characters per output token) needs ~2691 tokens
 *     before the JSON envelope, and a successful reasoning retry already spent ~400 thinking tokens. 4096 is the
 *     smallest common ceiling of every deployment the `skill.benchmark` route may use (E1 4096, E2 16384). v1's 1536
 *     could not hold a legal Arabic answer and truncated five of its six failed thinking-class retries.
 * Nothing else changes: the cases, rubric expectations, pass mark, program, scenarios and per-run money cap are v1's.
 * The money cap stays sufficient under the canonical worst case (24000-token context at 0.30 + 4096 output tokens at
 * 1.20 USD per million ≈ 12 115 micro-units per call; an answer run makes at most two calls ≈ 24 230 < 40 000).
 */
import type { AcademyPackage } from '../academy-package.js';
import { CEO_ACADEMY_PACKAGE_V1 } from './ceo-academy-v1.js';

const V1 = CEO_ACADEMY_PACKAGE_V1;

export const CEO_ACADEMY_PACKAGE_V2: AcademyPackage = {
  ...V1,
  version: 2,
  title: 'QANDEEL COMPANY CEO — Academy package v2',
  skills: V1.skills.map((s) => ({ ...s, versionLabel: '1.0.0+pkg2' })),
  limits: { ...V1.limits, benchmarkMaxOutputTokens: 4_096 },
};
