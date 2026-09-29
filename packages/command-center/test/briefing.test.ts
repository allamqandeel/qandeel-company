/**
 * The proactive CEO briefing policy: durable signals only, one request per context, cooldown, no storm.
 * C5-PROOF: founder-listener
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { EventRecord } from '@qandeel-company/storage';

import { BRIEF_COOLDOWN_MS, BriefingPolicy, signalFor } from '../src/index.js';

/** The value a proof relies on, present by construction of the fixture. */
function must<T>(v: T | null | undefined, what = 'value'): T {
  if (v === null || v === undefined) throw new Error(`${what} is missing`);
  return v;
}

const event = (type: EventRecord['type'], payload: Record<string, unknown> = {}): EventRecord => ({ seq: 1, id: '00000000-0000-4000-8000-000000000001', type, version: 1, aggregateType: 'work_item', aggregateId: '00000000-0000-4000-8000-000000000002', correlationId: '00000000-0000-4000-8000-000000000003', causationId: null, createdAt: '2026-09-29T00:00:00.000Z', payload, dispatchedAt: null }) as EventRecord;

describe('CEO briefing policy', () => {
  test('C5-PROOF: only Founder-worthy durable events become brief signals', () => {
    assert.equal(signalFor(event('job.claimed')), null);
    assert.equal(signalFor(event('run.finished')), null);
    assert.equal(signalFor(event('work_item.transitioned', { to: 'COMPLETED' })), null);
    assert.equal(signalFor(event('work_item.approval_requested'))?.contextKind, 'APPROVAL');
    assert.equal(signalFor(event('work_item.transitioned', { to: 'BLOCKED', blockedReason: 'DEPENDENCY' }))?.contextKind, 'WORK_ITEM');
  });

  test('C5-PROOF: one request per context within the cooldown; a vacant CEO seat is a refusal, not a crash', () => {
    let now = 1_000;
    const calls: string[] = [];
    let fail = false;
    const founder = {
      communications: {
        requestCeoBrief: (input: { contextRef: string }) => {
          if (fail) throw Object.assign(new Error('vacant'), { code: 'ORG_NOT_ELIGIBLE' });
          calls.push(input.contextRef);
          return { thread: { id: 't' }, workItemId: 'w', replayed: false };
        },
      },
    } as unknown as ConstructorParameters<typeof BriefingPolicy>[0];
    const policy = new BriefingPolicy(founder, { now: () => now });
    const s = must(signalFor(event('work_item.approval_requested')));
    assert.equal(policy.onSignal(s).code, 'REQUESTED');
    assert.equal(policy.onSignal(s).code, 'COOLDOWN');
    now += BRIEF_COOLDOWN_MS + 1;
    assert.equal(policy.onSignal(s).code, 'REQUESTED');
    assert.equal(calls.length, 2);
    fail = true;
    const other = must(signalFor(event('work_item.transitioned', { to: 'BLOCKED' })));
    assert.equal(policy.onSignal(other).code, 'ORG_NOT_ELIGIBLE');
    policy.disable();
    assert.equal(policy.onSignal(s).code, 'DISABLED');
  });
});
