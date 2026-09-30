/**
 * C4 runtime proofs through the real Runtime Supervisor with deterministic fakes: organizational acts and
 * handoffs through the runtime-owned employee loop, independent review by the reviewer's own run, rework
 * with the reviewer's rationale in the executor's governed context, P-07 routing across runs, C4 health / CLI.
 * C4-PROOF: runtime-c4
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import type { Id, ProcessorContext, ProcessorResult } from '@qandeel-company/domain';
import { CompanyStore, GovernanceStore, OrganizationStore, type EmployeeRecord } from '@qandeel-company/storage';

import { employeeTaskProcessor, runtimeHealth, type CompanyRuntime, type GovernedRunServices } from '../../src/index.js';
import { eventually, removeRoot, tempRoot } from '../helpers.js';
import { activateEmployeeForTest } from '@qandeel-company/storage/testing';

import { fakes, final, governedRuntime, nextName, script, seedWorld, submitTask, type C2World, type Fakes } from '../c2/c2-seed.js';
import { certifyAndPromote, plan, reviewDecision, seedReviewer, submitTaskWithPlan, type ReviewerWorld } from './c4-seed.js';

const state = (rt: CompanyRuntime, id: Id): string => rt.view.getWorkItem(id).state;
const until = (rt: CompanyRuntime, id: Id, states: readonly string[], ms = 30_000): Promise<string> => eventually(() => (states.includes(state(rt, id)) ? state(rt, id) : undefined), ms, `${id} → ${states.join('|')}`);
const inAYear = (): string => new Date(Date.now() + 365 * 86_400_000).toISOString();

interface OrgWorld {
  readonly director: EmployeeRecord;
  readonly report: EmployeeRecord;
}

/** An ACTIVE (C2 test seam) Employee of a given role, budgeted and allowed to call models. */
function hireAs(gov: GovernanceStore, w: C2World, roleRef: string): EmployeeRecord {
  const e = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef, positionRef: 'position:p1', departmentId: w.departmentId, managerRef: w.founder });
  gov.transitionEmployee(w.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
  gov.transitionEmployee(w.founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
  activateEmployeeForTest(gov, w.founder, e.id);
  gov.createBudget(w.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 5_000_000, capTokens: 5_000_000, reasonCode: 'seed' });
  gov.grant(w.founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'seed' });
  return gov.getEmployee(e.id);
}

/** Before start: the Growth Director (canonical seat) and one report below it; the Director may delegate work. */
function seedOrg(root: string, w: C2World): OrgWorld {
  const store = CompanyStore.open(root);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const directorSeat = org.positionByCode('director.growth');
    if (!directorSeat) throw new Error('canonical seat missing');
    const reportSeat = org.createPosition(w.founder, { code: 'growth.analyst-1', title: 'Growth Analyst', scope: 'DEPARTMENT', departmentId: w.departmentId, kind: 'SPECIALIST', roleRef: 'role:content-strategist', reportsToPositionId: directorSeat.id, reasonCode: 'headcount.added' });
    const director = hireAs(gov, w, directorSeat.roleRef);
    const report = hireAs(gov, w, reportSeat.roleRef);
    org.assignPrimary(w.founder, { positionId: directorSeat.id, employeeId: director.id, reasonCode: 'placed' });
    org.assignPrimary(w.founder, { positionId: reportSeat.id, employeeId: report.id, reasonCode: 'placed' });
    org.delegateAuthority(w.founder, { employeeId: director.id, capability: 'org.work.delegate', expiresAt: inAYear(), purposeCode: 'work', reasonCode: 'delegated' });
    return { director: gov.getEmployee(director.id), report: gov.getEmployee(report.id) };
  } finally {
    store.close();
  }
}

