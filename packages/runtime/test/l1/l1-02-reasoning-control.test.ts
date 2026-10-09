/**
 * D-L1-44 (D-L1-36) — Employee Reasoning Control through the real governed runtime (deterministic fake provider; no
 * network). Proves the runtime precedence of one model step:
 *   1. the Founder's one-task override, else 2. the Employee default; 3. bounded technical escalation may raise it;
 *   4. never above the Employee ceiling; 5. never above the route policy; 6. only on a qualified deployment of that
 *   class; 7. only after the class's worst case is reserved.
 * and that reasoning never changes authority: grants, tools, risk and data class stay as they were.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';

import type { CompanyRuntime } from '../../src/index.js';
import { fakes, final, governedRuntime, script, seedWorld, toolReq, type C2World, type Fakes } from '../c2/c2-seed.js';
import { eventually, removeRoot, tempRoot } from '../helpers.js';

const TASK = 'deep.memo';
const CLASSES = ['E1', 'E2', 'E3', 'E4'] as const;
type Cls = (typeof CLASSES)[number];

interface World {
  readonly w: C2World;
  readonly f: Fakes;
  readonly rt: CompanyRuntime;
  /** Deployment id → class, for reading the class that actually answered from usage evidence. */
  readonly classOf: Map<string, Cls>;
}

async function withWorld(label: string, fn: (x: World) => Promise<void>): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const f = fakes();
  const rt = governedRuntime(root, f);
  try {
    await rt.start();
    const gov = rt.governance;
    const modelId = gov.deployment(w.deployments.localE1).modelId;
    const classOf = new Map<string, Cls>();
    // One qualified local deployment per class; each deeper class is priced higher (a higher worst case to reserve).
    CLASSES.forEach((cls, i) => {
      const d = gov.registerDeployment(w.founder, { code: `deep-${cls.toLowerCase()}`, modelId, pinnedRevision: 'r1', reasoningClass: cls, contextWindowTokens: 200_000, maxOutputTokens: 4_096, taskClasses: [TASK] });
      const rate = 1_000_000 * 2 ** i;
      gov.addPriceCard(w.founder, d.id, { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: rate, billedOutputPerMTok: 4 * rate, billedPerCall: 0, economicInputPerMTok: rate, economicOutputPerMTok: 4 * rate, economicPerCall: 0 });
      for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED'] as const) gov.setQualification(w.founder, d.id, q, 'qualified');
      gov.approveEgress(w.founder, d.id, 'D4', 'egress.approved');
      classOf.set(d.id, cls);
    });
    gov.createRoutePolicy(w.founder, TASK, { minClass: 'E1', maxClass: 'E4', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 10, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 5_000_000 } });
    await fn({ w, f, rt, classOf });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

const state = (rt: CompanyRuntime, id: Id): string => rt.view.getWorkItem(id).state;
const settled = (rt: CompanyRuntime, id: Id): Promise<string> => eventually(() => (['COMPLETED', 'FAILED', 'WAITING', 'BLOCKED'].includes(state(rt, id)) ? state(rt, id) : undefined), 15_000, `work item ${id} to settle`);

/** The Founder's persistent profile act (through the test-armed Founder authority; the preview path is proven in storage). */
function setProfile(x: World, defaultClass: Cls, ceilingClass: Cls): void {
  const e = x.rt.governance.getEmployee(x.w.employee.id);
  x.rt.governance.changeReasoningProfile(x.w.founder, e.id, { defaultClass, ceilingClass, expectedVersion: e.version, reasonCode: 'founder.reasoning' });
}

/** A governed task: created PROPOSED, budgeted, optionally given a Founder one-task override, then released. */
function submit(x: World, { override, cap = 1_000_000, instructions = script(final()) }: { override?: Cls; cap?: number; instructions?: string } = {}): Id {
  const { workItem } = x.rt.submitWorkItem({ objective: 'reasoning control task', ownerRef: x.w.employee.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: TASK, maxOutputTokens: 256, instructions } });
  x.rt.governance.createBudget(x.w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: cap, capTokens: 1_000_000, reasonCode: 'seed' });
  if (override !== undefined) x.rt.governance.setWorkItemReasoningOverride(x.w.founder, workItem.id, { reasoningClass: override, reasonCode: 'founder.one_task' });
  x.rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  return workItem.id;
}

/** The classes that actually answered this Work Item's model calls (usage evidence, in order). */
const usedClasses = (x: World, id: Id): string[] => x.rt.governance.usage({ workItemId: id }).map((u) => x.classOf.get(String(u.deploymentId)) ?? '?');
const deepCalls = (x: World): number => CLASSES.reduce((n, c) => n + (x.f.local.calls.get(`deep-${c.toLowerCase()}`) ?? 0), 0);

