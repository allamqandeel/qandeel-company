/**
 * C3 crash proof: real process death right after a model-proposed memory candidate commits and
 * before the Memory Write Policy decides it. The recovering process decides it exactly once, the
 * resumed run replays the same step idempotently, and no candidate is lost or stored twice.
 * C3-PROOF: memory-crash-recovery
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { assertId } from '@qandeel-company/domain';
import { CompanyStore, MemoryStore } from '@qandeel-company/storage';

import { final, script, seedWorld } from '../c2/c2-seed.js';
import { removeRoot, tempRoot } from '../helpers.js';
import { spawnScript } from '../process-harness.js';

const HOST = new URL('../fixtures/c2-host.js', import.meta.url);
const parse = (line: string): Record<string, unknown> => JSON.parse(line) as Record<string, unknown>;
const isHost = (kind: string) => (l: string): boolean => l.includes(`"host":"${kind}"`);

describe('C3 fault matrix: process death between memory candidate and policy decision', () => {
  test('killed right after a memory candidate commits → recovery decides it once; the resumed run replays the step; one memory', async () => {
    const root = tempRoot('c3f-memory');
    try {
      const world = seedWorld(root);
      const candidate = { type: 'MEMORY_CANDIDATE', memoryClass: 'EXPERIENCE', topic: 'egypt.payments', claimKey: null, claimValue: null, content: 'Egypt payments: Giza merchants settle mostly through Instapay transfers.', confidencePct: 80 };
      const a = spawnScript(HOST, [root, JSON.stringify({ world, submit: { instructions: script(candidate, final('remembered')) }, fault: 'memoryCandidate.afterCommit' })]);
      const id = assertId(parse(await a.waitFor(isHost('SUBMITTED'), 40_000)).workItemId, 'workItemId');
      await a.waitFor(isHost('DYING'), 40_000);
      await a.exited();
      const b = spawnScript(HOST, [root, JSON.stringify({ exitWhenIdle: true })]);
      const ready = parse(await b.waitFor(isHost('READY'), 40_000));
      await b.waitFor(isHost('IDLE'), 60_000);
      await b.waitFor(isHost('STOPPED'), 30_000);
      assert.equal(await b.exited(), 0, b.stderr());
      const recovery = ready.recovery as Record<string, unknown>;
      assert.equal(recovery.memoryCandidatesDecided, 1, JSON.stringify(recovery));
      const store = CompanyStore.open(root, { migrationMode: 'verify', create: false });
      try {
        const m = MemoryStore.for(store);
        assert.equal(store.getWorkItem(id).state, 'COMPLETED');
        const cands = m.candidates(id);
        assert.equal(cands.length, 1, 'the replayed step reuses the same candidate (idempotency key)');
        assert.equal(cands[0]?.state, 'ACCEPTED');
        assert.equal(m.memories(world.employee.id).length, 1, 'exactly one memory');
        assert.deepEqual(m.pendingCandidates(), []);
        assert.equal(store.integrityCheck(), 'ok');
      } finally {
        store.close();
      }
    } finally {
      removeRoot(root);
    }
  });
});
