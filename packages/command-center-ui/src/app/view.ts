/**
 * The Tree of Light surface (D-C5-14): the company as a structured, living executive operating surface.
 * Founder at the top, the CEO beneath on one leadership trunk, five Department columns branching below with
 * the Director first and the team inside, goals along the bottom as the strategic direction, and gold
 * execution lines showing where each column's work flows. Everything is DOM + one SVG line layer: the words
 * are browser-shaped text (bidi and Arabic shaping are the browser's), every person and goal is a real
 * button, and the same view serves every renderer capability (there is no WebGL to fall back from).
 *
 * Two kinds of motion, kept apart (C5 §7.2): SEMANTIC — the focus scroll, a lit path when a goal or person is
 * selected, an edge pulse when a relation appears, an attention chip arriving, and the slow flow along an
 * execution line whose work is running now (a real state) — and AMBIENT — a very slow drift of the surface
 * light. Reduced motion keeps every mark and removes every tween.
 */
import { fmtDate, LEVEL_LABEL, SOURCE_LABEL, STATE_LABEL, deptName, dirOf, plural, t } from '../model/format.js';
import type { CompanyUniverse, Emphasis, Layout, LayoutNode } from '../model/types.js';

/**
 * Department accents in canonical column order, validated with the dataviz palette checker on the light
 * executive surface (#f4f2ec): L 0.43–0.77, ≥ 3:1 against the surface, adjacent pairs around the set ΔE ≥ 7.8
 * under CVD with the column's name as the secondary encoding. Assigned by entity, fixed order, never cycled.
 */
export const DEPARTMENT_COLORS = ['#2a78d6', '#178a63', '#b57a12', '#7a6fd6', '#c8501f'] as const;
export const departmentColor = (column: number | null): string => (column === null ? '#6f6b86' : (DEPARTMENT_COLORS[column % DEPARTMENT_COLORS.length] ?? '#6f6b86'));
const RELATION_COLORS: Readonly<Record<string, string>> = { DELEGATION: '#2f9bd6', SUPPORT: '#2a9d8f', REVIEW: '#8a6fd6', APPROVAL: '#c48a1f', HANDOFF: '#d0862b', ESCALATION: '#d64545' };
const GOLD = '#c48a1f';

export interface ViewEvents {
  onSelect(nodeId: string, node: LayoutNode): void;
  onSelectDepartment(departmentId: string): void;
  onAttention(nodeId: string): void;
  onOpenAttention(): void;
}

interface Line {
  readonly el: SVGPathElement;
  readonly kind: 'trunk' | 'branch' | 'lane' | 'exec' | 'derive' | 'relation';
  readonly a: string;
  readonly b: string;
  readonly goal?: string;
  readonly column?: number;
  readonly edge?: string;
  readonly count?: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (cls: string, text?: string): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  if (text !== undefined) b.textContent = text;
  return b;
};
const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase();

export class TreeView {
  #container!: HTMLElement;
  #events!: ViewEvents;
  #company!: HTMLElement;
  #goalsHost!: HTMLElement;
  #svg!: SVGSVGElement;
  #els = new Map<string, HTMLElement>();
  #columnEls = new Map<string, HTMLElement>();
  #lines: Line[] = [];
  #layout: Layout | null = null;
  #signature = '';
  #emphasis: Emphasis | null = null;
  #reduced = false;
  #relations = false;
  #selected: string | null = null;
  #raf = 0;
  #observer: ResizeObserver | null = null;

