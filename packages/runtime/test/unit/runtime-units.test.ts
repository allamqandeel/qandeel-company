import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';

import { newId, type CheckpointView, type JsonValue, type ProcessorContext } from '@qandeel-company/domain';

import { Logger, ProcessorRegistry, RUNTIME_VERSION, WakeSignal, errorCode, noopProcessor, stepsProcessor, type LogRecord } from '../../src/index.js';

describe('content-free logger (Rule A)', () => {
  test('keeps only short scalar fields; drops nested payloads and caps strings', () => {
    const records: LogRecord[] = [];
    const log = new Logger((r) => records.push(r), () => '2026-09-26T00:00:00.000Z');
    log.info('run.settled', { jobId: 'j', long: 'x'.repeat(500), nested: { secret: 1 } as never, list: ['a'] as never, 'bad key': 'v', ok: true });
    const [r] = records;
    assert.ok(r);
    assert.equal(r.event, 'run.settled');
    assert.equal((r.long as string).length, 128);
    assert.equal(r.ok, true);
    assert.equal('bad key' in r, false);
    assert.equal('nested' in r, false, 'nested payloads are never logged');
    assert.equal('list' in r, false);
  });

  test('errorCode never exposes messages or stacks', () => {
    assert.equal(errorCode(new Error('private text')), 'UNCLASSIFIED_ERROR');
    assert.equal(errorCode(Object.assign(new Error('x'), { code: 'STORAGE_BUSY' })), 'STORAGE_BUSY');
    assert.equal(errorCode({ code: 'lower case not allowed' }), 'UNCLASSIFIED_ERROR');
  });
});

describe('processor registry', () => {
  test('refuses duplicate or malformed kinds and unknown side-effect classes', () => {
    assert.throws(() => new ProcessorRegistry([noopProcessor, noopProcessor]), /duplicate/);
    assert.throws(() => new ProcessorRegistry([{ ...noopProcessor, kind: 'Bad Kind' }]), /invalid processor kind/);
    assert.throws(() => new ProcessorRegistry([{ ...noopProcessor, kind: 'x.y', sideEffects: 'MAYBE' as never }]), /side-effect/);
    const r = new ProcessorRegistry([noopProcessor, stepsProcessor]);
    assert.deepEqual(r.kinds, ['c1.noop', 'c1.steps']);
    assert.equal(r.sideEffects.get('c1.steps'), 'NONE');
  });
});

describe('wake signal', () => {
  test('coalesces bursts of signals into one wake per turn', async () => {
    let wakes = 0;
    const w = new WakeSignal(() => wakes++);
    for (let i = 0; i < 1000; i++) w.signal();
    await tick();
    await tick();
    assert.equal(wakes, 1);
    assert.equal(w.signals, 1000);
    w.close();
    w.signal();
    await tick();
    assert.equal(wakes, 1, 'closed signals never wake');
  });
});

function fakeContext(input: JsonValue, resumeFrom: CheckpointView | null = null, attempt = 1): ProcessorContext & { checkpoints: JsonValue[] } {
  const checkpoints: JsonValue[] = [];
  return {
    checkpoints,
    workItemId: newId(),
    rootWorkItemId: newId(),
    jobId: newId(),
    runId: newId(),
    attempt,
    correlationId: newId(),
    processorKind: 'c1.steps',
    input,
    resumeFrom,
    signal: new AbortController().signal,
    checkpoint: async (_kind, state) => {
      checkpoints.push(state);
    },
    putArtifact: async () => ({ artifactId: newId(), sha256: '0'.repeat(64) }),
  };
}

describe('deterministic processors', () => {
  test('c1.steps checkpoints every step and resumes after the last durable checkpoint', async () => {
    const fresh = fakeContext({ steps: 3 });
    assert.deepEqual(await stepsProcessor.run(fresh), { type: 'COMPLETED', evidence: { processor: 'c1.steps', steps: 3, resumedFrom: 0 } });
    assert.deepEqual(fresh.checkpoints, [{ step: 1 }, { step: 2 }, { step: 3 }]);
    const resumed = fakeContext({ steps: 3 }, { runId: newId(), seq: 2, kind: 'step', kindVersion: 1, state: { step: 2 }, createdAt: '2026-09-26T00:00:00.000Z' as never });
    assert.deepEqual(await stepsProcessor.run(resumed), { type: 'COMPLETED', evidence: { processor: 'c1.steps', steps: 3, resumedFrom: 2 } });
    assert.deepEqual(resumed.checkpoints, [{ step: 3 }]);
  });

  test('deterministic failure modes', async () => {
    assert.deepEqual(await stepsProcessor.run(fakeContext({ failUntilAttempt: 2 }, null, 1)), { type: 'RETRYABLE_FAILURE', code: 'DETERMINISTIC_TRANSIENT' });
    assert.equal((await stepsProcessor.run(fakeContext({ failUntilAttempt: 2 }, null, 2))).type, 'COMPLETED');
    assert.deepEqual(await stepsProcessor.run(fakeContext({ permanentFailure: true })), { type: 'PERMANENT_FAILURE', code: 'DETERMINISTIC_PERMANENT' });
    assert.deepEqual(await stepsProcessor.run(fakeContext({ waitFirst: true })), { type: 'WAIT', reasonCode: 'AWAITING_WAKE' });
    assert.equal((await noopProcessor.run(fakeContext(null))).type, 'COMPLETED');
  });

  test('runtime version matches the package manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
    assert.equal(RUNTIME_VERSION, manifest.version);
  });
});
