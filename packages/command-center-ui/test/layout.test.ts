/**
 * Attention Orbits layout and lens proofs (pure): rank = radius, Department = sector, seats own their angle,
 * determinism, no accidental overlap at scale, edges only from live relations, lenses quiet the unrelated.
 * C5-PROOF: attention-orbits-layout
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEPT_LABEL, RING_LABEL, RING_RADIUS, applyLens, cameraTargetFor, chainNodeIds, labelTier, labelVisible, layoutUniverse } from '../src/index.js';
import type { CompanyUniverse } from '../src/model/types.js';

/** The value a proof relies on, present by construction of the fixture. */
function must<T>(v: T | null | undefined, what = 'value'): T {
  if (v === null || v === undefined) throw new Error(`${what} is missing`);
  return v;
}

type U = CompanyUniverse;
type Loose = Record<string, unknown>;
interface LooseEmployee extends Loose {
  id: string;
  ref: string;
  departmentId: string | null;
  seatKind: string | null;
}
const id = (n: number, p = 'e'): string => `${p}${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`.slice(0, 36);

function universe(opts: { employeesPerDept?: number; vacancies?: boolean; acting?: boolean } = {}): U {
  const per = opts.employeesPerDept ?? 2;
  const departments = ['strategic-market-intelligence', 'growth', 'brand-creative', 'product', 'engineering'].map((code, i) => ({ id: id(i, 'd'), code, name: code, sector: i, directorPositionId: id(i, 'p') }));
  const seats: Loose[] = [];
  const employees: LooseEmployee[] = [];
  const ceoId = id(900);
  seats.push({ id: id(99, 'p'), code: 'company.ceo', title: 'CEO', kind: 'CEO', departmentId: null, reportsToPositionId: null, reportsToFounder: true, status: 'ACTIVE', holderEmployeeId: ceoId, holderKind: 'PRIMARY', coveredEmployeeId: null, actingUntil: null });
  employees.push({ id: ceoId, ref: `employee:${ceoId}`, name: { given: 'إيهاب', family: 'طارق' }, state: 'ACTIVE', roleRef: 'role:company.ceo', seatId: id(99, 'p'), seatKind: 'CEO', departmentId: null, orgScope: 'COMPANY', chain: [{ positionId: id(99, 'p'), kind: 'CEO', employeeId: ceoId }, { positionId: null, kind: 'FOUNDER', employeeId: null }] });
  let n = 0;
  for (const d of departments) {
    const dirSeat = id(d.sector, 'p');
    const vacant = opts.vacancies && d.sector === 2;
    const dirId = vacant ? null : id(100 + d.sector);
    seats.push({ id: dirSeat, code: `director.${d.code}`, title: `Director ${d.code}`, kind: 'DIRECTOR', departmentId: d.id, reportsToPositionId: id(99, 'p'), reportsToFounder: false, status: 'ACTIVE', holderEmployeeId: dirId, holderKind: dirId ? 'PRIMARY' : null, coveredEmployeeId: null, actingUntil: null });
    if (dirId) employees.push({ id: dirId, ref: `employee:${dirId}`, name: { given: 'مدير', family: d.code }, state: 'ACTIVE', roleRef: `role:director.${d.code}`, seatId: dirSeat, seatKind: 'DIRECTOR', departmentId: d.id, orgScope: 'DEPARTMENT', chain: [{ positionId: dirSeat, kind: 'DIRECTOR', employeeId: dirId }, { positionId: id(99, 'p'), kind: 'CEO', employeeId: ceoId }, { positionId: null, kind: 'FOUNDER', employeeId: null }] });
    for (let k = 0; k < per; k++) {
      const seatId = id(1000 + n, 'p');
      const empId = id(2000 + n);
      const acting = opts.acting && n === 0;
      seats.push({ id: seatId, code: `${d.code}.specialist-${k}`, title: `Specialist ${k}`, kind: 'SPECIALIST', departmentId: d.id, reportsToPositionId: dirSeat, reportsToFounder: false, status: 'ACTIVE', holderEmployeeId: empId, holderKind: acting ? 'ACTING' : 'PRIMARY', coveredEmployeeId: acting ? id(2999) : null, actingUntil: acting ? '2026-12-01T00:00:00.000Z' : null });
      employees.push({ id: empId, ref: `employee:${empId}`, name: { given: `موظف`, family: `${n}` }, state: k === 1 && d.sector === 1 ? 'ON_LEAVE' : 'ACTIVE', roleRef: 'role:x', seatId, seatKind: 'SPECIALIST', departmentId: d.id, orgScope: 'DEPARTMENT', chain: [{ positionId: seatId, kind: 'SPECIALIST', employeeId: empId }, { positionId: dirSeat, kind: 'DIRECTOR', employeeId: dirId }, { positionId: id(99, 'p'), kind: 'CEO', employeeId: ceoId }, { positionId: null, kind: 'FOUNDER', employeeId: null }] });
      n++;
    }
  }
  const e0 = must(employees.find((e) => e.seatKind === 'SPECIALIST'));
  const e1 = must(employees.filter((e) => e.seatKind === 'SPECIALIST')[1]);
  const work: Loose[] = [
    { id: id(1, 'w'), objective: 'w1', state: 'IN_PROGRESS', riskLevel: 'R1', ownerEmployeeId: e0.id, ownerRef: e0.ref, departmentId: e0.departmentId, parentId: null, rootId: id(1, 'w'), dueAt: null, blockedReason: null, waitReason: null, running: true, goalIds: [id(1, 'g')], updatedAt: '2026-09-29T00:00:00.000Z' },
    { id: id(2, 'w'), objective: 'w2', state: 'BLOCKED', riskLevel: 'R1', ownerEmployeeId: e1.id, ownerRef: e1.ref, departmentId: e1.departmentId, parentId: null, rootId: id(2, 'w'), dueAt: null, blockedReason: 'DEPENDENCY', waitReason: null, running: false, goalIds: [], updatedAt: '2026-09-29T00:00:00.000Z' },
  ];
  const relations: Loose[] = [
    { id: 'delegation:1', kind: 'DELEGATION', from: must(employees[1]).ref, to: e0.ref, workItemId: id(1, 'w'), state: 'ACCEPTED', since: '2026-09-29T00:00:00.000Z', sourceRef: 'work_delegation:1' },
    { id: 'approval:1', kind: 'APPROVAL', from: e1.ref, to: 'founder', workItemId: id(2, 'w'), state: 'PENDING_R3', since: '2026-09-29T00:00:00.000Z', sourceRef: 'approval:1' },
    { id: 'ghost:1', kind: 'REVIEW', from: 'employee:nobody', to: e0.ref, workItemId: null, state: 'ASSIGNED', since: '2026-09-29T00:00:00.000Z', sourceRef: 'review_request:x' },
  ];
  const goals: Loose[] = [{ id: id(1, 'g'), kind: 'COMPANY', title: 'إطلاق السعودية', state: 'ACTIVE', departmentId: null, parentGoalId: null, ownerRef: `employee:${ceoId}`, horizonTo: null, anchorDepartmentIds: [e0.departmentId], workItemIds: [id(1, 'w')] }];
  const attention: Loose[] = [{ id: id(1, 'a'), lane: 'NEEDS_ME', level: 'NEEDS_DECISION', sourceKind: 'APPROVAL', sourceRef: 'approval:1', ownerRef: e1.ref, firstSeenAt: '2026-09-29T00:00:00.000Z', lastSignalAt: '2026-09-29T00:00:00.000Z', signalCount: 1 }];
  return { at: '2026-09-29T00:00:00.000Z', live: true, founderRef: 'founder:x', departments, seats, employees, work, relations, goals, attention, signals: { running: 1, blocked: 1, waitingReview: 0, waitingApproval: 1, needsFounder: 1, vacantSeats: 0, actingSeats: 0 } } as unknown as U;
}

