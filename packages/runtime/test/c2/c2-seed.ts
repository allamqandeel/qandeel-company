/** Seeds a C2 workspace (before the runtime starts): public APIs plus the test-only Founder seam. */
import type { Id } from '@qandeel-company/domain';
import { CompanyStore, GovernanceStore, type EmployeeRecord } from '@qandeel-company/storage';
import { activateEmployeeForTest, armFounderTestSurface } from '@qandeel-company/storage/testing';

import { DeterministicFakeProvider, FakeToolDriver, employeeTaskProcessor, type CompanyRuntime, type RuntimeOptions } from '../../src/index.js';
import { runtimeFor } from '../helpers.js';

export interface C2World {
  readonly founder: string;
  readonly departmentId: Id;
  readonly employee: EmployeeRecord;
  readonly deployments: Record<'localE1' | 'cloudE1' | 'cloudE1b' | 'localE2', Id>;
  readonly providers: Record<'local' | 'cloud', Id>;
}

let n = 0;
const GIVEN = ['Nour', 'Karim', 'Salma', 'Omar', 'Laila', 'Hany', 'Mona', 'Tarek'];
export const nextName = (): { given: string; family: string } => {
  n++;
  return { given: GIVEN[n % GIVEN.length] as string, family: `Mahmoud${'abcdefghijklmnopqrstuvwxyz'[Math.floor(n / GIVEN.length) % 26]}` };
};

export function hireActive(gov: GovernanceStore, founder: string, departmentId: Id, { grants = true, budget = 5_000_000 } = {}): EmployeeRecord {
  const e = gov.createEmployee(founder, { name: nextName(), profile: { personality: 'practical' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: 'role:content-strategist', positionRef: 'position:p1', departmentId, managerRef: founder });
  gov.transitionEmployee(founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
  gov.transitionEmployee(founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
  // ACTIVE needs C3 certification, which C2 never fakes: tests reach it only through the test seam.
  const active = activateEmployeeForTest(gov, founder, e.id);
  gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: budget, capTokens: 5_000_000, reasonCode: 'seed' });
  if (grants) {
    gov.grant(founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'seed' });
    gov.grant(founder, { employeeId: e.id, capability: 'tool:notes.append', riskCeiling: 'R1', dataClassCeiling: 'D3', reasonCode: 'seed' });
    gov.grant(founder, { employeeId: e.id, capability: 'tool:publisher.publish', riskCeiling: 'R3', dataClassCeiling: 'D3', reasonCode: 'seed' });
  }
  return active;
}

function deployment(gov: GovernanceStore, founder: string, modelId: Id, code: string, cls: 'E1' | 'E2', egress: 'D2' | 'D4', inRate: number, outRate: number): Id {
  const d = gov.registerDeployment(founder, { code, modelId, pinnedRevision: 'r1', reasoningClass: cls, contextWindowTokens: 200_000, maxOutputTokens: 4_096, taskClasses: ['draft.memo'] });
  gov.addPriceCard(founder, d.id, { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: inRate, billedOutputPerMTok: outRate, billedPerCall: 0, economicInputPerMTok: inRate, economicOutputPerMTok: outRate, economicPerCall: 0 });
  for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED'] as const) gov.setQualification(founder, d.id, q, 'qualified');
  gov.approveEgress(founder, d.id, egress, 'egress.approved');
  return d.id;
}

