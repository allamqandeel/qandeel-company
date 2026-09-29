// C5 seed: a representative Strong-v1 organization for the deterministic acceptance and the visual proof.
// Everything goes through public APIs; the ONLY test-only element is the armed Founder seam (loaded under
// --conditions=qandeel-test) standing in for the launch-token session while seeding. No provider, no
// credential, no network: the deterministic fake provider answers every governed run.
//
// The application is English; the company's people, seats, goals and work are seeded in English, and the
// conversation is bilingual on purpose: the Founder asks the CEO in Arabic, the CEO answers and briefs in
// Arabic, and a direct note to a lead is in English — the proof that content renders as written.
//
// `seedStatic(company)` runs before the runtime starts (organization, catalog, goals);
// `seedLive(surface, world)` runs with the runtime up (live work, delegation, approval, threads, briefs);
// `seedScale(surface, world, n)` adds a larger synthetic Department through the running runtime's own APIs.

import { setTimeout as sleep } from 'node:timers/promises';

const { CompanyStore, GovernanceStore, OrganizationStore, GoalStore, AttentionStore } = await import('@qandeel-company/storage');
const { activateEmployeeForTest, armFounderTestSurface } = await import('@qandeel-company/storage/testing');

export const DEPARTMENTS = ['strategic-market-intelligence', 'growth', 'brand-creative', 'product', 'engineering'];
export const TASK_CLASSES = ['draft.memo', 'founder.reply', 'founder.brief'];
export const DEPLOYMENTS = { memo: 'local-memo', reply: 'local-reply', brief: 'local-brief' };

export const script = (...outputs) => JSON.stringify({ script: outputs });
export const FINAL = (summaryCode = 'done') => ({ type: 'FINAL', summaryCode });
const inDays = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

export const PEOPLE = [
  // [seat code (existing or created), given, family, role, dept, kind, parent seat, title]
  ['company.ceo', 'Ehab', 'Tarek', 'role:company.ceo', null],
  ['director.strategic-market-intelligence', 'Nour', 'El-Sherif', 'role:director.strategic-market-intelligence', 'strategic-market-intelligence'],
  ['director.growth', 'Karim', 'Adel', 'role:director.growth', 'growth'],
  ['director.product', 'Salma', 'Hassan', 'role:director.product', 'product'],
  ['director.engineering', 'Omar', 'Fouad', 'role:director.engineering', 'engineering'],
  // brand-creative Director seat stays vacant (truthful: no invented Director) and is covered ACTING by the Product Director.
  ['growth.manager-1', 'Laila', 'Mourad', 'role:growth.manager', 'growth', 'MANAGER', 'director.growth', 'Growth Manager'],
  ['growth.seo-1', 'Hany', 'Saeed', 'role:growth.seo-specialist', 'growth', 'SPECIALIST', 'growth.manager-1', 'SEO Specialist'],
  ['growth.content-1', 'Mona', 'Youssef', 'role:content-strategist', 'growth', 'SPECIALIST', 'growth.manager-1', 'Content Strategist'],
  ['growth.ads-1', 'Ziad', 'Kamal', 'role:growth.performance', 'growth', 'SPECIALIST', 'growth.manager-1', 'Performance Ads'],
  ['product.lead-1', 'Dina', 'Nabil', 'role:product.lead', 'product', 'LEAD', 'director.product', 'Product Intelligence Lead'],
  ['product.research-1', 'Sherif', 'Lotfy', 'role:product.researcher', 'product', 'SPECIALIST', 'product.lead-1', 'Product Researcher'],
  ['product.app-store-release-reputation-lead', 'Yasmine', 'Samy', 'role:product.app-store-release-reputation-lead', 'product'],
  ['engineering.backend-1', 'Tarek', 'Mansour', 'role:engineering.backend', 'engineering', 'SPECIALIST', 'director.engineering', 'Backend Engineer'],
  ['engineering.mobile-1', 'Rana', 'Ezzat', 'role:engineering.mobile', 'engineering', 'SPECIALIST', 'director.engineering', 'Mobile Engineer'],
  ['smi.analyst-1', 'Ahmed', 'Rashad', 'role:smi.analyst', 'strategic-market-intelligence', 'SPECIALIST', 'director.strategic-market-intelligence', 'Market Analyst'],
  ['smi.analyst-2', 'Farida', 'Ali', 'role:smi.analyst', 'strategic-market-intelligence', 'SPECIALIST', 'director.strategic-market-intelligence', 'Market Analyst'],
  ['brand.designer-1', 'Youssef', 'Helmy', 'role:brand.visual-designer', 'brand-creative', 'SPECIALIST', 'director.brand-creative', 'Visual Designer'],
];

