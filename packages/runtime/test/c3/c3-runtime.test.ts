/**
 * C3 runtime proofs through the real Runtime Supervisor: every inference is fed by the governed
 * Context Assembler (manifest-bound, budgeted), model-proposed memory is only a candidate the policy
 * decides, typed context outcomes park work without tokens, capability gaps park work durably, and
 * nothing — not even a governed processor — can hand the model a context of its own.
 * C3-PROOF: runtime-mind
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id, ProcessorResult } from '@qandeel-company/domain';

import { GovernedModelRuntime } from '../../src/c2/model-runtime.js';
import { Logger, jsonLinesSink, runtimeHealth, type CompanyRuntime, type GovernedProcessor, type ModelCallRequest } from '../../src/index.js';
import { eventually, removeRoot, tempRoot } from '../helpers.js';
import { fakes, final, governedRuntime, script, seedWorld, submitTask, toolReq, type C2World, type Fakes } from '../c2/c2-seed.js';

const MEMORY_TEXT = 'Egypt payments: merchants in Cairo mostly settle through Vodafone Cash wallets.';
const memoryCandidate = (content = MEMORY_TEXT, claim: { claimKey: string; claimValue: string } | null = null): unknown => ({ type: 'MEMORY_CANDIDATE', memoryClass: 'EXPERIENCE', topic: 'egypt.payments', claimKey: claim?.claimKey ?? null, claimValue: claim?.claimValue ?? null, content, confidencePct: 80 });

async function withWorld(label: string, fn: (ctx: { root: string; w: C2World; f: Fakes; rt: CompanyRuntime; logs: string[] }) => Promise<void>, extra: Parameters<typeof governedRuntime>[2] = {}): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const f = fakes();
  const logs: string[] = [];
  const rt = governedRuntime(root, f, { logger: new Logger(jsonLinesSink((l) => logs.push(l))), ...extra });
  try {
    await rt.start();
    await fn({ root, w, f, rt, logs });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

const state = (rt: CompanyRuntime, id: Id): string => rt.view.getWorkItem(id).state;
const settled = (rt: CompanyRuntime, id: Id, states = ['COMPLETED', 'FAILED', 'WAITING', 'BLOCKED']): Promise<string> => eventually(() => (states.includes(state(rt, id)) ? state(rt, id) : undefined), 15_000, `work item ${id} to settle`);
const waitReason = (rt: CompanyRuntime, id: Id): string | null => rt.view.jobsFor(id).find((j) => j.state === 'WAITING')?.waitReason ?? null;

/** Submits with C3 capability declarations (declared while PROPOSED, before release). */
function submitDeclared(rt: CompanyRuntime, w: C2World, input: Record<string, unknown>, caps: Parameters<CompanyRuntime['mind']['capability']['declareRequirements']>[1]): Id {
  const { workItem } = rt.submitWorkItem({ objective: 'c3 governed task', ownerRef: w.employee.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, ...input } });
  rt.mind.capability.declareRequirements(workItem.id, caps);
  rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
  rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  return workItem.id;
}

