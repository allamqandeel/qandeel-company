/**
 * COMPANY-TALENT-01 test helpers: complete synthetic identity profiles and program definitions, drafted in the Talent
 * Catalog and approved through the real governed confirmation (no model, no provider call, synthetic text only).
 */
import { programTemplate, type IdentitySpec } from '@qandeel-company/mind';

import { FounderActionStore, FounderAuthStore, TalentCatalogStore, type FounderSession } from '../src/index.js';
import type { Harness } from './helpers.js';

/** A complete synthetic identity profile for a role (every Stage 4 §7 field present). */
export function sampleIdentity(roleRef: string, title: string, overrides: Partial<IdentitySpec> = {}): IdentitySpec {
  return {
    roleRef,
    name: null,
    title,
    roleSummary: `SYNTHETIC: ${title} for QANDEEL COMPANY, accountable for evidence-based work in this role.`,
    personality: ['analytical', 'calm', 'direct'],
    professionalStyle: 'SYNTHETIC: structured, evidence first, states assumptions and confidence explicitly.',
    communicationStyle: 'SYNTHETIC: short, clear, separates facts from analysis and recommendations.',
    specialties: ['SYNTHETIC specialty one', 'SYNTHETIC specialty two'],
    marketExpertise: ['SYNTHETIC: Egypt and the Gulf'],
    workBehaviour: 'SYNTHETIC: plans small, verifies sources, escalates what exceeds its authority to its manager.',
    qualityStandards: ['SYNTHETIC: every claim cites its source', 'SYNTHETIC: uncertainty is stated, never hidden'],
    boundaries: ['SYNTHETIC: never spends or publishes without approval', 'SYNTHETIC: never claims unpublished platform internals'],
    designedBackground: null,
    sourceRef: 'doc:docs/talent/synthetic.md',
    ...overrides,
  };
}

/** Drafts an identity profile and approves it through TALENT_DEFINITION_DECIDE; returns the definition id. */
export function approveIdentity(h: Harness, founderRef: string, actions: FounderActionStore, session: FounderSession, code: string, spec: IdentitySpec): string {
  const d = TalentCatalogStore.for(h.store).saveDraft(founderRef, { kind: 'IDENTITY_PROFILE', code, body: spec }).definition;
  const p = actions.preview(session, 'TALENT_DEFINITION_DECIDE', { definitionId: d.id, decision: 'APPROVE' });
  actions.confirm(session, p.id, p.fingerprint);
  return d.id;
}

/** A complete synthetic BQM-2 program for a role (two Skills, practice / assessment / holdout scenarios, shadow work). */
export function sampleProgram(input: { roleRef: string; code: string; title: string; leader: boolean; competencies?: readonly Record<string, unknown>[]; toolCode?: string; version?: number }): Record<string, unknown> {
  const base = programTemplate({ roleRef: input.roleRef, code: input.code, title: input.title, leader: input.leader }) as Record<string, unknown> & { program: Record<string, unknown> };
  const skill = (code: string, name: string): Record<string, unknown> => ({
    code,
    name,
    versionLabel: '1.0.0',
    instructions: `SYNTHETIC skill ${name}: work from current, citable sources; state the evidence and its date; separate verified facts from assumptions; propose a small reversible test with a success metric and a stop rule; escalate decisions beyond your authority.`,
    blueprintCategory: 'REQUIRED',
    critical: true,
    minProficiency: 'QUALIFIED',
    targetProficiency: 'QUALIFIED',
    sourceRefs: ['authority:stage-7'],
    benchmark: [{ code: `${code}.case-1`, content: `SYNTHETIC benchmark case for ${name}: a growth idea arrives with weak evidence. Decide what to do.`, expect: { evidence: ['INSUFFICIENT', 'PARTIAL'], critical: ['evidence'] } }],
  });
  const skills = [skill(`${input.code}.research`, 'Platform research'), skill(`${input.code}.experiments`, 'Experiment design')];
  return {
    ...base,
    version: input.version ?? 1,
    skills,
    program: { ...base.program, skillTargets: skills.map((s) => ({ skillCode: s.code, proficiency: 'QUALIFIED' })), ...(input.competencies ? { competencies: input.competencies } : {}) },
    scenarios: [
      { code: `${input.code}.practice-1`, kind: 'PRACTICE', sourceRef: 'scenario:synthetic', budgetMicros: 40_000, content: 'SYNTHETIC practice scenario: plan a first two-week test on the platform.' },
      { code: `${input.code}.assess-1`, kind: 'ASSESSMENT', sourceRef: 'scenario:synthetic', budgetMicros: 40_000, content: 'SYNTHETIC assessment scenario: read these metrics and propose the next experiment.' },
      { code: `${input.code}.assess-2`, kind: 'ASSESSMENT', sourceRef: 'scenario:synthetic', budgetMicros: 40_000, content: 'SYNTHETIC assessment scenario: a rumour says the algorithm changed. What do you do?' },
      { code: `${input.code}.holdout-1`, kind: 'HOLDOUT', sourceRef: 'scenario:synthetic', budgetMicros: 40_000, content: 'SYNTHETIC hidden holdout: a manager asks you to promise viral reach next week.' },
      ...(input.toolCode ? [{ code: `${input.code}.tool-1`, kind: 'ASSESSMENT', sourceRef: 'scenario:synthetic', budgetMicros: 40_000, toolCode: input.toolCode, content: 'SYNTHETIC tool scenario: produce the edit with the integrated tool.' }] : []),
    ],
    shadowAssignments: [{ code: `${input.code}.shadow-1`, objective: 'SYNTHETIC internal shadow brief (no external effect)', instructions: 'SYNTHETIC: write an internal brief only; nothing is published or sent outside the Company.', capMicros: 60_000 }],
  };
}

/** The same approval through a fresh Founder session (for tests that hold no session of their own). */
export function approveIdentityAsFounder(h: Harness, founderRef: string, code: string, spec: IdentitySpec): string {
  const auth = FounderAuthStore.for(h.store);
  const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
  return approveIdentity(h, founderRef, FounderActionStore.for(h.store, auth), session, code, spec);
}