/** Content strings the seed writes (for the content-free checks: none of these may reach a log, a health line or an audit). */
export const CONTENT = ['Launch QANDEEL in Saudi Arabia', 'ما وضع إطلاق السعودية', 'الإطلاق السعودي على المسار', 'حملة الإطلاق السعودي جاهزة', 'Saudi keyword map'];

/** Seeds the organization, the catalog and the goals. Returns the world (IDs and refs only). */
export function seedStatic(company, { hangTool = false } = {}) {
  armFounderTestSurface(company);
  const store = CompanyStore.open(company);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const founder = gov.registerFounder().ref;
    // Money is in micro-units of EGP: company 2,000,000 EGP; each Department 250,000 EGP; each Employee 20,000 EGP
    // (so the Founder's "raise the ceiling to 50,000" in Scenario E is a real change inside the Department cap).
    gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: 2_000_000_000_000, capTokens: 2_000_000_000, currency: 'EGP', reasonCode: 'seed' });
    const dept = (code) => gov.departmentByCode(code).id;
    for (const c of DEPARTMENTS) gov.createBudget(founder, { scope: 'DEPARTMENT', scopeId: dept(c), capMoney: 250_000_000_000, capTokens: 250_000_000, reasonCode: 'seed' });
    const provider = gov.registerProvider(founder, { code: 'fake-local', locality: 'LOCAL' });
    const model = gov.registerModel(founder, { providerId: provider.id, code: 'fake-small' });
    const deployment = (code, taskClasses) => {
      const d = gov.registerDeployment(founder, { code, modelId: model.id, pinnedRevision: 'r1', reasoningClass: 'E1', contextWindowTokens: 100_000, maxOutputTokens: 2_048, taskClasses });
      gov.addPriceCard(founder, d.id, { currency: 'EGP', billingMode: 'METERED', billedInputPerMTok: 1_000_000, billedOutputPerMTok: 4_000_000, billedPerCall: 0, economicInputPerMTok: 1_000_000, economicOutputPerMTok: 4_000_000, economicPerCall: 0 });
      for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED']) gov.setQualification(founder, d.id, q, 'seed');
      gov.approveEgress(founder, d.id, 'D4', 'local.only');
      return d.id;
    };
    const deployments = { memo: deployment(DEPLOYMENTS.memo, ['draft.memo']), reply: deployment(DEPLOYMENTS.reply, ['founder.reply']), brief: deployment(DEPLOYMENTS.brief, ['founder.brief']) };
    for (const tc of TASK_CLASSES) gov.createRoutePolicy(founder, tc, { minClass: 'E1', maxClass: 'E2', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 8, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 100_000 } });
    const notes = gov.registerTool(founder, { code: 'notes', driverCode: 'fake-notes', egress: 'NONE' });
    gov.registerToolAction(founder, { toolId: notes.id, code: 'append', risk: 'R1', sideEffects: 'NONE', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: { fields: { text: { type: 'string', required: true, maxLength: 500 } } }, costPerCallMicros: 50 });
    const publisher = gov.registerTool(founder, { code: 'publisher', driverCode: 'fake-publisher', egress: 'EXTERNAL', credentialRef: 'vault:publisher' });
    gov.registerToolAction(founder, { toolId: publisher.id, code: 'publish', risk: 'R3', sideEffects: 'IDEMPOTENT', mutatesExternal: true, dataClassCeiling: 'D1', argsSchema: { fields: { text: { type: 'string', required: true, maxLength: 200 } } }, costPerCallMicros: 100 });

    const employees = {};
    const seatOf = {};
    for (const [code, given, family, roleRef, deptCode, kind, parentCode, title] of PEOPLE) {
      let seat = org.positionByCode(code);
      if (!seat) {
        const parent = org.positionByCode(parentCode);
        seat = org.createPosition(founder, { code, title, scope: 'DEPARTMENT', departmentId: dept(deptCode), kind, roleRef, reportsToPositionId: parent.id, reasonCode: 'headcount.added' });
      }
      const e = gov.createEmployee(founder, { name: { given, family }, profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: seat.roleRef, positionRef: 'position:p1', departmentId: dept(deptCode ?? 'product'), managerRef: founder });
      gov.transitionEmployee(founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
      gov.transitionEmployee(founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
      activateEmployeeForTest(gov, founder, e.id);
      gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 20_000_000_000, capTokens: 20_000_000, reasonCode: 'seed' });
      gov.grant(founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'seed' });
      gov.grant(founder, { employeeId: e.id, capability: 'tool:notes.append', riskCeiling: 'R1', dataClassCeiling: 'D3', reasonCode: 'seed' });
      org.assignPrimary(founder, { positionId: seat.id, employeeId: e.id, reasonCode: 'placed' });
      employees[code] = gov.getEmployee(e.id);
      seatOf[code] = seat;
    }
    // A vacant Director seat is truthfully vacant; the Product Director covers it, ACTING, for 30 days.
    const brandSeat = org.positionByCode('director.brand-creative');
    const acting = org.assignActing(founder, { positionId: brandSeat.id, employeeId: employees['director.product'].id, until: inDays(30), reasonCode: 'leave.cover' });
    // Vacant specialist seats: headcount is data (no invented people).
    org.createPosition(founder, { code: 'engineering.qa-1', title: 'QA Engineer', scope: 'DEPARTMENT', departmentId: dept('engineering'), kind: 'SPECIALIST', roleRef: 'role:engineering.qa', reportsToPositionId: seatOf['director.engineering'].id, reasonCode: 'headcount.added' });
    org.createPosition(founder, { code: 'brand.copy-1', title: 'Copywriter', scope: 'DEPARTMENT', departmentId: dept('brand-creative'), kind: 'SPECIALIST', roleRef: 'role:brand.copy', reportsToPositionId: brandSeat.id, reasonCode: 'headcount.added' });
    // Authority for the demo flows (explicit, bounded — Title ≠ Authority).
    org.delegateAuthority(founder, { employeeId: employees['director.growth'].id, capability: 'org.work.delegate', expiresAt: inDays(365), purposeCode: 'work', reasonCode: 'delegated' });
    gov.grant(founder, { employeeId: employees['growth.ads-1'].id, capability: 'tool:publisher.publish', riskCeiling: 'R3', dataClassCeiling: 'D1', reasonCode: 'seed' });

    // Goals (Stage 2 §3): two company goals (one ACTIVE, one PROPOSED awaiting the Founder), one derived Department goal.
    const goals = GoalStore.for(store);
    let saudi = goals.propose(founder, { kind: 'COMPANY', title: 'Launch QANDEEL in Saudi Arabia', summary: 'Enter the Saudi market before the end of the quarter with an Arabic-first experience and an organic plus paid growth plan.', successCriteria: ['Public launch on both app stores', 'Ten thousand active users within sixty days'], ownerRef: employees['company.ceo'].ref, horizonTo: inDays(75) });
    saudi = goals.transition(founder, saudi.id, { to: 'APPROVED', reasonCode: 'goal.approved' });
    saudi = goals.transition(founder, saudi.id, { to: 'ACTIVE', reasonCode: 'goal.activated' });
    const rating = goals.propose(founder, { kind: 'COMPANY', title: 'Raise the store rating to 4.7', summary: 'Address the causes of low ratings and answer reviews faster.', successCriteria: ['An average rating of 4.7 on both stores'], ownerRef: employees['product.app-store-release-reputation-lead'].ref, horizonTo: inDays(120) });
    let organic = goals.propose(founder, { kind: 'DEPARTMENT', departmentId: dept('growth'), parentGoalId: saudi.id, title: 'Saudi organic growth', summary: 'A keyword map and Arabic content for the Saudi market.', ownerRef: employees['director.growth'].ref, horizonTo: inDays(45) });
    organic = goals.transition(founder, organic.id, { to: 'APPROVED', reasonCode: 'goal.derived' });
    organic = goals.transition(founder, organic.id, { to: 'ACTIVE', reasonCode: 'goal.derived' });
    AttentionStore.for(store).sync('seed');
    return { founder, employees, seats: seatOf, deployments, goals: { saudi: saudi.id, rating: rating.id, organic: organic.id }, acting: acting.id, departments: Object.fromEntries(DEPARTMENTS.map((c) => [c, dept(c)])), hangTool };
  } finally {
    store.close();
  }
}