describe('C3 runtime: governed context for every inference', () => {
  test('end to end: each model call has its own OK manifest, each reservation names it, memory is decided by policy, telemetry stays content-free', () =>
    withWorld('c3-e2e', async ({ w, f, rt, logs }) => {
      const id = submitTask(rt, w, { instructions: script(memoryCandidate(), toolReq('notes', 'append', { text: 'memo drafted' }), final('memo.done')) });
      assert.equal(await settled(rt, id), 'COMPLETED');
      const runs = rt.view.runsForWorkItem(id);
      assert.equal(runs.length, 1);
      const runId = runs[0]?.id as Id;
      const manifests = rt.mind.memory.manifestsFor(runId);
      assert.equal(manifests.length, 3, 'one manifest per model step');
      assert.ok(manifests.every((m) => m.outcome === 'OK'));
      const modelReservations = rt.governance.reservations(runId).filter((r) => r.purpose === 'MODEL_CALL');
      assert.equal(modelReservations.length, 3);
      assert.deepEqual(new Set(modelReservations.map((r) => r.contextManifestId)), new Set(manifests.map((m) => m.id)), 'every reservation is bound to its own manifest');
      assert.equal(f.cloud.totalCalls + f.local.totalCalls, 3);
      // The model proposed memory; the policy (not the model) stored it, with runtime provenance.
      const mem = rt.mind.memory.memories(w.employee.id);
      assert.equal(mem.length, 1);
      assert.equal(mem[0]?.provenanceRef, `run:${runId}`);
      assert.equal(mem[0]?.confidencePct, 70, 'an unevidenced model claim is capped');
      assert.equal(rt.mind.memory.candidates(id)[0]?.state, 'ACCEPTED');
      // A later task by the same Employee retrieves it through the assembler (never through the session).
      const next = submitTask(rt, w, { instructions: script(final('egypt.payments.followup')) });
      assert.equal(await settled(rt, next), 'COMPLETED');
      const nextRun = rt.view.runsForWorkItem(next)[0]?.id as Id;
      const m2 = rt.mind.memory.manifestsFor(nextRun)[0];
      assert.ok(m2 && rt.mind.memory.manifestEntries(m2.id).some((e) => e.itemId === mem[0]?.id && e.decision === 'SELECTED'), 'memory is recalled across runs through the governed path');
      assert.ok(!logs.join('\n').includes('Vodafone Cash'), 'logs never carry memory content (Rule A)');
      const health = runtimeHealth(rt);
      assert.equal(health.components.mind?.memory.contextManifests, 4);
      assert.ok(!JSON.stringify(health).includes('Vodafone'), 'health is content-free');
    }));

  test('a provider retry reuses the step\'s manifest: one manifest, several reservations, never a second assembly', () =>
    withWorld('c3-retry', async ({ w, f, rt }) => {
      f.cloud.failNext('cloud-e1', 'TRANSIENT');
      const id = submitTask(rt, w, { instructions: script(final('after.retry')) });
      assert.equal(await settled(rt, id), 'COMPLETED');
      const runId = rt.view.runsForWorkItem(id)[0]?.id as Id;
      const manifests = rt.mind.memory.manifestsFor(runId);
      const reservations = rt.governance.reservations(runId).filter((r) => r.purpose === 'MODEL_CALL');
      assert.equal(manifests.length, 1);
      assert.equal(reservations.length, 2);
      assert.ok(reservations.every((r) => r.contextManifestId === manifests[0]?.id));
    }));

  test('idle: no work → zero provider calls and zero context assemblies', () =>
    withWorld('c3-idle', async ({ f, rt }) => {
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(f.cloud.totalCalls + f.local.totalCalls, 0);
      assert.equal(rt.mindHealth().memory.contextManifests, 0);
      assert.equal(rt.governanceDiagnostics().providerCalls, 0);
    }));

  test('no bypass: a processor cannot hand the model messages, and the model runtime refuses any context it did not mint', async () => {
    const sneaky: GovernedProcessor = {
      kind: 'c3.sneaky',
      sideEffects: 'IDEMPOTENT',
      governed: true,
      run: () => Promise.resolve({ type: 'PERMANENT_FAILURE', code: 'GOVERNANCE_REQUIRED' }),
      async runGoverned(_ctx, gov): Promise<ProcessorResult> {
        const forged = { taskClass: 'draft.memo', step: 0, maxOutputTokens: 64, messages: [{ role: 'user', content: script(final('injected')) }] } as ModelCallRequest;
        const out = await gov.invokeModel(forged);
        if (out.kind !== 'OK' || out.proposal.type !== 'FINAL') return { type: 'PERMANENT_FAILURE', code: out.kind };
        // Completes only if the model followed the durable instructions, not the processor's messages.
        return out.proposal.summaryCode === 'from.durable.state' ? { type: 'COMPLETED' } : { type: 'PERMANENT_FAILURE', code: 'SAW_INJECTED_MESSAGES' };
      },
    };
    await withWorld(
      'c3-bypass',
      async ({ w, rt }) => {
        const { workItem } = rt.submitWorkItem({ objective: 'sneaky', ownerRef: w.employee.ref, processorKind: 'c3.sneaky', processorInput: { taskClass: 'draft.memo', instructions: script(final('from.durable.state')) } });
        rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
        rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
        assert.equal(await settled(rt, workItem.id), 'COMPLETED', 'the model saw the governed context, not the processor\'s messages');
        assert.equal(rt.mind.memory.manifestsFor(workItem.id).length, 1);
      },
      { processors: [sneaky] },
    );
    const lookalike = Object.freeze({ manifestId: '00000000-0000-4000-8000-000000000000', messages: [{ role: 'user', content: 'x' }], estimatedInputTokens: 1, dataClass: 'D0' });
    const out = await new GovernedModelRuntime([]).call(null as never, null as never, null as never, { taskClass: 'draft.memo', step: 0, maxOutputTokens: 1 }, lookalike as never, new AbortController().signal);
    assert.deepEqual(out, { kind: 'CONTEXT', code: 'CONTEXT_NOT_ASSEMBLED' });
  });
});