describe('Attention Orbits layout', () => {
  test('C5-PROOF: Founder at the centre, CEO nearest, rank = radius (closer = higher), goals outside, attention inside the CEO orbit', () => {
    const l = layoutUniverse(universe());
    const founder = must(l.byId.get('founder'));
    assert.deepEqual([founder.x, founder.z], [0, 0]);
    const ceo = must(l.nodes.find((n) => n.seatKind === 'CEO'));
    const director = must(l.nodes.find((n) => n.seatKind === 'DIRECTOR'));
    const specialist = must(l.nodes.find((n) => n.seatKind === 'SPECIALIST'));
    const goal = must(l.nodes.find((n) => n.kind === 'goal'));
    const attention = must(l.nodes.find((n) => n.kind === 'attention'));
    assert.ok(ceo.radius < director.radius && director.radius < specialist.radius && specialist.radius < goal.radius, 'rank decreases outward');
    assert.ok(attention.radius < ceo.radius, 'needs-Founder items settle inside the CEO orbit');
    assert.equal(ceo.radius, RING_RADIUS.CEO);
    assert.ok(ceo.y > director.y && director.y > specialist.y, 'depth also expresses rank (never colour alone)');
  });

  test('C5-PROOF: Department = sector; every seat of a Department lies inside its sector; company seats sit in the company gap', () => {
    const u = universe();
    const l = layoutUniverse(u);
    assert.equal(l.sectors.length, 5);
    for (let i = 0; i < l.sectors.length; i++) {
      const s = must(l.sectors[i]);
      assert.ok(s.end - s.start > 0.5, `sector ${s.code} has width`);
      if (i > 0) assert.ok(must(l.sectors[i - 1]).end <= s.start + 1e-9, `sectors ${must(l.sectors[i - 1]).code} and ${s.code} do not overlap`);
    }
    for (const s of l.sectors) {
      for (const n of l.nodes.filter((x) => x.departmentId === s.departmentId && (x.kind === 'employee' || x.kind === 'seat'))) {
        assert.ok(n.angle >= s.start - 1e-9 && n.angle <= s.end + 1e-9, `${n.id} inside sector ${s.code}`);
        assert.equal(n.sector, s.index);
      }
    }
    const ceo = must(l.nodes.find((n) => n.seatKind === 'CEO'));
    assert.equal(ceo.sector, null);
    assert.ok(l.sectors.every((s) => !(ceo.angle >= s.start && ceo.angle <= s.end)), 'the CEO seat is in no Department sector');
  });

  test('C5-PROOF: stable spatial memory — deterministic, a transfer moves the person not the seat, a vacancy keeps its place', () => {
    const u = universe({ vacancies: true });
    const a = layoutUniverse(u);
    const b = layoutUniverse(JSON.parse(JSON.stringify(u)) as U);
    assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.z]), b.nodes.map((n) => [n.id, n.x, n.z]), 'the same universe yields the same layout');
    const vacant = must(a.nodes.find((n) => n.kind === 'seat'));
    assert.equal(vacant.vacant, true);
    // Fill the vacant seat: the new holder appears exactly where the vacancy was.
    const seat = must(u.seats.find((s) => s.holderEmployeeId === null));
    const filled = { ...u, seats: u.seats.map((s) => (s.id === seat.id ? { ...s, holderEmployeeId: id(4242), holderKind: 'PRIMARY' } : s)), employees: [...u.employees, { id: id(4242), ref: `employee:${id(4242)}`, name: { given: 'جديد', family: 'قادم' }, state: 'ACTIVE', roleRef: 'role:x', seatId: seat.id, seatKind: 'DIRECTOR', departmentId: seat.departmentId, orgScope: 'DEPARTMENT', chain: [] }] } as unknown as U;
    const c = layoutUniverse(filled);
    const holder = must(c.byId.get(`employee:${id(4242)}`));
    assert.ok(Math.abs(holder.x - vacant.x) < 1e-9 && Math.abs(holder.z - vacant.z) < 1e-9, 'seats own their angle');
  });

  test('C5-PROOF: edges only from live relations with both ends on the map; acting coverage and states are shape-encoded facts', () => {
    const l = layoutUniverse(universe({ acting: true }));
    assert.deepEqual(l.edges.map((e) => e.id).sort(), ['approval:1', 'delegation:1'], 'a relation to a ghost endpoint draws nothing');
    assert.ok(l.edges.every((e) => e.from !== e.to));
    const acting = must(l.nodes.find((n) => n.acting));
    assert.ok(acting.sublabel.includes('Acting'));
    const onLeave = l.nodes.find((n) => n.state === 'ON_LEAVE');
    assert.ok(onLeave, 'the lifecycle state travels with the node');
  });

  test('C5-PROOF: presentation facts come from state — running work circles its owner, goals carry their anchors, the map names ranks and departments in English', () => {
    const u = universe();
    const l = layoutUniverse(u);
    const owner = must(must(u.work[0]).ownerEmployeeId);
    assert.equal(must(l.byId.get(`employee:${owner}`)).running, true, 'the running arc is a real state');
    assert.ok(l.nodes.filter((n) => n.kind === 'employee' && n.running).length === 1, 'nobody else looks busy');
    const goal = must(l.byId.get(`goal:${id(1, 'g')}`));
    assert.equal(goal.goalKind, 'COMPANY');
    const ownerDept = must(u.employees.find((e) => e.id === owner)).departmentId;
    assert.deepEqual(goal.anchors, [must(l.sectors.find((s) => s.departmentId === ownerDept)).index], 'a goal is tethered to the sectors of the work serving it');
    assert.ok(l.rimRadius > must(l.rings.at(-1)).radius && l.rimRadius < l.outerRadius, 'the named rim sits between the last orbit and the goals');
    for (const r of l.rings) assert.ok(RING_LABEL[r.kind], `ring ${r.kind} has a name`);
    for (const s of l.sectors) assert.ok(DEPT_LABEL[s.code], `sector ${s.code} has a name`);
    assert.equal(must(l.nodes.find((n) => n.kind === 'founder')).label, 'Founder');
    assert.ok(l.nodes.every((n) => n.kind === 'attention' || !/[؀-ۿ]/.test(n.sublabel)), 'structural sublabels are English; content stays as written');
  });

  test('C5-PROOF: scale — a 60-employee Department keeps every employee apart and lays out in milliseconds', () => {
    const u = universe({ employeesPerDept: 12 });
    const started = performance.now();
    const l = layoutUniverse(u);
    const ms = performance.now() - started;
    const employees = l.nodes.filter((n) => n.kind === 'employee');
    assert.ok(employees.length >= 60, `${employees.length} employees`);
    let min = Infinity;
    for (let i = 0; i < employees.length; i++) for (let j = i + 1; j < employees.length; j++) {
      const a = must(employees[i]);
      const b = must(employees[j]);
      min = Math.min(min, Math.hypot(a.x - b.x, a.z - b.z));
    }
    assert.ok(min > 0.45, `minimum employee distance ${min.toFixed(2)}`);
    assert.ok(ms < 200, `layout took ${ms.toFixed(1)} ms`);
  });
});

