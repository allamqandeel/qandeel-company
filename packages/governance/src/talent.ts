/**
 * COMPANY-TALENT-01 — the pure contract of universal staffing, the Talent Catalog, leadership access policies, the
 * Company-documents source and Tool readiness (no I/O here).
 *
 * Nothing in this module grants anything by itself:
 * - A leadership access policy is a Founder-approved template (D-TALENT-02..04): once the Founder approves it, the
 *   datastore issues ONE explicit, individual, auditable and revocable grant per eligible seat holder, inside the
 *   Founder act that makes the holder eligible, and revokes it inside the act that ends the eligibility. A title alone
 *   never grants: eligibility is holding a PRIMARY CEO or Director seat in an eligible lifecycle state.
 * - A proposal right (`org.*.propose`, staffing request / review) lets a leader PROPOSE; it never decides, hires,
 *   spends or certifies — those stay Founder acts or explicit, bounded delegations.
 * - A Tool requirement of a role is metadata: readiness is derived from the Tool Registry, the host's drivers and the
 *   vault, and a Skill certification never asserts a Tool capability that was not assessed.
 */
import { QandeelError } from '@qandeel-company/domain';

import type { EmployeeState } from './employee.js';
import { PRODUCT_DOCS_CAPABILITY, PRODUCT_KNOWLEDGE_TOOL } from './product-knowledge.js';

// --- The Founder intents of this boundary (structured-only; no text produces them) -----------------------------------

/**
 * COMPANY-TALENT-01: the Talent Catalog decisions (approve / reject a submitted identity profile or Academy program
 * definition; accept / decline a leader's proposal), the organization acts (a new seat in an existing Department, a
 * Department budget), an Employee's identity revision, the leadership access policies, a role's Tool requirements and
 * the grant of a registered Tool, retraining an ACTIVE Employee, and the scalable Academy evaluation (a qualified
 * manager's evaluation assignment and its independent review). Structured-only: a form posts IDs / codes.
 */
export const TALENT_INTENTS = [
  'TALENT_DEFINITION_DECIDE',
  'TALENT_PROPOSAL_DECIDE',
  'EMPLOYEE_IDENTITY_REVISE',
  'POSITION_CREATE',
  'DEPARTMENT_BUDGET',
  'ACCESS_POLICY_DECIDE',
  'ROLE_TOOL_REQUIREMENT',
  'TOOL_ACCESS',
  'EMPLOYEE_RETRAIN',
  'ACADEMY_EVALUATION_ASSIGN',
  'ACADEMY_EVALUATION_REVIEW',
] as const;
export type TalentIntent = (typeof TALENT_INTENTS)[number];
export const isTalentIntent = (v: unknown): v is TalentIntent => typeof v === 'string' && (TALENT_INTENTS as readonly string[]).includes(v);

// --- The Talent Catalog -----------------------------------------------------------------------------------------------

export const DEFINITION_KINDS = ['IDENTITY_PROFILE', 'ACADEMY_PROGRAM'] as const;
export type DefinitionKind = (typeof DEFINITION_KINDS)[number];
/** DRAFT (editable) → SUBMITTED (frozen content) → APPROVED (in use) | REJECTED; an APPROVED version is SUPERSEDED by its successor. */
export const DEFINITION_STATES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN'] as const;
export type DefinitionState = (typeof DEFINITION_STATES)[number];

/** What a leader may propose through `talent.propose` (a proposal decides nothing). */
export const TALENT_PROPOSAL_KINDS = ['IDENTITY_PROFILE', 'ACADEMY_PROGRAM', 'SKILL', 'RETRAIN', 'DEPARTMENT_BUDGET'] as const;
export type TalentProposalKind = (typeof TALENT_PROPOSAL_KINDS)[number];

// --- Seats and staffing ------------------------------------------------------------------------------------------------

/** D7: one approved staffing request may open several identical seats (each with its own Employee and record). */
export const STAFFING_HEADCOUNT_MAX = 10;