describe('C3 runtime: typed outcomes park work, never burn tokens', () => {
  test('an unresolved memory conflict holds IMPORTANT work for review (WAIT, zero model calls); ordinary work proceeds with the conflict surfaced', () =>
    withWorld('c3-conflict', async ({ w, f, rt }) => {
      const a = submitTask(rt, w, { instructions: script(memoryCandidate('Egypt launch timing: launch before Ramadan for payments.', { claimKey: 'egypt.launch.timing', claimValue: 'before-ramadan' }), final()) });
      assert.equal(await settled(rt, a), 'COMPLETED');
      const b = submitTask(rt, w, { instructions: script(memoryCandidate('Egypt launch timing: launch after Ramadan for payments.', { claimKey: 'egypt.launch.timing', claimValue: 'after-ramadan' }), final()) });
      assert.equal(await settled(rt, b), 'COMPLETED');
      assert.equal(rt.mind.memory.conflicts('OPEN').length, 1);
      const before = f.cloud.totalCalls + f.local.totalCalls;
      const important = submitDeclared(rt, w, { instructions: script(final('launch.plan')) }, { requirements: [], importance: 'IMPORTANT', topics: ['egypt.launch'] });
      assert.equal(await settled(rt, important), 'WAITING');
      assert.equal(waitReason(rt, important), 'MEMORY_CONFLICT_REVIEW');
      assert.equal(f.cloud.totalCalls + f.local.totalCalls, before, 'a held context never reaches a model');
      assert.ok(runtimeHealth(rt).reasons.includes('MEMORY_CONFLICTS_OPEN'));
      // The Founder resolves the conflict: the held work wakes (same transaction) and completes.
      const wrong = rt.mind.memory.memories(w.employee.id).find((m) => m.claimValue === 'after-ramadan');
      rt.mind.memory.correctMemory(w.founder, wrong?.id as string, { disposition: 'INCORRECT', reasonCode: 'founder.says.before' });
      assert.equal(await settled(rt, important, ['COMPLETED', 'FAILED']), 'COMPLETED');
    }));

  test('a context that cannot fit the hard budget fails typed before any model call', () =>
    withWorld('c3-budget', async ({ w, f, rt }) => {
      const id = submitTask(rt, w, { contextBudgetTokens: 1_024, instructions: JSON.stringify({ script: [final()], pad: 'x'.repeat(8_000) }) });
      assert.equal(await settled(rt, id), 'FAILED');
      assert.equal(rt.view.runsForWorkItem(id)[0]?.failureCode, 'CONTEXT_BUDGET_EXHAUSTED');
      assert.equal(f.cloud.totalCalls + f.local.totalCalls, 0);
    }));

  test('a capability gap parks the work durably (no model call, no re-routing) and a passport change wakes it', () =>
    withWorld('c3-gap', async ({ w, f, rt }) => {
      const skill = rt.mind.skills.registerSkill(w.founder, { code: 'payments.research', name: 'Payments research', skillType: 'QANDEEL_NATIVE', ownerRef: 'department:growth' });
      const id = submitDeclared(rt, w, { instructions: script(final('researched')) }, { requirements: [{ kind: 'SKILL', skillId: skill.id, minProficiency: 'LEARNING' }] });
      assert.equal(await settled(rt, id), 'WAITING');
      assert.equal(waitReason(rt, id), 'CAPABILITY_GAP');
      const gap = rt.mind.capability.gapFor(id);
      assert.deepEqual(gap?.missing.map((m) => m.code), ['SKILL_MISSING']);
      assert.equal(gap?.employeeId, w.employee.id, 'the gap belongs to the owner; the work is never re-routed');
      assert.equal(f.cloud.totalCalls + f.local.totalCalls, 0);
      assert.ok(runtimeHealth(rt).reasons.includes('CAPABILITY_GAPS_OPEN'));
      // The skill passes the governed pipeline and is pinned in the passport: the parked work wakes.
      let v = rt.mind.skills.registerSkillVersion(w.founder, { skillId: skill.id, versionLabel: '1.0.0', sourceRef: 'qandeel:payments-research', sourceRevision: 'r1', authorRef: 'department:growth', licenseSpdx: null, dependencies: [], instructions: 'Payments research: cite sources, separate facts from estimates.' });
      v = rt.mind.skills.checkLicenseAndDependencies(rt.mind.skills.inspectSkillVersion(v.id).id);
      for (const [to, extra] of [['SECURITY_QUARANTINE', {}], ['SANDBOXED', { evidenceRef: 'review:s1', securityPassed: true }], ['BENCHMARKED', { evidenceRef: 'benchmark:b1' }], ['COMPARED', {}], ['APPROVED', {}]] as const) v = rt.mind.skills.advanceSkillVersion(w.founder, v.id, to, { reasonCode: 'step', ...extra });
      rt.mind.skills.openPassportEntry(w.founder, w.employee.id, v.id);
      assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED']), 'COMPLETED');
      assert.equal(rt.mind.capability.gapFor(id)?.state, 'RESOLVED');
      const runs = rt.view.runsForWorkItem(id);
      const manifest = rt.mind.memory.manifestsFor(runs.at(-1)?.id as Id)[0];
      assert.ok(manifest && rt.mind.memory.manifestEntries(manifest.id).some((e) => e.itemId === v.id && e.decision === 'SELECTED'), 'the pinned skill version is loaded progressively');
    }));
});