async function withRuntime(label: string, fn: (ctx: { root: string; w: C2World; f: Fakes; rt: CompanyRuntime; o: OrgWorld; rw: ReviewerWorld }) => Promise<void>): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const o = seedOrg(root, w);
  const rw = seedReviewer(root, w);
  const f = fakes();
  const rt = governedRuntime(root, f);
  try {
    await rt.start();
    await fn({ root, w, f, rt, o, rw });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

describe('C4 runtime: organizational acts go through the runtime-owned loop', () => {
  test('C4-PROOF: a delegated handoff — the delegator cannot finish while it is open, waits at zero tokens, and resumes when the delegate finishes', () =>
    withRuntime('c4-delegate', async ({ w, f, rt, o }) => {
      const child = script(final('child.done'));
      const parent = submitTask(rt, w, { instructions: script({ type: 'ORG_ACTION', action: 'work.delegate', args: { delegateEmployeeId: o.report.id, objective: 'Draft the SEO brief', instructions: child, taskClass: 'draft.memo', budgetMoney: 200_000, budgetTokens: 200_000 } }, final('parent.done')) }, { employee: o.director });
      assert.equal(await until(rt, parent, ['COMPLETED', 'FAILED'], 45_000), 'COMPLETED');
      const [handoff] = rt.org.organization.workDelegations({ parentWorkItemId: parent });
      assert.ok(handoff, 'the act created a handoff');
      assert.equal(state(rt, handoff.childWorkItemId), 'COMPLETED');
      assert.equal(handoff.state, 'COMPLETED');
      const runs = rt.view.runsForWorkItem(parent);
      assert.ok(runs.length >= 2, 'the parent parked on the open handoff (the same job, woken) and ran again after it closed');
      assert.ok(runs[0]?.state !== 'RUNNING');
      assert.ok(rt.view.audit(rt.view.runsForWorkItem(parent)[0]?.id as Id).some((a) => a.action === 'org.act'), 'the act is audited, content-free');
      assert.equal(rt.governance.grants(o.report.id).some((g) => g.capability.startsWith('org.')), false, 'delegating work granted nothing');
      assert.ok(f.local.totalCalls + f.cloud.totalCalls > 0);
    }));

  test('R2-04: an escalated handoff parks the delegator at zero tokens until the Founder resumes it — no re-run per WAIT settle, no MAX_TURNS', () =>
    withRuntime('c4-escalate', async ({ w, f, rt, o }) => {
      const child = script({ type: 'ORG_ACTION', action: 'handoff.escalate', args: { reason: 'Conflicting guidance.' } }, final('child.done'));
      const parent = submitTask(rt, w, { instructions: script({ type: 'ORG_ACTION', action: 'work.delegate', args: { delegateEmployeeId: o.report.id, objective: 'Draft the SEO brief', instructions: child, taskClass: 'draft.memo', budgetMoney: 200_000, budgetTokens: 200_000 } }, final('parent.done')) }, { employee: o.director });
      const handoff = () => rt.org.organization.workDelegations({ parentWorkItemId: parent })[0];
      await eventually(() => (handoff()?.state === 'ESCALATED' && rt.view.jobsFor(parent).at(-1)?.state === 'WAITING' ? true : undefined), 30_000, 'escalated; the delegator parked');
      const runs = rt.view.runsForWorkItem(parent).length;
      const calls = f.local.totalCalls + f.cloud.totalCalls;
      await sleep(2_000);
      assert.equal(rt.view.jobsFor(parent).at(-1)?.state, 'WAITING', 'still parked on the escalation');
      assert.equal(rt.view.runsForWorkItem(parent).length, runs, 'no re-run while the Founder has not answered');
      assert.equal(f.local.totalCalls + f.cloud.totalCalls, calls, 'zero tokens while parked');
      rt.org.organization.resumeEscalatedHandoff(w.founder, handoff()?.id as string, 'guidance.given');
      assert.equal(await until(rt, parent, ['COMPLETED', 'FAILED'], 45_000), 'COMPLETED');
      assert.equal(handoff()?.state, 'COMPLETED');
    }));

  test('RR2-2: a delegator that never answers its delegate\'s question is told why each FINAL is refused; when it ends unfinished the handoff closes and the delegated work is cancelled', () =>
    withRuntime('c4-clarify-unanswered', async ({ w, rt, o }) => {
      const child = script({ type: 'ORG_ACTION', action: 'handoff.clarification.request', args: { reason: 'Which market?' } }, final('child.done'));
      const parent = submitTask(rt, w, { instructions: script({ type: 'ORG_ACTION', action: 'work.delegate', args: { delegateEmployeeId: o.report.id, objective: 'Draft the SEO brief', instructions: child, taskClass: 'draft.memo', budgetMoney: 200_000, budgetTokens: 200_000 } }, final('parent.done')) }, { employee: o.director });
      assert.equal(await until(rt, parent, ['COMPLETED', 'FAILED'], 60_000), 'FAILED');
      const handoff = rt.org.organization.workDelegations({ parentWorkItemId: parent })[0];
      assert.deepEqual([handoff?.state, handoff?.responseReasonCode], ['CANCELLED', 'PARENT_ENDED'], 'the question never outlives its delegator');
      assert.equal(await until(rt, handoff?.childWorkItemId as Id, ['CANCELLED']), 'CANCELLED', 'the delegate no longer waits under a FAILED delegator');
      // Every refused FINAL became a step result that the following turn's governed context selected (required, newest).
      const selected = rt.view.runsForWorkItem(parent).flatMap((r) => rt.mind.memory.manifestsFor(r.id)).flatMap((m) => rt.mind.memory.manifestEntries(m.id)).filter((e) => e.decision === 'SELECTED').map((e) => e.itemId);
      assert.ok(new Set(selected.filter((x) => x.startsWith('step-'))).size >= 2, 'beyond the delegation act itself, the model is told why it cannot finish');
    }));

  test('C4-PROOF: an organizational act the model is not authorized for is refused and recorded; the model cannot talk its way to authority', () =>
    withRuntime('c4-org-deny', async ({ w, rt }) => {
      const id = submitTask(rt, w, { instructions: script({ type: 'ORG_ACTION', action: 'staffing.request.decide', args: { requestId: '00000000-0000-4000-8000-000000000000', decision: 'APPROVE' } }, final('tried')) });
      assert.equal(await until(rt, id, ['COMPLETED', 'FAILED']), 'COMPLETED');
      const audit = rt.view.audit(rt.view.runsForWorkItem(id)[0]?.id as Id);
      assert.deepEqual(audit.filter((a) => a.action === 'authority.denied').map((a) => a.reasonCode), ['NO_GRANT']);
      assert.equal(rt.org.organization.staffingRequests().length, 0);
    }));
});

describe('R2-04: the delegator loop answers a pending clarification instead of waiting on itself', () => {
  // The runtime-owned loop against minimal services: every model turn proposes FINAL.
  const loop = async (open: number, asked: number): Promise<{ result: ProcessorResult; calls: number; refused: string[] }> => {
    let calls = 0;
    const refused: string[] = [];
    const ctx = { input: { taskClass: 'draft.memo', instructions: 'x', maxTurns: 3 }, resumeFrom: null, signal: new AbortController().signal, checkpoint: () => Promise.resolve() } as unknown as ProcessorContext;
    const gov = {
      context: {},
      invokeModel: () => {
        calls++;
        return Promise.resolve({ kind: 'OK', proposal: { type: 'FINAL', summaryCode: 'done' }, usage: { inputTokens: 1, outputTokens: 1 }, deploymentId: 'd', reasoningClass: 'E1', attempts: 1, manifestId: 'm' });
      },
      openHandoffs: () => open,
      clarificationsRequested: () => asked,
      refuseFinal: (step: number, c: string) => void refused.push(`${step}:${c}`),
    } as unknown as GovernedRunServices;
    return { result: await employeeTaskProcessor.runGoverned(ctx, gov), calls, refused };
  };

  test('an offered / accepted / escalated handoff parks at zero tokens; a delegate\'s question keeps the loop turning (bounded by maxTurns); none open completes', async () => {
    assert.deepEqual(await loop(1, 0), { result: { type: 'WAIT', reasonCode: 'AWAITING_DELEGATION' }, calls: 1, refused: [] });
    // RR2-2: the loop still ends MAX_TURNS if the model never answers (the delegator's end then closes its handoffs and
    // cancels the delegated work — storage `work_delegations_follow_parent` / `cancelDelegatedChildren`), but every
    // refused FINAL is now recorded as its step's result, so each next turn's context says why and what to answer.
    const r = await loop(1, 1);
    assert.deepEqual([r.result, r.calls], [{ type: 'PERMANENT_FAILURE', code: 'MAX_TURNS' }, 3], 'the question is this run\'s to answer (handoff.clarify): parking would wait on itself');
    assert.deepEqual(r.refused, ['0:FINAL_REFUSED_CLARIFICATION_PENDING', '1:FINAL_REFUSED_CLARIFICATION_PENDING', '2:FINAL_REFUSED_CLARIFICATION_PENDING'], 'each refused FINAL is told to the model, never a silent continue');
    assert.equal((await loop(0, 0)).result.type, 'COMPLETED');
  });
});

describe('C4 runtime: independent review by the reviewer\'s own run', () => {
  test('C4-PROOF: a reviewer sends the output back; the rework run sees the reviewer\'s rationale in its governed context; the new output passes', () =>
    withRuntime('c4-review', async ({ w, rt, rw }) => {
      await certifyAndPromote(rt, w, rw);
      const review = rt.org.review;
      const id = submitTaskWithPlan(rt, w, script(final('draft.v1'), final('draft.v2')), plan('OUTPUT', 'FAIL', { reviewerInstructions: script(reviewDecision('FAIL', 'Figures lack sources.'), final('review.done')) }));
      await eventually(() => review.requests({ workItemId: id }).some((r) => r.state === 'REWORK'), 30_000, 'the FAIL decision');
      // The accountable Founder revises how the work is reviewed (a new plan version supersedes the old one).
      review.declarePlan(w.founder, id, plan('OUTPUT', 'PASS'));
      assert.equal(await until(rt, id, ['REVIEWED'], 45_000), 'REVIEWED');
      const runs = rt.view.runsForWorkItem(id);
      assert.ok(runs.length >= 2, 'the rework ran');
      const selected = runs.slice(1).flatMap((r) => rt.mind.memory.manifestsFor(r.id)).flatMap((m) => rt.mind.memory.manifestEntries(m.id)).filter((e) => e.decision === 'SELECTED').map((e) => e.itemId);
      assert.ok(selected.some((x) => x.startsWith('review:')), 'the executor sees why its work came back (local governed context)');
      const telemetry = JSON.stringify(rt.view.audit(id));
      assert.ok(!telemetry.includes('Figures lack sources'), 'the rationale never reaches telemetry');
    }));
});

describe('C4 runtime: P-07 — a charged-failure deployment is not routed to again for the same Work Item', () => {
  test('C4-PROOF: a charged failure in run 1 excludes that deployment in run 2 (a new job attempt); other Work Items still use it', () =>
    withRuntime('c4-p07', async ({ w, f, rt }) => {
      // Run 1: the cheapest D1 route bills a failed call; every fallback is unavailable (never sent) — the run is retried.
      f.cloud.failNextCharged('cloud-e1', 'TRANSIENT', { inputTokens: 40, outputTokens: 0 });
      f.cloud.failNext('cloud-e1b', 'CAPACITY');
      f.local.failNext('local-e1', 'CAPACITY');
      f.local.failNext('local-e2', 'CAPACITY');
      const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
      assert.equal(await until(rt, id, ['COMPLETED', 'FAILED'], 45_000), 'COMPLETED');
      assert.ok(rt.view.runsForWorkItem(id).length >= 2, 'a new run of the same logical Work Item');
      assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'the charged deployment was never selected again for this Work Item');
      assert.deepEqual(rt.governance.chargedExclusions(id), [w.deployments.cloudE1]);
      const refusals = rt.view.runsForWorkItem(id).flatMap((r) => rt.view.audit(r.id)).filter((a) => a.action === 'budget.refused' && a.reasonCode === 'ROUTE_NO_LONGER_ELIGIBLE');
      assert.deepEqual(refusals, [], 'the router never even proposes the excluded deployment (the reservation re-check is the backstop)');
      const ok = rt.governance.usage({ workItemId: id }).filter((u) => u.outcome === 'OK');
      assert.equal(ok.length, 1);
      assert.notEqual(ok[0]?.deploymentId, w.deployments.cloudE1);
      const other = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('other')) });
      assert.equal(await until(rt, other, ['COMPLETED']), 'COMPLETED');
      assert.equal(rt.governance.usage({ workItemId: other })[0]?.deploymentId, w.deployments.cloudE1, 'the exclusion is per Work Item, not global');
    }));
});

