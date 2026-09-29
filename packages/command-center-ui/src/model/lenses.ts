/**
 * Lenses (C5 §5): selection changes attention, never truth. A lens maps the layout to emphasis weights —
 * what stays bright, what quiets, which chain is lit inward to the Founder — and to the node the surface
 * brings into view. Pure and total: every lens on every layout yields a valid emphasis.
 */
import type { CompanyUniverse, Emphasis, Layout, Lens } from './types.js';

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

function full(layout: Layout, focus: string | null = null, chain: string[] = []): Emphasis {
  return { nodes: new Map(layout.nodes.map((n) => [n.id, 1])), edges: new Map(layout.edges.map((e) => [e.id, 1])), sectors: new Map(layout.columns.map((c) => [c.departmentId, 1])), pinnedLabels: new Set(layout.nodes.map((n) => n.id)), focusNodeId: focus, chain };
}

function quietExcept(layout: Layout, keep: Set<string>, keepEdges: Set<string>, keepSectors: Set<string>, focus: string | null, chain: string[]): Emphasis {
  return {
    nodes: new Map(layout.nodes.map((n) => [n.id, keep.has(n.id) ? 1 : n.kind === 'founder' ? 0.7 : QUIET])),
    edges: new Map(layout.edges.map((e) => [e.id, keepEdges.has(e.id) ? 1 : 0.05])),
    sectors: new Map(layout.columns.map((c) => [c.departmentId, keepSectors.has(c.departmentId) ? 1 : 0.35])),
    pinnedLabels: new Set(keep),
    focusNodeId: focus,
    chain,
  };
}

export function applyLens(u: CompanyUniverse, layout: Layout, lens: Lens): Emphasis {
  switch (lens.kind) {
    case 'LIVE':
    case 'HISTORY':
      return full(layout);
    case 'ATTENTION': {
      const items = layout.nodes.filter((n) => n.kind === 'attention' && (lens.lane === null || n.sublabel === lens.lane));
      const keep = new Set<string>(['founder', ...items.map((n) => n.id)]);
      const keepEdges = new Set<string>();
      for (const n of items) {
        if (n.employeeId !== null && layout.byId.has(`employee:${n.employeeId}`)) keep.add(`employee:${n.employeeId}`);
        for (const e of layout.edges) if (e.to === 'founder' || (n.employeeId !== null && (e.from === `employee:${n.employeeId}` || e.to === `employee:${n.employeeId}`))) keepEdges.add(e.id);
      }
      const sectors = new Set(items.map((n) => n.departmentId).filter((d): d is string => d !== null));
      return quietExcept(layout, keep, keepEdges, sectors, null, []);
    }
    case 'CEO': {
      const ceo = layout.ceoId === null ? undefined : layout.byId.get(layout.ceoId);
      if (!ceo) return full(layout);
      const keep = new Set<string>(['founder', ceo.id, ...layout.nodes.filter((n) => n.seatKind === 'DIRECTOR' || n.kind === 'attention' || n.kind === 'goal').map((n) => n.id)]);
      const keepEdges = new Set(layout.edges.filter((e) => e.from === ceo.id || e.to === ceo.id).map((e) => e.id));
      return quietExcept(layout, keep, keepEdges, new Set(layout.columns.map((c) => c.departmentId)), ceo.id, [ceo.id, 'founder']);
    }
    case 'EMPLOYEE':
    case 'CONVERSATION': {
      const id = `employee:${lens.employeeId}`;
      const node = layout.byId.get(id);
      if (!node) return full(layout);
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
      return quietExcept(layout, keep, keepEdges, sectors, id, chain);
    }
    case 'GOAL': {
      const gid = `goal:${lens.goalId}`;
      const goal = layout.byId.get(gid);
      if (!goal) return full(layout);
      const people = new Set<string>(goal.workers.map((w) => w.replace('employee:', '')));
      const keep = new Set<string>([gid, 'founder']);
      // Derived goals travel with their parent, and a Department goal lights its parent company goal.
      for (const g of layout.goals) if (g.parentGoalId === gid || g.id === goal.parentGoalId) keep.add(g.id);
      for (const p of people) {
        const nid = `employee:${p}`;
        if (layout.byId.has(nid)) keep.add(nid);
        // Leadership responsible for the goal's work: the chain of each contributor up to the Director.
        for (const c of chainNodeIds(u, layout, p)) keep.add(c);
      }
      const keepEdges = new Set<string>();
      const work = u.work.filter((w) => (w.goalIds as readonly string[]).includes(lens.goalId));
      for (const e of layout.edges) if ((e.workItemId !== null && work.some((w) => String(w.id) === e.workItemId)) || (people.size > 0 && (people.has(e.from.replace('employee:', '')) || people.has(e.to.replace('employee:', ''))))) {
        keepEdges.add(e.id);
        keep.add(e.from);
        keep.add(e.to);
      }
      const sectors = new Set<string>(goal.anchors.map((i) => layout.columns[i]?.departmentId).filter((d): d is string => d !== undefined));
      return quietExcept(layout, keep, keepEdges, sectors, gid, []);
    }
    case 'DEPARTMENT': {
      const keep = new Set<string>(['founder', ...layout.nodes.filter((n) => n.departmentId === lens.departmentId || n.seatKind === 'CEO' || (n.kind === 'goal' && n.anchors.some((i) => layout.columns[i]?.departmentId === lens.departmentId))).map((n) => n.id)]);
      const keepEdges = new Set(layout.edges.filter((e) => keep.has(e.from) && keep.has(e.to)).map((e) => e.id));
      const column = layout.columns.find((c) => c.departmentId === lens.departmentId);
      return quietExcept(layout, keep, keepEdges, new Set([lens.departmentId]), column?.directorId ?? null, []);
    }
    case 'BLOCKED': {
      const blocked = u.work.filter((w) => w.state === 'BLOCKED');
      const people = new Set<string>(blocked.map((w) => w.ownerEmployeeId).filter((x) => x !== null).map(String));
      const keep = new Set<string>(['founder', ...[...people].map((p) => `employee:${p}`).filter((id) => layout.byId.has(id))]);
      const keepEdges = new Set(layout.edges.filter((e) => e.workItemId !== null && blocked.some((w) => String(w.id) === e.workItemId)).map((e) => e.id));
      const sectors = new Set([...people].map((p) => layout.byId.get(`employee:${p}`)?.departmentId).filter((d): d is string => typeof d === 'string'));
      return quietExcept(layout, keep, keepEdges, sectors, null, []);
    }
  }
}

