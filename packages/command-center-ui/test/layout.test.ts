/**
 * Tree of Light layout and lens proofs (pure): the leadership spine, one column per Department in canonical
 * order with the Director first and people in rank order, seats own their place, goals anchored and served
 * through durable links, reporting lines from the seat chain, edges only from live relations, determinism,
 * scale, lenses that quiet the unrelated.
 * C5-PROOF: tree-of-light-layout
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEPT_LABEL, RANK_ORDER, applyLens, chainNodeIds, layoutUniverse, showsRelations } from '../src/index.js';
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

function universe(opts: { employeesPerDept?: number; vacancies?: boolean; acting?: boolean; manager?: boolean } = {}): U {
  const per = opts.employeesPerDept ?? 2;
  const departments = ['strategic-market-intelligence', 'growth', 'brand-creative', 'product', 'engineering'].map((code, i) => ({ id: id(i, 'd'), code, name: code, sector: i, directorPositionId: id(i, 'p') }));
  const seats: Loose[] = [];
  const employees: LooseEmployee[] = [];
  const ceoId = id(900);
  seats.push({ id: id(99, 'p'), code: 'company.ceo', title: 'CEO', kind: 'CEO', departmentId: null, reportsToPositionId: null, reportsToFounder: true, status: 'ACTIVE', holderEmployeeId: ceoId, holderKind: 'PRIMARY', coveredEmployeeId: null, actingUntil: null });
  employees.push({ id: ceoId, ref: `employee:${ceoId}`, name: { given: 'Ehab', family: 'Tarek' }, state: 'ACTIVE', roleRef: 'role:company.ceo', seatId: id(99, 'p'), seatKind: 'CEO', departmentId: null, orgScope: 'COMPANY', chain: [{ positionId: id(99, 'p'), kind: 'CEO', employeeId: ceoId }, { positionId: null, kind: 'FOUNDER', employeeId: null }] });
  let n = 0;
  for (const d of departments) {
    const dirSeat = id(d.sector, 'p');
    const vacant = opts.vacancies && d.sector === 2;
    const dirId = vacant ? null : id(100 + d.sector);
    seats.push({ id: dirSeat, code: `director.${d.code}`, title: `Director ${d.code}`, kind: 'DIRECTOR', departmentId: d.id, reportsToPositionId: id(99, 'p'), reportsToFounder: false, status: 'ACTIVE', holderEmployeeId: dirId, holderKind: dirId ? 'PRIMARY' : null, coveredEmployeeId: null, actingUntil: null });
    if (dirId) employees.push({ id: dirId, ref: `employee:${dirId}`, name: { given: 'Director', family: d.code }, state: 'ACTIVE', roleRef: `role:director.${d.code}`, seatId: dirSeat, seatKind: 'DIRECTOR', departmentId: d.id, orgScope: 'DEPARTMENT', chain: [{ positionId: dirSeat, kind: 'DIRECTOR', employeeId: dirId }, { positionId: id(99, 'p'), kind: 'CEO', employeeId: ceoId }, { positionId: null, kind: 'FOUNDER', employeeId: null }] });
    if (opts.manager && d.sector === 1) {
      const mSeat = id(500, 'p');
      const mId = id(600);
      // Sorted after the specialists by code on purpose: rank, not code, must order the column.
      seats.push({ id: mSeat, code: `zz.${d.code}.manager`, title: 'Manager', kind: 'MANAGER', departmentId: d.id, reportsToPositionId: dirSeat, reportsToFounder: false, status: 'ACTIVE', holderEmployeeId: mId, holderKind: 'PRIMARY', coveredEmployeeId: null, actingUntil: null });
      employees.push({ id: mId, ref: `employee:${mId}`, name: { given: 'Laila', family: 'Mourad' }, state: 'ACTIVE', roleRef: 'role:growth.manager', seatId: mSeat, seatKind: 'MANAGER', departmentId: d.id, orgScope: 'DEPARTMENT', chain: [{ positionId: mSeat, kind: 'MANAGER', employeeId: mId }, { positionId: dirSeat, kind: 'DIRECTOR', employeeId: dirId }, { positionId: id(99, 'p'), kind: 'CEO', employeeId: ceoId }, { positionId: null, kind: 'FOUNDER', employeeId: null }] });
    }
    for (let k = 0; k < per; k++) {
      const seatId = id(1000 + n, 'p');
      const empId = id(2000 + n);
      const acting = opts.acting && n === 0;
      seats.push({ id: seatId, code: `${d.code}.specialist-${k}`, title: `Specialist ${k}`, kind: 'SPECIALIST', departmentId: d.id, reportsToPositionId: dirSeat, reportsToFounder: false, status: 'ACTIVE', holderEmployeeId: empId, holderKind: acting ? 'ACTING' : 'PRIMARY', coveredEmployeeId: acting ? id(2999) : null, actingUntil: acting ? '2026-12-01T00:00:00.000Z' : null });
      employees.push({ id: empId, ref: `employee:${empId}`, name: { given: 'Person', family: `${n}` }, state: k === 1 && d.sector === 1 ? 'ON_LEAVE' : 'ACTIVE', roleRef: 'role:x', seatId, seatKind: 'SPECIALIST', departmentId: d.id, orgScope: 'DEPARTMENT', chain: [{ positionId: seatId, kind: 'SPECIALIST', employeeId: empId }, { positionId: dirSeat, kind: 'DIRECTOR', employeeId: dirId }, { positionId: id(99, 'p'), kind: 'CEO', employeeId: ceoId }, { positionId: null, kind: 'FOUNDER', employeeId: null }] });
      n++;
    }
  }
  const e0 = must(employees.find((e) => e.seatKind === 'SPECIALIST'));
  const e1 = must(employees.filter((e) => e.seatKind === 'SPECIALIST')[1]);
  const work: Loose[] = [
    { id: id(1, 'w'), objective: 'w1', state: 'IN_PROGRESS', riskLevel: 'R1', ownerEmployeeId: e0.id, ownerRef: e0.ref, departmentId: e0.departmentId, parentId: null, rootId: id(1, 'w'), dueAt: null, blockedReason: null, waitReason: null, running: true, goalIds: [id(1, 'g')], updatedAt: '2026-09-29T00:00:00.000Z' },
    { id: id(2, 'w'), objective: 'w2', state: 'BLOCKED', riskLevel: 'R1', ownerEmployeeId: e1.id, ownerRef: e1.ref, departmentId: e1.departmentId, parentId: null, rootId: id(2, 'w'), dueAt: null, blockedReason: 'DEPENDENCY', waitReason: null, running: false, goalIds: [], updatedAt: '2026-09-29T00:00:00.000Z' },
    { id: id(3, 'w'), objective: 'w3', state: 'COMPLETED', riskLevel: 'R1', ownerEmployeeId: e1.id, ownerRef: e1.ref, departmentId: e1.departmentId, parentId: null, rootId: id(3, 'w'), dueAt: null, blockedReason: null, waitReason: null, running: false, goalIds: [id(1, 'g')], updatedAt: '2026-09-29T00:00:00.000Z' },
  ];
  const relations: Loose[] = [
    { id: 'delegation:1', kind: 'DELEGATION', from: must(employees[1]).ref, to: e0.ref, workItemId: id(1, 'w'), state: 'ACCEPTED', since: '2026-09-29T00:00:00.000Z', sourceRef: 'work_delegation:1' },
    { id: 'approval:1', kind: 'APPROVAL', from: e1.ref, to: 'founder', workItemId: id(2, 'w'), state: 'PENDING_R3', since: '2026-09-29T00:00:00.000Z', sourceRef: 'approval:1' },
    { id: 'ghost:1', kind: 'REVIEW', from: 'employee:nobody', to: e0.ref, workItemId: null, state: 'ASSIGNED', since: '2026-09-29T00:00:00.000Z', sourceRef: 'review_request:x' },
  ];
  const goals: Loose[] = [
    { id: id(1, 'g'), kind: 'COMPANY', title: 'Launch in Saudi Arabia', state: 'ACTIVE', departmentId: null, parentGoalId: null, ownerRef: `employee:${ceoId}`, horizonTo: null, anchorDepartmentIds: [e0.departmentId], workItemIds: [id(1, 'w'), id(3, 'w')] },
    { id: id(2, 'g'), kind: 'COMPANY', title: 'Raise the rating', state: 'PROPOSED', departmentId: null, parentGoalId: null, ownerRef: e1.ref, horizonTo: null, anchorDepartmentIds: [], workItemIds: [] },
    { id: id(3, 'g'), kind: 'DEPARTMENT', title: 'Organic growth', state: 'ACTIVE', departmentId: id(1, 'd'), parentGoalId: id(1, 'g'), ownerRef: e1.ref, horizonTo: null, anchorDepartmentIds: [id(1, 'd')], workItemIds: [] },
  ];
  const attention: Loose[] = [{ id: id(1, 'a'), lane: 'NEEDS_ME', level: 'NEEDS_DECISION', sourceKind: 'APPROVAL', sourceRef: 'approval:1', ownerRef: e1.ref, firstSeenAt: '2026-09-29T00:00:00.000Z', lastSignalAt: '2026-09-29T00:00:00.000Z', signalCount: 1 }];
  return { at: '2026-09-29T00:00:00.000Z', live: true, founderRef: 'founder:x', departments, seats, employees, work, relations, goals, attention, signals: { running: 1, blocked: 1, waitingReview: 0, waitingApproval: 1, needsFounder: 1, vacantSeats: 0, actingSeats: 0 } } as unknown as U;
}

describe('Tree of Light layout', () => {
  test('C5-PROOF: the leadership spine — the Founder, then the CEO; five columns in canonical order, each led by its Director', () => {
    const l = layoutUniverse(universe());
    assert.equal(must(l.nodes[0]).id, 'founder');
    assert.equal(l.ceoId, `employee:${id(900)}`);
    assert.equal(must(l.byId.get(must(l.ceoId))).column, null, 'the CEO is on the spine, in no column');
    assert.deepEqual(l.columns.map((c) => c.code), ['strategic-market-intelligence', 'growth', 'brand-creative', 'product', 'engineering']);
    for (const c of l.columns) {
      const director = must(l.byId.get(must(c.directorId)));
      assert.equal(director.seatKind, 'DIRECTOR');
      assert.equal(director.row, 0, 'the Director leads the column');
      assert.ok(DEPT_LABEL[c.code], `column ${c.code} has a name`);
    }
    assert.ok(l.reports.some((r) => r.from === l.ceoId && r.to === 'founder'), 'the CEO reports to the Founder');
    assert.ok(l.columns.every((c) => l.reports.some((r) => r.from === c.directorId && r.to === l.ceoId)), 'every Director reports to the CEO');
  });

  test('C5-PROOF: people live inside their department in rank order — Director, Managers / Leads, Specialists; never by code', () => {
    const u = universe({ manager: true });
    const l = layoutUniverse(u);
    for (const n of l.nodes.filter((x) => x.kind === 'employee' || x.kind === 'seat')) {
      if (n.seatKind === 'CEO') continue;
      const dept = must(u.seats.find((s) => s.holderEmployeeId === n.employeeId || `seat:${s.id}` === n.id)).departmentId;
      assert.equal(n.departmentId, dept);
      assert.equal(n.column, l.columns.findIndex((c) => c.departmentId === dept), `${n.id} sits in its own column`);
    }
    const growth = must(l.columns[1]);
    const ranks = growth.memberIds.map((m) => RANK_ORDER[must(l.byId.get(m)).seatKind ?? ''] ?? 9);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'members are in rank order');
    assert.equal(must(l.byId.get(must(growth.memberIds[0]))).seatKind, 'MANAGER', 'the Manager comes first although its code sorts last');
    const rows = [growth.directorId, ...growth.memberIds].map((m) => must(l.byId.get(must(m))).row);
    assert.deepEqual(rows, rows.map((_, i) => i), 'rows are dense and unique');
    assert.equal(growth.headcount, 4);
  });

  test('C5-PROOF: seats own their place — deterministic, a vacancy keeps its row and its reporting line, a fill keeps the row', () => {
    const u = universe({ vacancies: true });
    const a = layoutUniverse(u);
    const b = layoutUniverse(JSON.parse(JSON.stringify(u)) as U);
    assert.deepEqual(a.nodes.map((n) => [n.id, n.column, n.row]), b.nodes.map((n) => [n.id, n.column, n.row]), 'the same universe yields the same layout');
    const brand = must(a.columns[2]);
    const vacant = must(a.byId.get(must(brand.directorId)));
    assert.equal(vacant.vacant, true);
    assert.equal(vacant.row, 0, 'the vacant Director seat still leads its column');
    assert.ok(a.reports.some((r) => r.from === vacant.id && r.to === a.ceoId), 'a vacant seat still reports to the CEO seat');
    const seat = must(u.seats.find((s) => s.holderEmployeeId === null));
    const filled = { ...u, seats: u.seats.map((s) => (s.id === seat.id ? { ...s, holderEmployeeId: id(4242), holderKind: 'PRIMARY' } : s)), employees: [...u.employees, { id: id(4242), ref: `employee:${id(4242)}`, name: { given: 'New', family: 'Director' }, state: 'ACTIVE', roleRef: 'role:x', seatId: seat.id, seatKind: 'DIRECTOR', departmentId: seat.departmentId, orgScope: 'DEPARTMENT', chain: [] }] } as unknown as U;
    const c = layoutUniverse(filled);
    const holder = must(c.byId.get(`employee:${id(4242)}`));
    assert.equal(holder.column, vacant.column);
    assert.equal(holder.row, vacant.row, 'the new holder appears exactly where the vacancy was');
  });

  test('C5-PROOF: goals are the direction band — anchored to columns and served through durable links; progress from work states; a derived goal hangs from its parent', () => {
    const u = universe();
    const l = layoutUniverse(u);
    assert.deepEqual(l.goals.map((g) => g.id), [`goal:${id(1, 'g')}`, `goal:${id(2, 'g')}`, `goal:${id(3, 'g')}`], 'company goals first, active before proposed, then department goals');
    const saudi = must(l.byId.get(`goal:${id(1, 'g')}`));
    const e0 = must(u.employees.find((e) => e.seatKind === 'SPECIALIST'));
    assert.deepEqual(saudi.anchors, [must(l.columns.find((c) => c.departmentId === e0.departmentId)).index]);
    assert.deepEqual([...saudi.workers].sort(), [`employee:${e0.id}`, `employee:${must(u.employees.filter((e) => e.seatKind === 'SPECIALIST')[1]).id}`].sort(), 'serving people come from Goal → Work links');
    assert.equal(saudi.progress, 0.5, 'one of two linked work items is completed');
    const proposed = must(l.byId.get(`goal:${id(2, 'g')}`));
    assert.equal(proposed.progress, null);
    assert.deepEqual(proposed.workers, []);
    const derived = must(l.byId.get(`goal:${id(3, 'g')}`));
    assert.equal(derived.parentGoalId, saudi.id);
    assert.equal(derived.column, 1, 'a Department goal belongs to its column');
  });

  test('C5-PROOF: edges only from live relations with both ends on the surface; acting cover, running work and lifecycle states travel with the node', () => {
    const l = layoutUniverse(universe({ acting: true }));
    assert.deepEqual(l.edges.map((e) => e.id).sort(), ['approval:1', 'delegation:1'], 'a relation to a ghost endpoint draws nothing');
    assert.ok(l.edges.every((e) => e.from !== e.to));
    const acting = must(l.nodes.find((n) => n.acting));
    assert.ok(acting.sublabel.includes('Acting cover'));
    assert.equal(l.nodes.filter((n) => n.kind === 'employee' && n.running).length, 1, 'exactly the person whose work runs');
    assert.ok(l.nodes.find((n) => n.state === 'ON_LEAVE'), 'the lifecycle state travels with the node');
    assert.equal(must(l.attention[0]).column, must(l.byId.get(must(l.attention[0]).employeeId ? `employee:${must(l.attention[0]).employeeId}` : '')).column, 'an attention item knows its owner\'s column');
  });

  test('C5-PROOF: scale — a 60-employee Department stays one ordered column with unique rows and lays out in milliseconds', () => {
    const u = universe({ employeesPerDept: 12 });
    const started = performance.now();
    const l = layoutUniverse(u);
    const ms = performance.now() - started;
    const employees = l.nodes.filter((n) => n.kind === 'employee');
    assert.ok(employees.length >= 60, `${employees.length} employees`);
    for (const c of l.columns) {
      const rows = c.memberIds.map((m) => must(l.byId.get(m)).row);
      assert.equal(new Set(rows).size, rows.length, `${c.code}: no two people share a row`);
    }
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
    assert.equal(showsRelations({ kind: 'EMPLOYEE', employeeId: e0.id }), true);
    assert.equal(showsRelations({ kind: 'LIVE' }), false, 'Company Live keeps the structure clean');
  });

  test('C5-PROOF: Goal Focus lights the goal, its serving people and their leadership, and its derived goal; Attention lens lights the items and their owners', () => {
    const u = universe();
    const l = layoutUniverse(u);
    const g = applyLens(u, l, { kind: 'GOAL', goalId: id(1, 'g') });
    assert.equal(g.nodes.get(`goal:${id(1, 'g')}`), 1);
    assert.equal(g.nodes.get(`goal:${id(3, 'g')}`), 1, 'the derived Department goal travels with its parent');
    assert.ok((g.nodes.get(`goal:${id(2, 'g')}`) ?? 1) < 0.5, 'an unrelated goal quiets');
    const owner = must(must(u.work[0]).ownerEmployeeId);
    assert.equal(g.nodes.get(`employee:${owner}`), 1);
    assert.equal(g.sectors.get(must(must(u.employees.find((e) => e.id === owner)).departmentId)), 1);
    assert.equal(g.nodes.get('founder'), 1);
    const a = applyLens(u, l, { kind: 'ATTENTION', lane: 'NEEDS_ME' });
    assert.equal(a.nodes.get(`attention:${id(1, 'a')}`), 1);
    const e1 = must(u.employees.filter((e) => e.seatKind === 'SPECIALIST')[1]);
    assert.equal(a.nodes.get(`employee:${e1.id}`), 1, 'the item\'s owner stays lit');
    const d = applyLens(u, l, { kind: 'DEPARTMENT', departmentId: id(0, 'd') });
    assert.equal(d.focusNodeId, must(l.columns[0]).directorId, 'a Department lens focuses its Director');
    assert.equal(d.nodes.get(`goal:${id(1, 'g')}`), 1, 'a goal anchored to the Department stays lit');
    assert.ok((d.nodes.get(`goal:${id(3, 'g')}`) ?? 1) < 0.5, 'a goal of another Department quiets');
  });
});