describe('D-L1-44 runtime: reasoning precedence for one model step', () => {
  test('persistent default: E1 → E2 makes new work without an override start at E2; lowering E2 → E1 returns new work to E1', () =>
    withWorld('l1-rc-default', async (x) => {
      const before = submit(x);
      assert.equal(await settled(x.rt, before), 'COMPLETED');
      assert.deepEqual(usedClasses(x, before), ['E1'], 'the standing E1 default, unchanged');
      setProfile(x, 'E2', 'E2');
      const raised = submit(x);
      assert.equal(await settled(x.rt, raised), 'COMPLETED');
      assert.deepEqual(usedClasses(x, raised), ['E2']);
      setProfile(x, 'E1', 'E2');
      const lowered = submit(x);
      assert.equal(await settled(x.rt, lowered), 'COMPLETED');
      assert.deepEqual(usedClasses(x, lowered), ['E1']);
      assert.deepEqual(usedClasses(x, before), ['E1'], 'earlier evidence is history, never rewritten');
    }));

  test('one-task override: default E1 / ceiling E3 — task A (none) runs E1, task B (Founder E3) runs E3, task C (none) runs E1 again; the profile never changed', () =>
    withWorld('l1-rc-override', async (x) => {
      setProfile(x, 'E1', 'E3');
      const version = x.rt.governance.getEmployee(x.w.employee.id).version;
      const a = submit(x);
      assert.equal(await settled(x.rt, a), 'COMPLETED');
      const b = submit(x, { override: 'E3' });
      assert.equal(await settled(x.rt, b), 'COMPLETED');
      const c = submit(x);
      assert.equal(await settled(x.rt, c), 'COMPLETED');
      assert.deepEqual([usedClasses(x, a), usedClasses(x, b), usedClasses(x, c)], [['E1'], ['E3'], ['E1']]);
      const e = x.rt.governance.getEmployee(x.w.employee.id);
      assert.deepEqual([e.cognitiveProfile.defaultClass, e.cognitiveProfile.ceilingClass, e.version], ['E1', 'E3', version], 'the override did not become persistent');
      const view = x.rt.governance.reasoningControl(e.id);
      assert.deepEqual(view.overrides.map((o) => [o.workItemId, o.reasoningClass]), [[b, 'E3']]);
      assert.deepEqual(view.modelCalls.filter((m) => [a, b, c].includes(m.workItemId)).map((m) => [m.workItemId, m.reasoningClass]).sort(), [[a, 'E1'], [b, 'E3'], [c, 'E1']].sort(), 'the read model shows the class actually used');
    }));

  test('highest class: an isolated test Employee configured up to E4 runs E4 by override and by default', () =>
    withWorld('l1-rc-e4', async (x) => {
      setProfile(x, 'E1', 'E4');
      const o = submit(x, { override: 'E4' });
      assert.equal(await settled(x.rt, o), 'COMPLETED');
      assert.deepEqual(usedClasses(x, o), ['E4']);
      setProfile(x, 'E4', 'E4');
      const d = submit(x);
      assert.equal(await settled(x.rt, d), 'COMPLETED');
      assert.deepEqual(usedClasses(x, d), ['E4']);
    }));

  // D-P1-04 (P1-REASON-AUTO-RECOVERY-01, Founder decision) amends the D-L1-44 escalation rule for a Founder-pinned level:
  // the level the Founder chose is pinned — never raised (nor lowered). An unpinned start keeps the bounded escalation.
  test('D-P1-04: a Founder-pinned level is never escalated — a context overflow at the pinned E2 ends the run with its own code and nothing is reserved above it; an unpinned start still escalates one class', () =>
    withWorld('l1-rc-escalate', async (x) => {
      setProfile(x, 'E1', 'E3');
      x.f.local.failNext('deep-e2', 'CONTEXT_OVERFLOW');
      const id = submit(x, { override: 'E2' });
      assert.equal(await settled(x.rt, id), 'FAILED');
      assert.equal(x.f.local.calls.get('deep-e1') ?? 0, 0, 'the default E1 was never used for this Work Item');
      assert.equal(x.f.local.calls.get('deep-e2'), 1);
      assert.equal(x.f.local.calls.get('deep-e3') ?? 0, 0, 'the pinned level was never raised');
      const run = x.rt.view.runsForWorkItem(id).at(-1);
      assert.ok(run);
      assert.equal(run.failureCode, 'PROVIDER_CONTEXT_OVERFLOW');
      assert.deepEqual(x.rt.governance.reservations(run.id).map((r) => r.attemptKind), ['PRIMARY']);
      // The same observed failure at an unpinned (default) start: one evidence-based escalation (D13-C.3), unchanged.
      x.f.local.failNext('deep-e1', 'CONTEXT_OVERFLOW');
      const free = submit(x);
      assert.equal(await settled(x.rt, free), 'COMPLETED');
      assert.deepEqual(usedClasses(x, free).at(-1), 'E2', 'escalated one class above the default');
      const freeRun = x.rt.view.runsForWorkItem(free).at(-1);
      assert.ok(freeRun);
      assert.deepEqual(x.rt.governance.reservations(freeRun.id).map((r) => r.attemptKind), ['PRIMARY', 'ESCALATION']);
    }));

  test('ceiling protection at run time: an override whose class is now above a lowered ceiling never reaches a provider and reserves nothing', () =>
    withWorld('l1-rc-ceiling', async (x) => {
      setProfile(x, 'E1', 'E3');
      const { workItem } = x.rt.submitWorkItem({ objective: 'reasoning control task', ownerRef: x.w.employee.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: TASK, maxOutputTokens: 256, instructions: script(final()) } });
      x.rt.governance.createBudget(x.w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
      x.rt.governance.setWorkItemReasoningOverride(x.w.founder, workItem.id, { reasoningClass: 'E3', reasonCode: 'founder.one_task' });
      setProfile(x, 'E1', 'E2');
      x.rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
      const run = await eventually(() => x.rt.view.runsForWorkItem(workItem.id).find((r) => r.failureCode !== null), 15_000, 'the first run to end');
      assert.equal(run.failureCode, 'REASONING_ABOVE_CEILING', 'refused at routing, before any reservation');
      assert.equal(deepCalls(x), 0, 'no provider call');
      assert.equal(x.rt.governance.usage({ workItemId: workItem.id }).length, 0);
      assert.equal(x.rt.governance.reservations(run.id).length, 0, 'nothing reserved');
      assert.equal(x.rt.governance.getEmployee(x.w.employee.id).cognitiveProfile.ceilingClass, 'E2', 'the override never raised the ceiling');
    }));
});