export function seedWorld(root: string): C2World {
  // Production has no Founder surface in C2 (D-C2-13); tests arm one through the test-only seam.
  armFounderTestSurface(root);
  const store = CompanyStore.open(root);
  try {
    const gov = GovernanceStore.for(store);
    const founder = gov.registerFounder().ref;
    gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: 50_000_000, capTokens: 50_000_000, currency: 'USD', reasonCode: 'seed' });
    // C4: the canonical Departments are release-seeded (D-C4-02); fixtures adopt them by code.
    const dept = gov.departmentByCode('growth');
    if (!dept) throw new Error('the canonical Growth Department is release-seeded');
    gov.createBudget(founder, { scope: 'DEPARTMENT', scopeId: dept.id, capMoney: 20_000_000, capTokens: 20_000_000, reasonCode: 'seed' });
    const employee = hireActive(gov, founder, dept.id);
    const local = gov.registerProvider(founder, { code: 'fake-local', locality: 'LOCAL' });
    const cloud = gov.registerProvider(founder, { code: 'fake-cloud', locality: 'EXTERNAL', credentialRef: 'vault:fake-cloud' });
    const lm = gov.registerModel(founder, { providerId: local.id, code: 'fake-small' });
    const cm = gov.registerModel(founder, { providerId: cloud.id, code: 'fake-hosted' });
    const deployments = {
      localE1: deployment(gov, founder, lm.id, 'local-e1', 'E1', 'D4', 3_000_000, 9_000_000),
      cloudE1: deployment(gov, founder, cm.id, 'cloud-e1', 'E1', 'D2', 1_000_000, 4_000_000),
      cloudE1b: deployment(gov, founder, cm.id, 'cloud-e1b', 'E1', 'D2', 1_000_000, 4_000_000),
      localE2: deployment(gov, founder, lm.id, 'local-e2', 'E2', 'D4', 5_000_000, 15_000_000),
    };
    gov.createRoutePolicy(founder, 'draft.memo', { minClass: 'E1', maxClass: 'E2', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 10, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 1_000_000 } });
    const notes = gov.registerTool(founder, { code: 'notes', driverCode: 'fake-notes', egress: 'NONE' });
    const publisher = gov.registerTool(founder, { code: 'publisher', driverCode: 'fake-publisher', egress: 'EXTERNAL', credentialRef: 'vault:publisher' });
    const ledger = gov.registerTool(founder, { code: 'ledger', driverCode: 'fake-ledger', egress: 'EXTERNAL' });
    const review = gov.registerTool(founder, { code: 'review', driverCode: 'fake-review', egress: 'NONE' });
    const text = { fields: { text: { type: 'string' as const, required: true, maxLength: 500 } } };
    gov.registerToolAction(founder, { toolId: notes.id, code: 'append', risk: 'R1', sideEffects: 'NONE', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: text, costPerCallMicros: 50 });
    gov.registerToolAction(founder, { toolId: publisher.id, code: 'publish', risk: 'R3', sideEffects: 'IDEMPOTENT', mutatesExternal: true, dataClassCeiling: 'D2', argsSchema: text, costPerCallMicros: 500 });
    gov.registerToolAction(founder, { toolId: ledger.id, code: 'transfer', risk: 'R4', sideEffects: 'UNSAFE', mutatesExternal: true, dataClassCeiling: 'D1', argsSchema: text, costPerCallMicros: 0 });
    gov.registerToolAction(founder, { toolId: review.id, code: 'merge', risk: 'R2', sideEffects: 'NONE', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: text, costPerCallMicros: 0 });
    return { founder, departmentId: dept.id, employee, deployments, providers: { local: local.id, cloud: cloud.id } };
  } finally {
    store.close();
  }
}

export interface Fakes {
  readonly local: DeterministicFakeProvider;
  readonly cloud: DeterministicFakeProvider;
  readonly drivers: Record<'notes' | 'publisher' | 'ledger' | 'review', FakeToolDriver>;
}

export function fakes(): Fakes {
  return {
    local: new DeterministicFakeProvider('fake-local'),
    cloud: new DeterministicFakeProvider('fake-cloud'),
    drivers: { notes: new FakeToolDriver('fake-notes'), publisher: new FakeToolDriver('fake-publisher'), ledger: new FakeToolDriver('fake-ledger'), review: new FakeToolDriver('fake-review') },
  };
}

export function governedRuntime(root: string, f: Fakes, extra: Partial<RuntimeOptions> = {}): CompanyRuntime {
  return runtimeFor(root, { processors: [employeeTaskProcessor], governance: { providers: [f.local, f.cloud], toolDrivers: Object.values(f.drivers), modelCallTimeoutMs: 5_000, toolCallTimeoutMs: 2_000 }, ...extra });
}

/** Submits a governed task: Work Item (PROPOSED) → Work Item budget → released. */
export function submitTask(rt: CompanyRuntime, w: C2World, input: Record<string, unknown>, { employee = w.employee, cap = 1_000_000, runCap }: { employee?: EmployeeRecord; cap?: number; runCap?: number } = {}): Id {
  const { workItem } = rt.submitWorkItem({ objective: 'governed employee task', ownerRef: employee.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, ...input } });
  rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: cap, capTokens: 1_000_000, ...(runCap !== undefined ? { runCapMoney: runCap } : {}), reasonCode: 'seed' });
  rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  return workItem.id;
}

export const script = (...outputs: unknown[]): string => JSON.stringify({ script: outputs });
export const final = (summaryCode = 'task.done'): unknown => ({ type: 'FINAL', summaryCode });
export const toolReq = (tool: string, action: string, args: Record<string, unknown>): unknown => ({ type: 'TOOL_REQUEST', tool, action, args });