/** Live work through the running runtime: running, blocked, awaiting approval, delegated; threads and a brief. */
export async function seedLive(surface, world, { waitMs = 45_000, holdMs = 180_000 } = {}) {
  const rt = surface.runtime;
  const [provider] = surface.fakes.providers;
  const founder = world.founder;
  const goals = rt.founder.goals;
  const state = (id) => rt.view.getWorkItem(id).state;
  const until = async (fn, what, ms = waitMs) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
      await sleep(25);
    }
  };
  const submit = (employee, objective, instructions, extra = {}) => {
    const { workItem } = rt.submitWorkItem({ objective, ownerRef: employee.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, instructions }, ...extra });
    rt.governance.createBudget(founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
    return workItem.id;
  };
  const release = (id) => rt.transitionWorkItem(id, { to: 'READY', reasonCode: 'release' });
  // The CEO answers the Founder in Arabic (a deterministic script, never a real model): the content proof.
  provider.defaultScript(DEPLOYMENTS.reply, [
    { type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'الإطلاق السعودي على المسار: خريطة الكلمات المفتاحية جاهزة، والمحتوى العربي الأول قيد المراجعة، وحملة الأداء تنتظر موافقتك على السقف.', brief: null, contextRefs: [] },
    FINAL('reply.sent'),
  ]);
  provider.defaultScript(DEPLOYMENTS.brief, [
    { type: 'MESSAGE', purpose: 'BRIEF', attentionLevel: 'NEEDS_DECISION', body: 'موجز المدير التنفيذي', brief: { happening: 'حملة الإطلاق السعودي جاهزة للنشر وتنتظر اعتمادك لسقف ميزانية خمسين ألف جنيه.', matters: 'كل يوم تأخير يؤجل بيانات التعلم الأولى من السوق السعودي.', recommendation: 'اعتماد السقف الآن مع مراجعة الإنفاق بعد أسبوع.', decisionNeeded: true, decision: 'اعتماد سقف خمسين ألف جنيه لحملة الأداء' }, contextRefs: [] },
    FINAL('brief.sent'),
  ]);

  const e = world.employees;
  const out = {};
  // 1. Completed quickly: an SMI analysis serving the Saudi goal.
  out.analysis = submit(e['smi.analyst-1'], 'Competitor analysis for the Saudi market', script(FINAL('analysis.done')));
  goals.linkWork(founder, world.goals.saudi, out.analysis);
  release(out.analysis);
  await until(() => state(out.analysis) === 'COMPLETED', 'analysis completes');
  // 2. Running now: the SEO specialist's model call is held open by the fake (bounded, abortable) — visibly in progress.
  out.running = submit(e['growth.seo-1'], 'Saudi keyword map', script({ hold: holdMs, then: FINAL('keywords.done') }));
  goals.linkWork(founder, world.goals.organic, out.running);
  release(out.running);
  await until(() => rt.view.jobsFor(out.running).some((j) => j.state === 'CLAIMED'), 'seo run is claimed');
  // 3. Blocked: mobile work depending on a backend item that is still only proposed.
  out.backend = submit(e['engineering.backend-1'], 'Saudi payment API (backend)', script(FINAL('backend.done')));
  out.blocked = submit(e['engineering.mobile-1'], 'Payment screen in the app', script(FINAL('mobile.done')), { dependsOn: [out.backend], initialState: 'READY' });
  goals.linkWork(founder, world.goals.saudi, out.blocked);
  // 4. Awaiting the Founder's approval: an R3 campaign work item (review + Founder approval; nothing executes before).
  const { workItem: campaign } = rt.submitWorkItem({ objective: 'Performance campaign for the Saudi launch', ownerRef: e['growth.ads-1'].ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, instructions: script(FINAL('campaign.done')) }, riskLevel: 'R3', approvalRequired: true, initialState: 'READY' });
  out.campaign = campaign.id;
  rt.governance.createBudget(founder, { scope: 'WORK_ITEM', scopeId: campaign.id, capMoney: 2_000_000, capTokens: 500_000, reasonCode: 'seed' });
  goals.linkWork(founder, world.goals.saudi, campaign.id);
  const approval = rt.governance.requestWorkItemApproval(e['growth.ads-1'].ref, campaign.id);
  out.approvalId = approval.id;
  // 5. Delegation: the Growth Director delegates content work to the content strategist; the child's model call
  //    is held open so the handoff stays open (a live DELEGATION relation) and the Director waits at zero tokens.
  out.parent = submit(e['director.growth'], 'Saudi launch content', script({ type: 'ORG_ACTION', action: 'work.delegate', args: { delegateEmployeeId: e['growth.content-1'].id, objective: 'First article for the Saudi market', instructions: script({ hold: holdMs, then: FINAL('article.done') }), taskClass: 'draft.memo', budgetMoney: 300_000, budgetTokens: 300_000 } }, FINAL('content.delegated')));
  goals.linkWork(founder, world.goals.organic, out.parent);
  release(out.parent);
  const delegation = await until(() => rt.org.organization.workDelegations({ parentWorkItemId: out.parent }).find((d) => d.state === 'ACCEPTED' || d.state === 'OFFERED'), 'delegation exists');
  out.delegationId = delegation.id;
  // 6. The Founder asks the CEO a question in Arabic; the CEO's governed run answers with a MESSAGE proposal.
  const comm = rt.founder.communications;
  const ceoThread = comm.directThread(founder, null);
  const sent = comm.send(founder, ceoThread.id, { purpose: 'QUESTION', body: 'ما وضع إطلاق السعودية اليوم؟ وهل هناك ما يحتاج قراري؟' });
  out.ceoThreadId = ceoThread.id;
  out.replyWorkItemId = sent.replyWorkItemId;
  await until(() => comm.messages(ceoThread.id).some((m) => m.senderKind === 'EMPLOYEE'), 'the CEO answers');
  // 7. A proactive CEO brief for the pending approval (the surface's briefing policy would raise it on the event;
  //    here it is requested explicitly so the seed is deterministic whatever the event timing).
  const brief = comm.requestCeoBrief({ subject: 'Decision needed: performance campaign ceiling', contextKind: 'APPROVAL', contextRef: `approval:${approval.id}`, reasonCode: 'brief.approval_pending', instructions: 'Brief the Founder about the pending campaign approval.' });
  out.briefThreadId = brief.thread.id;
  await until(() => comm.messages(brief.thread.id).some((m) => m.purpose === 'BRIEF'), 'the CEO briefs');
  // 8. A direct Founder ↔ Employee thread with a plain English FYI (no reply needed: not attention material).
  const direct = comm.directThread(founder, e['product.lead-1'].id);
  comm.send(founder, direct.id, { purpose: 'FYI', body: 'Thanks for last week’s report — the retention cut was exactly what I needed.', responseRequired: false });
  out.directThreadId = direct.id;
  rt.founder.attention.sync(founder);
  return out;
}