export function assertHeadcount(v: unknown, field = 'headcount'): number {
  if (v === undefined || v === null) return 1;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > STAFFING_HEADCOUNT_MAX) throw new QandeelError('VALIDATION_FAILED', `${field} is 1..${STAFFING_HEADCOUNT_MAX} identical seats`, { field });
  return v;
}

// --- Leadership access policies (D2 / D3 / D4 / D5) ---------------------------------------------------------------------

/** The Company documents source (D3): the Company's own organizational and administrative documentation, read-only. */
export const COMPANY_KNOWLEDGE_TOOL = 'company-knowledge';
export const COMPANY_DOCS_READ_ACTION = 'company-docs-read';
export const COMPANY_DOCS_ADAPTER = 'github.company-docs';
export const COMPANY_SOURCE_TARGET_CODE = 'company-knowledge-source';
export const COMPANY_DOCS_CAPABILITY = `tool:${COMPANY_KNOWLEDGE_TOOL}.${COMPANY_DOCS_READ_ACTION}`;

/** The proposal and evaluation rights (org acts are R1 on `*`, like every organizational act). */
export const TALENT_PROPOSE_CAPABILITY = 'org.talent.propose';
export const ACADEMY_EVALUATE_CAPABILITY = 'org.academy.evaluate';
export const ACADEMY_REVIEW_CAPABILITY = 'org.academy.review';

export const POLICY_SEAT_KINDS = ['CEO', 'DIRECTOR'] as const;
export type PolicySeatKind = (typeof POLICY_SEAT_KINDS)[number];

/** D2: a policy grant may exist from CANDIDATE; it is revoked on SUSPENDED or RETIRED (and when the seat is left). */
export const POLICY_INELIGIBLE_STATES: readonly EmployeeState[] = ['SUSPENDED', 'RETIRED'];

export interface PolicyGrantTemplate {
  readonly capability: string;
  readonly resourceScope: string;
  readonly riskCeiling: 'R0' | 'R1';
  readonly dataClassCeiling: 'D1' | 'D2';
  /** Which seat kinds receive this grant. */
  readonly seats: readonly PolicySeatKind[];
}

export interface AccessPolicyTemplate {
  readonly code: string;
  readonly title: string;
  readonly grants: readonly PolicyGrantTemplate[];
  /** The registered source this policy's Tool reads (approved with the policy when not yet registered). */
  readonly source: 'PRODUCT' | 'COMPANY' | null;
}

/**
 * The four policy templates the Founder may approve (COMPANY-TALENT-01 D2–D5). A template is a product decision recorded
 * in code; whether it is in force is a Founder act recorded as data (`access_policies`), and every grant it issues is an
 * individual `permission_grants` row linked to it.
 */
export const ACCESS_POLICY_TEMPLATES: readonly AccessPolicyTemplate[] = Object.freeze([
  {
    code: 'leadership.app-knowledge',
    title: 'Read the QANDEEL App documentation (R0, read-only)',
    grants: [{ capability: PRODUCT_DOCS_CAPABILITY, resourceScope: PRODUCT_KNOWLEDGE_TOOL, riskCeiling: 'R0', dataClassCeiling: 'D2', seats: ['CEO', 'DIRECTOR'] }],
    source: 'PRODUCT',
  },
  {
    code: 'leadership.company-knowledge',
    title: 'Read the QANDEEL COMPANY organizational documents (R0, read-only)',
    grants: [{ capability: COMPANY_DOCS_CAPABILITY, resourceScope: COMPANY_KNOWLEDGE_TOOL, riskCeiling: 'R0', dataClassCeiling: 'D2', seats: ['CEO', 'DIRECTOR'] }],
    source: 'COMPANY',
  },
  {
    code: 'leadership.proposals',
    title: 'Propose staffing, skills, retraining and development (proposal only)',
    grants: [
      { capability: 'org.staffing.request', resourceScope: '*', riskCeiling: 'R1', dataClassCeiling: 'D1', seats: ['CEO', 'DIRECTOR'] },
      { capability: 'org.staffing.review', resourceScope: '*', riskCeiling: 'R1', dataClassCeiling: 'D1', seats: ['CEO'] },
      { capability: TALENT_PROPOSE_CAPABILITY, resourceScope: '*', riskCeiling: 'R1', dataClassCeiling: 'D1', seats: ['CEO', 'DIRECTOR'] },
    ],
    source: null,
  },
  {
    code: 'leadership.academy-evaluation',
    title: 'Evaluate direct reports in the Academy and review evaluations (qualified managers only)',
    grants: [
      { capability: ACADEMY_EVALUATE_CAPABILITY, resourceScope: '*', riskCeiling: 'R1', dataClassCeiling: 'D1', seats: ['CEO', 'DIRECTOR'] },
      { capability: ACADEMY_REVIEW_CAPABILITY, resourceScope: '*', riskCeiling: 'R1', dataClassCeiling: 'D1', seats: ['CEO', 'DIRECTOR'] },
    ],
    source: null,
  },
]);

