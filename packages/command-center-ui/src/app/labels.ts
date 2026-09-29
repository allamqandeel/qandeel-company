/**
 * The HTML label layer: every name, title and badge is browser-shaped text (bidi and Arabic shaping are the
 * browser's), positioned from the renderer's projection each frame and scaled by depth so the map reads as a
 * space, not a diagram. Three families of text live here:
 * - node captions (real buttons: keyboard navigable in rank order, accessible names carry the status in words);
 * - ring tags, one per orbit, so the rank is read from the orbit itself;
 * - sector names on the coloured rim, one per Department (buttons: they open the Department).
 */
import { KIND_LABEL, LEVEL_LABEL, RING_LABEL, SOURCE_LABEL, STATE_LABEL, deptName, dirOf, plural, t } from '../model/format.js';
import { labelTier, labelVisible } from '../model/lenses.js';
import type { Emphasis, Layout, LayoutNode } from '../model/types.js';
import { departmentColor, statusShape, type UniverseRenderer } from './renderer.js';

/**
 * Ring tags sit on sector boundaries (seat-free by construction, and the Directors sit mid-sector): the outer
 * three step down the lower-left boundary toward the camera, one per orbit, like a legend read down the map;
 * the CEO's tag sits on the left boundary, clear of the Founder caption below the centre.
 */
function ringTagAngle(layout: Layout, kind: string): number {
  const boundaries = layout.sectors.map((s) => s.start).sort((a, b) => a - b);
  const lowerLeft = boundaries.find((a) => a > Math.PI / 2 + 0.4) ?? Math.PI / 2 + 0.75;
  const left = boundaries.find((a) => a > Math.PI) ?? Math.PI + 0.2;
  return kind === 'CEO' ? left : lowerLeft;
}
/** Sector names sit on the rim, ahead of the sector's middle so a goal beacon at the middle never covers them. */
const SECTOR_NAME_LEAD = -0.3;