describe('D-L1-44 runtime: reasoning is neither authority nor money', () => {
  test('budget: a deeper class reserves its own higher worst case; when that cannot be reserved the work waits on the existing budget path with no provider call', () =>
    withWorld('l1-rc-budget', async (x) => {
      setProfile(x, 'E1', 'E3');
      const light = submit(x);
      assert.equal(await settled(x.rt, light), 'COMPLETED');
      const deep = submit(x, { override: 'E3' });
      assert.equal(await settled(x.rt, deep), 'COMPLETED');
      const money = (id: Id): number => x.rt.governance.reservations(x.rt.view.runsForWorkItem(id)[0]?.id as Id)[0]?.money ?? 0;
      const m1 = money(light);
      const m3 = money(deep);
      assert.ok(m3 > m1 * 2, `the E3 reservation (${m3}) prices the deeper class above E1 (${m1})`);
      const calls = deepCalls(x);
      const tight = submit(x, { override: 'E3', cap: Math.floor((m1 + m3) / 2) });
      assert.equal(await settled(x.rt, tight), 'WAITING');
      assert.equal(x.rt.view.jobsFor(tight)[0]?.waitReason, 'BUDGET_EXHAUSTED');
      assert.equal(deepCalls(x), calls, 'refused before any provider call');
      const cheap = submit(x, { cap: Math.floor((m1 + m3) / 2) });
      assert.equal(await settled(x.rt, cheap), 'COMPLETED', 'the same cap is enough for the E1 default');
    }));

  test('authority independence: E4 by override changes no grant, risk or data class, and an unauthorized action still never executes', () =>
    withWorld('l1-rc-authority', async (x) => {
      // Authority shape only (a model call increments a grant's use counter; that is metering, not authority).
      const authority = (): string => JSON.stringify(x.rt.governance.grants(x.w.employee.id).map((g) => [g.id, g.capability, g.resourceScope, g.riskCeiling, g.dataClassCeiling, g.expiresAt, g.maxUses, g.status]));
      const grants = authority();
      setProfile(x, 'E1', 'E4');
      const id = submit(x, { override: 'E4', instructions: script(toolReq('ledger', 'transfer', { text: 'send all funds' }), final('memo.drafted')) });
      assert.equal(await settled(x.rt, id), 'COMPLETED');
      assert.deepEqual([...new Set(usedClasses(x, id))], ['E4']);
      assert.equal(x.f.drivers.ledger.invocations.length, 0, 'the R4 driver was never called at E4');
      const audit = x.rt.view.audit(x.rt.view.runsForWorkItem(id)[0]?.id as Id);
      assert.deepEqual(audit.filter((a) => a.action === 'authority.denied').map((a) => a.reasonCode), ['FOUNDER_ONLY']);
      assert.equal(authority(), grants, 'no grant created or widened');
      const item = x.rt.view.getWorkItem(id);
      assert.deepEqual([item.riskLevel, item.approvalRequired, (item.processorInput as { dataClass?: string }).dataClass ?? 'D1'], ['R1', false, 'D1']);
    }));
});
