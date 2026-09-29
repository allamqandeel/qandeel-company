/**
 * The Company Universe as the browser sees it. The shapes are the storage projection's (a type-only import,
 * erased at emit: the browser never loads storage code) — one source of truth for the read model.
 */
export type { CompanyUniverse, RelationKind, UniverseAttention, UniverseDepartment, UniverseEmployee, UniverseGoal, UniverseRelation, UniverseSeat, UniverseWork } from '@qandeel-company/storage';

export type Lens =
  | { readonly kind: 'LIVE' }
  | { readonly kind: 'ATTENTION'; readonly lane: 'NEEDS_ME' | 'CEO_BRIEFS' | 'THREADS' | null }
  | { readonly kind: 'CEO' }
  | { readonly kind: 'EMPLOYEE'; readonly employeeId: string }
  | { readonly kind: 'GOAL'; readonly goalId: string }
  | { readonly kind: 'DEPARTMENT'; readonly departmentId: string }
  | { readonly kind: 'BLOCKED' }
  | { readonly kind: 'CONVERSATION'; readonly threadId: string; readonly employeeId: string }
  | { readonly kind: 'HISTORY'; readonly at: string };

export type NodeKind = 'founder' | 'employee' | 'seat' | 'goal' | 'attention';

export interface LayoutNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** Orbit-plane coordinates (x, z) and a small vertical offset (y) that expresses rank depth. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly angle: number;
  readonly ring: number;
  readonly sector: number | null;
  readonly departmentId: string | null;
  readonly label: string;
  readonly sublabel: string;
  readonly state: string;
  readonly acting: boolean;
  readonly vacant: boolean;
  readonly seatKind: string | null;
  readonly employeeId: string | null;
  readonly importance: number;
}

export interface LayoutEdge {
  readonly id: string;
  readonly kind: string;
  readonly from: string;
  readonly to: string;
  readonly state: string;
  readonly workItemId: string | null;
  readonly sourceRef: string;
}

export interface LayoutSector {
  readonly departmentId: string;
  readonly code: string;
  readonly name: string;
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly mid: number;
}

export interface Layout {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly sectors: readonly LayoutSector[];
  readonly rings: readonly { readonly index: number; readonly radius: number; readonly kind: string }[];
  readonly outerRadius: number;
  readonly byId: ReadonlyMap<string, LayoutNode>;
}

export interface Emphasis {
  /** 0 = quiet (dimmed), 1 = full. */
  readonly nodes: ReadonlyMap<string, number>;
  readonly edges: ReadonlyMap<string, number>;
  readonly sectors: ReadonlyMap<string, number>;
  /** Node ids whose labels must show whatever the zoom (the answer to the lens question). */
  readonly pinnedLabels: ReadonlySet<string>;
  readonly focusNodeId: string | null;
  readonly chain: readonly string[];
}
