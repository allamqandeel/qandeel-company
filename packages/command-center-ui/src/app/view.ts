/**
 * The Tree of Light surface (D-C5-14, final craft D-C5-15): the company as a structured, living executive
 * operating surface. Founder at the top, the CEO beneath on one leadership trunk, five Department columns
 * branching below with the Director first and the team inside, goals along the bottom as the strategic
 * direction, and gold execution lines showing where each column's work flows. Everything is DOM + one SVG line
 * layer: the words are browser-shaped text (bidi and Arabic shaping are the browser's), every person and goal
 * is a real button, and the same view serves every renderer capability (there is no WebGL to fall back from).
 *
 * The line layer is one system, drawn from durable facts only: the gold leadership bus (Founder → CEO → each
 * column, orthogonal with rounded turns), the team lane inside a column (the Department's own accent), the
 * gold collector rail of each goal (each serving column drops into it; the bundle enters the goal), the
 * dashed derivation between a company goal and its Department goal, live relations on focus surfaces, and a
 * tether from the selected card to its context sheet (or from an attention item to the person it concerns): a
 * leader, not a work line — it keeps to the subject's row and the gutters, and passes beneath whatever it crosses.
 *
 * Two kinds of motion, kept apart (C5 §7.2): SEMANTIC — the focus scroll, a lit path when a goal or person is
 * selected, an edge pulse when a relation appears, an attention chip arriving, and a light travelling along an
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
/** Turn radius of the orthogonal lines, in CSS pixels. */
const R = 12;

export interface ViewEvents {
  onSelect(nodeId: string, node: LayoutNode): void;
  onSelectDepartment(departmentId: string): void;
  onAttention(nodeId: string): void;
  onOpenAttention(): void;
  /** The pointer rests on an attention item (or leaves it): the company spotlights where it lives, tethered to the item. */
  onHoverAttention(nodeId: string | null, itemEl: HTMLElement | null): void;
}

interface Line {
  readonly el: SVGPathElement;
  readonly kind: 'trunk' | 'branch' | 'lane' | 'exec' | 'bundle' | 'derive' | 'relation' | 'tether';
  readonly a: string;
  readonly b: string;
  readonly goal?: string;
  readonly column?: number;
  readonly edge?: string;
  readonly count?: number;
}

interface Port {
  readonly x: number;
  readonly y: number;
  readonly column: number;
  readonly departmentId: string;
  readonly count: number;
  readonly flowing: boolean;
}

interface Pt {
  readonly x: number;
  readonly y: number;
}

/**
 * Splits an orthogonal leader into the pieces drawn over the surface and the pieces that pass beneath a block
 * (a card, a column head, a goal, a chip): one path each, as `M … L …` runs. Blocks are padded by 3 px so a
 * leader never touches an edge; pieces shorter than 4 px are dropped.
 */