export class LabelLayer {
  readonly #root: HTMLElement;
  readonly #els = new Map<string, HTMLButtonElement>();
  readonly #tags: { el: HTMLElement; x: number; y: number; z: number; sector: number | null }[] = [];
  #layout: Layout | null = null;
  #emphasis: Emphasis | null = null;
  #renderer: UniverseRenderer | null = null;
  #distance = 34;
  #selected: string | null = null;
  #onSelect: (id: string) => void = () => undefined;
  #onSector: (departmentId: string) => void = () => undefined;
  #order: string[] = [];

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#root.addEventListener('keydown', (e) => this.#keys(e));
  }

  bind(renderer: UniverseRenderer, onSelect: (id: string) => void, onSector: (departmentId: string) => void): void {
    this.#renderer = renderer;
    this.#onSelect = onSelect;
    this.#onSector = onSector;
  }

  setLayout(layout: Layout): void {
    this.#layout = layout;
    const seen = new Set<string>();
    for (const n of layout.nodes) {
      seen.add(n.id);
      let el = this.#els.get(n.id);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'label';
        el.tabIndex = -1;
        el.dataset.id = n.id;
        el.addEventListener('click', () => this.#onSelect(n.id));
        el.addEventListener('focus', () => this.#renderer?.setSelection(n.id));
        this.#root.appendChild(el);
        this.#els.set(n.id, el);
      }
      this.#fill(el, n);
    }
    for (const [id, el] of this.#els) {
      if (!seen.has(id)) {
        el.remove();
        this.#els.delete(id);
      }
    }
    // Keyboard order: Founder, attention, CEO, Directors, the rest by sector then angle, goals last.
    this.#order = [...layout.nodes].sort((a, b) => rank(a) - rank(b) || (a.sector ?? -1) - (b.sector ?? -1) || a.angle - b.angle).map((n) => n.id);
    this.#roving();
    this.#buildTags(layout);
  }

  #buildTags(layout: Layout): void {
    for (const tag of this.#tags) tag.el.remove();
    this.#tags.length = 0;
    for (const ring of layout.rings) {
      const el = document.createElement('span');
      el.className = 'tag tag-ring';
      el.textContent = RING_LABEL[ring.kind] ?? ring.kind;
      el.setAttribute('aria-hidden', 'true');
      this.#root.appendChild(el);
      const a = ringTagAngle(layout, ring.kind);
      this.#tags.push({ el, x: Math.cos(a) * ring.radius, y: 0.02, z: Math.sin(a) * ring.radius, sector: null });
    }
    for (const s of layout.sectors) {
      const people = layout.nodes.filter((n) => n.kind === 'employee' && n.sector === s.index).length;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tag tag-sector';
      el.style.setProperty('--dept', departmentColor(s.index));
      el.dataset.department = s.departmentId;
      const name = document.createElement('span');
      name.className = 'tag-name';
      name.textContent = deptName(s.code, s.name);
      const count = document.createElement('span');
      count.className = 'tag-count';
      count.textContent = plural(people, 'person', 'people');
      el.append(name, count);
      el.setAttribute('aria-label', `${deptName(s.code, s.name)} department, ${plural(people, 'person', 'people')}. Open the department`);
      el.addEventListener('click', () => this.#onSector(s.departmentId));
      this.#root.appendChild(el);
      const a = s.mid + SECTOR_NAME_LEAD;
      this.#tags.push({ el, x: Math.cos(a) * layout.rimRadius, y: 0.02, z: Math.sin(a) * layout.rimRadius, sector: s.index });
    }
  }

  setEmphasis(emphasis: Emphasis): void {
    this.#emphasis = emphasis;
  }

  setSelection(id: string | null): void {
    this.#selected = id;
    for (const [nid, el] of this.#els) el.classList.toggle('is-selected', nid === id);
    this.#roving();
  }

  setDistance(d: number): void {
    this.#distance = d;
  }

  /** Called every frame by the app loop: place visible labels, hide the rest. */
  update(): void {
    if (!this.#layout || !this.#renderer) return;
    const tier = labelTier(this.#distance);
    const emphasis = this.#emphasis;
    for (const n of this.#layout.nodes) {
      const el = this.#els.get(n.id);
      if (!el) continue;
      const wanted = emphasis ? labelVisible(n, tier, emphasis) : n.importance >= 0.8;
      const p = wanted ? this.#renderer.project(n.id) : null;
      if (!p || !p.visible) {
        if (!el.hidden) el.hidden = true;
        continue;
      }
      if (el.hidden) el.hidden = false;
      const weight = emphasis?.nodes.get(n.id) ?? 1;
      const scale = 1.06 - 0.3 * p.depth;
      el.style.transform = `translate(-50%, -50%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
      el.style.opacity = String((0.35 + 0.65 * weight) * (1 - 0.25 * p.depth));
      el.style.zIndex = String(1000 - Math.round(p.depth * 500));
      el.classList.toggle('is-quiet', weight < 0.5);
      el.classList.toggle('is-near', tier === 'NEAR');
    }
    for (const tag of this.#tags) {
      const p = this.#renderer.projectPoint(tag.x, tag.y, tag.z);
      if (!p.visible) {
        if (!tag.el.hidden) tag.el.hidden = true;
        continue;
      }
      if (tag.el.hidden) tag.el.hidden = false;
      const weight = tag.sector === null ? 1 : (emphasis?.sectors.get(this.#layout.sectors[tag.sector]?.departmentId ?? '') ?? 1);
      const scale = 1.04 - 0.28 * p.depth;
      tag.el.style.transform = `translate(-50%, -50%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
      tag.el.style.opacity = String((0.45 + 0.55 * weight) * (1 - 0.2 * p.depth));
      // Sector names stay readable over a crowded sector; ring tags sit under the captions.
      tag.el.style.zIndex = String(tag.sector === null ? 400 - Math.round(p.depth * 300) : 1200);
    }
  }

  focusFirst(): void {
    const first = this.#order[0];
    if (first) this.#els.get(first)?.focus();
  }

  #fill(el: HTMLButtonElement, n: LayoutNode): void {
    const shape = statusShape(n);
    const color = n.kind === 'goal' ? '#ffe3ae' : departmentColor(n.sector);
    // An attention marker speaks the Founder's language: its source kind and level, never a raw code.
    const attention = n.kind === 'attention';
    const stateText = attention ? t(LEVEL_LABEL, n.state) : t(STATE_LABEL, n.state);
    const nameText = attention ? t(SOURCE_LABEL, n.label) : n.label;
    el.dataset.kind = n.kind;
    el.dataset.shape = shape;
    if (n.seatKind) el.dataset.rank = n.seatKind;
    el.style.setProperty('--dept', color);
    const kindText = n.seatKind ? t(KIND_LABEL, n.seatKind) : n.kind === 'goal' ? 'Goal' : attention ? 'Attention' : '';
    el.setAttribute('aria-label', `${nameText}${kindText ? ', ' + kindText : ''}${n.sublabel && !attention ? ', ' + n.sublabel : ''}. Status: ${stateText}`);
    el.replaceChildren();
    const mark = document.createElement('span');
    mark.className = `mark mark-${shape}`;
    mark.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = nameText;
    name.dir = dirOf(nameText);
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = attention ? stateText : n.sublabel;
    const line = document.createElement('span');
    line.className = 'line';
    line.append(mark, name);
    el.append(line, sub);
    if (n.state === 'BLOCKED' || n.state === 'VACANT' || n.acting || n.running) {
      const badge = document.createElement('span');
      badge.className = `badge badge-${n.state === 'BLOCKED' ? 'blocked' : n.acting ? 'acting' : n.vacant ? 'vacant' : 'running'}`;
      badge.textContent = n.state === 'BLOCKED' ? 'Blocked' : n.acting ? 'Acting' : n.vacant ? 'Vacant' : 'Running';
      el.append(badge);
    }
  }

  #roving(): void {
    const active = this.#selected && this.#els.has(this.#selected) ? this.#selected : this.#order[0];
    for (const [id, el] of this.#els) el.tabIndex = id === active ? 0 : -1;
  }

  #keys(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const id = target.dataset.id;
    if (!id) return;
    const i = this.#order.indexOf(id);
    if (i < 0) return;
    let next: string | undefined;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = this.#order[(i - 1 + this.#order.length) % this.#order.length];
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = this.#order[(i + 1) % this.#order.length];
    else if (e.key === 'Home') next = this.#order[0];
    else if (e.key === 'End') next = this.#order[this.#order.length - 1];
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.#onSelect(id);
      return;
    } else return;
    e.preventDefault();
    if (next) {
      const el = this.#els.get(next);
      if (el) {
        el.hidden = false;
        el.focus();
      }
    }
  }
}

function rank(n: LayoutNode): number {
  if (n.kind === 'founder') return 0;
  if (n.kind === 'attention') return 1;
  if (n.seatKind === 'CEO') return 2;
  if (n.seatKind === 'DIRECTOR') return 3;
  if (n.kind === 'goal') return 9;
  return 4 + n.ring;
}
