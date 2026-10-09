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
  // P1-CHAT-INTEL-01: the dedicated Chat screen; `from` is where × returns (the person's profile, or the company).
  | { readonly kind: 'CONVERSATION'; readonly threadId: string; readonly employeeId: string; readonly from?: 'EMPLOYEE' | 'LIVE' }
  | { readonly kind: 'HISTORY'; readonly at: string };

export type NodeKind = 'founder' | 'employee' | 'seat' | 'goal' | 'attention';

/**
 * One thing on the company surface. The Tree of Light composition (D-C5-14): the Founder at the top, the CEO
 * beneath, one column per Department with its Director first, its people below in rank order, goals along the
 * bottom tethered to the columns whose work serves them, and what needs the Founder beside the Founder.
 */
export interface LayoutNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** The Department column this node lives in (canonical order), or null for the leadership spine and company goals. */
  readonly column: number | null;
  readonly departmentId: string | null;
  /** Position inside the column: 0 = the Director, then Managers / Leads, then Specialists (vacant seats keep their place). */
  readonly row: number;
  readonly label: string;
  readonly sublabel: string;
  readonly state: string;
  readonly acting: boolean;
  readonly vacant: boolean;
  readonly seatKind: string | null;
  readonly employeeId: string | null;
  /** Goals only: company goals are the primary strategic objects. */
  readonly goalKind: 'COMPANY' | 'DEPARTMENT' | null;
  /** Goals only: the columns this goal is anchored to (its execution lines on the surface). */
  readonly anchors: readonly number[];
  /** Goals only: the employee node ids whose live work serves this goal (from durable Goal → Work links). */
  readonly workers: readonly string[];
  /** Goals only: completed linked work over all linked work, or null when nothing is linked yet. */
  readonly progress: number | null;
  /** Goals only: the parent company goal's node id for a derived Department goal. */
  readonly parentGoalId: string | null;
  /** Employees only: live work is running for this person right now (a real state). */
  readonly running: boolean;
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

/** A reporting line (the organization's structure, from the seat chain): `from` reports to `to` (`founder` for the CEO). */
export interface ReportEdge {
  readonly from: string;
  readonly to: string;
}

export interface LayoutColumn {
  readonly departmentId: string;
  readonly code: string;
  readonly name: string;
  readonly index: number;
  /** The Director's node (an employee, or the vacant seat), or null when the Department has no Director seat. */
  readonly directorId: string | null;
  /** Everyone else in rank order: Managers / Leads, then Specialists; vacant seats in place. */
  readonly memberIds: readonly string[];
  /** Live people in the column (vacant seats excluded). */
  readonly headcount: number;
}

export interface Layout {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly reports: readonly ReportEdge[];
  readonly columns: readonly LayoutColumn[];
  /** Goals in band order: company goals by state (active first), then Department goals. */
  readonly goals: readonly LayoutNode[];
  readonly attention: readonly LayoutNode[];
  readonly ceoId: string | null;
  readonly byId: ReadonlyMap<string, LayoutNode>;
}

export interface Emphasis {
  /** 0 = quiet (dimmed), 1 = full. */
  readonly nodes: ReadonlyMap<string, number>;
  readonly edges: ReadonlyMap<string, number>;
  /** By departmentId. */
  readonly sectors: ReadonlyMap<string, number>;
  /** Node ids whose captions must show whatever the density (kept for parity with the lens contract). */
  readonly pinnedLabels: ReadonlySet<string>;
  readonly focusNodeId: string | null;
  readonly chain: readonly string[];
}
