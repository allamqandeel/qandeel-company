/**
 * FounderActionStore — the governed confirmation boundary (C5 §11.3 / §15, Stage 14 D14-A.6).
 *
 * A mutating intent (from the command palette or a brief's "decision needed") becomes a structured PREVIEW
 * bound to the Founder's session: intent kind, a validated payload of IDs / codes / bounded numbers, a
 * fingerprint and an expiry. Confirming means presenting the preview id AND its fingerprint from a verified
 * session with a matching CSRF secret; only then does `confirm` call the real authority boundary (the C2
 * approval engine, the Goal store, the C4 organization / review stores) — never a text-derived call.
 *
 * Previews grant nothing, never widen an intent, and R4 (Founder-only sovereignty) is never offered as an
 * approvable action: a Founder decides R4 work outside the approval engine, as before.
 */
import { QandeelError, assertCode, assertId, boundedJson, canonicalJson, isTimestamp, newId, sha256Hex, type Id, type Timestamp } from '@qandeel-company/domain';
import { isGoalState, isMutatingIntent, type GoalState, type MutatingIntent } from '@qandeel-company/governance';

import { getBudgetRow, budgetFor } from './governance-core.js';
import { GovernanceStore } from './governance.js';
import { getGoal, GoalStore } from './goals.js';
import { mapActionPreview, type ActionPreviewRecord } from './founder-records.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { OrganizationStore } from './organization.js';
import { getStaffingRequest } from './organization.js';
import { ReviewStore } from './review.js';
import { storeContext, type CompanyStore } from './store.js';
import type { FounderAuthStore, FounderSession } from './founder-auth.js';

export const PREVIEW_TTL_MS = 10 * 60_000;

type Payload = Record<string, string | number | boolean | null>;

const later = (at: Timestamp, ms: number): Timestamp => new Date(Date.parse(at) + ms).toISOString() as Timestamp;

