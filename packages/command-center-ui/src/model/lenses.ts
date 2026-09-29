/**
 * Lenses (C5 §5): selection changes attention, never truth. A lens maps the layout to emphasis weights —
 * what stays bright, what quiets, which labels are pinned, which chain is drawn inward to the Founder — and
 * to the camera target. Pure and total: every lens on every layout yields a valid emphasis.
 */
import type { CompanyUniverse, Emphasis, Layout, LayoutNode, Lens } from './types.js';

const QUIET = 0.18;

/** The seat chain inward from an employee node (seat ids resolved to node ids), Founder last. */
export function chainNodeIds(u: CompanyUniverse, layout: Layout, employeeId: string): string[] {
  const e = u.employees.find((x) => x.id === employeeId);
  if (!e) return ['founder'];
  const out: string[] = [];
  for (const link of e.chain) {
    if (link.kind === 'FOUNDER') {
      out.push('founder');
      continue;
    }
    if (link.employeeId !== null && layout.byId.has(`employee:${link.employeeId}`)) out.push(`employee:${link.employeeId}`);
    else if (link.positionId !== null && layout.byId.has(`seat:${link.positionId}`)) out.push(`seat:${link.positionId}`);
  }
  if (out[0] !== `employee:${employeeId}` && layout.byId.has(`employee:${employeeId}`)) out.unshift(`employee:${employeeId}`);
  return [...new Set(out)];
}

function full(layout: Layout, pinned: Iterable<string> = [], focus: string | null = null, chain: string[] = []): Emphasis {
  return { nodes: new Map(layout.nodes.map((n) => [n.id, 1])), edges: new Map(layout.edges.map((e) => [e.id, 1])), sectors: new Map(layout.sectors.map((s) => [s.departmentId, 1])), pinnedLabels: new Set(pinned), focusNodeId: focus, chain };
}

function quietExcept(layout: Layout, keep: Set<string>, keepEdges: Set<string>, keepSectors: Set<string>, pinned: Iterable<string>, focus: string | null, chain: string[]): Emphasis {
  return {
    nodes: new Map(layout.nodes.map((n) => [n.id, keep.has(n.id) ? 1 : n.kind === 'founder' ? 0.7 : QUIET])),
    edges: new Map(layout.edges.map((e) => [e.id, keepEdges.has(e.id) ? 1 : 0.05])),
    sectors: new Map(layout.sectors.map((s) => [s.departmentId, keepSectors.has(s.departmentId) ? 1 : 0.35])),
    pinnedLabels: new Set(pinned),
    focusNodeId: focus,
    chain,
  };
}

// Company Live pins leadership and goals. Attention markers keep their shape and glow next to the Founder; their
// words live in the attention rail and appear on the map in the Attention lens, when near, or when selected —
// so the centre never becomes a stack of captions over the CEO orbit.
const importantLabels = (layout: Layout): string[] => layout.nodes.filter((n) => n.kind === 'founder' || n.seatKind === 'CEO' || n.seatKind === 'DIRECTOR' || n.kind === 'goal').map((n) => n.id);

