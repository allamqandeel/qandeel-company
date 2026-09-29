/**
 * Attention Orbits layout (pure, deterministic): Founder at the centre, rank = radius, Department = sector,
 * seats own their angle (a stable hash of the seat code, so a vacancy keeps its place and a transfer moves
 * the person, not the map), goals are beacons outside the last ring at the mean angle of their Departments,
 * attention items settle in the zone between the centre and the CEO orbit. The same layout drives the
 * WebGL scene, the SVG fallback and every test.
 */
import { SEAT_TITLE_AR } from './format.js';
import type { CompanyUniverse, Layout, LayoutEdge, LayoutNode, LayoutSector } from './types.js';

/** Rank → radius (units of the scene). Closer to the Founder = higher organizational level. */
export const RING_RADIUS: Readonly<Record<string, number>> = { FOUNDER: 0, CEO: 2.6, DIRECTOR: 5.4, MANAGER: 8.2, LEAD: 8.2, SPECIALIST: 11, GOAL: 14.2, ATTENTION: 1.35 };
/** Rank → vertical offset: depth reads as altitude, not only radius (never rank by colour alone). */
export const RING_HEIGHT: Readonly<Record<string, number>> = { FOUNDER: 0.9, CEO: 0.6, DIRECTOR: 0.35, MANAGER: 0.15, LEAD: 0.15, SPECIALIST: 0, GOAL: 1.4, ATTENTION: 0.75 };
const RING_INDEX: Readonly<Record<string, number>> = { FOUNDER: 0, CEO: 1, DIRECTOR: 2, MANAGER: 3, LEAD: 3, SPECIALIST: 4, GOAL: 5, ATTENTION: 0 };
/** The company sector (the CEO seat, company-scoped seats): a narrow gap at the top so the CEO ring stays readable. */
const COMPANY_SECTOR_WIDTH = 0.36;
const TAU = Math.PI * 2;

/** FNV-1a: a stable 32-bit hash for deterministic placement (never Math.random). */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function sectorsOf(u: CompanyUniverse): LayoutSector[] {
  const n = Math.max(1, u.departments.length);
  const span = (TAU - COMPANY_SECTOR_WIDTH) / n;
  // Sectors start just past the company gap (which sits around the top, angle −π/2) and run clockwise.
  const origin = -Math.PI / 2 + COMPANY_SECTOR_WIDTH / 2;
  return u.departments.map((d, i) => {
    const start = origin + i * span;
    return { departmentId: d.id, code: d.code, name: d.name, index: i, start, end: start + span, mid: start + span / 2 };
  });
}

/** Minimum arc length between two seats on one ring (scene units) before a group overflows to a sub-ring. */
const MIN_SEAT_SPACING = 1.15;
/** Radial step between the sub-rings of one rank when a Department holds more seats than one ring can carry. */
const SUB_RING_STEP = 0.85;

/**
 * Placement of a seat inside its sector: Directors sit mid-sector; other kinds spread evenly by ordinal (sorted
 * by code) and are nudged by a stable hash. When a Department has more seats of one rank than its arc can hold
 * at `MIN_SEAT_SPACING`, the group overflows onto concentric sub-rings (ordinal modulo the ring count), so a
 * growing company stays readable instead of collapsing into one crowded arc.
 */
function placeInSector(sector: LayoutSector, seatCode: string, kind: string, ordinal: number, count: number, radius: number): { angle: number; radius: number } {
  const width = sector.end - sector.start;
  if (kind === 'DIRECTOR') return { angle: sector.mid, radius };
  const pad = width * 0.12;
  const usable = width - 2 * pad;
  const capacity = Math.max(1, Math.floor((usable * radius) / MIN_SEAT_SPACING));
  const rings = Math.max(1, Math.ceil(count / capacity));
  const sub = ordinal % rings;
  const idx = Math.floor(ordinal / rings);
  const onRing = Math.ceil((count - sub) / rings);
  const base = onRing <= 1 ? sector.mid : sector.start + pad + (usable * idx) / (onRing - 1);
  const jitter = ((stableHash(seatCode) % 1000) / 1000 - 0.5) * (usable / Math.max(onRing, 3)) * 0.35;
  return { angle: base + jitter, radius: radius + sub * SUB_RING_STEP };
}

const polar = (radius: number, angle: number): { x: number; z: number } => ({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });

export function layoutUniverse(u: CompanyUniverse): Layout {
  const sectors = sectorsOf(u);
  const sectorByDept = new Map(sectors.map((s) => [s.departmentId, s]));
  const nodes: LayoutNode[] = [];
  const employees = new Map<string, CompanyUniverse['employees'][number]>(u.employees.map((e) => [String(e.id), e]));
  const fullName = (id: string | null): string => {
    const e = id === null ? undefined : employees.get(id);
    return e ? `${e.name.given} ${e.name.family}` : '';
  };

  nodes.push({ id: 'founder', kind: 'founder', x: 0, y: RING_HEIGHT.FOUNDER ?? 0, z: 0, radius: 0, angle: 0, ring: 0, sector: null, departmentId: null, label: 'المؤسس', sublabel: 'مركز الشركة', state: 'PRINCIPAL', acting: false, vacant: false, seatKind: null, employeeId: null, importance: 1 });

  // Seats: one node per live seat (occupied or vacant). Employees without a seat (legacy) get a placement too.
  const seats = u.seats.filter((s) => s.status !== 'RETIRED');
  const seatsByGroup = new Map<string, typeof seats>();
  for (const s of seats) {
    const key = `${s.departmentId ?? 'company'}:${s.kind === 'LEAD' ? 'MANAGER' : s.kind}`;
    seatsByGroup.set(key, [...(seatsByGroup.get(key) ?? []), s]);
  }
  for (const group of seatsByGroup.values()) group.sort((a, b) => (a.code < b.code ? -1 : 1));
  const placedEmployees = new Set<string>();
  for (const s of seats) {
    const group = seatsByGroup.get(`${s.departmentId ?? 'company'}:${s.kind === 'LEAD' ? 'MANAGER' : s.kind}`) ?? [];
    const ordinal = group.findIndex((g) => g.id === s.id);
    const sector = s.departmentId === null ? null : sectorByDept.get(s.departmentId) ?? null;
    let angle: number;
    let radius = RING_RADIUS[s.kind] ?? 11;
    if (sector === null) {
      // Company-scoped seats sit in the company gap at the top; several spread inside it.
      const companySeats = seats.filter((x) => x.departmentId === null).sort((a, b) => (a.code < b.code ? -1 : 1));
      const i = companySeats.findIndex((x) => x.id === s.id);
      angle = -Math.PI / 2 + (companySeats.length <= 1 ? 0 : ((i / (companySeats.length - 1)) - 0.5) * COMPANY_SECTOR_WIDTH * 0.8);
    } else {
      ({ angle, radius } = placeInSector(sector, s.code, s.kind, ordinal, group.length, radius));
    }
    const { x, z } = polar(radius, angle);
    const holder = s.holderEmployeeId;
    const vacant = holder === null;
    const acting = s.holderKind === 'ACTING';
    const employee = holder === null ? undefined : employees.get(holder);
    const title = SEAT_TITLE_AR[s.code] ?? s.title;
    if (holder !== null) placedEmployees.add(holder);
    if (s.coveredEmployeeId !== null) placedEmployees.add(s.coveredEmployeeId);
    nodes.push({
      id: vacant ? `seat:${s.id}` : `employee:${holder}`,
      kind: vacant ? 'seat' : 'employee',
      x,
      y: RING_HEIGHT[s.kind] ?? 0,
      z,
      radius,
      angle,
      ring: RING_INDEX[s.kind] ?? 4,
      sector: sector?.index ?? null,
      departmentId: s.departmentId,
      label: vacant ? title : fullName(holder),
      sublabel: vacant ? 'مقعد شاغر' : `${title}${acting ? ' · بالإنابة' : ''}`,
      state: vacant ? 'VACANT' : (employee?.state ?? 'UNKNOWN'),
      acting,
      vacant,
      seatKind: s.kind,
      employeeId: holder,
      importance: s.kind === 'CEO' ? 0.95 : s.kind === 'DIRECTOR' ? 0.8 : s.kind === 'SPECIALIST' ? 0.45 : 0.6,
    });
  }
  // Employees who hold no seat (not yet placed, or covered): placed on the outer ring of their Department.
  const unplaced = u.employees.filter((e) => !placedEmployees.has(e.id) && e.state !== 'RETIRED').sort((a, b) => (a.id < b.id ? -1 : 1));
  unplaced.forEach((e, i) => {
    const sector = e.departmentId === null ? null : sectorByDept.get(e.departmentId) ?? null;
    const angle = sector === null ? -Math.PI / 2 + 0.25 + i * 0.12 : sector.start + (sector.end - sector.start) * (0.15 + 0.7 * ((stableHash(e.id) % 1000) / 1000));
    const radius = RING_RADIUS.SPECIALIST ?? 11;
    const { x, z } = polar(radius, angle);
    nodes.push({ id: `employee:${e.id}`, kind: 'employee', x, y: 0, z, radius, angle, ring: 4, sector: sector?.index ?? null, departmentId: e.departmentId, label: `${e.name.given} ${e.name.family}`, sublabel: e.roleRef.replace(/^role:/, ''), state: e.state, acting: false, vacant: false, seatKind: null, employeeId: e.id, importance: 0.4 });
  });

  // Goals: beacons outside the last ring, at the mean angle of their anchor Departments (company goals with
  // no anchored work sit in the company gap, above the CEO).
  const goals = [...u.goals].sort((a, b) => (a.id < b.id ? -1 : 1));
  const anchorAngles = (g: CompanyUniverse['goals'][number]): number[] => g.anchorDepartmentIds.map((d) => sectorByDept.get(d)?.mid).filter((a): a is number => a !== undefined);
  // Goals with no anchored work yet share the top; they are spread by their ordinal among themselves so two
  // company goals never stand on one spot (Historical Focus before any work was linked shows exactly that).
  const unanchored = goals.filter((g) => anchorAngles(g).length === 0);
  goals.forEach((g) => {
    const angles = anchorAngles(g);
    let angle: number;
    if (angles.length === 0) {
      const i = unanchored.indexOf(g);
      angle = -Math.PI / 2 + (i - (unanchored.length - 1) / 2) * 0.42;
    } else {
      const sx = angles.reduce((s, a) => s + Math.cos(a), 0);
      const sz = angles.reduce((s, a) => s + Math.sin(a), 0);
      angle = Math.atan2(sz, sx) + (((stableHash(g.id) % 1000) / 1000 - 0.5) * 0.18);
    }
    const radius = RING_RADIUS.GOAL ?? 14.2;
    const { x, z } = polar(radius, angle);
    nodes.push({ id: `goal:${g.id}`, kind: 'goal', x, y: RING_HEIGHT.GOAL ?? 1.4, z, radius, angle, ring: 5, sector: null, departmentId: g.departmentId, label: g.title, sublabel: g.kind === 'COMPANY' ? 'هدف الشركة' : 'هدف القسم', state: g.state, acting: false, vacant: false, seatKind: null, employeeId: null, importance: g.kind === 'COMPANY' ? 0.9 : 0.7 });
  });

  // Attention items: inside the CEO orbit, spread around the Founder by lane (needs-me nearest the top).
  const attention = [...u.attention].sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? -1 : a.firstSeenAt > b.firstSeenAt ? 1 : a.id < b.id ? -1 : 1));
  attention.forEach((a, i) => {
    const laneOffset = a.lane === 'NEEDS_ME' ? -Math.PI / 2 : a.lane === 'CEO_BRIEFS' ? Math.PI / 6 : (5 * Math.PI) / 6;
    const angle = laneOffset + (i % 5) * 0.28 - 0.56;
    const radius = (RING_RADIUS.ATTENTION ?? 1.35) + Math.floor(i / 5) * 0.35;
    const { x, z } = polar(radius, angle);
    const owner = a.ownerRef?.startsWith('employee:') ? a.ownerRef.slice('employee:'.length) : null;
    nodes.push({ id: `attention:${a.id}`, kind: 'attention', x, y: RING_HEIGHT.ATTENTION ?? 0.75, z, radius, angle, ring: 0, sector: null, departmentId: owner ? (employees.get(owner)?.departmentId ?? null) : null, label: a.sourceKind, sublabel: a.lane, state: a.level, acting: false, vacant: false, seatKind: null, employeeId: owner, importance: a.level === 'URGENT' || a.level === 'NEEDS_DECISION' ? 1 : 0.7 });
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Edges: only live typed relations whose ends are on the map.
  const endpoint = (ref: string): string | null => (ref === 'founder' ? 'founder' : byId.has(ref) ? ref : null);
  const edges: LayoutEdge[] = [];
  for (const r of u.relations) {
    const from = endpoint(r.from);
    const to = endpoint(r.to);
    if (from === null || to === null || from === to) continue;
    edges.push({ id: r.id, kind: r.kind, from, to, state: r.state, workItemId: r.workItemId, sourceRef: r.sourceRef });
  }
  const rings = [
    { index: 1, radius: RING_RADIUS.CEO ?? 2.6, kind: 'CEO' },
    { index: 2, radius: RING_RADIUS.DIRECTOR ?? 5.4, kind: 'DIRECTOR' },
    { index: 3, radius: RING_RADIUS.MANAGER ?? 8.2, kind: 'MANAGER' },
    { index: 4, radius: RING_RADIUS.SPECIALIST ?? 11, kind: 'SPECIALIST' },
  ];
  return { nodes, edges, sectors, rings, outerRadius: RING_RADIUS.GOAL ?? 14.2, byId };
}

/** The department a node belongs to, for sector emphasis. */
export const nodeSector = (n: LayoutNode): number | null => n.sector;
