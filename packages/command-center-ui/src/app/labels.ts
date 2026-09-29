/**
 * The HTML label layer: every name, title and badge is browser-shaped text (Arabic shaping and bidi are
 * the browser's), positioned from the renderer's projection each frame. Labels are real buttons: keyboard
 * navigable (roving tabindex in rank order), with accessible names carrying the status in words.
 */
import { ar, KIND_AR, LEVEL_AR, SOURCE_AR, STATE_AR } from '../model/format.js';
import { labelTier, labelVisible } from '../model/lenses.js';
import type { Emphasis, Layout, LayoutNode } from '../model/types.js';
import { departmentColor, statusShape, type UniverseRenderer } from './renderer.js';

export class LabelLayer {
  readonly #root: HTMLElement;
  readonly #els = new Map<string, HTMLButtonElement>();
  #layout: Layout | null = null;
  #emphasis: Emphasis | null = null;
  #renderer: UniverseRenderer | null = null;
  #distance = 34;
  #selected: string | null = null;
  #onSelect: (id: string) => void = () => undefined;
  #order: string[] = [];

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#root.addEventListener('keydown', (e) => this.#keys(e));
  }

  bind(renderer: UniverseRenderer, onSelect: (id: string) => void): void {
    this.#renderer = renderer;
    this.#onSelect = onSelect;
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
      el.style.transform = `translate(-50%, -50%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      el.style.opacity = String(0.35 + 0.65 * weight);
      el.style.zIndex = String(1000 - Math.round(p.depth * 10));
      el.classList.toggle('is-quiet', weight < 0.5);
      el.classList.toggle('is-near', tier === 'NEAR');
    }
  }

  focusFirst(): void {
    const first = this.#order[0];
    if (first) this.#els.get(first)?.focus();
  }

  #fill(el: HTMLButtonElement, n: LayoutNode): void {
    const shape = statusShape(n);
    const color = departmentColor(n.sector);
    // An attention marker speaks the Founder's language: its source kind and level, never a raw code.
    const attention = n.kind === 'attention';
    const stateText = attention ? ar(LEVEL_AR, n.state) : ar(STATE_AR, n.state);
    const nameText = attention ? ar(SOURCE_AR, n.label) : n.label;
    el.dataset.kind = n.kind;
    el.dataset.shape = shape;
    el.style.setProperty('--dept', color);
    const kindText = n.seatKind ? ar(KIND_AR, n.seatKind) : n.kind === 'goal' ? 'هدف' : attention ? 'انتباه' : '';
    el.setAttribute('aria-label', `${nameText}${kindText ? '، ' + kindText : ''}${n.sublabel && !attention ? '، ' + n.sublabel : ''}، الحالة: ${stateText}`);
    el.replaceChildren();
    const mark = document.createElement('span');
    mark.className = `mark mark-${shape}`;
    mark.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = nameText;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = attention ? stateText : n.sublabel;
    el.append(mark, name, sub);
    if (n.state === 'BLOCKED' || n.state === 'VACANT' || n.acting || n.kind === 'attention') {
      const badge = document.createElement('span');
      badge.className = `badge badge-${n.state === 'BLOCKED' ? 'blocked' : n.acting ? 'acting' : n.vacant ? 'vacant' : 'attention'}`;
      badge.textContent = n.state === 'BLOCKED' ? 'متوقف' : n.acting ? 'إنابة' : n.vacant ? 'شاغر' : '';
      if (badge.textContent) el.append(badge);
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
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = this.#order[(i - 1 + this.#order.length) % this.#order.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = this.#order[(i + 1) % this.#order.length];
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