  mount(container: HTMLElement, events: ViewEvents): void {
    this.#container = container;
    this.#events = events;
    this.#company = el('div', 'company');
    // The goal band is a sibling of the company grid so it can stay pinned to the bottom of the scroll area.
    this.#goalsHost = el('div', 'goals-host');
    this.#svg = document.createElementNS(SVG_NS, 'svg');
    this.#svg.setAttribute('class', 'lines');
    this.#svg.setAttribute('aria-hidden', 'true');
    container.append(this.#company, this.#goalsHost);
    this.#observer = new ResizeObserver(() => this.#scheduleLines());
    this.#observer.observe(container);
    window.addEventListener('resize', () => this.#scheduleLines());
    // The goal band stays in view while the columns scroll under it: the lines follow.
    container.addEventListener('scroll', () => this.#scheduleLines(), { passive: true });
  }

  setLayout(layout: Layout, universe: CompanyUniverse): void {
    this.#layout = layout;
    // A live company refreshes often; the surface is rebuilt only when what it shows has changed (stable
    // spatial memory: an unchanged card is never recreated, so no state, hover or transition is lost).
    const signature = JSON.stringify([
      layout.nodes.map((n) => [n.id, n.column, n.row, n.state, n.acting, n.vacant, n.running, n.label, n.sublabel, n.anchors, n.workers, n.progress, n.parentGoalId]),
      layout.columns.map((c) => [c.departmentId, c.name, c.headcount]),
      universe.goals.map((g) => [g.id, g.horizonTo, g.ownerRef]),
    ]);
    if (signature === this.#signature) {
      this.#scheduleLines();
      return;
    }
    this.#signature = signature;
    // Observable for the proofs: how many times the surface was really rebuilt.
    this.#company.dataset.builds = String(Number(this.#company.dataset.builds ?? '0') + 1);
    const scrollTop = this.#container.scrollTop;
    this.#els.clear();
    this.#columnEls.clear();
    this.#company.replaceChildren();
    this.#company.append(this.#buildSpine(layout, universe), this.#buildColumns(layout), this.#svg);
    this.#goalsHost.replaceChildren(this.#buildGoals(layout, universe));
    this.#container.scrollTop = scrollTop;
    if (this.#emphasis) this.setEmphasis(this.#emphasis);
    this.setSelection(this.#selected);
    this.#scheduleLines();
  }

  #buildSpine(layout: Layout, universe: CompanyUniverse): HTMLElement {
    const spine = el('section', 'spine');
    const founder = button('founder');
    founder.dataset.id = 'founder';
    founder.setAttribute('aria-label', 'Founder, company centre. Return to Company Live');
    founder.append(el('span', 'emblem', 'Q'), el('span', 'founder-text'));
    founder.querySelector('.founder-text')?.append(el('span', 'founder-name', 'Founder'), el('span', 'founder-sub', 'Company centre'));
    founder.addEventListener('click', () => this.#events.onSelect('founder', layout.byId.get('founder') as LayoutNode));
    this.#els.set('founder', founder);
    const ceoNode = layout.ceoId === null ? null : layout.byId.get(layout.ceoId) ?? null;
    const ceo = ceoNode ? this.#card(ceoNode, layout) : el('div', 'card card-empty', 'No CEO seat');
    if (ceoNode) ceo.classList.add('card-ceo');
    const trunk = el('div', 'trunk');
    trunk.setAttribute('aria-hidden', 'true');
    spine.append(founder, this.#buildAttention(layout, universe), trunk, ceo);
    return spine;
  }

  #buildAttention(layout: Layout, universe: CompanyUniverse): HTMLElement {
    const dock = el('aside', 'dock-attention');
    dock.setAttribute('aria-label', 'Needs you');
    const items = layout.attention;
    const head = button('dock-head');
    head.append(el('span', 'dock-title', items.length === 0 ? 'Nothing needs you' : 'Needs you'), el('span', 'dock-count', String(items.length)));
    head.addEventListener('click', () => this.#events.onOpenAttention());
    dock.append(head);
    if (items.length === 0) dock.append(el('p', 'dock-empty', 'The company is working. Decisions and briefs appear here.'));
    const list = el('ul', 'attention-list');
    for (const n of items.slice(0, 4)) {
      const li = el('li', '');
      const chip = button(`chip chip-attention level-${n.state.toLowerCase()}`);
      chip.dataset.id = n.id;
      const owner = n.employeeId ? (layout.byId.get(`employee:${n.employeeId}`)?.label ?? '') : '';
      const item = universe.attention.find((a) => `attention:${a.id}` === n.id);
      chip.append(el('span', 'chip-mark'), el('span', 'chip-text', `${t(SOURCE_LABEL, n.label)}${owner ? ' · ' + owner : ''}`), el('span', 'chip-level', t(LEVEL_LABEL, n.state)));
      chip.setAttribute('aria-label', `${t(SOURCE_LABEL, n.label)}${owner ? ' from ' + owner : ''}, ${t(LEVEL_LABEL, n.state)}${item ? '' : ''}. Open`);
      chip.addEventListener('click', () => this.#events.onAttention(n.id));
      this.#els.set(n.id, chip);
      li.append(chip);
      list.append(li);
    }
    if (items.length > 4) {
      const more = button('link dock-more', `${items.length - 4} more`);
      more.addEventListener('click', () => this.#events.onOpenAttention());
      const li = el('li', '');
      li.append(more);
      list.append(li);
    }
    dock.append(list);
    return dock;
  }

  #buildColumns(layout: Layout): HTMLElement {
    const columns = el('section', 'columns');
    columns.setAttribute('aria-label', 'Departments');
    for (const c of layout.columns) {
      const col = el('section', 'column');
      col.dataset.department = c.departmentId;
      col.style.setProperty('--dept', departmentColor(c.index));
      const header = button('column-head');
      header.append(el('span', 'column-name', deptName(c.code, c.name)), el('span', 'column-count', plural(c.headcount, 'person', 'people')));
      header.setAttribute('aria-label', `${deptName(c.code, c.name)}, ${plural(c.headcount, 'person', 'people')}. Open the department`);
      header.addEventListener('click', () => this.#events.onSelectDepartment(c.departmentId));
      col.append(header);
      const director = el('div', 'director');
      const d = c.directorId === null ? null : layout.byId.get(c.directorId) ?? null;
      director.append(d ? this.#card(d, layout) : el('div', 'card card-empty', 'No Director seat'));
      col.append(director);
      const members = el('div', 'members');
      for (const id of c.memberIds) {
        const n = layout.byId.get(id);
        if (n) members.append(this.#card(n, layout));
      }
      if (c.memberIds.length === 0) members.append(el('p', 'members-empty', 'No team yet'));
      col.append(members);
      this.#columnEls.set(c.departmentId, col);
      columns.append(col);
    }
    return columns;
  }

  #card(n: LayoutNode, layout: Layout): HTMLElement {
    const card = button('card');
    card.dataset.id = n.id;
    card.dataset.kind = n.kind;
    if (n.seatKind) card.dataset.rank = n.seatKind;
    card.dataset.state = n.state.toLowerCase();
    if (n.running) card.dataset.running = 'true';
    if (n.acting) card.dataset.acting = 'true';
    card.style.setProperty('--dept', departmentColor(n.column));
    const avatar = el('span', 'avatar');
    avatar.setAttribute('aria-hidden', 'true');
    if (!n.vacant) avatar.textContent = initials(n.label);
    const text = el('span', 'card-text');
    const name = el('span', 'card-name', n.label);
    name.dir = dirOf(n.label);
    // The column already names the department: a Director's card says "Director", the CEO's its full title.
    const roleText = n.seatKind === 'DIRECTOR' ? 'Director' : n.seatKind === 'CEO' ? 'Chief Executive Officer' : n.vacant ? n.sublabel.replace('Vacant · ', '') : n.sublabel.replace(' · Acting cover', '');
    const role = el('span', 'card-role', roleText);
    text.append(name, role);
    const meta = el('span', 'card-meta');
    const stateText = n.vacant ? 'Vacant' : n.acting ? 'Acting cover' : n.state === 'BLOCKED' ? 'Blocked' : n.running ? 'Running' : n.state.startsWith('WAITING') ? 'Awaiting' : '';
    if (stateText) meta.append(el('span', `tag tag-${n.vacant ? 'vacant' : n.acting ? 'acting' : n.state === 'BLOCKED' ? 'blocked' : n.running ? 'running' : 'waiting'}`, stateText));
    const serves = layout.goals.filter((g) => g.workers.includes(n.id));
    if (serves.length) {
      const mark = el('span', 'serves', '◆');
      mark.setAttribute('aria-hidden', 'true');
      meta.append(mark);
    }
    const dot = el('span', 'dot');
    dot.setAttribute('aria-hidden', 'true');
    meta.append(dot);
    card.append(avatar, text, meta);
    const kind = n.seatKind === 'CEO' ? 'Chief Executive' : n.seatKind === 'DIRECTOR' ? 'Director' : n.seatKind === 'MANAGER' ? 'Manager' : n.seatKind === 'LEAD' ? 'Lead' : n.seatKind === 'SPECIALIST' ? 'Specialist' : '';
    card.setAttribute('aria-label', `${n.label}, ${n.sublabel}${kind ? ', ' + kind : ''}. Status: ${t(STATE_LABEL, n.state)}${serves.length ? '. Serves ' + plural(serves.length, 'goal', 'goals') : ''}`);
    card.addEventListener('click', () => this.#events.onSelect(n.id, n));
    this.#els.set(n.id, card);
    return card;
  }

  #buildGoals(layout: Layout, universe: CompanyUniverse): HTMLElement {
    const section = el('section', 'goals');
    section.setAttribute('aria-label', 'Strategic direction');
    section.append(el('h2', 'goals-title', 'Strategic direction'), el('p', 'goals-sub', layout.goals.length === 0 ? 'No goal yet. Propose one and the company can line its work up behind it.' : 'Where the work is going: gold lines run from each department to the goals its work serves.'));
    const band = el('div', 'goal-band');
    for (const g of layout.goals) band.append(this.#goal(g, layout, universe));
    section.append(band);
    return section;
  }

  #goal(g: LayoutNode, layout: Layout, universe: CompanyUniverse): HTMLElement {
    const goal = universe.goals.find((x) => `goal:${x.id}` === g.id);
    const proposed = g.state === 'PROPOSED' || g.state === 'DRAFT';
    const b = button('goal');
    b.dataset.id = g.id;
    b.dataset.goalKind = g.goalKind ?? 'COMPANY';
    b.dataset.state = g.state.toLowerCase();
    const emblem = el('span', 'goal-emblem');
    emblem.setAttribute('aria-hidden', 'true');
    const head = el('span', 'goal-head');
    head.append(el('span', 'goal-kind', `${g.sublabel} · ${t(STATE_LABEL, g.state)}`));
    const title = el('span', 'goal-title', g.label);
    title.dir = dirOf(g.label);
    const depts = el('span', 'goal-depts');
    for (const i of g.anchors) {
      const c = layout.columns[i];
      if (!c) continue;
      const chip = el('span', 'goal-dept', deptName(c.code, c.name));
      chip.style.setProperty('--dept', departmentColor(i));
      depts.append(chip);
    }
    if (g.anchors.length === 0) depts.append(el('span', 'goal-dept goal-dept-none', proposed ? 'Awaiting your decision' : 'No work linked yet'));
    const meta = el('span', 'goal-meta');
    const ownerName = goal ? (layout.byId.get(goal.ownerRef)?.label ?? (goal.ownerRef === 'founder' ? 'Founder' : '')) : '';
    const bits = [goal?.horizonTo ? `Horizon ${fmtDate(goal.horizonTo)}` : null, plural(g.workers.length, 'work item', 'work items'), ownerName || null].filter((x): x is string => x !== null);
    meta.textContent = bits.join(' · ');
    const progress = el('span', 'goal-progress');
    progress.setAttribute('role', 'img');
    if (g.progress === null) {
      progress.setAttribute('aria-label', 'No linked work yet');
      progress.classList.add('is-empty');
    } else {
      const pct = Math.round(g.progress * 100);
      progress.setAttribute('aria-label', `${pct}% of linked work completed`);
      const bar = el('span', 'goal-bar');
      const fill = el('span', 'goal-fill');
      fill.style.width = `${pct}%`;
      bar.append(fill);
      progress.append(bar, el('span', 'goal-pct', `${pct}%`));
    }
    b.append(emblem, head, title, depts, meta, progress);
    b.setAttribute('aria-label', `${g.label}, ${g.sublabel}, ${t(STATE_LABEL, g.state)}. ${bits.join(', ')}. Open the goal`);
    b.addEventListener('click', () => this.#events.onSelect(g.id, g));
    this.#els.set(g.id, b);
    return b;
  }

  // --- emphasis, selection, motion --------------------------------------------------------------------

  setEmphasis(emphasis: Emphasis): void {
    this.#emphasis = emphasis;
    for (const [id, e] of this.#els) {
      const w = emphasis.nodes.get(id) ?? 1;
      e.classList.toggle('is-quiet', w < 0.5);
      e.classList.toggle('is-chain', emphasis.chain.includes(id));
    }
    for (const [dept, col] of this.#columnEls) col.classList.toggle('is-quiet', (emphasis.sectors.get(dept) ?? 1) < 0.5);
    this.#applyLineEmphasis();
  }

  setSelection(nodeId: string | null): void {
    this.#selected = nodeId;
    for (const [id, e] of this.#els) e.classList.toggle('is-selected', id === nodeId);
  }

  setRelationsVisible(visible: boolean): void {
    this.#relations = visible;
    this.#scheduleLines();
  }

  /** Bring a node into view (semantic motion: a cut in reduced motion). */
  focus(nodeId: string | null): void {
    const e = nodeId === null ? this.#els.get('founder') : this.#els.get(nodeId);
    if (!e) return;
    e.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: this.#reduced ? 'auto' : 'smooth' });
  }

  setReducedMotion(reduced: boolean): void {
    this.#reduced = reduced;
    this.#company.classList.toggle('is-reduced', reduced);
  }

  setLive(live: boolean): void {
    this.#company.classList.toggle('is-history', !live);
  }

  /** One-shot semantic motion: a relation appeared or changed. */
  pulseEdge(edgeId: string): void {
    const line = this.#lines.find((l) => l.edge === edgeId);
    if (!line) return;
    line.el.classList.add('is-pulsing');
    setTimeout(() => line.el.classList.remove('is-pulsing'), this.#reduced ? 2500 : 1200);
  }

  /** One-shot semantic motion: a new attention item arrives beside the Founder. */
  arriveAttention(nodeId: string): void {
    const e = this.#els.get(nodeId);
    if (!e) return;
    e.classList.add('is-new');
    setTimeout(() => e.classList.remove('is-new'), 2500);
  }

  dispose(): void {
    cancelAnimationFrame(this.#raf);
    this.#observer?.disconnect();
    this.#company.remove();
    this.#goalsHost.remove();
  }

  // --- the line layer ---------------------------------------------------------------------------------

  #scheduleLines(): void {
    cancelAnimationFrame(this.#raf);
    this.#raf = requestAnimationFrame(() => this.#drawLines());
  }

  #drawLines(): void {
    const layout = this.#layout;
    if (!layout) return;
    const origin = this.#company.getBoundingClientRect();
    const w = Math.max(this.#company.scrollWidth, Math.ceil(origin.width));
    // The line layer covers the company and the goal band beneath it (the band may be pinned inside the view).
    const h = Math.max(this.#company.scrollHeight, Math.ceil(origin.height)) + this.#goalsHost.getBoundingClientRect().height + 8;
    this.#svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.#svg.setAttribute('width', String(w));
    this.#svg.setAttribute('height', String(h));
    this.#svg.replaceChildren();
    this.#lines = [];
    const rect = (id: string): DOMRect | null => {
      const e = this.#els.get(id);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return new DOMRect(r.left - origin.left, r.top - origin.top, r.width, r.height);
    };
    const add = (d: string, kind: Line['kind'], attrs: Record<string, string>, meta: Partial<Line> = {}): Line => {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', `line line-${kind}`);
      for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
      if (attrs.class) p.setAttribute('class', attrs.class);
      this.#svg.append(p);
      const line: Line = { el: p, kind, a: meta.a ?? '', b: meta.b ?? '', ...meta };
      this.#lines.push(line);
      return line;
    };
    const vcurve = (x1: number, y1: number, x2: number, y2: number): string => `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
    // Trunk: Founder → CEO.
    const founder = rect('founder');
    const ceo = layout.ceoId === null ? null : rect(layout.ceoId);
    if (founder && ceo) add(vcurve(founder.left + founder.width / 2, founder.bottom, ceo.left + ceo.width / 2, ceo.top), 'trunk', { stroke: GOLD }, { a: 'founder', b: layout.ceoId ?? '' });
    // Branches: CEO → each column head (a bus below the CEO, then down to the column).
    const from = ceo ?? founder;
    for (const c of layout.columns) {
      const col = this.#columnEls.get(c.departmentId);
      if (!from || !col) continue;
      const r = col.getBoundingClientRect();
      const x = r.left - origin.left + r.width / 2;
      const top = r.top - origin.top;
      const busY = from.bottom + (top - from.bottom) * 0.5;
      const x0 = from.left + from.width / 2;
      const d = `M ${x0} ${from.bottom} C ${x0} ${busY} ${x} ${busY} ${x} ${top}`;
      add(d, 'branch', { stroke: departmentColor(c.index) }, { a: layout.ceoId ?? 'founder', b: c.departmentId, column: c.index });
      // Lane: the team's line inside the column, from the Director down to the last member.
      const first = c.directorId ? rect(c.directorId) : null;
      const last = c.memberIds.length ? rect(c.memberIds[c.memberIds.length - 1] ?? '') : first;
      if (first && last && last !== first) add(`M ${x} ${first.bottom} L ${x} ${last.top + last.height / 2}`, 'lane', { stroke: departmentColor(c.index) }, { a: c.directorId ?? '', b: c.departmentId, column: c.index });
    }
    // Execution lines: each column whose people serve a goal sends one gold line to that goal (bundled per column).
    for (const g of layout.goals) {
      const target = rect(g.id);
      if (!target) continue;
      const tx = target.left + target.width / 2;
      const perColumn = new Map<number, number>();
      for (const worker of g.workers) {
        const n = layout.byId.get(worker);
        if (n && n.column !== null) perColumn.set(n.column, (perColumn.get(n.column) ?? 0) + 1);
      }
      for (const i of g.anchors) if (!perColumn.has(i)) perColumn.set(i, 0);
      for (const [i, count] of perColumn) {
        const c = layout.columns[i];
        const col = c ? this.#columnEls.get(c.departmentId) : undefined;
        if (!col) continue;
        const r = col.getBoundingClientRect();
        const x = r.left - origin.left + r.width / 2;
        const y = r.bottom - origin.top;
        const flowing = g.workers.some((wid) => layout.byId.get(wid)?.running && layout.byId.get(wid)?.column === i);
        const d = vcurve(x, y, tx, target.top);
        add(d, 'exec', { stroke: GOLD, 'stroke-width': String(1.4 + Math.min(count, 4) * 0.6) }, { a: c?.departmentId ?? '', b: g.id, goal: g.id, column: i, count });
        // Work running now: light travels along the line (a real state; a still highlight in reduced motion).
        if (flowing) add(d, 'exec', { stroke: '#ffe2a6', 'stroke-width': '3', class: 'line line-exec line-flow' }, { a: c?.departmentId ?? '', b: g.id, goal: g.id, column: i, count });
        // A small gold dot where the line leaves the column.
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(x));
        dot.setAttribute('cy', String(y));
        dot.setAttribute('r', '3');
        dot.setAttribute('class', 'line-port');
        dot.dataset.goal = g.id;
        this.#svg.append(dot);
      }
      // A derived Department goal hangs from its parent company goal.
      if (g.parentGoalId) {
        const parent = rect(g.parentGoalId);
        if (parent) add(`M ${parent.left + parent.width / 2} ${parent.bottom} C ${parent.left + parent.width / 2} ${parent.bottom + 18} ${tx} ${target.top - 18} ${tx} ${target.top}`, 'derive', { stroke: GOLD }, { a: g.parentGoalId, b: g.id, goal: g.id });
      }
    }
    // Live relations: drawn only on focus surfaces (the relationship lens).
    if (this.#relations) {
      for (const e of layout.edges) {
        const a = rect(e.from);
        const b = rect(e.to);
        if (!a || !b) continue;
        const ax = a.left + a.width / 2;
        const ay = a.top + a.height / 2;
        const bx = b.left + b.width / 2;
        const by = b.top + b.height / 2;
        const bend = Math.max(60, Math.abs(bx - ax) * 0.35);
        add(`M ${ax} ${ay} C ${ax} ${ay - bend} ${bx} ${by - bend} ${bx} ${by}`, 'relation', { stroke: RELATION_COLORS[e.kind] ?? GOLD }, { a: e.from, b: e.to, edge: e.id });
      }
    }
    this.#applyLineEmphasis();
  }

  #applyLineEmphasis(): void {
    const em = this.#emphasis;
    if (!em) return;
    const weight = (id: string): number => em.nodes.get(id) ?? 1;
    for (const l of this.#lines) {
      let w = 1;
      if (l.kind === 'exec') w = Math.min(weight(l.goal ?? ''), em.sectors.get(l.a) ?? 1);
      else if (l.kind === 'derive') w = weight(l.goal ?? '');
      else if (l.kind === 'branch' || l.kind === 'lane') w = em.sectors.get(l.b) ?? 1;
      else if (l.kind === 'relation') w = em.edges.get(l.edge ?? '') ?? 1;
      else if (l.kind === 'trunk') w = Math.max(weight('founder'), weight(l.b));
      l.el.classList.toggle('is-quiet', w < 0.5);
    }
    for (const dot of this.#svg.querySelectorAll<SVGCircleElement>('.line-port')) dot.classList.toggle('is-quiet', weight(dot.dataset.goal ?? '') < 0.5);
  }
}