/**
 * The Founder reads one attention item: the company shows where it lives — the person it concerns, their
 * leadership chain, their Department and the goal it is about — without changing the lens (a spotlight over
 * the attention emphasis, gone when the eye moves on). Pure and total, like the lenses.
 */
export function attentionSpotlight(u: CompanyUniverse, layout: Layout, itemNodeId: string): Emphasis {
  const item = layout.byId.get(itemNodeId);
  if (!item || item.kind !== 'attention') return full(layout);
  const keep = new Set<string>(['founder', item.id]);
  const chain = item.employeeId === null ? [] : chainNodeIds(u, layout, item.employeeId);
  for (const c of chain) keep.add(c);
  const source = u.attention.find((a) => `attention:${a.id}` === item.id)?.sourceRef ?? '';
  if (source.startsWith('goal:') && layout.byId.has(source)) keep.add(source);
  const keepEdges = new Set<string>();
  for (const e of layout.edges) if (item.employeeId !== null && (e.from === `employee:${item.employeeId}` || e.to === `employee:${item.employeeId}`)) keepEdges.add(e.id);
  const sectors = new Set<string>(item.departmentId === null ? [] : [item.departmentId]);
  if (source.startsWith('goal:')) for (const i of layout.byId.get(source)?.anchors ?? []) {
    const d = layout.columns[i]?.departmentId;
    if (d) sectors.add(d);
  }
  return quietExcept(layout, keep, keepEdges, sectors, item.employeeId === null ? null : `employee:${item.employeeId}`, chain);
}

/** Live relations are drawn only where they answer the lens question (focus surfaces); Company Live keeps the structure clean. */
export function showsRelations(lens: Lens): boolean {
  return lens.kind === 'EMPLOYEE' || lens.kind === 'CONVERSATION' || lens.kind === 'CEO' || lens.kind === 'ATTENTION' || lens.kind === 'BLOCKED' || lens.kind === 'GOAL';
}
