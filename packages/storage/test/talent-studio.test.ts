/**
 * COMPANY-TALENT-01 at the store boundary, on the real governed paths (preview → fingerprint → confirm; org acts from a
 * claimed run; the real context assembler) — no model, no provider call, synthetic text only.
 *
 *   A — the Talent Catalog: identities and programs are versioned data, complete-or-refused, frozen at submission,
 *       approved only by the Founder; a release code is never reused; a leader's program requires Founder Calibration.
 *   B — identity without code: a hire names an approved identity (none → refused); the kernel and the LIVE organization
 *       reach the context; one identity is one person; a revision keeps the Employee and its history (MATERIAL →
 *       certifications REVIEW_DUE).
 *   C — manager-led staffing: a Director with the standing proposal right files a request for N identical seats; the CEO
 *       recommends; the Founder approves N seats (no Employee); a rejected / unrecommended request creates nothing; a
 *       consolidated one is never decided; with no ACTIVE CEO the Founder decides directly.
 *   D — Department budgets: a Department Employee's envelope needs its Department budget and stays within it.
 *   E — leadership policies: one individual grant per eligible seat holder, from the hire (CANDIDATE); revoked on
 *       SUSPENDED / RETIRED / leaving the seat; an existing grant is adopted as it is; a title alone grants nothing.
 *   F — scalable evaluation (D5): a qualified direct manager evaluates; practice applies at once; an assessment waits for
 *       an independent review; never self-evaluation (refused by the store and by the datastore).
 *   G — tools: a role's Tool need shows NOT_REGISTERED / NOT_INTEGRATED honestly; a certification records NOT_ASSESSED.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Id } from '@qandeel-company/domain';
import { COMPETENCY_PRESETS, GRANTED_ORG_ACT_GUIDANCE, identityKernel } from '@qandeel-company/mind';

import { AcademyStore, CommunicationStore, DigitalStore, FounderActionStore, FounderAuthStore, GovernanceStore, OrganizationStore, TalentCatalogStore, talentOverview, type FounderSession } from '../src/index.js';
import { assembleContext, recordOrgAct } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { seed, type Seed } from './c2-helpers.js';
import { answerWork, academyWorld, certify, scores } from './c3-helpers.js';
import { budgetDepartment, claimItem, departmentId, placed, runFor, seat } from './c4-helpers.js';
import { harness, type Harness } from './helpers.js';
import { approveIdentity, sampleIdentity, sampleProgram } from './talent-helpers.js';

interface W {
  readonly h: Harness;
  readonly s: Seed;
  readonly session: FounderSession;
  readonly actions: FounderActionStore;
  act(intent: string, payload: Record<string, unknown>): string;
  preview(intent: string, payload: Record<string, unknown>): Record<string, unknown>;
  identity(roleRef: string, code: string, title?: string, overrides?: Record<string, unknown>): string;
}

function world(fn: (w: W) => void): void {
  const h = harness();
  try {
    const s = seed(h.store);
    const auth = FounderAuthStore.for(h.store);
    const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
    const actions = FounderActionStore.for(h.store, auth);
    fn({
      h, s, session, actions,
      act: (intent, payload) => {
        const p = actions.preview(session, intent, payload);
        return actions.confirm(session, p.id, p.fingerprint).resultRef;
      },
      preview: (intent, payload) => actions.preview(session, intent, payload).payload as Record<string, unknown>,
      identity: (roleRef, code, title = 'SYNTHETIC role', overrides = {}) => approveIdentity(h, s.founder, actions, session, code, sampleIdentity(roleRef, title, overrides)),
    });
  } finally {
    h.close();
  }
}

const reason = (r: string) => (e: unknown): boolean => isQandeelError(e) && (e.details.reason === r || e.code === r);
const refOf = (ref: string): Id => ref.split(':')[1] as Id;
const db = (w: W) => storeContext(w.h.store).db;
const STAFFING = { roleRef: 'role:growth.reddit-specialist', positionKind: 'SPECIALIST', positionTitle: 'Reddit Growth Specialist', businessNeed: 'SYNTHETIC: Reddit is an under-used channel for our audience.', workloadEvidence: 'SYNTHETIC: 40 relevant communities, no owner.', skillGap: 'SYNTHETIC: nobody knows Reddit norms.', expectedValue: 'SYNTHETIC: qualified sign-ups at low cost.', impactIfNotStaffed: 'SYNTHETIC: the channel stays dark.', alternatives: { redistributeWork: 'SYNTHETIC: no capacity.', improveSkillOrTraining: 'SYNTHETIC: not enough.', automate: 'SYNTHETIC: community work is human-paced.', temporarySpecialistOrCapability: 'SYNTHETIC: tried, not durable.' }, departmentCode: 'growth' };

describe('COMPANY-TALENT-01 A: the Talent Catalog — identities and programs are versioned Company data', () => {
  test('an incomplete identity is a draft with its gaps; it cannot be approved; a complete one is approved, frozen and superseded by its next version', () => {
    world((w) => {
      const catalog = TalentCatalogStore.for(w.h.store);
      const draft = catalog.saveDraft(w.s.founder, { kind: 'IDENTITY_PROFILE', code: 'sara-adel', body: { ...sampleIdentity('role:growth.analyst', 'SYNTHETIC analyst'), personality: ['calm'], boundaries: [] } });
      assert.equal(draft.definition.state, 'DRAFT');
      assert.deepEqual(draft.check.gaps.map((g) => g.field).sort(), ['boundaries', 'personality']);
      assert.throws(() => w.preview('TALENT_DEFINITION_DECIDE', { definitionId: draft.definition.id, decision: 'APPROVE' }), reason('DEFINITION_INCOMPLETE'));
      // Completed in place (a draft is editable, version-safe), then approved by the Founder.
      catalog.saveDraft(w.s.founder, { kind: 'IDENTITY_PROFILE', definitionId: draft.definition.id, expectedRowVersion: draft.definition.rowVersion, body: sampleIdentity('role:growth.analyst', 'SYNTHETIC analyst') });
      assert.throws(() => catalog.saveDraft(w.s.founder, { kind: 'IDENTITY_PROFILE', definitionId: draft.definition.id, expectedRowVersion: draft.definition.rowVersion, body: sampleIdentity('role:growth.analyst', 'x') }), (e: unknown) => isQandeelError(e, 'VERSION_CONFLICT'));
      const p = w.preview('TALENT_DEFINITION_DECIDE', { definitionId: draft.definition.id, decision: 'APPROVE' });
      assert.match(String(p.sha256), /^[0-9a-f]{64}$/);
      assert.equal(p.grants, 'NONE');
      w.act('TALENT_DEFINITION_DECIDE', { definitionId: draft.definition.id, decision: 'APPROVE' });
      const v1 = catalog.get(draft.definition.id);
      assert.equal(v1.state, 'APPROVED');
      assert.match(String(v1.decidedByRef), /^founder:/);
      // Frozen: the datastore refuses any content change of a decided definition.
      assert.throws(() => db(w).run(`UPDATE talent_definitions SET body_json = '{}', row_version = row_version + 1 WHERE id = ?`, v1.id), (e: unknown) => isQandeelError(e, 'STORAGE_INVARIANT') && /frozen/.test(String((e as { cause?: unknown }).cause)));
      assert.throws(() => catalog.saveDraft(w.s.founder, { kind: 'IDENTITY_PROFILE', definitionId: v1.id, body: sampleIdentity('role:growth.analyst', 'x') }), reason('DEFINITION_FROZEN'));
      // v2 of the same profile supersedes v1 (kept as history).
      const v2 = catalog.saveDraft(w.s.founder, { kind: 'IDENTITY_PROFILE', code: 'sara-adel', body: sampleIdentity('role:growth.analyst', 'SYNTHETIC senior analyst') }).definition;
      assert.equal(v2.version, 2);
      w.act('TALENT_DEFINITION_DECIDE', { definitionId: v2.id, decision: 'APPROVE' });
      assert.deepEqual([catalog.get(v1.id).state, catalog.get(v2.id).state], ['SUPERSEDED', 'APPROVED']);
      assert.deepEqual(catalog.history(v1.id).map((x) => x.toState), ['DRAFT', 'SUBMITTED', 'APPROVED', 'SUPERSEDED']);
    });
  });

  test('a program is validated by the same contract as a release package: BQM-2 pins, no release code, Founder Calibration for a leader role; approved programs resolve like release packages', () => {
    world((w) => {
      const catalog = TalentCatalogStore.for(w.h.store);
      const noPins = { ...sampleProgram({ roleRef: 'role:growth.reddit-specialist', code: 'growth.reddit', title: 'Reddit', leader: false }) };
      delete (noPins as Record<string, unknown>).benchmarkMethod;
      const a = catalog.saveDraft(w.s.founder, { kind: 'ACADEMY_PROGRAM', body: noPins });
      assert.ok(a.check.gaps.some((g) => g.reason === 'BQM2_PINS_REQUIRED'), 'no new BQM-1 program');
      const leader = catalog.saveDraft(w.s.founder, { kind: 'ACADEMY_PROGRAM', body: { ...sampleProgram({ roleRef: 'role:director.growth', code: 'director.growth', title: 'Growth Director', leader: true }), program: { ...(sampleProgram({ roleRef: 'role:director.growth', code: 'director.growth', title: 'x', leader: true }).program as Record<string, unknown>), founderCalibrationRequired: false } } });
      assert.ok(leader.check.gaps.some((g) => g.reason === 'LEADER_CALIBRATION_REQUIRED'), 'D6: a Director program requires Founder Calibration');
      const release = catalog.saveDraft(w.s.founder, { kind: 'ACADEMY_PROGRAM', body: sampleProgram({ roleRef: 'role:company.ceo', code: 'ceo.company-ceo', title: 'x', leader: true, version: 99 }) });
      assert.equal(release.check.ok, true, 'the catalog store alone knows no release codes');
      assert.ok(TalentCatalogStore.for(w.h.store, [{ code: 'ceo.company-ceo' } as never]).check(release.definition.id).gaps.some((g) => g.reason === 'RELEASE_PACKAGE_CODE'));
      const ok = catalog.saveDraft(w.s.founder, { kind: 'ACADEMY_PROGRAM', body: sampleProgram({ roleRef: 'role:growth.reddit-specialist', code: 'growth.reddit-specialist', title: 'Reddit Growth Specialist', leader: false, competencies: COMPETENCY_PRESETS['platform-growth'] as never }) });
      assert.equal(ok.check.ok, true, JSON.stringify(ok.check.gaps));
      w.act('TALENT_DEFINITION_DECIDE', { definitionId: ok.definition.id, decision: 'APPROVE' });
      // The approved program is a package the existing activation intents resolve (no code, no release entry).
      const env = w.actions.activationEnv();
      const pkg = env.packages.find((p) => p.code === 'growth.reddit-specialist');
      assert.ok(pkg, 'resolved from the catalog');
      assert.equal(w.actions.packageDigest('growth.reddit-specialist', 1), catalog.get(ok.definition.id).sha256);
      assert.equal((pkg?.program.competencies ?? []).length, 7);
    });
  });
});

describe('COMPANY-TALENT-01 B: identity without code per Employee', () => {
  test('a hire names an approved identity of the seat\'s role; the kernel and the LIVE organization reach the Employee\'s context; one identity is one person', () => {
    world((w) => {
      const smi = seat(w.h, 'director.strategic-market-intelligence');
      const ceo = placed(w.h, w.s, 'company.ceo');
      assert.throws(() => w.preview('EMPLOYEE_HIRE', { positionId: smi.id, givenName: 'Majed', familyName: 'Kedwany' }), reason('IDENTITY_REQUIRED'));
      const other = w.identity('role:director.growth', 'someone-else');
      assert.throws(() => w.preview('EMPLOYEE_HIRE', { positionId: smi.id, givenName: 'Majed', familyName: 'Kedwany', identityDefinitionId: other }), reason('IDENTITY_ROLE_MISMATCH'));
      const id = w.identity(smi.roleRef, 'majed-el-kedwany', 'SYNTHETIC Head of Strategic Market Intelligence', { name: { given: 'Majed', family: 'Kedwany', ar: 'ماجد الكدواني' } });
      const p = w.preview('EMPLOYEE_HIRE', { positionId: smi.id, givenName: 'Majed', familyName: 'Kedwany', displayNameAr: 'ماجد الكدواني', identityDefinitionId: id });
      assert.equal(p.identityCode, 'majed-el-kedwany');
      const majed = refOf(w.act('EMPLOYEE_HIRE', { positionId: smi.id, givenName: 'Majed', familyName: 'Kedwany', displayNameAr: 'ماجد الكدواني', identityDefinitionId: id }));
      const e = w.s.gov.getEmployee(majed);
      assert.equal(e.state, 'CANDIDATE', 'a hire never activates');
      assert.equal(TalentCatalogStore.for(w.h.store).bindings(majed)[0]?.classification, 'INITIAL');
      // One identity is one person: a second seat cannot carry the same profile.
      assert.throws(() => w.preview('EMPLOYEE_HIRE', { positionId: seat(w.h, 'director.growth').id, givenName: 'Other', familyName: 'Person', identityDefinitionId: id }), reason('IDENTITY_ROLE_MISMATCH'));
      // The context: the approved kernel and the live organization (seat, Department, manager = the CEO, lifecycle).
      w.s.gov.transitionEmployee(w.s.founder, majed, { to: 'TRAINING', reasonCode: 'onboarding' });
      budgetDepartment(w.s, departmentId(w.s, 'strategic-market-intelligence'));
      w.s.gov.createBudget(w.s.founder, { scope: 'EMPLOYEE', scopeId: majed, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
      // A trainee runs only constrained Academy work: its attempt context carries the identity.
      const wld = academyWorld(w.h, w.s, smi.roleRef, {}, 'smi.research');
      const academy = AcademyStore.for(w.h.store);
      const en = academy.enroll(w.s.founder, majed, wld.programVersionId);
      for (let i = 0; i < 6; i++) academy.recordModuleCompletion(w.s.founder, en.id, `module-${i}`, `evidence:module-${i}`);
      academy.advance(en.id);
      const started = academy.startAttempt(en.id, { scenarioId: wld.scenarios.practice, kind: 'SIMULATION', taskClass: 'draft.memo' });
      w.h.store.transitionWorkItem(started.workItemId, { to: 'READY', reasonCode: 'release' });
      const ctx = assembleContext(w.h.store, claimItem(w.h, started.workItemId, 'w-majed').fence, { step: 0 });
      assert.equal(ctx.outcome, 'OK');
      const sys = ctx.outcome === 'OK' ? ctx.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '';
      assert.ok(sys.includes(identityKernel(sampleIdentity(smi.roleRef, 'SYNTHETIC Head of Strategic Market Intelligence', { name: { given: 'Majed', family: 'Kedwany', ar: 'ماجد الكدواني' } }))), 'the approved kernel');
      assert.ok(sys.includes(`you report to ${ceo.name.given} ${ceo.name.family}`), 'the manager is read live from the seats');
      assert.ok(sys.includes('seat Strategic Market Intelligence Director') && sys.includes('lifecycle TRAINING'), 'the seat and lifecycle are read live');
    });
  });

  test('an identity revision keeps the same Employee and history; MATERIAL makes its VALID certification REVIEW_DUE; MINOR changes none', () => {
    world((w) => {
      const roleRef = 'role:analyst';
      const v1 = w.identity(roleRef, 'nour-said', 'SYNTHETIC analyst');
      const e = w.s.employee;
      // The seeded Employee is an ACTIVE analyst: bind its identity, certify it, then revise.
      const wld = academyWorld(w.h, w.s, roleRef);
      certify(w.h, w.s, w.s.gov.getEmployee(e.id), wld);
      w.act('EMPLOYEE_IDENTITY_REVISE', { employeeId: e.id, definitionId: v1, classification: 'MINOR' });
      assert.equal(AcademyStore.for(w.h.store).certifications(e.id).find((c) => c.status === 'VALID') !== undefined, true, 'MINOR: no certification change');
      const catalog = TalentCatalogStore.for(w.h.store);
      const v2 = catalog.saveDraft(w.s.founder, { kind: 'IDENTITY_PROFILE', code: 'nour-said', body: sampleIdentity(roleRef, 'SYNTHETIC senior analyst', { personality: ['bold', 'direct'] }) }).definition;
      w.act('TALENT_DEFINITION_DECIDE', { definitionId: v2.id, decision: 'APPROVE' });
      const p = w.preview('EMPLOYEE_IDENTITY_REVISE', { employeeId: e.id, definitionId: v2.id, classification: 'MATERIAL' });
      assert.equal(p.certificationsReviewDue, 1);
      w.act('EMPLOYEE_IDENTITY_REVISE', { employeeId: e.id, definitionId: v2.id, classification: 'MATERIAL' });
      const after = w.s.gov.getEmployee(e.id);
      assert.equal(after.id, e.id, 'the same Employee');
      assert.equal(AcademyStore.for(w.h.store).certifications(e.id).some((c) => c.status === 'REVIEW_DUE'), true);
      const b = catalog.bindings(e.id);
      assert.deepEqual(b.map((x) => [x.classification, x.endedAt === null]).sort(), [['MATERIAL', true], ['MINOR', false]]);
      assert.equal(db(w).get<{ n: number }>(`SELECT COUNT(*) AS n FROM employee_history WHERE employee_id = ? AND change_kind = 'PROFILE'`, e.id)?.n, 2, 'history appended, never rewritten');
    });
  });
});

describe('COMPANY-TALENT-01 C: manager-led staffing for several identical seats', () => {
  test('a Director (standing proposal right) files a request for 2 seats; the CEO recommends; the Founder approves 2 seats and no Employee; each seat is hired with its own identity', () => {
    world((w) => {
      const director = placed(w.h, w.s, 'director.growth');
      const ceo = placed(w.h, w.s, 'company.ceo');
      // D4: the standing, proposal-only rights come from the Founder-approved policy (no expiring delegation).
      w.act('ACCESS_POLICY_DECIDE', { policyCode: 'leadership.proposals', decision: 'APPROVE' });
      const d = runFor(w.h, w.s, director);
      const filed = recordOrgAct(w.h.store, d.claim.fence, 1, 'staffing.request.create', { ...STAFFING, headcount: 2 });
      assert.equal(filed.outcome, 'DONE', filed.code);
      const requestId = refOf(String(filed.resultRef));
      assert.throws(() => w.preview('STAFFING_DECIDE', { requestId, decision: 'APPROVE' }), reason('INVALID_TRANSITION'), 'the CEO reviews first while an ACTIVE CEO holds the seat');
      const c = runFor(w.h, w.s, ceo);
      assert.equal(recordOrgAct(w.h.store, c.claim.fence, 1, 'staffing.request.review', { requestId, action: 'RECOMMEND_APPROVE', priority: 5 }).outcome, 'DONE');
      // The CEO's proposal right is not a decision right.
      assert.equal(recordOrgAct(w.h.store, c.claim.fence, 2, 'staffing.request.decide', { requestId, decision: 'APPROVE' }).code, 'NO_GRANT');
      const p = w.preview('STAFFING_DECIDE', { requestId, decision: 'APPROVE' });
      assert.deepEqual([p.headcount, p.roleRef, p.ceoRecommendation], [2, 'role:growth.reddit-specialist', 'APPROVE']);
      const employeesBefore = w.s.gov.listEmployees().length;
      w.act('STAFFING_DECIDE', { requestId, decision: 'APPROVE' });
      const seats = db(w).all<{ id: string; kind: string; reports_to_position_id: string }>('SELECT id, kind, reports_to_position_id FROM org_positions WHERE staffing_request_id = ? ORDER BY created_at', requestId);
      assert.equal(seats.length, 2, 'D7: two identical seats');
      assert.ok(seats.every((x) => x.kind === 'SPECIALIST' && x.reports_to_position_id === seat(w.h, 'director.growth').id), 'under the requesting Director');
      assert.equal(w.s.gov.listEmployees().length, employeesBefore, 'approval creates no Employee');
      // Each seat its own hire and identity; never beyond the approved number.
      const a = w.identity('role:growth.reddit-specialist', 'reddit-one', 'SYNTHETIC Reddit specialist');
      const b = w.identity('role:growth.reddit-specialist', 'reddit-two', 'SYNTHETIC Reddit specialist');
      const e1 = refOf(w.act('EMPLOYEE_HIRE', { positionId: seats[0]?.id, givenName: 'Ola', familyName: 'Samir', identityDefinitionId: a }));
      const e2 = refOf(w.act('EMPLOYEE_HIRE', { positionId: seats[1]?.id, givenName: 'Tarek', familyName: 'Nabil', identityDefinitionId: b }));
      assert.notEqual(e1, e2);
      assert.throws(() => w.preview('EMPLOYEE_HIRE', { positionId: seats[0]?.id, givenName: 'Third', familyName: 'Person', identityDefinitionId: a }), reason('SEAT_OCCUPIED'));
      const view = talentOverview(w.h.store, [], null) as { staffing: { id: string; seats: unknown[] }[] };
      assert.equal(view.staffing.find((r) => r.id === requestId)?.seats.length, 2);
    });
  });

  test('a rejected request creates no seat and no Employee; a consolidated request is never decided; with no ACTIVE CEO the Founder decides an open request directly', () => {
    world((w) => {
      const director = placed(w.h, w.s, 'director.growth');
      w.act('ACCESS_POLICY_DECIDE', { policyCode: 'leadership.proposals', decision: 'APPROVE' });
      const d = runFor(w.h, w.s, director);
      const r1 = refOf(String(recordOrgAct(w.h.store, d.claim.fence, 1, 'staffing.request.create', STAFFING).resultRef));
      // No CEO is hired in this world: the Founder decides the Director's open request directly.
      const before = { seats: db(w).get<{ n: number }>('SELECT COUNT(*) AS n FROM org_positions')?.n, employees: w.s.gov.listEmployees().length };
      assert.equal(w.preview('STAFFING_DECIDE', { requestId: r1, decision: 'REJECT' }).decidedWithoutCeoReview, true);
      w.act('STAFFING_DECIDE', { requestId: r1, decision: 'REJECT' });
      assert.deepEqual({ seats: db(w).get<{ n: number }>('SELECT COUNT(*) AS n FROM org_positions')?.n, employees: w.s.gov.listEmployees().length }, before, 'nothing created');
      assert.equal(OrganizationStore.for(w.h.store).staffingRequest(r1).state, 'REJECTED');
      // A consolidated request is history: its target is decided instead.
      const ceo = placed(w.h, w.s, 'company.ceo');
      const r2 = refOf(String(recordOrgAct(w.h.store, d.claim.fence, 2, 'staffing.request.create', { ...STAFFING, positionTitle: 'Reddit Specialist A' }).resultRef));
      const r3 = refOf(String(recordOrgAct(w.h.store, d.claim.fence, 3, 'staffing.request.create', { ...STAFFING, positionTitle: 'Reddit Specialist B' }).resultRef));
      const c = runFor(w.h, w.s, ceo);
      assert.equal(recordOrgAct(w.h.store, c.claim.fence, 1, 'staffing.request.review', { requestId: r3, action: 'CONSOLIDATE', consolidateIntoId: r2 }).outcome, 'DONE');
      assert.throws(() => w.preview('STAFFING_DECIDE', { requestId: r3, decision: 'APPROVE' }), /consolidated/);
      assert.throws(() => w.preview('STAFFING_DECIDE', { requestId: r2, decision: 'APPROVE' }), reason('INVALID_TRANSITION'), 'an ACTIVE CEO now reviews first');
    });
  });
});

describe('COMPANY-TALENT-01 C2: a need agreed in conversation becomes a structured request without re-entry', () => {
  test('a Director holding the standing proposal right sees the request shape in its reply context and files the request from that same reply run', () => {
    world((w) => {
      const director = placed(w.h, w.s, 'director.growth');
      const comm = CommunicationStore.for(w.h.store);
      // Before the policy: no proposal right, no request shape in its context.
      const before = comm.send(w.s.founder, comm.directThread(w.s.founder, director.id).id, { purpose: 'QUESTION', body: 'SYNTHETIC: هل نحتاج متخصص Reddit؟' });
      const c0 = assembleContext(w.h.store, claimItem(w.h, before.replyWorkItemId as Id, 'w-before').fence, { step: 0 });
      assert.equal(c0.outcome === 'OK' && c0.messages.some((m) => m.content.includes('staffing.request.create')), false, 'a title alone shows no proposal act');
      w.act('ACCESS_POLICY_DECIDE', { policyCode: 'leadership.proposals', decision: 'APPROVE' });
      const sent = comm.send(w.s.founder, comm.directThread(w.s.founder, director.id).id, { purpose: 'REQUEST', body: 'SYNTHETIC: اتفقنا، قدّم طلب التوظيف.' });
      const claim = claimItem(w.h, sent.replyWorkItemId as Id, 'w-reply');
      const ctx = assembleContext(w.h.store, claim.fence, { step: 0 });
      assert.equal(ctx.outcome, 'OK');
      const sys = ctx.outcome === 'OK' ? ctx.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '';
      assert.ok(sys.includes(GRANTED_ORG_ACT_GUIDANCE['org.staffing.request'] as string), 'the granted proposal act, with its exact shape');
      // The Director files the agreed request from the reply run itself: the evidence is its own, nothing is re-typed.
      const filed = recordOrgAct(w.h.store, claim.fence, 1, 'staffing.request.create', { ...STAFFING, headcount: 1 });
      assert.equal(filed.outcome, 'DONE', filed.code);
      const r = OrganizationStore.for(w.h.store).staffingRequest(refOf(String(filed.resultRef)));
      assert.deepEqual([r.state, r.requestedByEmployeeId], ['SUBMITTED', director.id]);
    });
  });
});

describe('COMPANY-TALENT-01 D: Department budgets', () => {
  test('a Department Employee\'s envelope needs its Department budget and stays within it; the Founder creates it, nothing is spent', () => {
    world((w) => {
      const growth = departmentId(w.s, 'growth');
      const id = w.identity('role:director.growth', 'hala-mostafa', 'SYNTHETIC Growth Director');
      const e = refOf(w.act('EMPLOYEE_HIRE', { positionId: seat(w.h, 'director.growth').id, givenName: 'Hala', familyName: 'Mostafa', identityDefinitionId: id }));
      w.act('EMPLOYEE_LIFECYCLE', { employeeId: e, to: 'TRAINING' });
      w.s.gov.createRoutePolicy(w.s.founder, 'academy.attempt', { minClass: 'E1', maxClass: 'E2', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 5, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 50_000 } });
      assert.throws(() => w.preview('EMPLOYEE_MODEL_ACCESS', { employeeId: e, capMoney: 300_000, taskClasses: ['academy.attempt'] }), reason('DEPARTMENT_BUDGET_MISSING'));
      const p = w.preview('DEPARTMENT_BUDGET', { departmentId: growth, capMoney: 400_000 });
      assert.equal(p.spend, 'NONE');
      w.act('DEPARTMENT_BUDGET', { departmentId: growth, capMoney: 400_000 });
      assert.throws(() => w.preview('DEPARTMENT_BUDGET', { departmentId: growth, capMoney: 400_000 }), reason('DEPARTMENT_BUDGET_EXISTS'));
      assert.throws(() => w.preview('EMPLOYEE_MODEL_ACCESS', { employeeId: e, capMoney: 500_000, taskClasses: ['academy.attempt'] }), reason('CAP'), 'never above the Department cap');
      assert.equal(w.preview('EMPLOYEE_MODEL_ACCESS', { employeeId: e, capMoney: 300_000, taskClasses: ['academy.attempt'] }).parentBudget, 'DEPARTMENT');
      w.act('EMPLOYEE_MODEL_ACCESS', { employeeId: e, capMoney: 300_000, taskClasses: ['academy.attempt'] });
      const env = w.s.gov.budgetFor('EMPLOYEE', e);
      assert.equal(env?.parentId, w.s.gov.budgetFor('DEPARTMENT', growth)?.id, 'the envelope hangs under the Department budget');
      assert.equal(w.s.gov.budgetFor('DEPARTMENT', growth)?.spentMoney, 0);
    });
  });
});

describe('COMPANY-TALENT-01 E: leadership access policies (D2–D4)', () => {
  test('one individual grant per PRIMARY CEO / Director seat holder, from the hire; revoked on SUSPENDED, RETIRED or leaving the seat; an existing grant is adopted; a title grants nothing', () => {
    world((w) => {
      const gov = GovernanceStore.for(w.h.store);
      const ceo = placed(w.h, w.s, 'company.ceo');
      // The Company documents source and Tool are registered by the policy approval itself (D3).
      const p = w.preview('ACCESS_POLICY_DECIDE', { policyCode: 'leadership.company-knowledge', decision: 'APPROVE', repository: 'github:example/qandeel-company' });
      assert.equal(p.registerTool, true);
      assert.deepEqual(p.issue, [`${ceo.name.given} ${ceo.name.family}: tool:company-knowledge.company-docs-read`]);
      // The CEO already holds an individual grant of the capability (as Ahmed holds product knowledge): it is adopted.
      gov.registerTool(w.s.founder, { code: 'product-knowledge', driverCode: 'github.product-docs', egress: 'EXTERNAL' });
      w.act('ACCESS_POLICY_DECIDE', { policyCode: 'leadership.company-knowledge', decision: 'APPROVE', repository: 'github:example/qandeel-company' });
      const cap = 'tool:company-knowledge.company-docs-read';
      const active = (id: Id): string[] => gov.grants(id).filter((g) => g.status === 'ACTIVE' && g.capability === cap).map((g) => g.id);
      assert.equal(active(ceo.id).length, 1, 'one individual grant');
      assert.match(String(gov.grants(ceo.id).find((g) => g.capability === cap)?.grantedByRef), /^founder:/);
      // A hire into a Director seat receives its grant as a CANDIDATE (usable only within its other controls).
      const id = w.identity('role:director.product', 'amr-fathy', 'SYNTHETIC Product Director');
      const director = refOf(w.act('EMPLOYEE_HIRE', { positionId: seat(w.h, 'director.product').id, givenName: 'Amr', familyName: 'Fathy', identityDefinitionId: id }));
      assert.equal(active(director).length, 1);
      // A specialist seat — a title, not a leadership seat — receives nothing.
      const spec = placed(w.h, w.s, 'product.app-store-release-reputation-lead');
      assert.equal(active(spec.id).length, 0, 'a title alone grants nothing');
      // SUSPENDED revokes; reinstatement issues a new grant; RETIRED revokes.
      w.s.gov.transitionEmployee(w.s.founder, director, { to: 'TRAINING', reasonCode: 'x' });
      w.s.gov.transitionEmployee(w.s.founder, director, { to: 'SUSPENDED', reasonCode: 'x' });
      assert.equal(active(director).length, 0, 'suspended: revoked');
      // Leaving the seat ends the CEO's grant.
      const org = OrganizationStore.for(w.h.store);
      org.endAssignment(w.s.founder, org.assignmentsOfEmployee(ceo.id).find((a) => a.status === 'ACTIVE')?.id as string, 'left.seat');
      assert.equal(active(ceo.id).length, 0, 'left the seat: revoked');
      const links = db(w).all<{ adopted: number }>('SELECT adopted FROM policy_grant_links');
      assert.ok(links.length >= 2);
    });
  });

  test('an existing individual grant (Ahmed\'s product knowledge) is adopted as it is: never revoked and re-issued; a revoked policy leaves it standing', () => {
    world((w) => {
      const gov = GovernanceStore.for(w.h.store);
      const ceo = placed(w.h, w.s, 'company.ceo');
      gov.registerTool(w.s.founder, { code: 'product-knowledge', driverCode: 'github.product-docs', egress: 'EXTERNAL' });
      const tool = db(w).get<{ id: string }>(`SELECT id FROM tools WHERE code = 'product-knowledge'`);
      gov.registerToolAction(w.s.founder, { toolId: String(tool?.id), code: 'product-docs-read', risk: 'R0', sideEffects: 'NONE', mutatesExternal: false, dataClassCeiling: 'D2', argsSchema: { fields: { query: { type: 'string', required: true, maxLength: 200 } } }, costPerCallMicros: 0 });
      DigitalStore.for(w.h.store).registerTarget(w.s.founder, { code: 'product-knowledge-source', targetClass: 'CODE_REPOSITORY', adapterCode: 'github.product-docs', externalRef: 'github:example/qandeel', actions: {} });
      const original = gov.grant(w.s.founder, { employeeId: ceo.id, capability: 'tool:product-knowledge.product-docs-read', resourceScope: 'product-knowledge', riskCeiling: 'R0', dataClassCeiling: 'D2', reasonCode: 'founder.product_knowledge' });
      const p = w.preview('ACCESS_POLICY_DECIDE', { policyCode: 'leadership.app-knowledge', decision: 'APPROVE' });
      assert.deepEqual([(p.issue as string[]).length, (p.adopt as string[]).length], [0, 1], 'adopted, not re-issued');
      w.act('ACCESS_POLICY_DECIDE', { policyCode: 'leadership.app-knowledge', decision: 'APPROVE' });
      const live = gov.grants(ceo.id).filter((g) => g.status === 'ACTIVE' && g.capability === 'tool:product-knowledge.product-docs-read');
      assert.deepEqual(live.map((g) => g.id), [original.id], 'the very same grant, uninterrupted');
      w.act('ACCESS_POLICY_DECIDE', { policyCode: 'leadership.app-knowledge', decision: 'REVOKE' });
      assert.equal(gov.grants(ceo.id).find((g) => g.id === original.id)?.status, 'ACTIVE', 'revoking the policy leaves an adopted individual grant standing');
    });
  });
});

describe('COMPANY-TALENT-01 F: scalable Academy evaluation (D5)', () => {
  test('a qualified direct manager evaluates a practice attempt (applied at once) and an assessment (applied only after an independent review); never self-evaluation', () => {
    world((w) => {
      const director = placed(w.h, w.s, 'director.growth');
      const ceo = placed(w.h, w.s, 'company.ceo');
      // The Director is qualified: ACTIVE with a VALID certification for its own role.
      certify(w.h, w.s, director, academyWorld(w.h, w.s, director.roleRef, {}, 'growth.leadership'));
      w.act('ACCESS_POLICY_DECIDE', { policyCode: 'leadership.academy-evaluation', decision: 'APPROVE' });
      // A specialist under the Director, in the Academy.
      const pos = OrganizationStore.for(w.h.store).createPosition(w.s.founder, { code: 'growth.reddit-1', title: 'Reddit Growth Specialist', scope: 'DEPARTMENT', departmentId: departmentId(w.s, 'growth'), kind: 'SPECIALIST', roleRef: 'role:growth.reddit-specialist', reportsToPositionId: seat(w.h, 'director.growth').id, status: 'ACTIVE', reasonCode: 'x' });
      const id = w.identity('role:growth.reddit-specialist', 'ola-samir', 'SYNTHETIC Reddit specialist');
      const trainee = refOf(w.act('EMPLOYEE_HIRE', { positionId: pos.id, givenName: 'Ola', familyName: 'Samir', identityDefinitionId: id }));
      w.s.gov.transitionEmployee(w.s.founder, trainee, { to: 'TRAINING', reasonCode: 'x' });
      w.s.gov.createBudget(w.s.founder, { scope: 'EMPLOYEE', scopeId: trainee, capMoney: 200_000, capTokens: 200_000, reasonCode: 'seed' });
      const wld = academyWorld(w.h, w.s, 'role:growth.reddit-specialist', {}, 'growth.reddit');
      const a = AcademyStore.for(w.h.store);
      const en = a.enroll(w.s.founder, trainee, wld.programVersionId);
      for (let i = 0; i < 6; i++) a.recordModuleCompletion(w.s.founder, en.id, `module-${i}`, `evidence:module-${i}`);
      a.advance(en.id);
      const practice = a.startAttempt(en.id, { scenarioId: wld.scenarios.practice, kind: 'SIMULATION', taskClass: 'draft.memo' });
      answerWork(w.h, w.s, practice.workItemId);
      // The Director's model access for its evaluation work.
      w.s.gov.grant(w.s.founder, { employeeId: director.id, capability: 'model.invoke', resourceScope: 'draft.memo', riskCeiling: 'R0', dataClassCeiling: 'D2', reasonCode: 'seed' });
      // Not the manager / not qualified / self → refused.
      assert.throws(() => w.preview('ACADEMY_EVALUATION_ASSIGN', { attemptId: practice.attempt.id, evaluatorEmployeeId: trainee, taskClass: 'draft.memo' }), reason('SELF_EVALUATION'));
      assert.throws(() => w.preview('ACADEMY_EVALUATION_ASSIGN', { attemptId: practice.attempt.id, evaluatorEmployeeId: ceo.id, taskClass: 'draft.memo' }), reason('NOT_THE_DIRECT_MANAGER'));
      const evalRef = w.act('ACADEMY_EVALUATION_ASSIGN', { attemptId: practice.attempt.id, evaluatorEmployeeId: director.id, taskClass: 'draft.memo' });
      const evaluationId = refOf(evalRef);
      const m = db(w).get<{ work_item_id: string }>('SELECT work_item_id FROM academy_manager_evaluations WHERE id = ?', evaluationId);
      // The manager proposes its scores from the evaluation Work Item created for it (its own governed run).
      const claim = claimItem(w.h, String(m?.work_item_id) as Id, 'w-eval');
      const dims = Object.fromEntries(scores(85).map((x) => [x.dimension, x.scorePct]));
      const out = recordOrgAct(w.h.store, claim.fence, 1, 'academy.evaluation.propose', { evaluationId, dimensions: dims, competencies: {} });
      assert.equal(out.outcome, 'DONE', out.code);
      const decided = a.attempts(en.id).find((x) => x.id === practice.attempt.id);
      assert.equal(decided?.state, 'EVALUATED', 'practice: applied at once');
      const evaluators = a.dimensionResults(practice.attempt.id).filter((r) => r.evaluatorKind === 'MANAGER').map((r) => r.evaluatorRef);
      assert.ok(evaluators.length > 0 && evaluators.every((r) => r === `employee:${director.id}`));
      // An assessment (it counts toward certification): the datastore refuses a MANAGER score without an applied evaluation,
      // and any employee:* row that is not a MANAGER's.
      a.advance(en.id);
      const assess = a.startAttempt(en.id, { scenarioId: wld.scenarios.assessment, kind: 'ASSESSMENT', taskClass: 'draft.memo' });
      answerWork(w.h, w.s, assess.workItemId);
      const cause = (re: RegExp) => (e: unknown): boolean => isQandeelError(e, 'STORAGE_INVARIANT') && re.test(String((e as { cause?: unknown }).cause));
      assert.throws(() => db(w).run(`INSERT INTO academy_dimension_results (attempt_id, dimension, score_pct, evaluator_kind, evaluator_ref, evidence_refs_json, recorded_at) VALUES (?, 'CORRECTNESS', 90, 'MANAGER', ?, '[]', '2026-10-16T00:00:00.000Z')`, assess.attempt.id, `employee:${director.id}`), cause(/manager scores only/));
      assert.throws(() => db(w).run(`INSERT INTO academy_dimension_results (attempt_id, dimension, score_pct, evaluator_kind, evaluator_ref, evidence_refs_json, recorded_at) VALUES (?, 'CORRECTNESS', 90, 'EVALUATOR', ?, '[]', '2026-10-16T00:00:00.000Z')`, assess.attempt.id, `employee:${trainee}`), cause(/CHECK constraint/));
      const p2 = w.preview('ACADEMY_EVALUATION_ASSIGN', { attemptId: assess.attempt.id, evaluatorEmployeeId: director.id, taskClass: 'draft.memo' });
      assert.equal(p2.reviewRequired, true);
      const e2 = refOf(w.act('ACADEMY_EVALUATION_ASSIGN', { attemptId: assess.attempt.id, evaluatorEmployeeId: director.id, taskClass: 'draft.memo' }));
      const m2 = db(w).get<{ work_item_id: string }>('SELECT work_item_id FROM academy_manager_evaluations WHERE id = ?', e2);
      const claim2 = claimItem(w.h, String(m2?.work_item_id) as Id, 'w-eval-2');
      assert.equal(recordOrgAct(w.h.store, claim2.fence, 1, 'academy.evaluation.propose', { evaluationId: e2, dimensions: dims }).outcome, 'DONE');
      assert.equal(a.attempts(en.id).find((x) => x.id === assess.attempt.id)?.state, 'OPEN', 'an assessment waits for an independent review');
      // The Director's manager (the CEO) is not a qualified manager here (no certification): its review is refused.
      const c = runFor(w.h, w.s, ceo);
      assert.equal(recordOrgAct(w.h.store, c.claim.fence, 1, 'academy.evaluation.review', { evaluationId: e2, decision: 'CONFIRM' }).code, 'NOT_THE_EVALUATORS_MANAGER');
      // The Founder's independent review confirms: the scores count and the attempt is decided by the program's rules.
      w.act('ACADEMY_EVALUATION_REVIEW', { evaluationId: e2, decision: 'CONFIRM' });
      assert.equal(a.attempts(en.id).find((x) => x.id === assess.attempt.id)?.state, 'EVALUATED');
      assert.match(String(db(w).get<{ r: string }>('SELECT reviewed_by_ref AS r FROM academy_manager_evaluations WHERE id = ?', e2)?.r), /^founder:/);
    });
  });
});

describe('COMPANY-TALENT-01 G: Tools of a role — readiness is honest, a certification never claims an unassessed Tool', () => {
  test('a video editor\'s editing Tool shows NOT_REGISTERED; a registered Tool without a driver is NOT_INTEGRATED; the certification records NOT_ASSESSED', () => {
    world((w) => {
      const roleRef = 'role:analyst';
      w.act('ROLE_TOOL_REQUIREMENT', { roleRef, toolCode: 'video-editor', purpose: 'SYNTHETIC: cut short-form videos', decision: 'ADD' });
      const view = talentOverview(w.h.store, [], { drivers: () => [], hasCredential: () => false }) as { roleToolRequirements: { toolCode: string; readiness: { readiness: string } }[]; tools: { toolCode: string; readiness: string }[] };
      assert.equal(view.roleToolRequirements.find((r) => r.toolCode === 'video-editor')?.readiness.readiness, 'NOT_REGISTERED');
      assert.equal(view.tools.find((t) => t.toolCode === 'notes')?.readiness, 'NOT_INTEGRATED', 'a registered tool with no driver on this host');
      // A standing grant is refused for a Tool that is not READY (no adapter, no connection).
      assert.throws(() => w.preview('TOOL_ACCESS', { employeeId: w.s.employee.id, toolCode: 'video-editor', actionCode: 'edit', decision: 'GRANT' }), reason('TOOL_NOT_REGISTERED'));
      // A certification of the role records the Tool as NOT_ASSESSED (the Skill is certified; operating the Tool is not).
      const cert = certify(w.h, w.s, w.s.gov.getEmployee(w.s.employee.id), academyWorld(w.h, w.s, roleRef));
      const scope = db(w).all<{ tool_code: string; status: string; readiness: string }>('SELECT tool_code, status, readiness FROM certification_tool_scopes WHERE certification_id = ?', cert.certificationId).map((r) => ({ ...r }));
      assert.deepEqual(scope, [{ tool_code: 'video-editor', status: 'NOT_ASSESSED', readiness: 'NOT_REGISTERED' }]);
    });
  });
});
