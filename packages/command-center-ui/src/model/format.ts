/**
 * One formatting and wording policy for the Founder surface. The application itself speaks English (LTR
 * layout, en-GB numerals and dates, Gregorian calendar, one policy centralized here). Company content —
 * names, objectives, messages — is shown as written: an Arabic message renders right-to-left inside its own
 * block (`dirOf`), never the layout around it. Codes and IDs never reach the Founder's eyes as codes: every
 * table below names the thing in words, and an unknown code falls back to a readable form.
 */
export const LOCALE = 'en-GB-u-ca-gregory';

const numberFormat = new Intl.NumberFormat(LOCALE);
const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' });
const timeOnly = new Intl.DateTimeFormat(LOCALE, { timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

export const fmtNumber = (n: number): string => numberFormat.format(n);
export const fmtMoneyMicros = (micros: number, currency: string): string => new Intl.NumberFormat(LOCALE, { style: 'currency', currency, currencyDisplay: 'code', maximumFractionDigits: 0, signDisplay: 'never' }).format(Math.max(0, Number.isFinite(micros) ? micros : 0) / 1_000_000);

/** "1 department", "3 departments". */
export const plural = (n: number, one: string, other: string): string => `${fmtNumber(n)} ${n === 1 ? one : other}`;
export const fmtDateTime = (iso: string): string => dateTime.format(new Date(iso));
export const fmtDate = (iso: string): string => dateOnly.format(new Date(iso));
export const fmtTime = (iso: string): string => timeOnly.format(new Date(iso));

export function fmtRelative(iso: string, nowMs = Date.now()): string {
  const diff = Date.parse(iso) - nowMs;
  const abs = Math.abs(diff);
  if (abs < 60_000) return relative.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return relative.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return relative.format(Math.round(diff / 3_600_000), 'hour');
  return relative.format(Math.round(diff / 86_400_000), 'day');
}

/** Text direction from the first strong character: Arabic content reads right-to-left inside an English layout. */
export const dirOf = (text: string): 'rtl' | 'ltr' => (/^[^A-Za-z؀-ۿ]*[؀-ۿ]/.test(text) ? 'rtl' : 'ltr');
export const hasArabic = (text: string): boolean => /[؀-ۿ]/.test(text);

export const STATE_LABEL: Readonly<Record<string, string>> = {
  PROPOSED: 'Proposed',
  READY: 'Ready',
  QUEUED: 'Queued',
  RUNNING: 'Running',
  IN_PROGRESS: 'In progress',
  DELEGATED: 'Delegated',
  ACCEPTED: 'Accepted',
  REFUSED: 'Refused',
  REWORK: 'Rework',
  PASS: 'Pass',
  WAITING_REVIEW: 'Waiting for review',
  WAITING_APPROVAL: 'Waiting for approval',
  BLOCKED: 'Blocked',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  APPROVED: 'Approved',
  ACHIEVED: 'Achieved',
  DRAFT: 'Draft',
  VACANT: 'Vacant',
  CANDIDATE: 'Candidate',
  TRAINING: 'Training',
  SHADOW: 'Shadowing',
  PROBATION: 'Probation',
  ON_LEAVE: 'On leave',
  RETRAINING: 'Retraining',
  SUSPENDED: 'Suspended',
  RETIRED: 'Retired',
  PENDING: 'Pending',
  OPEN: 'Open',
  RESOLVED: 'Resolved',
  PRINCIPAL: 'Founder',
};

export const LANE_LABEL: Readonly<Record<string, string>> = { NEEDS_ME: 'Needs me', CEO_BRIEFS: 'CEO briefs', THREADS: 'Conversations' };
export const LEVEL_LABEL: Readonly<Record<string, string>> = { INFORMATIONAL: 'For information', NEEDS_ATTENTION: 'Needs attention', NEEDS_DECISION: 'Decision needed', URGENT: 'Urgent' };
export const SOURCE_LABEL: Readonly<Record<string, string>> = { APPROVAL: 'Approval', STAFFING_REQUEST: 'Staffing request', ESCALATION: 'Escalation', REVIEW_CONFLICT: 'Review conflict', BRIEF: 'Brief', THREAD: 'Conversation', GOAL: 'Goal', DECISION_REQUEST: 'Decision request' };
export const RELATION_LABEL: Readonly<Record<string, string>> = { DELEGATION: 'Delegation', SUPPORT: 'Support', REVIEW: 'Review', APPROVAL: 'Approval', HANDOFF: 'Hand-off', ESCALATION: 'Escalation' };
export const KIND_LABEL: Readonly<Record<string, string>> = { CEO: 'Chief Executive', DIRECTOR: 'Director', MANAGER: 'Manager', LEAD: 'Lead', SPECIALIST: 'Specialist', FOUNDER: 'Founder' };
export const RING_LABEL: Readonly<Record<string, string>> = { CEO: 'CEO', DIRECTOR: 'Directors', MANAGER: 'Managers & Leads', SPECIALIST: 'Specialists' };
export const PURPOSE_LABEL: Readonly<Record<string, string>> = { REQUEST: 'Request', QUESTION: 'Question', FYI: 'For information', REVIEW: 'Review', DECISION_REQUEST: 'Decision request', BLOCKER: 'Blocker', ESCALATION: 'Escalation', RESULT: 'Result', CORRECTION: 'Correction', BRIEF: 'Brief' };

/** The five canonical Departments as the Founder reads them (a Department the Founder creates keeps its own name). */
export const DEPT_LABEL: Readonly<Record<string, string>> = {
  'strategic-market-intelligence': 'Strategic Market Intelligence',
  growth: 'Growth',
  'brand-creative': 'Brand & Creative',
  product: 'Product',
  engineering: 'Engineering',
};
export const deptName = (code: string, name: string): string => DEPT_LABEL[code] ?? name;

/** Approval actions in words; an unknown action code is spelled out from its parts. */
export const ACTION_LABEL: Readonly<Record<string, string>> = {
  'work_item.execute': 'execute a work item',
  'work_item.release': 'release a work item',
  'tool.invoke': 'invoke a tool',
  'budget.change': 'change a budget',
  'employee.activate': 'activate an employee',
};

/** Canonical seat titles (the release seed stores the C4 codes' names); a seat the Founder created keeps its title. */
export const SEAT_TITLE: Readonly<Record<string, string>> = {
  'company.ceo': 'Chief Executive Officer',
  'director.strategic-market-intelligence': 'Director, Strategic Market Intelligence',
  'director.growth': 'Director, Growth',
  'director.brand-creative': 'Director, Brand & Creative',
  'director.product': 'Director, Product',
  'director.engineering': 'Director, Engineering',
  'product.app-store-release-reputation-lead': 'Store Release & Reputation Lead',
};

/** Capabilities in words (the Founder reads what an employee may do, never the grant code). */
export const CAPABILITY_LABEL: Readonly<Record<string, string>> = {
  'model.invoke': 'Model calls',
  'tool:notes.append': 'Notes',
  'tool:publisher.publish': 'Publishing',
  'org.work.delegate': 'Delegating work',
};

/** Founder command intents in words (the activity note and the preview name the act, never its code). */
export const INTENT_LABEL: Readonly<Record<string, string>> = {
  RETURN_TO_LIVE: 'Return to live',
  WHO_WORKS_ON: 'Who works on',
  WHAT_IS_BLOCKED: 'What is blocked',
  NEEDS_MY_APPROVAL: 'Needs my approval',
  SHOW_BRIEFS: 'Show briefs',
  SHOW_TIMELINE: 'Show timeline',
  SHOW_CEO: 'Open the CEO',
  SHOW_GOAL: 'Open a goal',
  SHOW_DEPARTMENT: 'Open a department',
  OPEN_EMPLOYEE: 'Open an employee',
  SHOW_REPORT: 'Show a company report',
  SHOW_PERFORMANCE: 'Show a performance profile',
  SHOW_PILOT: 'Show a pilot',
  SHOW_DIGITAL: 'Show digital work',
  SHOW_PROVIDERS: 'Show model providers',
  APPROVAL_DECIDE: 'Decide an approval',
  GOAL_APPROVE: 'Approve a goal',
  GOAL_STATE: 'Change a goal state',
  GOAL_PROPOSE: 'Propose a goal',
  STAFFING_DECIDE: 'Decide a staffing request',
  CONFLICT_RESOLVE: 'Resolve a review conflict',
  BUDGET_CEILING: 'Set a budget ceiling',
  DELEGATE_WORK: 'Delegate authority',
  TOOL_RECONCILE: 'Settle an uncertain external effect',
  RESERVATION_RECONCILE: 'Settle held money',
  JOB_RECONCILE: 'Decide held work',
  REVIEW_ESCALATION_RESOLVE: 'Resolve an escalated review',
  SYSTEMIC_DECIDE: 'Decide a systemic finding',
  ATTRIBUTION_DECIDE: 'Decide the cause of an outcome',
  LESSON_DECIDE: 'Decide a lesson',
  OUTCOME_VERIFY: 'Verify an outcome',
  PROMOTION_DECIDE: 'Decide sharing a lesson',
  PILOT_CREATE: 'Create a pilot',
  PILOT_ADVANCE: 'Take a pilot step',
  PROVIDER_PROVISION: 'Provision a model provider',
  SHOW_ACTIVATION: 'Activate the Company',
  EMPLOYEE_HIRE: 'Hire into a seat (candidate)',
  EMPLOYEE_LIFECYCLE: 'Move a trainee',
  EMPLOYEE_MODEL_ACCESS: 'Open an envelope and model access',
  SKILL_PACKAGE_QUALIFY: 'Qualify an Academy package',
  ACADEMY_PACKAGE_INSTALL: 'Install an Academy package',
  ACADEMY_ENROLL: 'Enroll in the Academy',
  ACADEMY_MODULES_COMPLETE: 'Acknowledge curriculum modules',
  ACADEMY_ATTEMPT_START: 'Start an Academy attempt',
  ACADEMY_EVALUATE: 'Evaluate an Academy attempt',
  ACADEMY_RETRAIN_COMPLETE: 'Confirm retraining',
  ACADEMY_SHADOW_ASSIGN: 'Assign shadow work',
  ACADEMY_PROBATION_EVIDENCE: 'Record probation evidence',
  ACADEMY_PROBATION_REVIEW: 'Decide the probation review',
  ACADEMY_CALIBRATION: 'Founder Calibration',
  ACTIVATION_DECIDE: 'Decide the activation',
};

/** Decisions and outcomes in a preview, in words. */
export const DECISION_LABEL: Readonly<Record<string, string>> = {
  APPROVE: 'Approve',
  REJECT: 'Reject',
  PASS: 'Pass',
  REWORK: 'Send back for rework',
  VALIDATE: 'Validate',
  ADDRESSED: 'Addressed',
  RELEASE: 'Release',
  CHARGE: 'Charge',
  RETRY: 'Retry',
  CONFIRMED_COMPLETED: 'Completed',
  FAILED: 'Failed',
  CONFIRMED_SUCCEEDED: 'It happened',
  CONFIRMED_NOT_EXECUTED: 'It did not happen',
  ACHIEVED: 'Achieved',
  NOT_ACHIEVED: 'Not achieved',
  INCONCLUSIVE: 'Inconclusive',
};

/** Preview payload fields in words; a field this table does not know is spelled out from its code. */
export const FIELD_LABEL: Readonly<Record<string, string>> = {
  approvalId: 'Approval',
  decision: 'Decision',
  reasonCode: 'Reason',
  goalId: 'Goal',
  activate: 'Activate now',
  to: 'New state',
  budgetId: 'Budget',
  capMoney: 'Money ceiling',
  capTokens: 'Token ceiling',
  currency: 'Currency',
  scope: 'Scope',
  scopeId: 'Budget holder',
  requestId: 'Staffing request',
  conflictId: 'Conflict',
  employeeId: 'Employee',
  capability: 'Capability',
  expiresAt: 'Expires',
  purposeCode: 'Purpose',
  outcome: 'What happened',
  verdict: 'Verdict',
  inputTokens: 'Input tokens',
  outputTokens: 'Output tokens',
  evidenceClasses: 'Evidence',
  evidenceRefs: 'Evidence records',
  risk: 'Risk',
  target: 'Shared with',
  title: 'Goal',
  mode: 'Pilot mode',
  from: 'From',
  requiresExternalOutcome: 'Needs real-world evidence',
  answeredBriefingRequests: 'Briefing requests answered',
  unansweredBriefingRequests: 'Briefing requests unanswered',
  successCriteria: 'Success criteria',
};

/** C7-C: Pilot modes, readiness criteria and evidence states in words (advisory evidence, never a score). */
/** C7-D: where one exact external act stands (derived from its review, the Founder's approval and its execution). */
export const PROMOTION_STATE_LABEL: Readonly<Record<string, string>> = { PREPARED: 'Prepared', UNDER_REVIEW: 'Under independent review', REVIEW_REJECTED: 'Rework requested by review', READY_FOR_FOUNDER: 'Waiting for your decision', REJECTED: 'You rejected it', APPROVED: 'Approved, not yet done', EXECUTING: 'In progress', PROMOTED: 'Done (provider confirmed)', FAILED: 'Failed', RECONCILIATION_REQUIRED: 'Outcome uncertain — needs reconciliation', STALE: 'No longer valid' };
export const PROMOTION_KIND_LABEL: Readonly<Record<string, string>> = { EXPORT_SOURCE: 'Export source to the code host', MERGE_PRODUCTION: 'Merge to production', PREVIEW_EXTERNAL: 'External preview', PUBLISH_PRODUCTION: 'Publish to production', ROLLBACK_PRODUCTION: 'Roll production back', SOCIAL_PUBLISH: 'Publish a social post' };
export const PILOT_MODE_LABEL: Readonly<Record<string, string>> = { TRAINING_INTERNAL: 'Internal training', CONTROLLED_REAL: 'Controlled real-world' };
export const READINESS_LABEL: Readonly<Record<string, string>> = { FOUNDER_DIALOGUE: 'Founder dialogue', GOAL_DECOMPOSITION: 'Goal decomposition', CROSS_DEPARTMENT_EXECUTION: 'Cross-department execution', REVIEW_DISCIPLINE: 'Review discipline', APPROPRIATE_AUTONOMY: 'Appropriate autonomy', LEARNING_CLOSURE: 'Learning closure', COST_DISCIPLINE: 'Cost discipline', REAL_WORLD_OUTCOME: 'Real-world outcome' };
export const EVIDENCE_LABEL: Readonly<Record<string, string>> = { INSUFFICIENT_EVIDENCE: 'Not enough evidence yet', SUPPORTED: 'Supported by evidence', CONCERN: 'Concern', CONTESTED: 'Contested', NOT_APPLICABLE: 'Not applicable' };
export const PILOT_DECISION_LABEL: Readonly<Record<string, string>> = { START_BRIEFING: 'Start the briefing with the CEO', ASK_CEO_A_BRIEFING_REQUEST: 'Ask the CEO a question or request in the briefing', AWAITING_GOVERNED_REPLY: 'Waiting for the CEO’s reply (silence is not agreement)', DECIDE_READY: 'Decide whether the pilot is ready', APPROVE_ROOT_COMPANY_GOAL_WITH_SUCCESS_CRITERIA: 'Approve a company goal with success criteria', DECIDE_ACTIVE_ON_ROOT_GOAL: 'Decide whether to activate the pilot on its goal', DECIDE_OPEN_PILOT_ATTENTION_ITEMS: 'Decide the pilot’s open items', DECIDE_COMPLETION: 'Decide whether the pilot is complete' };
export const MARKET_CLAIM_LABEL: Readonly<Record<string, string>> = { NOT_CLAIMABLE_TRAINING_INTERNAL: 'Internal training: no market claim', NOT_SUPPORTED: 'No governed real-world evidence yet', SUPPORTED_BY_GOVERNED_EVIDENCE: 'Supported by governed real-world evidence', CONTESTED: 'Contested by a later evidence conflict' };

export const SCOPE_LABEL: Readonly<Record<string, string>> = { EMPLOYEE: 'Employee', DEPARTMENT: 'Department', COMPANY: 'Company', WORK_ITEM: 'Work item' };
export const RESULT_LABEL: Readonly<Record<string, string>> = {
  budget: 'budget ceiling',
  approval: 'approval',
  goal: 'goal',
  staffing_request: 'staffing request',
  review_conflict: 'review conflict',
  authority_delegation: 'authority delegation',
  tool_invocation: 'external effect',
  budget_reservation: 'held money',
  queue_job: 'held work',
  review_request: 'escalated review',
  systemic_finding: 'systemic finding',
  causal_attribution: 'cause of an outcome',
  lesson: 'lesson',
  outcome_verification: 'outcome verification',
  lesson_promotion: 'lesson sharing',
  pilot: 'pilot',
  provider: 'model provider',
  employee: 'employee',
  academy_package: 'Academy package',
  academy_enrollment: 'Academy enrollment',
  academy_attempt: 'Academy attempt',
  academy_remediation: 'retraining',
  probation_review: 'probation review',
  activation_request: 'activation decision',
  work_item: 'shadow work',
};
export const CALENDAR_LABEL: Readonly<Record<string, string>> = { ACTING_ENDS: 'Acting cover ends', DELEGATION_DUE: 'Delegation due', STAFFING_DECISION_DUE: 'Staffing decision due', GOAL_HORIZON: 'Goal horizon', WORK_DUE: 'Work due', APPROVAL_EXPIRES: 'Approval expires', SESSION_EXPIRES: 'Your session ends', PUBLICATION_WINDOW: 'Publication window (exact, approved per post)' };

/** A table lookup that never leaks a code: unknown codes become readable words ("work_item.execute" → "work item execute"). */
export const t = (table: Readonly<Record<string, string>>, code: string): string => table[code] ?? humanize(code);
export const humanize = (code: string): string => {
  const words = code.replace(/^(?:role|tool|employee|goal|seat|department|work_item|approval|thread|message):/, '').replace(/[._:-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
};
