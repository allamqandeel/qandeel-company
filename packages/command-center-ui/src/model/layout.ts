/**
 * Tree of Light layout (pure, deterministic; D-C5-14): the Founder at the top, the CEO beneath, one column per
 * Department in canonical order with its Director first and its people below in rank order, goals along the
 * bottom anchored to the columns whose work serves them, attention items beside the Founder. Seats own their
 * place (a vacancy keeps its row; a transfer moves the person, not the column), and every relation drawn on
 * the surface is a durable fact: reporting lines from the seat chain, execution lines from Goal → Work links,
 * coloured lines from live typed relations. The same layout drives the surface and every test.
 */
import { KIND_LABEL, SEAT_TITLE } from './format.js';
import type { CompanyUniverse, Layout, LayoutColumn, LayoutEdge, LayoutNode, ReportEdge } from './types.js';

/** Rank order inside a column: the Director leads, Managers and Leads follow, Specialists complete the team. */
export const RANK_ORDER: Readonly<Record<string, number>> = { DIRECTOR: 0, MANAGER: 1, LEAD: 1, SPECIALIST: 2 };

/** FNV-1a: a stable 32-bit hash for deterministic tie-breaks (never Math.random). */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const NODE_DEFAULTS = { acting: false, vacant: false, seatKind: null, employeeId: null, goalKind: null, anchors: [] as readonly number[], workers: [] as readonly string[], progress: null, parentGoalId: null, running: false } as const;
const byCode = <T extends { code: string }>(a: T, b: T): number => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

