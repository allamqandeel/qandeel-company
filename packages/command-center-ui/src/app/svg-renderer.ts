/**
 * Graceful fallback (C5 §25): the same Company Universe, same layout, same lenses, same labels and actions,
 * rendered as SVG 2.5D (an isometric-leaning top-down view with altitude offsets) when WebGL 2 is not
 * available. Not an Org Chart: the Founder still operates the same world.
 */
import type { Emphasis, Layout, LayoutEdge, LayoutNode } from '../model/types.js';
import { departmentColor, nodeColor, PALETTE, RELATION_COLORS, statusShape, type CameraTarget, type RendererEvents, type UniverseRenderer } from './renderer.js';

const NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export class SvgUniverse implements UniverseRenderer {
  readonly kind = 'svg' as const;
  #container!: HTMLElement;
  #events!: RendererEvents;
  #svg!: SVGSVGElement;
  #gSectors!: SVGGElement;
  #gEdges!: SVGGElement;
  #gNodes!: SVGGElement;
  #emphasis: Emphasis | null = null;
  #selection: string | null = null;
  #view = { cx: 0, cz: 0, scale: 1, distance: 34 };
  #target = { cx: 0, cz: 0, scale: 1, distance: 34 };
  #raf = 0;
  #reduced = false;
  #nodes = new Map<string, { node: LayoutNode; g: SVGGElement }>();
  #edges = new Map<string, { edge: LayoutEdge; path: SVGPathElement }>();
  #disposed = false;

  mount(container: HTMLElement, events: RendererEvents): void {
    this.#container = container;
    this.#events = events;
    this.#svg = el('svg', { class: 'svg-universe', 'aria-hidden': 'true' });
    this.#gSectors = el('g');
    this.#gEdges = el('g');
    this.#gNodes = el('g');
    this.#svg.append(this.#gSectors, this.#gEdges, this.#gNodes);
    container.appendChild(this.#svg);
    this.resize();
    this.#loop();
  }

  setLayout(layout: Layout): void {
    this.#gSectors.replaceChildren();
    for (const s of layout.sectors) {
      const r = layout.outerRadius + 1.2;
      const p = el('path', { d: `M 0 0 L ${Math.cos(s.start) * r} ${Math.sin(s.start) * r} A ${r} ${r} 0 0 1 ${Math.cos(s.end) * r} ${Math.sin(s.end) * r} Z`, fill: departmentColor(s.index), 'fill-opacity': 0.07, stroke: departmentColor(s.index), 'stroke-opacity': 0.18, 'stroke-width': 0.03 });
      p.dataset.department = s.departmentId;
      this.#gSectors.appendChild(p);
    }
    for (const ring of layout.rings) this.#gSectors.appendChild(el('circle', { r: ring.radius, fill: 'none', stroke: '#8f86d8', 'stroke-opacity': ring.index === 1 ? 0.35 : 0.2, 'stroke-width': 0.04 }));
    this.#gNodes.replaceChildren();
    this.#nodes.clear();
    for (const n of layout.nodes) {
      const g = el('g', { transform: `translate(${n.x} ${n.z - n.y * 0.55})` });
      const color = nodeColor(n);
      const shape = statusShape(n);
      const r = n.kind === 'founder' ? 0.7 : n.kind === 'goal' ? 0.32 : n.seatKind === 'CEO' ? 0.48 : n.seatKind === 'DIRECTOR' ? 0.4 : 0.3;
      g.appendChild(el('circle', { r: r * 2.2, fill: color, 'fill-opacity': n.kind === 'attention' ? 0.25 : 0.12 }));
      if (n.kind === 'goal') g.appendChild(el('polygon', { points: `0,${-1.6} 0.22,0 -0.22,0`, fill: color, 'fill-opacity': 0.9 }));
      const core = el('circle', { r, fill: shape === 'hollow' || shape === 'dashed' ? 'none' : color, stroke: shape === 'broken' ? PALETTE.blocked : color, 'stroke-width': shape === 'solid' ? 0.04 : 0.09, 'stroke-dasharray': shape === 'dashed' ? '0.18 0.12' : shape === 'broken' ? `${r * 2.2} ${r * 1.2}` : 'none' });
      g.appendChild(core);
      if (shape === 'double') g.appendChild(el('circle', { r: r + 0.2, fill: 'none', stroke: color, 'stroke-width': 0.05 }));
      g.dataset.id = n.id;
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => this.#events.onSelect(n.id, n));
      g.addEventListener('pointerenter', () => this.#events.onHover(n.id));
      g.addEventListener('pointerleave', () => this.#events.onHover(null));
      this.#gNodes.appendChild(g);
      this.#nodes.set(n.id, { node: n, g });
    }
    this.#gEdges.replaceChildren();
    this.#edges.clear();
    for (const e of layout.edges) {
      const a = layout.byId.get(e.from) ?? (e.from === 'founder' ? { x: 0, y: 0.9, z: 0 } : null);
      const b = layout.byId.get(e.to) ?? (e.to === 'founder' ? { x: 0, y: 0.9, z: 0 } : null);
      if (!a || !b) continue;
      const ax = a.x;
      const az = a.z - a.y * 0.55;
      const bx = b.x;
      const bz = b.z - b.y * 0.55;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2 - 1.2;
      const path = el('path', { d: `M ${ax} ${az} Q ${mx} ${mz} ${bx} ${bz}`, fill: 'none', stroke: RELATION_COLORS[e.kind] ?? '#fff', 'stroke-width': e.kind === 'ESCALATION' ? 0.12 : 0.08, 'stroke-opacity': 0.8, 'stroke-linecap': 'round' });
      this.#gEdges.appendChild(path);
      this.#edges.set(e.id, { edge: e, path });
    }
    if (this.#emphasis) this.setEmphasis(this.#emphasis);
  }

  setEmphasis(emphasis: Emphasis): void {
    this.#emphasis = emphasis;
    for (const [id, v] of this.#nodes) v.g.style.opacity = String(0.15 + 0.85 * (emphasis.nodes.get(id) ?? 1));
    for (const [id, v] of this.#edges) v.path.style.opacity = String(0.08 + 0.92 * (emphasis.edges.get(id) ?? 1));
    for (const p of this.#gSectors.querySelectorAll<SVGPathElement>('path[data-department]')) p.style.opacity = String(0.4 + 0.6 * (emphasis.sectors.get(p.dataset.department ?? '') ?? 1));
  }

  setSelection(nodeId: string | null): void {
    if (this.#selection) this.#nodes.get(this.#selection)?.g.classList.remove('is-selected');
    this.#selection = nodeId;
    if (nodeId) this.#nodes.get(nodeId)?.g.classList.add('is-selected');
  }

  focus(target: CameraTarget, immediate: boolean): void {
    const scale = 34 / target.distance;
    this.#target = { cx: target.x, cz: target.z - target.y * 0.55, scale, distance: target.distance };
    if (immediate || this.#reduced) this.#view = { ...this.#target };
  }

  pulseEdge(edgeId: string): void {
    const v = this.#edges.get(edgeId);
    if (!v) return;
    v.path.classList.add('is-pulsing');
    setTimeout(() => v.path.classList.remove('is-pulsing'), 1600);
  }

  arriveAttention(): void {
    // Static substitute in the fallback: the node itself is the badge.
  }

  setReducedMotion(reduced: boolean): void {
    this.#reduced = reduced;
    if (reduced) this.#view = { ...this.#target };
  }

  setLive(live: boolean): void {
    this.#svg.classList.toggle('is-history', !live);
  }

  project(nodeId: string): { x: number; y: number; visible: boolean; depth: number } | null {
    const v = this.#nodes.get(nodeId);
    if (!v) return null;
    const w = this.#container.clientWidth;
    const h = this.#container.clientHeight;
    const unit = (Math.min(w, h) / 34) * this.#view.scale;
    const x = w / 2 + (v.node.x - this.#view.cx) * unit;
    const y = h / 2 + (v.node.z - v.node.y * 0.55 - this.#view.cz) * unit - unit * 0.55;
    return { x, y, visible: x > -20 && x < w + 20 && y > -20 && y < h + 20, depth: 0.5 };
  }

  resize(): void {
    this.#apply();
  }

  dispose(): void {
    this.#disposed = true;
    cancelAnimationFrame(this.#raf);
    this.#svg.remove();
  }

  #loop = (): void => {
    if (this.#disposed) return;
    this.#raf = requestAnimationFrame(this.#loop);
    const k = this.#reduced ? 1 : 0.12;
    this.#view.cx += (this.#target.cx - this.#view.cx) * k;
    this.#view.cz += (this.#target.cz - this.#view.cz) * k;
    this.#view.scale += (this.#target.scale - this.#view.scale) * k;
    this.#view.distance += (this.#target.distance - this.#view.distance) * k;
    this.#apply();
    this.#events.onDistance(this.#view.distance);
  };

  #apply(): void {
    const w = this.#container.clientWidth || 1;
    const h = this.#container.clientHeight || 1;
    const half = (34 / 2) / this.#view.scale;
    const aspect = w / h;
    this.#svg.setAttribute('viewBox', `${this.#view.cx - half * aspect} ${this.#view.cz - half} ${half * 2 * aspect} ${half * 2}`);
  }
}