export const accessPolicyTemplate = (code: unknown): AccessPolicyTemplate | null => ACCESS_POLICY_TEMPLATES.find((t) => t.code === code) ?? null;

/** Whether a seat holder is eligible for a policy grant (D2: PRIMARY CEO / Director seat, eligible lifecycle state). */
export function policyEligible(seatKind: string, assignmentKind: string, state: EmployeeState, grant: PolicyGrantTemplate): boolean {
  return assignmentKind === 'PRIMARY' && (grant.seats as readonly string[]).includes(seatKind) && !POLICY_INELIGIBLE_STATES.includes(state);
}

// --- The Company documents source (D3) ----------------------------------------------------------------------------------

/** The documents read when no path is named (the Company's own reading order). */
export const COMPANY_LOCATOR_DOCS: readonly string[] = Object.freeze(['docs/authority/COMPANY_CANONICAL_BASELINE.md', 'docs/authority/company-architecture/README.md', 'README.md']);

/**
 * The closed source list (D3): the repository README and the Company's organizational authority under `docs/authority/`
 * (constitution, stages, decision registers). Never code, configuration, workflows, engineering reports, hidden files or
 * a path that climbs. The repository carries no secret by rule; this list keeps the reader inside the organizational
 * documents even so.
 */
export function isCompanyDocPath(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 200) return false;
  if (v.includes('..') || v.includes('//') || v.includes('\\') || /(^|\/)\./.test(v)) return false;
  return v === 'README.md' || /^docs\/authority\/[A-Za-z0-9][A-Za-z0-9._/-]{0,170}\.md$/.test(v);
}

/** The Tool Registry definition of the read (R0, no side effect, no credential; the result is public Company documentation). */
export const COMPANY_DOCS_ACTION_DEFINITION = Object.freeze({ code: COMPANY_DOCS_READ_ACTION, risk: 'R0' as const, sideEffects: 'NONE' as const, mutatesExternal: false, dataClassCeiling: 'D2' as const, resultDataClass: 'D1' as const, argsSchema: Object.freeze({ fields: Object.freeze({ query: Object.freeze({ type: 'string' as const, required: true, maxLength: 200 }), path: Object.freeze({ type: 'string' as const, required: false, maxLength: 200 }) }) }), costPerCallMicros: 0 });

// --- Tool readiness of a role (COMPANY-TALENT-01 D) -------------------------------------------------------------------

/**
 * The honest state of one Tool a role needs:
 * - NOT_REGISTERED: no such Tool in the Registry (no adapter has been built or registered);
 * - NOT_INTEGRATED: registered, but this host has no driver for it (the adapter is missing);
 * - AWAITING_CONNECTION: integrated, but the authorized account / credential is not connected;
 * - ON_HOLD: the Tool or its action is held or retired;
 * - READY: registered, integrated, connected and active (an Employee still needs its own grant).
 */
export const TOOL_READINESS = ['NOT_REGISTERED', 'NOT_INTEGRATED', 'AWAITING_CONNECTION', 'ON_HOLD', 'READY'] as const;
export type ToolReadiness = (typeof TOOL_READINESS)[number];


/** The scope a certification states for each Tool the role needs (a Skill certificate never claims an unassessed Tool). */
export const TOOL_SCOPE_STATUSES = ['ASSESSED', 'NOT_ASSESSED'] as const;
