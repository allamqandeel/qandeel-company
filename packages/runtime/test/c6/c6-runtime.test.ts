/**
 * C6 on the real runtime: the Improvement capability joins the C5 change-signalling contract (reads silent,
 * failures silent, a Founder decision announces once, an idempotent derivation announces only when it recorded
 * something new), governed work is evaluated from its real lineage, and the resilience operations run against
 * the live store without stopping it. C6-PROOF: runtime-c6
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { isQandeelError } from '@qandeel-company/domain';
import { standardWorkOutcomeDefinition } from '@qandeel-company/mind';
import { DirectoryDestination } from '@qandeel-company/storage';

import type { CompanyRuntime } from '../../src/index.js';
import { eventually, removeRoot, tempRoot } from '../helpers.js';
import { fakes, final, governedRuntime, script, seedWorld, submitTask, type C2World } from '../c2/c2-seed.js';

function meter(rt: CompanyRuntime): { readonly changes: number; readonly wakes: number; reset(): void; off(): void } {
  let changes = 0;
  let wakesAt = rt.diagnostics().wakeSignals;
  const off = rt.onFounderChange(() => {
    changes++;
  });
  return {
    get changes() {
      return changes;
    },
    get wakes() {
      return rt.diagnostics().wakeSignals - wakesAt;
    },
    reset() {
      changes = 0;
      wakesAt = rt.diagnostics().wakeSignals;
    },
    off,
  };
}

async function withRuntime(label: string, fn: (ctx: { rt: CompanyRuntime; w: C2World }) => Promise<void> | void): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const rt = governedRuntime(root, fakes());
  try {
    await rt.start();
    await fn({ rt, w });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

describe('C6 runtime: the Improvement capability under the Founder change-signalling contract', () => {
  test('C6-PROOF: every Improvement method is classified; reads and failed writes are silent; a decision announces once; an unchanged derivation stays silent', () =>
    withRuntime('c6-signal', async ({ rt, w }) => {
      const f = rt.founder;
      const methods = Object.keys(f.improvement).filter((k) => typeof (f.improvement as unknown as Record<string, unknown>)[k] === 'function').sort();
      assert.equal(methods.length, 33);
      assert.ok(Object.isFrozen(f.improvement));
      const m = meter(rt);
      try {
        f.improvement.definitions();
        f.improvement.health();
        f.improvement.inspect({ kind: 'COMPANY' });
        f.improvement.economics();
        f.improvement.reports();
        f.improvement.latestReport('WEEKLY');
        f.improvement.reviewerCalibration();
        f.improvement.systemicFindings();
        f.improvement.profile(w.employee.id);
        assert.deepEqual([m.changes, m.wakes], [0, 0], 'reads announce nothing and wake nothing');
        assert.throws(() => f.improvement.registerDefinition(w.founder, { ...standardWorkOutcomeDefinition(), dimensions: [] }), (e: unknown) => isQandeelError(e) && e.code === 'EVAL_INVALID');
        assert.equal(m.changes, 0, 'a failed write announces nothing');
        const d = f.improvement.registerDefinition(w.founder, standardWorkOutcomeDefinition());
        assert.equal(m.changes, 1);
        f.improvement.activateDefinition(w.founder, d.id, f.improvement.calibrateDefinition(w.founder, d.id).id);
        assert.equal(m.changes, 3);
        m.reset();
        const first = f.improvement.generateReport('DAILY');
        assert.equal(first.changed, true);
        assert.equal(m.changes, 1);
        assert.equal(f.improvement.generateReport('DAILY', { at: first.report.periodTo }).changed, false);
        assert.equal(m.changes, 1, 'an identical report is not news');
      } finally {
        m.off();
      }
    }));

  test('C6-PROOF: governed work is evaluated from its real lineage (runs, usage); completion alone is not qualified; re-evaluation is idempotent and silent', () =>
    withRuntime('c6-evaluate', async ({ rt, w }) => {
      const f = rt.founder;
      const d = f.improvement.registerDefinition(w.founder, standardWorkOutcomeDefinition());
      f.improvement.activateDefinition(w.founder, d.id, f.improvement.calibrateDefinition(w.founder, d.id).id);
      const id = submitTask(rt, w, { instructions: script(final('memo.done')) });
      await eventually(() => rt.view.getWorkItem(id).state === 'COMPLETED', 20_000, 'governed work completes');
      const m = meter(rt);
      try {
        const first = f.improvement.evaluate(id);
        assert.equal(first.changed, true);
        assert.equal(first.evaluation.qualifiedOutcome, false, 'COMPLETED is not a qualified outcome');
        assert.equal(first.evaluation.employeeId, w.employee.id, 'attributed to the Employee through the run attribution');
        assert.ok((first.evaluation.observability.runs ?? 0) >= 1, 'the run trace is part of the evidence');
        assert.equal(m.changes, 1);
        assert.equal(f.improvement.evaluate(id).changed, false);
        assert.equal(m.changes, 1, 'unchanged evidence announces nothing');
      } finally {
        m.off();
      }
    }));

  test('C6-PROOF: portable backup, restore drill and resilience status run against the live runtime', () =>
    withRuntime('c6-resilience', async ({ rt }) => {
      const ext = path.join(mkdtempSync(path.join(tmpdir(), 'qc-rt-offdevice-')), 'external');
      try {
        const passphrase = ['runtime', 'drill', 'phrase', String(process.pid)].join('-');
        const pkg = await rt.portableBackup({ destination: new DirectoryDestination(ext, { attestOffDevice: true }), passphrase });
        assert.equal(pkg.failureDomain, 'ATTESTED_OFF_DEVICE');
        assert.equal(rt.restoreDrill().result, 'PASS');
        const status = rt.resilience();
        assert.equal(status.portableBackup?.withinOffDeviceRpo, true);
        assert.equal(status.localBackup?.withinRpo, true);
        assert.deepEqual(status.exceptions.filter((x) => x.material), []);
      } finally {
        rmSync(path.dirname(ext), { recursive: true, force: true });
      }
    }));
});
