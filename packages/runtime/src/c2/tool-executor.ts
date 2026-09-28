/**
 * The governed Tool Executor (Stage 12 §11/§51): the ONLY code that invokes a tool driver
 * (verifier rule `tool-drivers-confined`). Drivers are handed over at construction and held
 * privately; nothing else can reach them, and there is no generic "execute anything" entry point.
 *
 * Order per call: durable intent after the full authority path (storage transaction) → driver call
 * → durable result. A model's tool request is only data: it reaches a driver only through here,
 * and only after authority, approval, egress, idempotency and budget checks have committed.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { sha256Hex, type JsonObject } from '@qandeel-company/domain';
import { assertToolCode, type ToolDriver, type ToolDriverResult } from '@qandeel-company/governance';
import type { CompanyStore, Fence } from '@qandeel-company/storage';
import { recordToolIntent, recordToolResult, type GovernedRunContext } from '@qandeel-company/storage/runtime-authority';

import type { ToolOutcome, ToolRequest } from './types.js';

export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;

export class ToolExecutor {
  readonly #drivers: ReadonlyMap<string, ToolDriver>;
  readonly #timeoutMs: number;

  constructor(drivers: readonly ToolDriver[], timeoutMs = DEFAULT_TOOL_CALL_TIMEOUT_MS) {
    const map = new Map<string, ToolDriver>();
    for (const d of drivers) {
      assertToolCode(d.driverCode, 'driverCode');
      if (map.has(d.driverCode)) throw new Error(`duplicate tool driver "${d.driverCode}"`);
      map.set(d.driverCode, d);
    }
    this.#drivers = map;
    this.#timeoutMs = timeoutMs;
  }

  get driverCodes(): readonly string[] {
    return [...this.#drivers.keys()];
  }

  /**
   * The idempotency key is derived from durable run state (Work Item + checkpointed step), never
   * from model output, so a resumed run presents the same key for the same logical action.
   */
  static idempotencyKey(workItemId: string, step: number): string {
    return `wi:${workItemId}:s${step}`;
  }

  async execute(store: CompanyStore, fence: Fence, run: GovernedRunContext, request: ToolRequest, step: number, signal: AbortSignal): Promise<ToolOutcome> {
    if (!Number.isSafeInteger(step) || step < 0 || step > 100_000) return { kind: 'FAILED', code: 'INVALID_STEP' };
    const intent = recordToolIntent(store, fence, { toolCode: request.tool, actionCode: request.action, args: request.args, idempotencyKey: ToolExecutor.idempotencyKey(run.workItemId, step) });
    switch (intent.kind) {
      case 'REPLAY':
        return { kind: 'SUCCEEDED', result: intent.result, replayed: true };
      case 'DENIED':
        return { kind: 'DENIED', code: intent.code, paused: intent.paused };
      case 'APPROVAL_REQUIRED':
        return { kind: 'APPROVAL_REQUIRED', approvalId: intent.approvalId };
      case 'REVIEW_REQUIRED':
        return { kind: 'REVIEW_REQUIRED', code: intent.code };
      case 'BUDGET':
        return { kind: 'BUDGET', code: intent.code };
      case 'RECONCILIATION_REQUIRED':
        return { kind: 'RECONCILIATION_REQUIRED', invocationId: intent.invocationId };
      case 'FAILED':
        return { kind: 'FAILED', code: intent.code };
      case 'IN_FLIGHT':
        return { kind: 'NOT_EXECUTED', code: 'TOOL_IN_FLIGHT' };
      case 'EXECUTE':
        break;
    }
    const driver = this.#drivers.get(intent.driverCode);
    let result: ToolDriverResult;
    if (!driver) {
      result = { ok: false, code: 'DRIVER_NOT_REGISTERED', sent: 'NO' };
    } else {
      // The driver receives the validated arguments the intent (and any approval) was bound to, as an
      // immutable copy: nothing the caller does afterwards can change what is executed.
      result = await this.#invoke(driver, { actionCode: intent.actionCode, args: deepFreeze(structuredClone(intent.args)) as JsonObject, idempotencyKey: ToolExecutor.idempotencyKey(run.workItemId, step) }, signal);
    }
    const state = recordToolResult(store, fence, intent.invocationId, result);
    if (state === 'SUCCEEDED' && result.ok) return { kind: 'SUCCEEDED', result: result.result, replayed: false };
    if (state === 'RECONCILIATION_REQUIRED') return { kind: 'RECONCILIATION_REQUIRED', invocationId: intent.invocationId };
    return { kind: 'NOT_EXECUTED', code: result.ok ? 'UNKNOWN' : result.code };
  }

  /** A bounded driver call. A throw or timeout is "sent: UNKNOWN" unless the action has no side effects. */
  async #invoke(driver: ToolDriver, input: Parameters<ToolDriver['invoke']>[0], runSignal: AbortSignal): Promise<ToolDriverResult> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    runSignal.addEventListener('abort', onAbort, { once: true });
    const timer = new AbortController();
    // A throw or timeout never proves the driver did nothing: always UNKNOWN (charged; UNSAFE → reconcile).
    const unknown: ToolDriverResult = { ok: false, code: 'DRIVER_OUTCOME_UNKNOWN', sent: 'UNKNOWN' };
    try {
      const timeout = sleep(this.#timeoutMs, 'TIMEOUT' as const, { signal: timer.signal }).catch(() => 'CANCELLED' as const);
      const r = await Promise.race([driver.invoke(input, controller.signal), timeout]);
      if (r === 'TIMEOUT' || r === 'CANCELLED') {
        controller.abort();
        return unknown;
      }
      if (r?.ok === true && typeof r.result === 'object' && r.result !== null) return r;
      if (r?.ok === false && typeof r.code === 'string') return { ok: false, code: /^[A-Z][A-Z0-9_]{0,63}$/.test(r.code) ? r.code : 'DRIVER_FAILURE', sent: r.sent === 'NO' ? 'NO' : 'UNKNOWN' };
      return unknown;
    } catch {
      return unknown;
    } finally {
      timer.abort();
      runSignal.removeEventListener('abort', onAbort);
    }
  }
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/** Content-free digest of a tool result for logs / evidence (Rule A). */
export function resultDigest(result: unknown): string {
  try {
    return sha256Hex(JSON.stringify(result) ?? 'null').slice(0, 16);
  } catch {
    return 'unserializable';
  }
}