/** Validates one intent's payload against durable state. Returns the canonical (re-shaped) payload. */
function validatePayload(ctx: StoreContext, intent: MutatingIntent, raw: Record<string, unknown>): Payload {
  const s = (k: string, max = 161): string => {
    const v = raw[k];
    if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) throw new QandeelError('VALIDATION_FAILED', `${k} is required`, { field: k });
    return v;
  };
  switch (intent) {
    case 'APPROVAL_DECIDE': {
      const approvalId = assertId(raw.approvalId, 'approvalId');
      const decision = raw.decision;
      if (decision !== 'APPROVE' && decision !== 'REJECT') throw new QandeelError('VALIDATION_FAILED', 'decision is APPROVE or REJECT', { field: 'decision' });
      const a = ctx.db.get<{ state: string; risk_level: string; subject_ref: string; action: string }>('SELECT state, risk_level, subject_ref, action FROM approvals WHERE id = ?', approvalId);
      if (!a) throw new QandeelError('NOT_FOUND', 'approval not found', { approvalId });
      if (a.state !== 'PENDING') throw new QandeelError('INVALID_TRANSITION', 'only a pending approval can be decided', { approvalId, state: a.state });
      if (a.risk_level === 'R4' || a.risk_level === 'R2') throw new QandeelError('FOUNDER_ONLY', 'R4 is never approvable through the approval engine and R2 is review-only', { approvalId, risk: a.risk_level });
      return { approvalId, decision, reasonCode: assertCode(raw.reasonCode ?? 'founder.decided', 'reasonCode'), risk: a.risk_level, subjectRef: a.subject_ref, action: a.action.slice(0, 64) };
    }
    case 'GOAL_APPROVE': {
      const g = getGoal(ctx, assertId(raw.goalId, 'goalId'));
      if (g.kind !== 'COMPANY' || (g.state !== 'PROPOSED' && g.state !== 'DRAFT')) throw new QandeelError('GOAL_INVALID', 'only a proposed company goal is approved', { goalId: g.id, state: g.state });
      return { goalId: g.id, to: raw.activate === true ? 'ACTIVE' : 'APPROVED', reasonCode: assertCode(raw.reasonCode ?? 'goal.approved', 'reasonCode'), title: g.title.slice(0, 120) };
    }
    case 'GOAL_STATE': {
      const g = getGoal(ctx, assertId(raw.goalId, 'goalId'));
      const to = raw.to;
      if (!isGoalState(to)) throw new QandeelError('VALIDATION_FAILED', 'unknown goal state', { field: 'to' });
      return { goalId: g.id, to, reasonCode: assertCode(raw.reasonCode ?? 'goal.state', 'reasonCode'), title: g.title.slice(0, 120) };
    }
    case 'GOAL_PROPOSE': {
      const kind = raw.kind === 'DEPARTMENT' ? 'DEPARTMENT' : 'COMPANY';
      const departmentId = kind === 'DEPARTMENT' ? assertId(raw.departmentId, 'departmentId') : null;
      const parentGoalId = kind === 'DEPARTMENT' ? assertId(raw.parentGoalId, 'parentGoalId') : null;
      const horizonTo = raw.horizonTo === undefined || raw.horizonTo === null ? null : raw.horizonTo;
      if (horizonTo !== null && !isTimestamp(horizonTo)) throw new QandeelError('VALIDATION_FAILED', 'horizonTo must be a canonical UTC timestamp', { field: 'horizonTo' });
      return { kind, departmentId, parentGoalId, title: s('title', 160), summary: s('summary', 2000), ownerRef: s('ownerRef'), horizonTo: horizonTo as string | null, activate: raw.activate === true };
    }
    case 'STAFFING_DECIDE': {
      const r = getStaffingRequest(ctx, assertId(raw.requestId, 'requestId'));
      const decision = raw.decision;
      if (decision !== 'APPROVE' && decision !== 'REJECT') throw new QandeelError('VALIDATION_FAILED', 'decision is APPROVE or REJECT', { field: 'decision' });
      if (r.state !== 'RECOMMENDED' && r.state !== 'CONSOLIDATED') throw new QandeelError('INVALID_TRANSITION', 'the Founder decides a recommended request', { requestId: r.id, state: r.state });
      return { requestId: r.id, decision, reasonCode: assertCode(raw.reasonCode ?? 'founder.decided', 'reasonCode'), positionKind: r.positionKind };
    }
    case 'CONFLICT_RESOLVE': {
      const id = assertId(raw.conflictId, 'conflictId');
      const c = ctx.db.get<{ state: string }>('SELECT state FROM review_conflicts WHERE id = ?', id);
      if (!c) throw new QandeelError('NOT_FOUND', 'review conflict not found', { conflictId: id });
      if (c.state !== 'OPEN') throw new QandeelError('INVALID_TRANSITION', 'the conflict is already resolved', { conflictId: id });
      const resolution = raw.resolution;
      if (resolution !== 'PASS' && resolution !== 'REWORK') throw new QandeelError('VALIDATION_FAILED', 'resolution is PASS or REWORK', { field: 'resolution' });
      return { conflictId: id, resolution, reasonCode: assertCode(raw.reasonCode ?? 'founder.resolved', 'reasonCode') };
    }
    case 'BUDGET_CEILING': {
      const budgetId = assertId(raw.budgetId, 'budgetId');
      const b = getBudgetRow(ctx, budgetId);
      const capMoney = raw.capMoney;
      const capTokens = raw.capTokens ?? b.capTokens;
      if (typeof capMoney !== 'number' || !Number.isInteger(capMoney) || capMoney < 0 || capMoney > 1_000_000_000_000_000) throw new QandeelError('VALIDATION_FAILED', 'capMoney is an integer amount in micro-units', { field: 'capMoney' });
      if (typeof capTokens !== 'number' || !Number.isInteger(capTokens) || capTokens < 0) throw new QandeelError('VALIDATION_FAILED', 'capTokens is an integer', { field: 'capTokens' });
      const currency = raw.currency ?? b.currency;
      if (currency !== b.currency) throw new QandeelError('CURRENCY_MISMATCH', 'the ceiling must be stated in the budget\'s currency', { budgetId, currency: b.currency });
      return { budgetId, scope: b.scope, scopeId: b.scopeId, currency: b.currency, capMoney, capTokens, reasonCode: assertCode(raw.reasonCode ?? 'founder.ceiling', 'reasonCode') };
    }
    case 'DELEGATE_WORK': {
      // Founder-originated authority delegation (C4): a capability grant, bounded and reviewed; never work delegation by text.
      const employeeId = assertId(raw.employeeId, 'employeeId');
      const capability = s('capability', 96);
      const expiresAt = raw.expiresAt;
      if (!isTimestamp(expiresAt) || expiresAt <= ts(ctx)) throw new QandeelError('VALIDATION_FAILED', 'expiresAt must be a future canonical UTC timestamp', { field: 'expiresAt' });
      if (!ctx.db.get('SELECT 1 AS ok FROM employees WHERE id = ?', employeeId)) throw new QandeelError('NOT_FOUND', 'employee not found', { employeeId });
      return { employeeId, capability, expiresAt, purposeCode: assertCode(raw.purposeCode ?? 'founder.delegation', 'purposeCode'), reasonCode: assertCode(raw.reasonCode ?? 'founder.delegated', 'reasonCode') };
    }
    default:
      throw new QandeelError('VALIDATION_FAILED', 'unknown intent', { field: 'intent' });
  }
}

