/**
 * The renderer contract shared by the WebGL scene and the SVG fallback, plus the visual tokens both use.
 * Colours here are the only place the universe's palette lives; the CSS custom properties mirror them.
 *
 * Status is never colour alone: every state also has a shape (hollow / broken / dashed / doubled ring)
 * and a text badge in the label layer.
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
  project(nodeId: string): { x: number; y: number; visible: boolean; depth: number } | null;
  resize(): void;
  dispose(): void;
}

/** Department hues in canonical order (dataviz: assigned by entity, fixed order, never cycled). */
export const DEPARTMENT_COLORS = ['#7fa6ff', '#5ad39c', '#ff8fb5', '#ffc46b', '#a793ff'] as const;
export const departmentColor = (sector: number | null): string => (sector === null ? '#cfc8ff' : (DEPARTMENT_COLORS[sector % DEPARTMENT_COLORS.length] ?? '#cfc8ff'));

export const PALETTE = {
  founder: '#f7edd2',
  founderGlow: '#f2b95b',
  attention: '#f2b95b',
  urgent: '#ff6b57',
  running: '#79e6ff',
  blocked: '#ff6b57',
  waiting: '#d9d3ff',
  vacant: '#5f5a8c',
  goalCompany: '#ffe1a8',
  goalDepartment: '#ffd27a',
  text: '#ece8ff',
  haze: '#1a1540',
  deep: '#0a0920',
} as const;

export const RELATION_COLORS: Readonly<Record<string, string>> = {
  DELEGATION: '#9fd8ff',
  SUPPORT: '#b8f0d8',
  REVIEW: '#e5d5ff',
  APPROVAL: '#f2b95b',
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
  if (n.kind === 'goal') return n.sublabel === 'هدف الشركة' ? PALETTE.goalCompany : PALETTE.goalDepartment;
  if (n.kind === 'attention') return n.state === 'URGENT' ? PALETTE.urgent : PALETTE.attention;
  if (n.vacant) return PALETTE.vacant;
  return departmentColor(n.sector);
}