export function applyLens(u: CompanyUniverse, layout: Layout, lens: Lens): Emphasis {
  switch (lens.kind) {
    case 'LIVE':
    case 'HISTORY':
      return full(layout, importantLabels(layout));
    case 'ATTENTION': {
      const items = layout.nodes.filter((n) => n.kind === 'attention' && (lens.lane === null || n.sublabel === lens.lane));
      const keep = new Set<string>(['founder', ...items.map((n) => n.id)]);
      const keepEdges = new Set<string>();
      for (const n of items) {
        if (n.employeeId !== null && layout.byId.has(`employee:${n.employeeId}`)) keep.add(`employee:${n.employeeId}`);
        for (const e of layout.edges) if (e.to === 'founder' || (n.employeeId !== null && (e.from === `employee:${n.employeeId}` || e.to === `employee:${n.employeeId}`))) keepEdges.add(e.id);
      }
      const sectors = new Set(items.map((n) => n.departmentId).filter((d): d is string => d !== null));
      return quietExcept(layout, keep, keepEdges, sectors, keep, null, []);
    }
    case 'CEO': {
      const ceo = layout.nodes.find((n) => n.seatKind === 'CEO');
      if (!ceo) return full(layout, importantLabels(layout));
      const keep = new Set<string>(['founder', ceo.id, ...layout.nodes.filter((n) => n.seatKind === 'DIRECTOR' || n.kind === 'attention' || n.kind === 'goal').map((n) => n.id)]);
      const keepEdges = new Set(layout.edges.filter((e) => e.from === ceo.id || e.to === ceo.id).map((e) => e.id));
      return quietExcept(layout, keep, keepEdges, new Set(layout.sectors.map((s) => s.departmentId)), keep, ceo.id, [ceo.id, 'founder']);
    }
    case 'EMPLOYEE':
    case 'CONVERSATION': {
      const id = `employee:${lens.employeeId}`;
      const node = layout.byId.get(id);
      if (!node) return full(layout, importantLabels(layout));
      const chain = chainNodeIds(u, layout, lens.employeeId);
      const keep = new Set<string>(chain);
      const keepEdges = new Set<string>();
      for (const e of layout.edges) {
        if (e.from === id || e.to === id) {
          keepEdges.add(e.id);
          keep.add(e.from);
          keep.add(e.to);
        }
      }
      // The goals this employee's live work serves stay lit.
      for (const w of u.work) if (String(w.ownerEmployeeId) === lens.employeeId) for (const g of w.goalIds) keep.add(`goal:${g}`);
      const sectors = new Set(node.departmentId === null ? [] : [node.departmentId]);
      return quietExcept(layout, keep, keepEdges, sectors, keep, id, chain);
    }
    case 'GOAL': {
      const gid = `goal:${lens.goalId}`;
      const goal = u.goals.find((g) => g.id === lens.goalId);
      if (!goal || !layout.byId.has(gid)) return full(layout, importantLabels(layout));
      const work = u.work.filter((w) => (w.goalIds as readonly string[]).includes(lens.goalId));
      const people = new Set<string>(work.map((w) => w.ownerEmployeeId).filter((x) => x !== null).map(String));
      const keep = new Set<string>([gid, 'founder']);
      for (const p of people) {
        const nid = `employee:${p}`;
        if (layout.byId.has(nid)) keep.add(nid);
        // Leadership responsible for the goal's work: the chain of each contributor up to the Director.
        for (const c of chainNodeIds(u, layout, p)) keep.add(c);
      }
      const keepEdges = new Set<string>();
      for (const e of layout.edges) if ((e.workItemId !== null && work.some((w) => String(w.id) === e.workItemId)) || (people.size > 0 && (people.has(e.from.replace('employee:', '')) || people.has(e.to.replace('employee:', ''))))) {
        keepEdges.add(e.id);
        keep.add(e.from);
        keep.add(e.to);
      }
      const sectors = new Set<string>(goal.anchorDepartmentIds.map(String));
      return quietExcept(layout, keep, keepEdges, sectors, keep, gid, []);
    }
    case 'DEPARTMENT': {
      const keep = new Set<string>(['founder', ...layout.nodes.filter((n) => n.departmentId === lens.departmentId || n.seatKind === 'CEO' || (n.kind === 'goal' && (u.goals.find((g) => String(g.id) === n.id.slice(5))?.anchorDepartmentIds as readonly string[] | undefined)?.includes(lens.departmentId))).map((n) => n.id)]);
      const keepEdges = new Set(layout.edges.filter((e) => keep.has(e.from) && keep.has(e.to)).map((e) => e.id));
      const director = layout.nodes.find((n) => n.seatKind === 'DIRECTOR' && n.departmentId === lens.departmentId);
      return quietExcept(layout, keep, keepEdges, new Set([lens.departmentId]), keep, director?.id ?? null, []);
    }
    case 'BLOCKED': {
      const blocked = u.work.filter((w) => w.state === 'BLOCKED');
      const people = new Set<string>(blocked.map((w) => w.ownerEmployeeId).filter((x) => x !== null).map(String));
      const keep = new Set<string>(['founder', ...[...people].map((p) => `employee:${p}`).filter((id) => layout.byId.has(id))]);
      const keepEdges = new Set(layout.edges.filter((e) => e.workItemId !== null && blocked.some((w) => String(w.id) === e.workItemId)).map((e) => e.id));
      const sectors = new Set([...people].map((p) => layout.byId.get(`employee:${p}`)?.departmentId).filter((d): d is string => typeof d === 'string'));
      return quietExcept(layout, keep, keepEdges, sectors, keep, null, []);
    }
  }
}

/** Where the camera looks for a lens: the focus node or the centre. */
export function cameraTargetFor(layout: Layout, emphasis: Emphasis): { x: number; y: number; z: number; distance: number } {
  const focus = emphasis.focusNodeId === null ? null : layout.byId.get(emphasis.focusNodeId);
  // The Attention lens pins the items inside the CEO orbit: come closer so their captions spread out around the centre.
  if (!focus) return { x: 0, y: 0, z: 0, distance: [...emphasis.pinnedLabels].some((id) => id.startsWith('attention:')) ? 17 : 34 };
  // Look at the midpoint between the focus and the centre so the chain inward stays in frame.
  const k = focus.kind === 'goal' ? 0.55 : 0.6;
  return { x: focus.x * k, y: focus.y * 0.5, z: focus.z * k, distance: 14 + focus.radius * 0.9 };
}

/** Label tier by camera distance: far shows leadership, goals and urgent attention; near shows everything. */
export function labelTier(distance: number): 'FAR' | 'MID' | 'NEAR' {
  return distance > 30 ? 'FAR' : distance > 18 ? 'MID' : 'NEAR';
}

export function labelVisible(n: LayoutNode, tier: 'FAR' | 'MID' | 'NEAR', emphasis: Emphasis): boolean {
  if (emphasis.pinnedLabels.has(n.id)) return true;
  if ((emphasis.nodes.get(n.id) ?? 1) < 0.5) return false;
  if (tier === 'NEAR') return true;
  if (n.kind === 'attention') return false;
  if (tier === 'MID') return n.importance >= 0.6 || n.kind === 'goal';
  return n.kind === 'founder' || n.seatKind === 'CEO' || n.seatKind === 'DIRECTOR' || n.kind === 'goal';
}
