/** C2 storage test seeding: Founder, department, employee, catalog, tools, grants, budgets. */
import type { Id, SideEffectClass } from '@qandeel-company/domain';

import { GovernanceStore, type CompanyStore, type EmployeeRecord } from '../src/index.js';
import { beginGovernedRun, claimNext } from '../src/runtime-authority.js';
import type { Harness } from './helpers.js';

export const GOVERNED_KIND = 'c2.employee-task';
export const C2_KINDS: ReadonlyMap<string, SideEffectClass> = new Map([[GOVERNED_KIND, 'IDEMPOTENT']]);

export interface Seed {
  readonly gov: GovernanceStore;
  readonly founder: string;
  readonly departmentId: Id;
  readonly employee: EmployeeRecord;
  readonly deploymentId: Id;
  readonly priceCardId: Id;
  readonly policyId: Id;
  readonly actions: Record<'read' | 'append' | 'publish' | 'merge' | 'transfer', Id>;
}

let counter = 0;
const GIVEN = ['Nour', 'Karim', 'Salma', 'Omar', 'Laila', 'Hany', 'Mona', 'Tarek', 'Yasmin', 'Ziad', 'Dina', 'Sherif'];
export function uniqueName(): { given: string; family: string } {
  counter++;
  return { given: GIVEN[counter % GIVEN.length] as string, family: `Hassan${'abcdefghijklmnopqrstuvwxyz'[Math.floor(counter / GIVEN.length) % 26]}` };
}

export function hire(gov: GovernanceStore, founder: string, departmentId: Id, active = true, roleRef = 'role:analyst'): EmployeeRecord {
  const e = gov.createEmployee(founder, { name: uniqueName(), profile: { personality: 'calm', strengths: ['analysis'] }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef, positionRef: 'position:p1', departmentId, managerRef: founder });
  if (!active) return e;
  gov.transitionEmployee(founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
  gov.transitionEmployee(founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
  return gov.transitionEmployee(founder, e.id, { to: 'ACTIVE', reasonCode: 'qualified', qualificationRefs: ['academy:attested-1'] });
}

export function seed(store: CompanyStore, { companyCap = 10_000_000, employeeCap = 1_000_000, grants = true } = {}): Seed {
  const gov = GovernanceStore.for(store);
  const founder = gov.registerFounder().ref;
  gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: companyCap, capTokens: 10_000_000, currency: 'USD', reasonCode: 'seed' });
  const dept = gov.createDepartment(founder, { code: 'product', name: 'Product' });
  gov.createBudget(founder, { scope: 'DEPARTMENT', scopeId: dept.id, capMoney: companyCap, capTokens: 10_000_000, reasonCode: 'seed' });
  const employee = hire(gov, founder, dept.id);
  gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: employee.id, capMoney: employeeCap, capTokens: 1_000_000, reasonCode: 'seed' });
  const provider = gov.registerProvider(founder, { code: 'fake-local', locality: 'LOCAL' });
  const model = gov.registerModel(founder, { providerId: provider.id, code: 'fake-small' });
  const d = gov.registerDeployment(founder, { code: 'local-e1', modelId: model.id, pinnedRevision: 'r1', reasoningClass: 'E1', contextWindowTokens: 100_000, maxOutputTokens: 4_096, taskClasses: ['draft.memo'] });
  const card = gov.addPriceCard(founder, d.id, { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 2_000_000, billedOutputPerMTok: 8_000_000, billedPerCall: 0, economicInputPerMTok: 2_000_000, economicOutputPerMTok: 8_000_000, economicPerCall: 0 });
  for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED'] as const) gov.setQualification(founder, d.id, q, 'qualification.step');
  gov.approveEgress(founder, d.id, 'D3', 'egress.approved');
  const policy = gov.createRoutePolicy(founder, 'draft.memo', { minClass: 'E1', maxClass: 'E2', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 5, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 50_000 } });
  const notes = gov.registerTool(founder, { code: 'notes', driverCode: 'fake-notes', egress: 'NONE' });
  const publisher = gov.registerTool(founder, { code: 'publisher', driverCode: 'fake-publisher', egress: 'EXTERNAL', credentialRef: 'vault:publisher-token' });
  const review = gov.registerTool(founder, { code: 'review', driverCode: 'fake-review', egress: 'NONE' });
  const ledger = gov.registerTool(founder, { code: 'ledger', driverCode: 'fake-ledger', egress: 'EXTERNAL' });
  const text = { fields: { text: { type: 'string' as const, required: true, maxLength: 200 } } };
  const actions = {
    read: gov.registerToolAction(founder, { toolId: notes.id, code: 'read', risk: 'R0', sideEffects: 'NONE', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: { fields: {} }, costPerCallMicros: 0 }).id,
    append: gov.registerToolAction(founder, { toolId: notes.id, code: 'append', risk: 'R1', sideEffects: 'NONE', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: text, costPerCallMicros: 100 }).id,
    publish: gov.registerToolAction(founder, { toolId: publisher.id, code: 'publish', risk: 'R3', sideEffects: 'IDEMPOTENT', mutatesExternal: true, dataClassCeiling: 'D1', argsSchema: text, costPerCallMicros: 1_000 }).id,
    merge: gov.registerToolAction(founder, { toolId: review.id, code: 'merge', risk: 'R2', sideEffects: 'NONE', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: text, costPerCallMicros: 0 }).id,
    transfer: gov.registerToolAction(founder, { toolId: ledger.id, code: 'transfer', risk: 'R4', sideEffects: 'UNSAFE', mutatesExternal: true, dataClassCeiling: 'D1', argsSchema: text, costPerCallMicros: 0 }).id,
  };
  if (grants) grantAll(gov, founder, employee.id);
  return { gov, founder, departmentId: dept.id, employee, deploymentId: d.id, priceCardId: card.id, policyId: policy.id as Id, actions };
}

export function grantAll(gov: GovernanceStore, founder: string, employeeId: Id): void {
  gov.grant(founder, { employeeId, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D3', reasonCode: 'seed' });
  for (const [cap, risk] of [['tool:notes.read', 'R0'], ['tool:notes.append', 'R1'], ['tool:publisher.publish', 'R3'], ['tool:review.merge', 'R3'], ['tool:ledger.transfer', 'R3']] as const) {
    gov.grant(founder, { employeeId, capability: cap, riskCeiling: risk, dataClassCeiling: 'D3', reasonCode: 'seed' });
  }
}

/** Creates a governed Work Item owned by `employee` with its own budget, then releases it. */
export function governedItem(h: Harness, s: Seed, employee: EmployeeRecord = s.employee, { cap = 100_000, runCap, dataClass = 'D1', risk = 'R1' as 'R1' | 'R3' | 'R4' } = {} as { cap?: number; runCap?: number; dataClass?: string; risk?: 'R1' | 'R3' | 'R4' }): Id {
  const { workItem } = h.store.createWorkItem({ objective: 'governed work', ownerRef: employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', dataClass, instructions: 'x' }, riskLevel: risk });
  s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: cap, capTokens: 100_000, ...(runCap !== undefined ? { runCapMoney: runCap } : {}), reasonCode: 'seed' });
  h.store.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  return workItem.id;
}

/** Claims the next governed job (as the runtime would) and binds its run to the employee. */
export function claimGoverned(h: Harness, workerId = 'w1') {
  const claim = claimNext(h.store, { ...h.claimOpts(workerId, 60_000), kinds: C2_KINDS });
  if (!claim) throw new Error('nothing to claim');
  const begun = beginGovernedRun(h.store, claim.fence);
  return { claim, begun };
}