describe('C4 runtime: health and read-only CLI (content-free)', () => {
  const CLI = fileURLToPath(new URL('../../src/cli.js', import.meta.url));
  const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 60_000 });

  test('C4-PROOF: organization and review health are reported; the CLI shows seats, queues and reviews without content', async () => {
    const root = tempRoot('c4-cli');
    try {
      const w = seedWorld(root);
      seedOrg(root, w);
      const f = fakes();
      const rt = governedRuntime(root, f);
      try {
        await rt.start();
        const h = runtimeHealth(rt);
        assert.ok(h.components.organization, 'C4 health component');
        assert.ok(h.reasons.includes('CEO_SEAT_VACANT'), 'a vacant CEO seat is visible');
        assert.equal(h.status, 'HEALTHY', 'vacant canonical seats change no status: the Founder staffs the skeleton');
      } finally {
        await rt.stop();
      }
      const orgOut = cli('organization', '--workspace', root);
      assert.equal(orgOut.status, 0, orgOut.stderr);
      const parsed = JSON.parse(orgOut.stdout.trim()) as { seats: { code: string; holderEmployeeId: string | null }[]; health: { ceoSeatVacant: boolean } };
      assert.ok(parsed.seats.some((s) => s.code === 'company.ceo' && s.holderEmployeeId === null));
      assert.equal(parsed.health.ceoSeatVacant, true);
      const reviews = cli('reviews', '--workspace', root);
      assert.equal(reviews.status, 0, reviews.stderr);
      assert.doesNotMatch(reviews.stdout, /Judge|rubric\.applied|instructions/i, 'no review content on the CLI');
      assert.doesNotMatch(orgOut.stdout, /businessNeed|workloadEvidence/);
    } finally {
      removeRoot(root);
    }
  });
});