function getPreview(ctx: StoreContext, id: Id): ActionPreviewRecord {
  const r = ctx.db.get('SELECT * FROM founder_action_previews WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'action preview not found', { previewId: id });
  return mapActionPreview(r);
}

export interface ConfirmResult {
  readonly preview: ActionPreviewRecord;
  readonly resultRef: string;
}

export class FounderActionStore {
  readonly #store: CompanyStore;
  readonly #auth: FounderAuthStore;

  private constructor(store: CompanyStore, auth: FounderAuthStore) {
    this.#store = store;
    this.#auth = auth;
  }

  static for(store: CompanyStore, auth: FounderAuthStore): FounderActionStore {
    return new FounderActionStore(store, auth);
  }

  /** One write transaction; an optional `onRefusal` runs (in its own transaction) after a typed refusal rolled back. */
  #write<T>(operation: string, fn: (ctx: StoreContext) => T, onRefusal?: (code: string) => void): T {
    const ctx = storeContext(this.#store);
    try {
      return ctx.db.immediate(operation, () => fn(ctx));
    } catch (error) {
      if (onRefusal && error instanceof QandeelError && error.code === 'FOUNDER_CONFIRMATION_REQUIRED') {
        try {
          onRefusal(String(error.details.reason ?? 'REFUSED'));
        } catch {
          // Auditing a refusal never masks the refusal itself.
        }
      }
      throw error;
    }
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  /** Creates a preview for a verified session. Validation reads durable state; nothing is mutated. */
  preview(session: FounderSession, intent: unknown, payload: unknown): ActionPreviewRecord {
    return this.#write('founder action preview', (ctx) => {
      if (!isMutatingIntent(intent)) throw new QandeelError('VALIDATION_FAILED', 'unknown mutating intent', { field: 'intent' });
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new QandeelError('VALIDATION_FAILED', 'payload must be an object', { field: 'payload' });
      const canonical = validatePayload(ctx, intent, payload as Record<string, unknown>);
      const id = newId();
      const at = ts(ctx);
      const fingerprint = sha256Hex(canonicalJson({ v: 1, intent, payload: canonical, session: session.id }));
      ctx.db.run(
        `INSERT INTO founder_action_previews (id, session_id, intent_kind, payload_json, fingerprint, state, result_ref, result_code, created_at, expires_at, decided_at) VALUES (?, ?, ?, ?, ?, 'PREVIEW', NULL, NULL, ?, ?, NULL)`,
        id, session.id, intent, boundedJson(canonical, 'payload', 4096), fingerprint, at, later(at, PREVIEW_TTL_MS),
      );
      appendAudit(ctx, 'founder.action_previewed', 'founder_action', id, { actorRef: session.founderRef }, 'OK', intent, { sessionId: session.id });
      return getPreview(ctx, id);
    });
  }

  /**
   * Confirms exactly one preview: same session, same fingerprint, not expired. The real boundary is called
   * inside the Founder session scope; the outcome (a record ref or a refusal code) is durable on the preview.
   */
  confirm(session: FounderSession, previewId: string, fingerprint: unknown): ConfirmResult {
    // A stale preview is expired durably first (its own transaction), then refused.
    this.#write('expire stale preview', (ctx) => {
      const id = assertId(previewId, 'previewId');
      const now = ts(ctx);
      ctx.db.run(`UPDATE founder_action_previews SET state = 'EXPIRED', decided_at = ?, result_code = 'EXPIRED' WHERE id = ? AND state = 'PREVIEW' AND expires_at <= ?`, now, id, now);
    });
    const p = this.#write('founder action check', (ctx) => {
      const preview = getPreview(ctx, assertId(previewId, 'previewId'));
      const refuse = (code: string): never => {
        // The refusal is audited in its own transaction below (this one rolls back with the throw).
        throw new QandeelError('FOUNDER_CONFIRMATION_REQUIRED', 'the action was not confirmed', { reason: code, previewId: preview.id });
      };
      if (preview.sessionId !== session.id) refuse('SESSION_MISMATCH');
      if (preview.state !== 'PREVIEW') refuse(`ALREADY_${preview.state}`);
      if (typeof fingerprint !== 'string' || fingerprint !== preview.fingerprint) refuse('FINGERPRINT_MISMATCH');
      return preview;
    }, (code) => this.#write('audit refused confirmation', (ctx) => appendAudit(ctx, 'founder.action_refused', 'founder_action', String(previewId).slice(0, 36), { actorRef: session.founderRef }, 'REJECTED', code, { sessionId: session.id })));
    let resultRef: string;
    try {
      resultRef = this.#auth.withSession(session, (founderRef) => this.#execute(founderRef, p));
    } catch (error) {
      const code = error instanceof QandeelError ? error.code : 'UNCLASSIFIED_ERROR';
      this.#write('founder action failed', (ctx) => {
        ctx.db.run(`UPDATE founder_action_previews SET state = 'FAILED', decided_at = ?, result_code = ? WHERE id = ? AND state = 'PREVIEW'`, ts(ctx), code.slice(0, 64), p.id);
        appendAudit(ctx, 'founder.action_failed', 'founder_action', p.id, { actorRef: session.founderRef }, 'ERROR', code.slice(0, 64), { intent: p.intentKind });
      });
      throw error;
    }
    const preview = this.#write('founder action confirmed', (ctx) => {
      ctx.db.run(`UPDATE founder_action_previews SET state = 'CONFIRMED', decided_at = ?, result_ref = ?, result_code = 'DONE' WHERE id = ? AND state = 'PREVIEW'`, ts(ctx), resultRef, p.id);
      appendAudit(ctx, 'founder.action_confirmed', 'founder_action', p.id, { actorRef: session.founderRef }, 'OK', p.intentKind, { resultRef: resultRef.slice(0, 128) });
      return getPreview(ctx, p.id);
    });
    return { preview, resultRef };
  }

  /** Executes a confirmed preview at its real boundary (inside the session scope; each call is its own transaction). */
  #execute(founderRef: string, p: ActionPreviewRecord): string {
    const pl = p.payload;
    const str = (k: string): string => String(pl[k]);
    switch (p.intentKind) {
      case 'APPROVAL_DECIDE': {
        const a = GovernanceStore.for(this.#store).decideApproval(founderRef, str('approvalId'), { decision: pl.decision as 'APPROVE' | 'REJECT', reasonCode: str('reasonCode') });
        return `approval:${a.id}`;
      }
      case 'GOAL_APPROVE': {
        const goals = GoalStore.for(this.#store);
        const g = getGoal(storeContext(this.#store), str('goalId') as Id);
        let cur = g;
        if (cur.state === 'DRAFT') cur = goals.transition(founderRef, cur.id, { to: 'PROPOSED', reasonCode: str('reasonCode') });
        cur = goals.transition(founderRef, cur.id, { to: 'APPROVED', reasonCode: str('reasonCode') });
        if (pl.to === 'ACTIVE') cur = goals.transition(founderRef, cur.id, { to: 'ACTIVE', reasonCode: str('reasonCode') });
        return `goal:${cur.id}`;
      }
      case 'GOAL_STATE': {
        const g = GoalStore.for(this.#store).transition(founderRef, str('goalId'), { to: pl.to as GoalState, reasonCode: str('reasonCode') });
        return `goal:${g.id}`;
      }
      case 'GOAL_PROPOSE': {
        const goals = GoalStore.for(this.#store);
        let g = goals.propose(founderRef, { kind: pl.kind as 'COMPANY' | 'DEPARTMENT', departmentId: pl.departmentId as string | null, parentGoalId: pl.parentGoalId as string | null, title: str('title'), summary: str('summary'), ownerRef: str('ownerRef'), horizonTo: pl.horizonTo as string | null });
        if (pl.activate === true) {
          g = goals.transition(founderRef, g.id, { to: 'APPROVED', reasonCode: 'goal.approved' });
          g = goals.transition(founderRef, g.id, { to: 'ACTIVE', reasonCode: 'goal.activated' });
        }
        return `goal:${g.id}`;
      }
      case 'STAFFING_DECIDE': {
        const r = OrganizationStore.for(this.#store).decideStaffingRequest(founderRef, str('requestId'), { decision: pl.decision as 'APPROVE' | 'REJECT', reasonCode: str('reasonCode') });
        return `staffing_request:${r.id}`;
      }
      case 'CONFLICT_RESOLVE': {
        const c = ReviewStore.for(this.#store).resolveConflict(founderRef, str('conflictId'), pl.resolution as 'PASS' | 'REWORK', str('reasonCode'));
        return `review_conflict:${c.id}`;
      }
      case 'BUDGET_CEILING': {
        const b = GovernanceStore.for(this.#store).changeBudgetCap(founderRef, str('budgetId'), { capMoney: Number(pl.capMoney), capTokens: Number(pl.capTokens), reasonCode: str('reasonCode') });
        return `budget:${b.id}`;
      }
      case 'DELEGATE_WORK': {
        const d = OrganizationStore.for(this.#store).delegateAuthority(founderRef, { employeeId: str('employeeId'), capability: str('capability'), expiresAt: str('expiresAt'), purposeCode: str('purposeCode'), reasonCode: str('reasonCode') });
        return `authority_delegation:${d.id}`;
      }
    }
  }

  reject(session: FounderSession, previewId: string, reasonCode: string): ActionPreviewRecord {
    return this.#write('founder action rejected', (ctx) => {
      const p = getPreview(ctx, assertId(previewId, 'previewId'));
      if (p.sessionId !== session.id) throw new QandeelError('FOUNDER_CONFIRMATION_REQUIRED', 'the preview belongs to another session', { reason: 'SESSION_MISMATCH', previewId: p.id });
      if (p.state !== 'PREVIEW') return p;
      const reason = assertCode(reasonCode, 'reasonCode');
      ctx.db.run(`UPDATE founder_action_previews SET state = 'REJECTED', decided_at = ?, result_code = ? WHERE id = ?`, ts(ctx), reason, p.id);
      appendAudit(ctx, 'founder.action_rejected', 'founder_action', p.id, { actorRef: session.founderRef }, 'OK', reason, {});
      return getPreview(ctx, p.id);
    });
  }

  /** Marks every stale PREVIEW as EXPIRED (called on demand by the surface). */
  expireStale(): number {
    return this.#write('expire founder previews', (ctx) => {
      const now = ts(ctx);
      const stale = ctx.db.all<{ id: string }>(`SELECT id FROM founder_action_previews WHERE state = 'PREVIEW' AND expires_at <= ?`, now);
      for (const s of stale) ctx.db.run(`UPDATE founder_action_previews SET state = 'EXPIRED', decided_at = ?, result_code = 'EXPIRED' WHERE id = ?`, now, s.id);
      return stale.length;
    });
  }

  get(id: Id): ActionPreviewRecord {
    return this.#read((ctx) => getPreview(ctx, id));
  }

  list(filter: { sessionId?: Id; state?: ActionPreviewRecord['state'] } = {}): ActionPreviewRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM founder_action_previews ORDER BY created_at, id')
        .map(mapActionPreview)
        .filter((p) => (filter.sessionId === undefined || p.sessionId === filter.sessionId) && (filter.state === undefined || p.state === filter.state)),
    );
  }

  /** The Employee's open envelope (the ceiling a BUDGET_CEILING intent addresses), if any. */
  employeeBudgetId(employeeId: Id): Id | null {
    return this.#read((ctx) => budgetFor(ctx, 'EMPLOYEE', employeeId)?.id ?? null);
  }
}
