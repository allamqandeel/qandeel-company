/**
 * G4-C2-SNA-01 (D-P1-15) test helpers: provisioning the assessment task class for one Employee, and running one Skill Need
 * Assessment through its own claimed, fenced run (governed Context Assembly, then the recorded result) — no model call.
 */
import type { Id, SideEffectClass } from '@qandeel-company/domain';
import { SKILL_NEED_TASK_CLASS, type SkillNeedTier } from '@qandeel-company/governance';

import { SKILL_NEED_ASSESSMENT_KIND, SkillNeedStore } from '../src/index.js';
import { assembleContext, beginGovernedRun, claimJob, recordSkillNeed, settle, type AssembleResult, type Claim, type RecordSkillNeedInput, type RecordSkillNeedResult } from '../src/runtime-authority.js';
import type { Seed } from './c2-helpers.js';
import { backoff, type Harness } from './helpers.js';

export const SNA_KINDS: ReadonlyMap<string, SideEffectClass> = new Map([[SKILL_NEED_ASSESSMENT_KIND, 'IDEMPOTENT']]);

export const SNA_ROUTE_POLICY = { minClass: 'E1', maxClass: 'E1', allowLimitedProduction: true, maxRetriesPerCall: 1, maxCallsPerRun: 2, fallbackCostCeilingMicros: null, escalation: { maxDepth: 0, maxOverheadMicros: 20_000 } } as const;

/** The assessment's route policy, and (unless the Employee already holds one covering it) its explicit `model.invoke`. */
export function provisionSkillNeed(s: Seed, employeeId: Id, opts: { grant?: boolean } = {}): void {
  s.gov.createRoutePolicy(s.founder, SKILL_NEED_TASK_CLASS, SNA_ROUTE_POLICY);
  if (opts.grant !== false) s.gov.grant(s.founder, { employeeId, capability: 'model.invoke', resourceScope: SKILL_NEED_TASK_CLASS, riskCeiling: 'R0', dataClassCeiling: 'D2', reasonCode: 'founder.model_access' });
}

export const assessmentOf = (h: Harness, replyId: Id): Id | null => SkillNeedStore.for(h.store).assessmentOf(replyId);

/** Claims the assessment's queued job and binds its run to the Employee. */
export function claimAssessment(h: Harness, snaId: Id, worker = 'w-sna'): Claim {
  const job = h.store.jobsFor(snaId).find((j) => j.state === 'QUEUED');
  if (!job) throw new Error(`no queued assessment job for ${snaId}`);
  const claim = claimJob(h.store, job.id, { ...h.claimOpts(worker, 600_000), kinds: SNA_KINDS });
  if (!claim) throw new Error('assessment claim failed');
  const begun = beginGovernedRun(h.store, claim.fence);
  if (!begun.ok) throw new Error(`assessment run refused: ${begun.code}`);
  return claim;
}

export const proposalOf = (tiers: Readonly<Record<string, SkillNeedTier>>): Extract<RecordSkillNeedInput, { kind: 'PROPOSAL' }>['proposal'] => ({ type: 'SKILL_NEED', skills: Object.entries(tiers).map(([code, tier]) => ({ code, tier })) });

/**
 * Runs the reply's assessment: assembles its context (step 0), then records the given tiers as the model's SKILL_NEED (or a
 * fallback cause) and settles the run.
 */
export function assess(h: Harness, replyId: Id, result: Readonly<Record<string, SkillNeedTier>> | { readonly fallback: Extract<RecordSkillNeedInput, { kind: 'FALLBACK' }>['outcome'] }, worker = 'w-sna'): { context: AssembleResult; recorded: RecordSkillNeedResult; snaId: Id } {
  const snaId = assessmentOf(h, replyId);
  if (snaId === null) throw new Error('the reply has no assessment');
  const claim = claimAssessment(h, snaId, worker);
  const context = assembleContext(h.store, claim.fence, { step: 0 });
  const input: RecordSkillNeedInput = 'fallback' in result ? { kind: 'FALLBACK', outcome: result.fallback as Extract<RecordSkillNeedInput, { kind: 'FALLBACK' }>['outcome'] } : { kind: 'PROPOSAL', proposal: proposalOf(result as Record<string, SkillNeedTier>), manifestId: context.manifestId };
  const recorded = recordSkillNeed(h.store, claim.fence, input);
  settle(h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
  return { context, recorded, snaId };
}
