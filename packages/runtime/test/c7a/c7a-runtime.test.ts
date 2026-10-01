/**
 * C7-A on the real runtime: the external-evidence capability joins the C5 change-signalling contract (reads silent,
 * failures silent, a Founder decision announces once, an intake announces only a NEW accepted record or a NEW recorded
 * conflict — an exact replay, a repeated conflict or a refusal is silent), and the read-only CLI reports availability and source health content-free (there
 * is no intake, register, activate or bind command). C7A-PROOF: runtime-c7a
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isQandeelError } from '@qandeel-company/domain';

import type { CompanyRuntime } from '../../src/index.js';
import { removeRoot, tempRoot } from '../helpers.js';
import { fakes, governedRuntime, seedWorld } from '../c2/c2-seed.js';

const CLI = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

function meter(rt: CompanyRuntime): { readonly changes: number; off(): void } {
  let changes = 0;
  const off = rt.onFounderChange(() => {
    changes++;
  });
  return {
    get changes() {
      return changes;
    },
    off,
  };
}

const occurrence = (producerEventId: string, value = 10): Record<string, unknown> => ({
  sourceKey: 'web-analytics.main',
  contractCode: 'outcome.metrics',
  contractVersion: 1,
  producerEventId,
  type: 'web.sessions',
  occurredAt: '2026-09-26T10:00:00.000Z',
  scope: { kind: 'SITE', ref: 'qandeel-site' },
  window: { from: '2026-09-19T00:00:00.000Z', to: '2026-09-26T00:00:00.000Z' },
  fields: { value },
});

describe('C7-A runtime: governed external evidence under the Founder change-signalling contract', () => {
  test('C7A-PROOF: every external-evidence method is classified; reads, refusals and exact replays are silent; decisions and new records announce once; the CLI reads content-free', async () => {
    const root = tempRoot('c7a-signal');
    const w = seedWorld(root);
    const rt = governedRuntime(root, fakes());
    try {
      await rt.start();
      const f = rt.founder;
      const methods = Object.keys(f.external).filter((k) => typeof (f.external as unknown as Record<string, unknown>)[k] === 'function').sort();
      assert.deepEqual(methods, ['availability', 'bindEvidence', 'bindings', 'decideSource', 'evidenceFor', 'health', 'ingest', 'record', 'registerSource', 'source', 'sourceHistory', 'sources', 'unbindEvidence']);
      assert.ok(Object.isFrozen(f.external));
      const m = meter(rt);
      try {
        f.external.sources();
        f.external.availability();
        f.external.health();
        assert.equal(m.changes, 0, 'reads announce nothing');
        assert.throws(() => f.external.ingest(occurrence('o-1')), (e: unknown) => isQandeelError(e, 'INTAKE_REJECTED'));
        assert.throws(() => f.external.registerSource(w.founder, { sourceKey: 'Not A Key', family: 'WEB_ANALYTICS', contractCode: 'outcome.metrics', contractVersion: 1 }), (e: unknown) => isQandeelError(e, 'VALIDATION_FAILED'));
        assert.equal(m.changes, 0, 'refusals announce nothing');
        const src = f.external.registerSource(w.founder, { sourceKey: 'web-analytics.main', family: 'WEB_ANALYTICS', contractCode: 'outcome.metrics', contractVersion: 1 }).source;
        f.external.decideSource(w.founder, src.id, { decision: 'ACTIVATE', reasonCode: 'founder.trusted' });
        assert.equal(m.changes, 2, 'each Founder decision announces once');
        assert.equal(f.external.ingest(occurrence('o-1')).outcome, 'ACCEPTED');
        assert.equal(m.changes, 3, 'a new accepted record announces once');
        assert.equal(f.external.ingest(occurrence('o-1')).outcome, 'DUPLICATE');
        assert.equal(m.changes, 3, 'an exact replay is not news');
        assert.throws(() => f.external.ingest(occurrence('o-1', 99)), (e: unknown) => isQandeelError(e, 'INTAKE_CONFLICT'));
        assert.equal(m.changes, 4, 'a NEW conflicting replay is refused but committed its conflict (and any contest, D-C7A-11): it announces once');
        assert.throws(() => f.external.ingest(occurrence('o-1', 99)), (e: unknown) => isQandeelError(e, 'INTAKE_CONFLICT'));
        assert.equal(m.changes, 4, 'the same conflicting replay again changes nothing new and announces nothing');
        assert.equal(f.external.availability().state, 'NO_RELEVANT_EVIDENCE');
        assert.equal(f.improvement.inspect({ kind: 'COMPANY' }).externalOutcomes !== undefined, true);
      } finally {
        m.off();
      }
    } finally {
      await rt.stop().catch(() => undefined);
    }
    try {
      const r = spawnSync(process.execPath, [CLI, 'external', '--workspace', root], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 60_000 });
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '{}') as { availability: { state: string }; health: { perSource: { accepted: number; conflicts: number; rejected: number }[] }; sources: { state: string }[] };
      assert.equal(out.availability.state, 'NO_RELEVANT_EVIDENCE');
      assert.deepEqual(out.sources.map((s) => s.state), ['ACTIVE']);
      assert.deepEqual(out.health.perSource.map((s) => [s.accepted, s.conflicts]), [[1, 1]]);
      assert.ok(!r.stdout.includes('qandeel-site') && !r.stdout.includes('o-1'), 'the CLI prints no record content or producer identity');
      for (const write of ['ingest', 'register-source', 'activate-source', 'bind']) {
        assert.notEqual(spawnSync(process.execPath, [CLI, write, '--workspace', root], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 60_000 }).status, 0, `no ${write} command`);
      }
    } finally {
      removeRoot(root);
    }
  });
});