export function splitLeader(route: readonly Pt[], blocks: readonly DOMRect[]): { over: string; under: string } {
  const over: string[] = [];
  const under: string[] = [];
  const seg = (x0: number, y0: number, x1: number, y1: number): string => `M ${n2(x0)} ${n2(y0)} L ${n2(x1)} ${n2(y1)}`;
  for (let i = 0; i + 1 < route.length; i++) {
    const p = route[i] as Pt;
    const q = route[i + 1] as Pt;
    const horizontal = Math.abs(p.y - q.y) < Math.abs(p.x - q.x);
    const from = horizontal ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
    const to = horizontal ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
    const at = horizontal ? p.y : p.x;
    const hits: Array<[number, number]> = [];
    for (const r of blocks) {
      const inBand = horizontal ? at >= r.top - 3 && at <= r.bottom + 3 : at >= r.left - 3 && at <= r.right + 3;
      if (!inBand) continue;
      const lo = Math.max(from, (horizontal ? r.left : r.top) - 3);
      const hi = Math.min(to, (horizontal ? r.right : r.bottom) + 3);
      if (hi > lo) hits.push([lo, hi]);
    }
    hits.sort((u, v) => u[0] - v[0]);
    const merged: Array<[number, number]> = [];
    for (const h of hits) {
      const last = merged[merged.length - 1];
      if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
      else merged.push([h[0], h[1]]);
    }
    const emit = (list: string[], s: number, e: number): void => {
      if (e - s < 4) return;
      list.push(horizontal ? seg(s, at, e, at) : seg(at, s, at, e));
    };
    let cursor = from;
    for (const [lo, hi] of merged) {
      emit(over, cursor, lo);
      emit(under, lo, hi);
      cursor = hi;
    }
    emit(over, cursor, to);
  }
  return { over: over.join(' '), under: under.join(' ') };
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
const n2 = (v: number): string => (Math.round(v * 2) / 2).toString();

export class TreeView {
  #container!: HTMLElement;
  #events!: ViewEvents;
  #company!: HTMLElement;
  #goalsHost!: HTMLElement;
  #svg!: SVGSVGElement;
  /** The upper line layer: execution rails, bundles, derivations, ports and the tether, above the pinned goal band. */
  #svgTop!: SVGSVGElement;
  #els = new Map<string, HTMLElement>();
  #columnEls = new Map<string, HTMLElement>();
  #lines: Line[] = [];
  #layout: Layout | null = null;
  #signature = '';
  #emphasis: Emphasis | null = null;
  #reduced = false;
  #relations = false;
  #selected: string | null = null;
  #tether: { from: string; to: HTMLElement } | null = null;
  #raf = 0;
  #observer: ResizeObserver | null = null;

  mount(container: HTMLElement, events: ViewEvents): void {
    this.#container = container;
    this.#events = events;
    this.#company = el('div', 'company');
    // The goal band is a sibling of the company grid so it can stay pinned to the bottom of the scroll area.
    this.#goalsHost = el('div', 'goals-host');
    this.#svg = document.createElementNS(SVG_NS, 'svg');
    this.#svg.setAttribute('class', 'lines lines-under');
    this.#svg.setAttribute('aria-hidden', 'true');
    this.#svgTop = document.createElementNS(SVG_NS, 'svg');
    this.#svgTop.setAttribute('class', 'lines lines-over');
    this.#svgTop.setAttribute('aria-hidden', 'true');
    container.append(this.#company, this.#goalsHost);
    this.#observer = new ResizeObserver(() => {
      this.#measureShelves();
      this.#scheduleLines();
    });
    this.#observer.observe(container);
    this.#observer.observe(this.#goalsHost);
    window.addEventListener('resize', () => this.#scheduleLines());
    // A selected node settles with a short transform (a goal lifts 2px); the ResizeObserver never sees a transform,
    // so the tether measured at selection would keep the pre-lift edge and run into the node it leaves (C5-CORR-02).
    // When the tether's own subject finishes moving, the lines are measured again from where it now stands.
    container.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'transform' && this.#tether !== null && e.target === this.#els.get(this.#tether.from)) this.#scheduleLines();
    });
    // The goal band stays in view while the columns scroll under it: the lines follow (and the desk moves).
    container.addEventListener('scroll', () => {
      this.#measureShelves();
      this.#scheduleLines();
    }, { passive: true });
  }

  /**
   * The context sheets and the attention surface stop above the strategic direction and, on the right, start
   * beneath the Founder's "Needs you" chips: both shelves are read from the surface, never assumed.
   */
  #measureShelves(): void {
    const stage = this.#container.parentElement ?? this.#container;
    stage.style.setProperty('--goals-h', `${Math.round(this.#goalsHost.getBoundingClientRect().height)}px`);
    const dock = this.#company.querySelector('.dock-attention');
    const desk = dock ? Math.max(0, Math.round(dock.getBoundingClientRect().bottom - stage.getBoundingClientRect().top)) : 0;
    stage.style.setProperty('--desk-b', `${desk}px`);
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
    this.#company.append(this.#buildSpine(layout, universe), this.#buildColumns(layout), this.#svg, this.#svgTop);
    this.#goalsHost.replaceChildren(this.#buildGoals(layout, universe));
    this.#container.scrollTop = scrollTop;
    const dock = this.#company.querySelector('.dock-attention');
    if (dock) this.#observer?.observe(dock);
    this.#measureShelves();
    if (this.#emphasis) this.setEmphasis(this.#emphasis);
    this.setSelection(this.#selected);
    this.#scheduleLines();
  }

  /** The column a node lives in (null on the spine and for company goals). */
  columnOf(nodeId: string): number | null {
    return this.#layout?.byId.get(nodeId)?.column ?? null;
  }

  #buildSpine(layout: Layout, universe: CompanyUniverse): HTMLElement {
    const spine = el('section', 'spine');
    const founder = button('founder');
    founder.dataset.id = 'founder';
    founder.setAttribute('aria-label', 'Founder, company centre. Return to Company Live');
    const text = el('span', 'founder-text');
    text.append(el('span', 'founder-name', 'Founder'), el('span', 'founder-sub', 'Company centre'));
    founder.append(el('span', 'emblem', 'Q'), text);
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
    head.setAttribute('aria-label', items.length === 0 ? 'Nothing needs you. Open Founder attention' : `${plural(items.length, 'item needs', 'items need')} you. Open Founder attention`);
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
      const goalTitle = item?.sourceRef.startsWith('goal:') ? (layout.byId.get(item.sourceRef)?.label ?? '') : '';
      const what = el('span', 'chip-text');
      what.append(el('span', 'chip-kind', t(SOURCE_LABEL, n.label)));
      const who = goalTitle || owner;
      if (who) {
        const w = el('span', 'chip-who', who);
        w.dir = dirOf(who);
        what.append(w);
      }
      const verb = n.state === 'URGENT' ? 'Urgent' : n.state === 'NEEDS_DECISION' ? 'Decide' : n.state === 'NEEDS_ATTENTION' ? 'Look' : 'Read';
      chip.append(el('span', 'chip-mark'), what, el('span', 'chip-level', verb));
      chip.setAttribute('aria-label', `${t(SOURCE_LABEL, n.label)}${who ? ' · ' + who : ''}, ${t(LEVEL_LABEL, n.state)}. Open`);
      chip.addEventListener('click', () => this.#events.onAttention(n.id));
      chip.addEventListener('pointerenter', () => this.#events.onHoverAttention(n.id, chip));
      chip.addEventListener('focus', () => this.#events.onHoverAttention(n.id, chip));
      chip.addEventListener('pointerleave', () => this.#events.onHoverAttention(null, null));
      chip.addEventListener('blur', () => this.#events.onHoverAttention(null, null));
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
      const mark = el('span', 'column-mark');
      mark.setAttribute('aria-hidden', 'true');
      const name = el('span', 'column-name', deptName(c.code, c.name));
      const count = el('span', 'column-count', plural(c.headcount, 'person', 'people'));
      header.append(mark, name, count);
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
    // The status lives on the person: a small dot at the avatar's corner (green well, blue running, amber
    // awaiting a decision, red blocked, hollow for a vacant seat), and a ring while their work runs.
    avatar.append(el('span', 'status'));
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
      const mark = el('span', 'serves');
      mark.setAttribute('aria-hidden', 'true');
      mark.title = `Serves ${plural(serves.length, 'goal', 'goals')}`;
      meta.append(mark);
    }
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
    const head = el('div', 'goals-head');
    head.append(el('h2', 'goals-title', 'Strategic direction'), el('p', 'goals-sub', layout.goals.length === 0 ? 'No goal yet. Propose one and the company can line its work up behind it.' : 'Where the work is going. Each gold rail collects a department’s work into the goal it serves.'));
    section.append(head);
    const band = el('div', 'goal-band');
    for (const g of layout.goals) band.append(this.#goal(g, layout, universe));
    section.append(band);
    return section;
  }

  #goal(g: LayoutNode, layout: Layout, universe: CompanyUniverse): HTMLElement {
    const goal = universe.goals.find((x) => `goal:${x.id}` === g.id);
    const proposed = g.state === 'PROPOSED' || g.state === 'DRAFT';
    const company = (g.goalKind ?? 'COMPANY') === 'COMPANY';
    const b = button('goal');
    b.dataset.id = g.id;
    b.dataset.goalKind = g.goalKind ?? 'COMPANY';
    b.dataset.state = g.state.toLowerCase();
    const emblem = el('span', 'goal-emblem');
    emblem.setAttribute('aria-hidden', 'true');
    const title = el('span', 'goal-title', g.label);
    title.dir = dirOf(g.label);
    // Kind and state read as a small status line under the title, never as a label above it.
    const line = el('span', 'goal-line');
    line.append(el('span', `goal-state state-${g.state.toLowerCase()}`, proposed ? 'Awaiting your decision' : t(STATE_LABEL, g.state)), el('span', 'goal-kind', company ? 'Company goal' : 'Department goal'));
    const ownerName = goal ? (layout.byId.get(goal.ownerRef)?.label ?? (goal.ownerRef === 'founder' ? 'Founder' : '')) : '';
    if (ownerName) {
      const owner = el('span', 'goal-owner');
      const av = el('span', 'goal-owner-avatar', initials(ownerName));
      av.setAttribute('aria-hidden', 'true');
      const ownerNode = goal ? layout.byId.get(goal.ownerRef) : undefined;
      av.style.setProperty('--dept', departmentColor(ownerNode?.column ?? null));
      const nm = el('span', 'goal-owner-name', ownerName);
      nm.dir = dirOf(ownerName);
      owner.append(av, nm);
      line.append(owner);
    }
    if (goal?.horizonTo) line.append(el('span', 'goal-horizon', `by ${fmtDate(goal.horizonTo)}`));
    const depts = el('span', 'goal-depts');
    for (const i of g.anchors) {
      const c = layout.columns[i];
      if (!c) continue;
      const chip = el('span', 'goal-dept', deptName(c.code, c.name));
      chip.style.setProperty('--dept', departmentColor(i));
      depts.append(chip);
    }
    if (g.anchors.length === 0) depts.append(el('span', 'goal-dept goal-dept-none', proposed ? 'No work until you decide' : 'No work linked yet'));
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
      progress.append(bar, el('span', 'goal-pct', `${pct}%`), el('span', 'goal-work', plural(g.workers.length, 'person', 'people')));
    }
    b.append(emblem, title, line, depts, progress);
    const bits = [company ? 'Company goal' : 'Department goal', proposed ? 'awaiting your decision' : t(STATE_LABEL, g.state), goal?.horizonTo ? `by ${fmtDate(goal.horizonTo)}` : null, plural(g.workers.length, 'person serving', 'people serving'), ownerName ? `owned by ${ownerName}` : null].filter((x): x is string => x !== null);
    b.setAttribute('aria-label', `${g.label}. ${bits.join(', ')}. Open the goal`);
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

  /** A gold tether from a node to a surface outside the company grid (a context sheet, the attention surface). */
  setTether(fromId: string | null, to: HTMLElement | null): void {
    this.#tether = fromId !== null && to !== null ? { from: fromId, to } : null;
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
    const band = this.#goalsHost.getBoundingClientRect();
    // The line layer covers the company and the goal band beneath it (the band may be pinned inside the view).
    // Its size is read from layout rects only, never from the scroll extent: the layer is itself the company's
    // largest overflow, so a height derived from `scrollHeight` grew by one band on every redraw without bound
    // (the surface then crawled). It is also rounded down, never up: a layer that reaches even a fraction of a
    // pixel past the boxes it covers opens the surface's scrollbars, which shrink the company, which redraws the
    // layer smaller, which closes them again, an endless redraw at frame rate. The layer paints with
    // `overflow: visible`, so a line that runs to the very edge of the band is never clipped by this.
    const w = Math.floor(origin.width);
    const h = Math.floor(Math.max(origin.height, band.bottom - origin.top));
    for (const svg of [this.#svg, this.#svgTop]) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      svg.replaceChildren();
    }
    this.#lines = [];
    const local = (r: DOMRect): DOMRect => new DOMRect(r.left - origin.left, r.top - origin.top, r.width, r.height);
    const rect = (id: string): DOMRect | null => {
      const e = this.#els.get(id);
      return e ? local(e.getBoundingClientRect()) : null;
    };
    // Structure (trunk, bus, lanes, relations) draws under the cards; execution (rails, bundles, derivations,
    // ports, the tether) draws over the pinned goal band so a line visibly enters the goal it serves. A gold line
    // over the band or a card wears a thin paper casing, like a road on a map.
    const OVER: ReadonlySet<Line['kind']> = new Set(['exec', 'bundle', 'derive', 'tether']);
    const add = (d: string, kind: Line['kind'], attrs: Record<string, string>, meta: Partial<Line> = {}, into?: SVGSVGElement): Line => {
      const layer = into ?? (OVER.has(kind) ? this.#svgTop : this.#svg);
      if ((kind === 'exec' || kind === 'bundle') && !attrs.class) {
        const casing = document.createElementNS(SVG_NS, 'path');
        casing.setAttribute('d', d);
        casing.setAttribute('class', 'line line-casing');
        casing.setAttribute('stroke-width', n2(Number(attrs['stroke-width'] ?? '1.5') + 4));
        layer.append(casing);
        const line: Line = { el: casing, kind, a: meta.a ?? '', b: meta.b ?? '', ...meta };
        this.#lines.push(line);
      }
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', `line line-${kind}`);
      for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
      if (attrs.class) p.setAttribute('class', attrs.class);
      layer.append(p);
      const line: Line = { el: p, kind, a: meta.a ?? '', b: meta.b ?? '', ...meta };
      this.#lines.push(line);
      return line;
    };
    const port = (x: number, y: number, r: number, cls: string, goal?: string, fill?: string): void => {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', n2(x));
      dot.setAttribute('cy', n2(y));
      dot.setAttribute('r', String(r));
      dot.setAttribute('class', cls);
      if (goal) dot.dataset.goal = goal;
      if (fill) dot.style.fill = fill;
      this.#svgTop.append(dot);
    };
    // An orthogonal path: down from (x0, y0) to a horizontal bus at busY, along it, then down to (x1, y1),
    // with rounded turns (a straight line when the ends are aligned).
    const elbow = (x0: number, y0: number, x1: number, y1: number, busY: number): string => {
      if (Math.abs(x1 - x0) < R * 2) return `M ${n2(x0)} ${n2(y0)} L ${n2(x1)} ${n2(y1)}`;
      const dir = x1 > x0 ? 1 : -1;
      const r = Math.min(R, Math.abs(y1 - y0) / 2, Math.abs(busY - y0), Math.abs(y1 - busY));
      const s1 = dir > 0 ? 0 : 1;
      const s2 = dir > 0 ? 1 : 0;
      return `M ${n2(x0)} ${n2(y0)} L ${n2(x0)} ${n2(busY - r)} A ${n2(r)} ${n2(r)} 0 0 ${s1} ${n2(x0 + dir * r)} ${n2(busY)} L ${n2(x1 - dir * r)} ${n2(busY)} A ${n2(r)} ${n2(r)} 0 0 ${s2} ${n2(x1)} ${n2(busY + r)} L ${n2(x1)} ${n2(y1)}`;
    };

    // Leadership trunk: Founder → CEO (one straight gold stem with a soft halo beneath it).
    const founder = rect('founder');
    const ceo = layout.ceoId === null ? null : rect(layout.ceoId);
    if (founder && ceo) {
      const d = `M ${n2(founder.left + founder.width / 2)} ${n2(founder.bottom)} L ${n2(ceo.left + ceo.width / 2)} ${n2(ceo.top)}`;
      add(d, 'trunk', { stroke: GOLD, class: 'line line-trunk line-halo' }, { a: 'founder', b: layout.ceoId ?? '' });
      add(d, 'trunk', { stroke: GOLD }, { a: 'founder', b: layout.ceoId ?? '' });
    }
    // The leadership bus: CEO → every column, one gold system with rounded turns; the column's own accent marks the port.
    const from = ceo ?? founder;
    const columnRects = new Map<string, DOMRect>();
    for (const c of layout.columns) {
      const col = this.#columnEls.get(c.departmentId);
      if (!col) continue;
      const r = local(col.getBoundingClientRect());
      columnRects.set(c.departmentId, r);
      if (!from) continue;
      const x = r.left + r.width / 2;
      const busY = from.bottom + (r.top - from.bottom) * 0.5;
      add(elbow(from.left + from.width / 2, from.bottom, x, r.top, busY), 'branch', { stroke: GOLD }, { a: layout.ceoId ?? 'founder', b: c.departmentId, column: c.index });
      port(x, r.top, 3.5, 'line-port port-column', undefined, departmentColor(c.index));
      // Lane: the team's line inside the column, from the Director down to the last member (the Department's accent).
      const first = c.directorId ? rect(c.directorId) : null;
      const last = c.memberIds.length ? rect(c.memberIds[c.memberIds.length - 1] ?? '') : first;
      if (first && last && last !== first) add(`M ${n2(x)} ${n2(first.bottom)} L ${n2(x)} ${n2(last.top + last.height / 2)}`, 'lane', { stroke: departmentColor(c.index) }, { a: c.directorId ?? '', b: c.departmentId, column: c.index });
    }
    // Execution: each goal owns a gold collector rail just above the strategic direction; every column whose
    // people serve it drops into the rail (weight by the people), and the bundle enters the goal from the rail.
    const goalRects = new Map<string, DOMRect>();
    for (const g of layout.goals) {
      const r = rect(g.id);
      if (r) goalRects.set(g.id, r);
    }
    const bandTop = Math.min(...[...goalRects.values()].map((r) => r.top), Number.POSITIVE_INFINITY);
    layout.goals.forEach((g, rank) => {
      const target = goalRects.get(g.id);
      if (!target) return;
      const tx = target.left + target.width / 2;
      const railY = bandTop - 14 - rank * 8;
      const perColumn = new Map<number, number>();
      for (const worker of g.workers) {
        const n = layout.byId.get(worker);
        if (n && n.column !== null) perColumn.set(n.column, (perColumn.get(n.column) ?? 0) + 1);
      }
      for (const i of g.anchors) if (!perColumn.has(i)) perColumn.set(i, 0);
      const ports: Port[] = [];
      for (const [i, count] of perColumn) {
        const c = layout.columns[i];
        const r = c ? columnRects.get(c.departmentId) : undefined;
        if (!c || !r) continue;
        // Columns serving several goals fan their ports out a little so the drops never overlap.
        const served = layout.goals.filter((o) => o.anchors.includes(i) || o.workers.some((wid) => layout.byId.get(wid)?.column === i));
        const k = served.findIndex((o) => o.id === g.id);
        const x = r.left + r.width / 2 + (k - (served.length - 1) / 2) * 7;
        const flowing = g.workers.some((wid) => layout.byId.get(wid)?.running && layout.byId.get(wid)?.column === i);
        ports.push({ x, y: r.bottom, column: i, departmentId: c.departmentId, count, flowing });
      }
      if (ports.length === 0) return;
      const total = ports.reduce((s, p) => s + p.count, 0);
      for (const p of ports) {
        const width = 1.2 + Math.min(p.count, 4) * 0.5;
        let d: string;
        if (p.y >= railY - R * 2) {
          // The column runs on under the band: its rail starts where the column passes, then leads to the goal.
          d = `M ${n2(p.x)} ${n2(railY)} L ${n2(tx)} ${n2(railY)} L ${n2(tx)} ${n2(target.top)}`;
        } else {
          d = elbow(p.x, p.y, tx, target.top, railY);
          port(p.x, p.y, 3, 'line-port', g.id);
        }
        add(d, 'exec', { stroke: GOLD, 'stroke-width': n2(width) }, { a: p.departmentId, b: g.id, goal: g.id, column: p.column, count: p.count });
        // Work running now: one light travels along the line (a real state; a still highlight in reduced motion).
        if (p.flowing) add(d, 'exec', { stroke: '#fff1cf', 'stroke-width': n2(width + 1.5), pathLength: '1000', class: 'line line-exec line-flow' }, { a: p.departmentId, b: g.id, goal: g.id, column: p.column, count: p.count });
      }
      // The bundle: everything the goal collects enters it as one line, weighted by all the people serving.
      add(`M ${n2(tx)} ${n2(railY)} L ${n2(tx)} ${n2(target.top)}`, 'bundle', { stroke: GOLD, 'stroke-width': n2(1.6 + Math.min(total, 8) * 0.45) }, { a: '', b: g.id, goal: g.id, count: total });
      port(tx, target.top, 3.5 + Math.min(total, 6) * 0.25, 'line-port port-goal', g.id);
      // A derived Department goal hangs from its parent company goal: a dashed link that runs beneath the goal
      // objects (never across another goal) from the parent's foot to the child's foot.
      if (g.parentGoalId) {
        const parent = goalRects.get(g.parentGoalId);
        if (parent) {
          const px = parent.left + parent.width / 2;
          const under = Math.max(parent.bottom, target.bottom) + 10;
          const d = Math.abs(target.top - parent.top) < 4 && Math.abs(tx - px) > R * 2
            ? `M ${n2(px)} ${n2(parent.bottom)} L ${n2(px)} ${n2(under - R)} A ${n2(R)} ${n2(R)} 0 0 ${tx > px ? 0 : 1} ${n2(px + (tx > px ? R : -R))} ${n2(under)} L ${n2(tx - (tx > px ? R : -R))} ${n2(under)} A ${n2(R)} ${n2(R)} 0 0 ${tx > px ? 0 : 1} ${n2(tx)} ${n2(under - R)} L ${n2(tx)} ${n2(target.bottom)}`
            : `M ${n2(px)} ${n2(parent.bottom)} C ${n2(px)} ${n2(parent.bottom + 18)} ${n2(tx)} ${n2(target.top - 18)} ${n2(tx)} ${n2(target.top)}`;
          add(d, 'derive', { stroke: GOLD }, { a: g.parentGoalId, b: g.id, goal: g.id });
        }
      }
    });
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
        add(`M ${n2(ax)} ${n2(ay)} C ${n2(ax)} ${n2(ay - bend)} ${n2(bx)} ${n2(by - bend)} ${n2(bx)} ${n2(by)}`, 'relation', { stroke: RELATION_COLORS[e.kind] ?? GOLD }, { a: e.from, b: e.to, edge: e.id });
      }
    }
    // The tether: a leader from the selected card to its context sheet (or from an attention item to its
    // person). It is not a work relationship, so it never takes the gold system's routes: it leaves the subject
    // toward the surface's nearest edge, stays on the subject's row, uses the column gutter when it must change
    // row, and wherever it would cross a card, a column head, a goal or a chip it passes beneath (drawn in the
    // under-layer), so nothing on the surface is ever written over.
    if (this.#tether && this.#els.has(this.#tether.from) && this.#tether.to.isConnected && !this.#tether.to.hidden) {
      const subject = this.#els.get(this.#tether.from) as HTMLElement;
      const a = rect(this.#tether.from);
      const b = local(this.#tether.to.getBoundingClientRect());
      const route = a && b.width > 0 ? this.#leaderRoute(this.#tether.from, a, b, layout, columnRects) : null;
      if (route) {
        const skip = new Set<Element>([subject, this.#tether.to]);
        const blocks: DOMRect[] = [];
        for (const e of this.#els.values()) if (!skip.has(e) && e.isConnected) blocks.push(local(e.getBoundingClientRect()));
        for (const col of this.#columnEls.values()) {
          const head = col.querySelector('.column-head');
          if (head) blocks.push(local(head.getBoundingClientRect()));
        }
        const { over, under } = splitLeader(route, blocks);
        if (under) add(under, 'tether', { stroke: GOLD, class: 'line line-tether is-under' }, { a: this.#tether.from, b: 'sheet' }, this.#svg);
        if (over) add(over, 'tether', { stroke: GOLD }, { a: this.#tether.from, b: 'sheet' });
        const first = route[0] as Pt;
        const last = route[route.length - 1] as Pt;
        port(first.x, first.y, 3, 'line-port port-tether');
        port(last.x, last.y, 3, 'line-port port-tether');
      }
    }
    this.#applyLineEmphasis();
  }

  /**
   * The leader's route as an orthogonal polyline (subject rect `a`, surface rect `b`, both local). A person or
   * the CEO leaves from the side edge on the surface's side, on their own row; when the surface has no room on
   * that row (a small chip, a sheet that starts lower) the leader steps over in the nearest gutter first. A goal
   * leaves from its top edge at the column gutter nearest the sheet (never through the goal beside it) and joins
   * the sheet's side edge above the rails; a sheet standing over the goal takes a short vertical. Null when no
   * clean route exists (the surface overlaps the subject).
   */
  #leaderRoute(subjectId: string, a: DOMRect, b: DOMRect, layout: Layout, columnRects: Map<string, DOMRect>): Pt[] | null {
    const node = layout.byId.get(subjectId);
    const cx = a.left + a.width / 2;
    const cy = a.top + a.height / 2;
    const bcx = b.left + b.width / 2;
    // Every column gutter (between neighbours, and the margin outside the outer columns), left to right.
    const cols = layout.columns.map((c) => columnRects.get(c.departmentId)).filter((r): r is DOMRect => r !== undefined).sort((p, q) => p.left - q.left);
    const gutters: number[] = [];
    cols.forEach((r, i) => {
      if (i === 0) gutters.push(r.left - 10);
      const next = cols[i + 1];
      gutters.push(next ? (r.right + next.left) / 2 : r.right + 10);
    });
    // The gutter beside the subject's own column on one side (a step beside the card when it is on the spine).
    const beside = (dir: 1 | -1): number => {
      const col = node?.column ?? null;
      const r = col === null ? undefined : columnRects.get(layout.columns[col]?.departmentId ?? '');
      if (!r) return (dir > 0 ? a.right : a.left) + dir * 14;
      const near = gutters.filter((g) => (dir > 0 ? g > r.right - 1 : g < r.left + 1));
      return dir > 0 ? Math.min(...near, r.right + 10) : Math.max(...near, r.left - 10);
    };
    if (node?.kind === 'goal') {
      if (b.bottom > a.top + 1) return null;
      const lo = Math.max(a.left, b.left);
      const hi = Math.min(a.right, b.right);
      if (hi - lo >= 20) {
        // The sheet stands over the goal: straight up, beside the bundle's port.
        const inset = Math.min(24, (hi - lo) / 3);
        let x = (lo + hi) / 2;
        if (Math.abs(x - cx) < 16) x = x + 24 <= hi - inset ? x + 24 : x - 24;
        return [{ x, y: a.top }, { x, y: b.bottom }];
      }
      const dir: 1 | -1 = bcx > cx ? 1 : -1;
      const within = gutters.filter((g) => g >= a.left + 12 && g <= a.right - 12 && Math.abs(g - cx) >= 14);
      const x0 = within.length ? (dir > 0 ? Math.max(...within) : Math.min(...within)) : dir > 0 ? a.right - 22 : a.left + 22;
      const y = Math.min(Math.max(cy, b.top + 28), b.bottom - 36);
      return [{ x: x0, y: a.top }, { x: x0, y }, { x: dir > 0 ? b.left : b.right, y }];
    }
    const toRight = b.left >= a.right - 4;
    const toLeft = b.right <= a.left + 4;
    if (toRight || toLeft) {
      const dir: 1 | -1 = toRight ? 1 : -1;
      const ax = toRight ? a.right : a.left;
      const bx = toRight ? b.left : b.right;
      const inset = Math.min(28, b.height / 3);
      const by = Math.min(Math.max(cy, b.top + inset), b.bottom - inset);
      if (Math.abs(by - cy) < 1) return [{ x: ax, y: cy }, { x: bx, y: cy }];
      let gx = beside(dir);
      if ((gx - ax) * dir > (bx - ax) * dir - 8) gx = ax + dir * Math.max(6, ((bx - ax) * dir) / 2);
      return [{ x: ax, y: cy }, { x: gx, y: cy }, { x: gx, y: by }, { x: bx, y: by }];
    }
    // The surface is above or below the subject (a chip beside the Founder): out to the nearest gutter on its
    // side, along the gutter, and into the surface from below or from the side.
    const below = b.top >= a.bottom - 1;
    if (!below && b.bottom > a.top + 1) return null;
    const dir: 1 | -1 = bcx >= cx ? 1 : -1;
    const ax = dir > 0 ? a.right : a.left;
    const gx = beside(dir);
    if (gx >= b.left + 12 && gx <= b.right - 12) return [{ x: ax, y: cy }, { x: gx, y: cy }, { x: gx, y: below ? b.top : b.bottom }];
    const inset = Math.min(14, b.height / 3);
    const yy = Math.min(Math.max(cy, b.top + inset), b.bottom - inset);
    return [{ x: ax, y: cy }, { x: gx, y: cy }, { x: gx, y: yy }, { x: gx < b.left ? b.left : b.right, y: yy }];
  }

  #applyLineEmphasis(): void {
    const em = this.#emphasis;
    if (!em) return;
    const weight = (id: string): number => em.nodes.get(id) ?? 1;
    for (const l of this.#lines) {
      let w = 1;
      if (l.kind === 'exec') w = Math.min(weight(l.goal ?? ''), em.sectors.get(l.a) ?? 1);
      else if (l.kind === 'bundle' || l.kind === 'derive') w = weight(l.goal ?? '');
      else if (l.kind === 'branch' || l.kind === 'lane') w = em.sectors.get(l.b) ?? 1;
      else if (l.kind === 'relation') w = em.edges.get(l.edge ?? '') ?? 1;
      else if (l.kind === 'trunk') w = Math.max(weight('founder'), weight(l.b));
      l.el.classList.toggle('is-quiet', w < 0.5);
      // A selected goal's lines are lit: they carry the eye from the goal back to the people serving it.
      l.el.classList.toggle('is-lit', (l.kind === 'exec' || l.kind === 'bundle') && !l.el.classList.contains('line-casing') && l.goal !== undefined && l.goal === this.#selected && w >= 0.5);
    }
    for (const dot of this.#svgTop.querySelectorAll<SVGCircleElement>('.line-port[data-goal]')) dot.classList.toggle('is-quiet', weight(dot.dataset.goal ?? '') < 0.5);
  }
}
