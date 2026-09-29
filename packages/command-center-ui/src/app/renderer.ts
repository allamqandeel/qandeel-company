/**
 * The renderer contract shared by the WebGL scene and the SVG fallback, plus the visual tokens both use.
 * Colours here are the only place the universe's palette lives; the CSS custom properties mirror them.
 *
 * Status is never colour alone: every state also has a shape (hollow / broken / dashed / doubled ring)
 * and a text badge in the label layer. Department is never colour alone either: the sector's position and
 * its named rim carry it, the hue is the redundant cue.
 */
import type { Emphasis, Layout, LayoutNode, Lens } from '../model/types.js';

export interface CameraTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly distance: number;
}

export interface RendererEvents {
  onSelect(nodeId: string, node: LayoutNode): void;
  onHover(nodeId: string | null): void;
  onDistance(distance: number): void;
}

export interface Projection {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  /** 0 near … 1 far, for label stacking and depth scaling. */
  readonly depth: number;
}

export interface UniverseRenderer {
  readonly kind: 'webgl' | 'svg';
  mount(container: HTMLElement, events: RendererEvents): void;
  setLayout(layout: Layout, lens: Lens): void;
  setEmphasis(emphasis: Emphasis): void;
  setSelection(nodeId: string | null): void;
  focus(target: CameraTarget, immediate: boolean): void;
  /** One-shot semantic motion: a light travels along the edge (a relation appeared or changed). */
  pulseEdge(edgeId: string): void;
  /** One-shot semantic motion: an attention item glides inward from its owner (a new item). */
  arriveAttention(nodeId: string, fromNodeId: string | null): void;
  setReducedMotion(reduced: boolean): void;
  setLive(live: boolean): void;
  project(nodeId: string): Projection | null;
  /** Any point of the orbit plane (ring tags, sector names) to screen space. */
  projectPoint(x: number, y: number, z: number): Projection;
  resize(): void;
  dispose(): void;
}

/**
 * Department hues in canonical sector order, validated with the dataviz palette checker on the dark surface
 * (OKLCH lightness band 0.48–0.67, ≥ 3:1 contrast, every adjacent pair around the ring — including the wrap —
 * ΔE ≥ 8.4 under protan/deutan and ≥ 19.8 in normal vision). Assigned by entity, fixed order, never cycled.
 */
export const DEPARTMENT_COLORS = ['#3987e5', '#199e70', '#c98500', '#9085e9', '#d95926'] as const;
export const departmentColor = (sector: number | null): string => (sector === null ? '#b9b4d6' : (DEPARTMENT_COLORS[sector % DEPARTMENT_COLORS.length] ?? '#b9b4d6'));

export const PALETTE = {
  founder: '#f6ecd4',
  founderGlow: '#e9c07a',
  attention: '#f0c987',
  urgent: '#ff6b57',
  running: '#7fd9ff',
  blocked: '#ff6b57',
  waiting: '#cfc8ee',
  vacant: '#6b6592',
  goalCompany: '#ffe3ae',
  goalDepartment: '#e8c98f',
  text: '#ebe8f6',
  haze: '#161a33',
  deep: '#080a16',
} as const;

export const RELATION_COLORS: Readonly<Record<string, string>> = {
  DELEGATION: '#9fd8ff',
  SUPPORT: '#b8f0d8',
  REVIEW: '#e5d5ff',
  APPROVAL: '#f0c987',
  HANDOFF: '#ffd6a8',
  ESCALATION: '#ff8f7a',
};

/** Node status → shape treatment (colour is secondary). */
export function statusShape(n: LayoutNode): 'solid' | 'hollow' | 'broken' | 'dashed' | 'double' {
  if (n.vacant) return 'dashed';
  if (n.acting) return 'double';
  if (n.state === 'BLOCKED' || n.state === 'SUSPENDED') return 'broken';
  if (n.state.startsWith('WAITING') || n.state === 'PROPOSED' || n.state === 'PAUSED') return 'hollow';
  return 'solid';
}

export function nodeColor(n: LayoutNode): string {
  if (n.kind === 'founder') return PALETTE.founder;
  if (n.kind === 'goal') return n.goalKind === 'COMPANY' ? PALETTE.goalCompany : PALETTE.goalDepartment;
  if (n.kind === 'attention') return n.state === 'URGENT' ? PALETTE.urgent : PALETTE.attention;
  if (n.vacant) return PALETTE.vacant;
  return departmentColor(n.sector);
}

/** Core radius by rank: the orbit says the level, the size confirms it. */
export function nodeRadius(n: LayoutNode): number {
  if (n.kind === 'founder') return 0.5;
  if (n.kind === 'goal') return 0.34;
  if (n.kind === 'attention') return 0.2;
  if (n.seatKind === 'CEO') return 0.42;
  if (n.seatKind === 'DIRECTOR') return 0.34;
  if (n.seatKind === 'MANAGER' || n.seatKind === 'LEAD') return 0.27;
  return 0.22;
}