describe('Lenses', () => {
  test('C5-PROOF: Employee Focus keeps the chain inward to the Founder, the employee\'s relations and goals; quiets the rest', () => {
    const u = universe();
    const l = layoutUniverse(u);
    const e0 = must(u.employees.find((e) => e.seatKind === 'SPECIALIST'));
    const em = applyLens(u, l, { kind: 'EMPLOYEE', employeeId: e0.id });
    const chain = chainNodeIds(u, l, e0.id);
    assert.equal(chain.at(-1), 'founder');
    assert.ok(chain.length >= 4, 'specialist → director → CEO → Founder');
    for (const c of chain) assert.equal(em.nodes.get(c), 1, `${c} stays bright`);
    assert.equal(em.nodes.get(`goal:${id(1, 'g')}`), 1, 'the goal its work serves stays lit');
    assert.equal(em.edges.get('delegation:1'), 1);
    assert.ok((em.edges.get('approval:1') ?? 1) < 0.5, 'an unrelated relation quiets');
    const unrelated = must(l.nodes.find((n) => n.kind === 'employee' && !chain.includes(n.id) && n.id !== `employee:${e0.id}` && n.departmentId !== e0.departmentId));
    assert.ok((em.nodes.get(unrelated.id) ?? 1) < 0.5, 'an unrelated employee quiets');
    assert.equal(em.focusNodeId, `employee:${e0.id}`);
    const cam = cameraTargetFor(l, em);
    assert.ok(cam.distance < 34, 'the camera comes closer for a focus');
  });

  test('C5-PROOF: Goal Focus lights the goal, its work owners and their leadership; Attention lens lights the items and their owners', () => {
    const u = universe();
    const l = layoutUniverse(u);
    const g = applyLens(u, l, { kind: 'GOAL', goalId: id(1, 'g') });
    assert.equal(g.nodes.get(`goal:${id(1, 'g')}`), 1);
    const owner = must(must(u.work[0]).ownerEmployeeId);
    assert.equal(g.nodes.get(`employee:${owner}`), 1);
    assert.equal(g.sectors.get(must(must(u.employees.find((e) => e.id === owner)).departmentId)), 1);
    const a = applyLens(u, l, { kind: 'ATTENTION', lane: 'NEEDS_ME' });
    assert.equal(a.nodes.get(`attention:${id(1, 'a')}`), 1);
    assert.equal(a.edges.get('approval:1'), 1, 'the edge to the Founder for the pending approval stays lit');
    const live = applyLens(u, l, { kind: 'LIVE' });
    assert.ok([...live.nodes.values()].every((w) => w === 1), 'Company Live quiets nothing');
  });

  test('C5-PROOF: label tiers — far shows leadership, goals and urgent attention; near shows everything', () => {
    const u = universe();
    const l = layoutUniverse(u);
    const em = applyLens(u, l, { kind: 'LIVE' });
    assert.equal(labelTier(40), 'FAR');
    assert.equal(labelTier(25), 'MID');
    assert.equal(labelTier(12), 'NEAR');
    const specialist = must(l.nodes.find((n) => n.seatKind === 'SPECIALIST'));
    const director = must(l.nodes.find((n) => n.seatKind === 'DIRECTOR'));
    assert.equal(labelVisible(specialist, 'FAR', em), false);
    assert.equal(labelVisible(director, 'FAR', em), true);
    assert.equal(labelVisible(specialist, 'NEAR', em), true);
  });
});