export function layoutUniverse(u: CompanyUniverse): Layout {
  const nodes: LayoutNode[] = [];
  const employees = new Map(u.employees.map((e) => [String(e.id), e]));
  const runningOwners = new Set(u.work.filter((w) => w.running || w.state === 'RUNNING').map((w) => String(w.ownerEmployeeId)));
  const fullName = (id: string | null): string => {
    const e = id === null ? undefined : employees.get(id);
    return e ? `${e.name.given} ${e.name.family}` : '';
  };
  const columnIndex = new Map(u.departments.map((d, i) => [d.id, i]));

  nodes.push({ ...NODE_DEFAULTS, id: 'founder', kind: 'founder', column: null, departmentId: null, row: 0, label: 'Founder', sublabel: 'Company centre', state: 'PRINCIPAL', importance: 1 });

  // Seats: one node per live seat (occupied or vacant), in its Department column, in rank order.
  const seats = u.seats.filter((s) => s.status !== 'RETIRED');
  const placed = new Set<string>();
  const seatNodeId = new Map<string, string>();
  const primaryHolders = new Set(seats.filter((s) => s.holderKind === 'PRIMARY' && s.holderEmployeeId !== null).map((s) => String(s.holderEmployeeId)));
  const seatNode = (s: CompanyUniverse['seats'][number], column: number | null, row: number): LayoutNode => {
    const holder = s.holderEmployeeId;
    const vacant = holder === null;
    const acting = s.holderKind === 'ACTING';
    const employee = holder === null ? undefined : employees.get(holder);
    const title = SEAT_TITLE[s.code] ?? s.title;
    if (holder !== null) placed.add(holder);
    if (s.coveredEmployeeId !== null) placed.add(s.coveredEmployeeId);
    // Someone covering a seat beside their own keeps their own card in their own seat; the covered seat shows
    // them as cover with its own node. A person whose only placement is a cover is reachable as themselves.
    const id = vacant ? `seat:${s.id}` : acting && holder !== null && primaryHolders.has(holder) ? `acting:${s.id}` : `employee:${holder}`;
    seatNodeId.set(s.id, id);
    return {
      ...NODE_DEFAULTS,
      id,
      kind: vacant ? 'seat' : 'employee',
      column,
      departmentId: s.departmentId,
      row,
      label: vacant ? title : fullName(holder),
      sublabel: vacant ? `Vacant · ${title}` : `${title}${acting ? ' · Acting cover' : ''}`,
      state: vacant ? 'VACANT' : (employee?.state ?? 'UNKNOWN'),
      acting,
      vacant,
      seatKind: s.kind,
      employeeId: holder,
      running: holder !== null && runningOwners.has(holder),
      importance: s.kind === 'CEO' ? 0.95 : s.kind === 'DIRECTOR' ? 0.8 : s.kind === 'SPECIALIST' ? 0.45 : 0.6,
    };
  };

  // The leadership spine: the CEO seat (company scope). Other company-scoped seats sit beside it.
  const companySeats = seats.filter((s) => s.departmentId === null).sort((a, b) => (a.kind === 'CEO' ? -1 : b.kind === 'CEO' ? 1 : byCode(a, b)));
  let ceoId: string | null = null;
  companySeats.forEach((s, i) => {
    const n = seatNode(s, null, i);
    if (s.kind === 'CEO' && ceoId === null) ceoId = n.id;
    nodes.push(n);
  });

  const columns: LayoutColumn[] = u.departments.map((d, index) => {
    const own = seats.filter((s) => s.departmentId === d.id);
    const director = own.filter((s) => s.kind === 'DIRECTOR').sort(byCode)[0] ?? null;
    const rest = own.filter((s) => s !== director).sort((a, b) => (RANK_ORDER[a.kind] ?? 3) - (RANK_ORDER[b.kind] ?? 3) || byCode(a, b));
    let row = 0;
    let directorId: string | null = null;
    if (director) {
      const n = seatNode(director, index, row++);
      directorId = n.id;
      nodes.push(n);
    }
    const memberIds: string[] = [];
    for (const s of rest) {
      const n = seatNode(s, index, row++);
      memberIds.push(n.id);
      nodes.push(n);
    }
    // Employees of this Department who hold no seat (not yet placed, or covered): after the seated members.
    const unplaced = u.employees.filter((e) => !placed.has(e.id) && e.state !== 'RETIRED' && e.departmentId === d.id).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const e of unplaced) {
      placed.add(e.id);
      const n: LayoutNode = { ...NODE_DEFAULTS, id: `employee:${e.id}`, kind: 'employee', column: index, departmentId: d.id, row: row++, label: `${e.name.given} ${e.name.family}`, sublabel: e.seatKind ? (KIND_LABEL[e.seatKind] ?? e.seatKind) : 'No seat', state: e.state, employeeId: e.id, running: runningOwners.has(e.id), importance: 0.4 };
      memberIds.push(n.id);
      nodes.push(n);
    }
    const headcount = [directorId, ...memberIds].filter((id): id is string => id !== null && id.startsWith('employee:')).length;
    return { departmentId: d.id, code: d.code, name: d.name, index, directorId, memberIds, headcount };
  });
  // Employees with no Department and no seat: beside the spine.
  u.employees.filter((e) => !placed.has(e.id) && e.state !== 'RETIRED').sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((e, i) => {
    nodes.push({ ...NODE_DEFAULTS, id: `employee:${e.id}`, kind: 'employee', column: null, departmentId: null, row: companySeats.length + i, label: `${e.name.given} ${e.name.family}`, sublabel: 'No seat', state: e.state, employeeId: e.id, running: runningOwners.has(e.id), importance: 0.4 });
  });

  // Goals: the strategic direction band. Anchors and serving people come from durable Goal → Work links.
  const stateRank = (s: string): number => (s === 'ACTIVE' ? 0 : s === 'APPROVED' ? 1 : s === 'PROPOSED' || s === 'DRAFT' ? 2 : s === 'PAUSED' ? 3 : 4);
  const goalNodes: LayoutNode[] = [...u.goals]
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'COMPANY' ? -1 : 1) || stateRank(a.state) - stateRank(b.state) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
    .map((g, i) => {
      const linked = u.work.filter((w) => (w.goalIds as readonly string[]).includes(g.id));
      const workers = [...new Set(linked.map((w) => (w.ownerEmployeeId ? `employee:${w.ownerEmployeeId}` : null)).filter((x): x is string => x !== null))];
      const anchors = [...new Set(g.anchorDepartmentIds.map((d) => columnIndex.get(d)).filter((x): x is number => x !== undefined))].sort((a, b) => a - b);
      const done = linked.filter((w) => w.state === 'COMPLETED').length;
      return { ...NODE_DEFAULTS, id: `goal:${g.id}`, kind: 'goal', column: g.kind === 'DEPARTMENT' && g.departmentId ? (columnIndex.get(g.departmentId) ?? null) : null, departmentId: g.departmentId, row: i, label: g.title, sublabel: g.kind === 'COMPANY' ? 'Company goal' : 'Department goal', state: g.state, goalKind: g.kind === 'COMPANY' ? 'COMPANY' : 'DEPARTMENT', anchors, workers, progress: linked.length === 0 ? null : done / linked.length, parentGoalId: g.parentGoalId ? `goal:${g.parentGoalId}` : null, importance: g.kind === 'COMPANY' ? 0.9 : 0.7 };
    });
  nodes.push(...goalNodes);

  // Attention items: beside the Founder, needs-me first, then briefs, then conversations; oldest first inside a lane.
  const laneRank = (l: string): number => (l === 'NEEDS_ME' ? 0 : l === 'CEO_BRIEFS' ? 1 : 2);
  const attentionNodes: LayoutNode[] = [...u.attention]
    .sort((a, b) => laneRank(a.lane) - laneRank(b.lane) || (a.firstSeenAt < b.firstSeenAt ? -1 : a.firstSeenAt > b.firstSeenAt ? 1 : a.id < b.id ? -1 : 1))
    .map((a, i) => {
      const owner = a.ownerRef?.startsWith('employee:') ? a.ownerRef.slice('employee:'.length) : null;
      const dept = owner ? (employees.get(owner)?.departmentId ?? null) : null;
      return { ...NODE_DEFAULTS, id: `attention:${a.id}`, kind: 'attention', column: dept ? (columnIndex.get(dept) ?? null) : null, departmentId: dept, row: i, label: a.sourceKind, sublabel: a.lane, state: a.level, employeeId: owner, importance: a.level === 'URGENT' || a.level === 'NEEDS_DECISION' ? 1 : 0.7 };
    });
  nodes.push(...attentionNodes);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Live relations: only typed relations whose ends are on the surface.
  const endpoint = (ref: string): string | null => (ref === 'founder' ? 'founder' : byId.has(ref) ? ref : null);
  const edges: LayoutEdge[] = [];
  for (const r of u.relations) {
    const from = endpoint(r.from);
    const to = endpoint(r.to);
    if (from === null || to === null || from === to) continue;
    edges.push({ id: r.id, kind: r.kind, from, to, state: r.state, workItemId: r.workItemId, sourceRef: r.sourceRef });
  }
  // Reporting lines from the seat chain (the next link inward), never invented.
  const reports: ReportEdge[] = [];
  for (const e of u.employees) {
    const id = `employee:${e.id}`;
    if (!byId.has(id)) continue;
    const next = e.chain[1];
    let to: string | null = null;
    if (next) {
      if (next.kind === 'FOUNDER') to = 'founder';
      else if (next.employeeId !== null && byId.has(`employee:${next.employeeId}`)) to = `employee:${next.employeeId}`;
      else if (next.positionId !== null) to = seatNodeId.get(next.positionId) ?? null;
    }
    if (to !== null && to !== id) reports.push({ from: id, to });
  }
  for (const s of seats) {
    // A vacant seat still reports somewhere: the line shows the shape of the team, not a person.
    const id = seatNodeId.get(s.id);
    if (!id || !id.startsWith('seat:')) continue;
    const to = s.reportsToFounder ? 'founder' : s.reportsToPositionId ? (seatNodeId.get(s.reportsToPositionId) ?? null) : null;
    if (to !== null) reports.push({ from: id, to });
  }
  return { nodes, edges, reports, columns, goals: goalNodes, attention: attentionNodes, ceoId, byId };
}