/**
 * A larger company through the same public store APIs the static seed uses (a second connection beside the
 * running runtime, as any administrative tool would open): `n` more Growth seats (every sixth a Manager)
 * with active holders, so the scale frame is the real UI over real rows, not a synthetic layout.
 */
export function seedScale(company, world, n = 60) {
  const store = CompanyStore.open(company);
  try {
    return seedScaleInto(store, world, n);
  } finally {
    store.close();
  }
}

function seedScaleInto(store, world, n) {
  const gov = GovernanceStore.for(store);
  const org = OrganizationStore.for(store);
  const founder = world.founder;
  const growth = world.departments.growth;
  const director = world.seats['director.growth'];
  const FAMILIES = ['Adly', 'Barakat', 'Chalhoub', 'Darwish', 'Elgohary', 'Fahmy', 'Ghali', 'Hamdy', 'Ibrahim', 'Jaber', 'Khalil', 'Lotfy', 'Mahdy', 'Nassar', 'Osman', 'Qasem', 'Rady', 'Saber', 'Tawfik', 'Wahba'];
  const GIVEN = ['Adam', 'Basma', 'Cherine', 'Dalia', 'Eman', 'Fady', 'Ghada', 'Hossam', 'Injy', 'Jana', 'Khaled', 'Lina', 'Mazen', 'Nadine', 'Omnia', 'Ramy', 'Sara', 'Tamer', 'Walid', 'Yara'];
  const created = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 6 === 0 ? 'MANAGER' : 'SPECIALIST';
    const seat = org.createPosition(founder, { code: `growth.scale-${String(i).padStart(2, '0')}`, title: kind === 'MANAGER' ? 'Growth Manager' : 'Growth Specialist', scope: 'DEPARTMENT', departmentId: growth, kind, roleRef: kind === 'MANAGER' ? 'role:growth.manager' : 'role:growth.specialist', reportsToPositionId: director.id, reasonCode: 'headcount.added' });
    const e = gov.createEmployee(founder, { name: { given: GIVEN[i % GIVEN.length], family: FAMILIES[Math.floor(i / GIVEN.length) % FAMILIES.length] }, profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: seat.roleRef, positionRef: 'position:p1', departmentId: growth, managerRef: founder });
    gov.transitionEmployee(founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, founder, e.id);
    org.assignPrimary(founder, { positionId: seat.id, employeeId: e.id, reasonCode: 'placed' });
    created.push(e.id);
  }
  return created;
}
