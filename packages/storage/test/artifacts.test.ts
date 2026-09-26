import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { isQandeelError, sha256Hex } from '@qandeel-company/domain';

import { ArtifactStore, CompanyStore, type FaultPoint } from '../src/index.js';
import { executable, harness } from './helpers.js';

class InjectedCrash extends Error {}

function crashAt(point: FaultPoint) {
  return (p: FaultPoint): void => {
    if (p === point) throw new InjectedCrash(p);
  };
}

describe('Artifact Store', () => {
  test('put → READY with SHA-256, content-addressed object outside SQLite, verified read', () => {
    const h = harness();
    try {
      const wi = executable(h.store);
      const artifacts = new ArtifactStore(h.store);
      const rec = artifacts.put({ content: 'تقرير: نتائج', mediaType: 'text/plain', label: '../../etc/passwd', workItemId: wi });
      assert.equal(rec.state, 'READY');
      assert.equal(rec.sha256, sha256Hex(Buffer.from('تقرير: نتائج', 'utf8')));
      const object = artifacts.objectPath(rec.sha256);
      assert.ok(object.startsWith(h.store.workspace.objectsDir), 'the label never becomes a path');
      assert.ok(existsSync(object));
      assert.equal(artifacts.read(rec.id).toString('utf8'), 'تقرير: نتائج');
      assert.deepEqual(readdirSync(h.store.workspace.artifactTmpDir), [], 'no staging debris');
      assert.ok(h.store.events(rec.id).some((e) => e.type === 'artifact.ready'));
      assert.deepEqual(artifacts.listForWorkItem(wi).map((a) => a.id), [rec.id]);
    } finally {
      h.close();
    }
  });

  test('path safety: only SHA-256 hex maps to an object path', () => {
    const h = harness();
    try {
      const artifacts = new ArtifactStore(h.store);
      for (const bad of ['../../../x', 'a'.repeat(63), 'G'.repeat(64), `${'a'.repeat(62)}/..`]) {
        assert.throws(() => artifacts.objectPath(bad), (e) => isQandeelError(e, 'VALIDATION_FAILED'), bad);
      }
      assert.throws(() => artifacts.put({ content: 'x', mediaType: '../evil' }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    } finally {
      h.close();
    }
  });

  test('a run-linked artifact must present that run\'s fence', () => {
    const h = harness();
    try {
      assert.throws(() => new ArtifactStore(h.store).put({ content: 'x', mediaType: 'text/plain', runId: '00000000-0000-4000-8000-000000000001' as never }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    } finally {
      h.close();
    }
  });

  test('duplicate content is stored once and referenced by two READY rows', () => {
    const h = harness();
    try {
      const artifacts = new ArtifactStore(h.store);
      const a = artifacts.put({ content: 'same bytes', mediaType: 'text/plain' });
      const b = artifacts.put({ content: 'same bytes', mediaType: 'text/plain' });
      assert.notEqual(a.id, b.id);
      assert.equal(a.sha256, b.sha256);
      assert.equal(b.state, 'READY');
      const shard = path.dirname(artifacts.objectPath(a.sha256));
      assert.deepEqual(readdirSync(shard), [a.sha256]);
    } finally {
      h.close();
    }
  });

  test('crash after the temp write, before metadata: startup removes the temp file; no READY row', () => {
    const h = harness();
    try {
      const crashing = h.open({ fault: crashAt('artifact.afterTempWrite') });
      assert.throws(() => new ArtifactStore(crashing).put({ content: 'lost', mediaType: 'text/plain' }), InjectedCrash);
      assert.equal(readdirSync(h.store.workspace.artifactTmpDir).length, 1);
      const report = new ArtifactStore(h.open()).recover();
      assert.equal(report.tempFilesRemoved, 1);
      assert.equal(h.store.healthCounts().artifacts.READY, undefined);
    } finally {
      h.close();
    }
  });

  test('crash before the final rename (STAGED row + temp file): recovery re-hashes, finishes the rename, promotes', () => {
    const h = harness();
    try {
      const crashing = h.open({ fault: crashAt('artifact.afterStage') });
      assert.throws(() => new ArtifactStore(crashing).put({ content: 'staged', mediaType: 'text/plain' }), InjectedCrash);
      assert.deepEqual(h.store.healthCounts().artifacts, { STAGED: 1 });
      const artifacts = new ArtifactStore(h.open());
      assert.equal(artifacts.recover().promoted, 1);
      assert.deepEqual(h.store.healthCounts().artifacts, { READY: 1 });
      assert.deepEqual(readdirSync(h.store.workspace.artifactTmpDir), []);
    } finally {
      h.close();
    }
  });

  test('crash before the final rename with a truncated temp file: the row is ABANDONED, never READY', () => {
    const h = harness();
    try {
      const crashing = h.open({ fault: crashAt('artifact.afterStage') });
      assert.throws(() => new ArtifactStore(crashing).put({ content: 'will be truncated', mediaType: 'text/plain' }), InjectedCrash);
      const [temp] = readdirSync(h.store.workspace.artifactTmpDir);
      assert.ok(temp);
      writeFileSync(path.join(h.store.workspace.artifactTmpDir, temp), 'will be');
      const report = new ArtifactStore(h.open()).recover();
      assert.equal(report.abandoned, 1);
      assert.deepEqual(h.store.healthCounts().artifacts, { ABANDONED: 1 });
    } finally {
      h.close();
    }
  });

  test('crash after rename, before READY: recovery verifies and promotes', () => {
    const h = harness();
    try {
      const crashing = h.open({ fault: crashAt('artifact.afterRename') });
      assert.throws(() => new ArtifactStore(crashing).put({ content: 'renamed', mediaType: 'text/plain' }), InjectedCrash);
      assert.equal(new ArtifactStore(h.open()).recover().promoted, 1);
    } finally {
      h.close();
    }
  });

  test('final object exists but metadata is absent: recovery quarantines the orphan (never deletes it)', () => {
    const h = harness();
    try {
      const artifacts = new ArtifactStore(h.store);
      const content = Buffer.from('orphan bytes');
      const sha = sha256Hex(content);
      const object = artifacts.objectPath(sha);
      mkdirSync(path.dirname(object), { recursive: true });
      writeFileSync(object, content);
      const report = artifacts.recover();
      assert.equal(report.orphansQuarantined, 1);
      assert.ok(!existsSync(object));
      assert.equal(readdirSync(artifacts.quarantineDir).length, 1);
      assert.equal(h.store.auditByAction('artifact.orphan_quarantined').length, 1);
      assert.equal(artifacts.recover().orphansQuarantined, 0, 'idempotent');
    } finally {
      h.close();
    }
  });

  test('metadata exists but the file is missing: never reported READY', () => {
    const h = harness();
    try {
      const artifacts = new ArtifactStore(h.store);
      const rec = artifacts.put({ content: 'soon gone', mediaType: 'text/plain' });
      rmSync(artifacts.objectPath(rec.sha256));
      assert.equal(artifacts.recover().missing, 1);
      assert.equal(artifacts.get(rec.id).state, 'MISSING');
      assert.throws(() => artifacts.read(rec.id), (e) => isQandeelError(e, 'ARTIFACT_NOT_READY'));
    } finally {
      h.close();
    }
  });

  test('corrupted content is detected by re-hashing and demoted to CORRUPT', () => {
    const h = harness();
    try {
      const artifacts = new ArtifactStore(h.store);
      const a = artifacts.put({ content: 'original', mediaType: 'text/plain' });
      const b = artifacts.put({ content: 'second', mediaType: 'text/plain' });
      writeFileSync(artifacts.objectPath(a.sha256), 'tampered');
      assert.throws(() => artifacts.read(a.id), (e) => isQandeelError(e, 'ARTIFACT_INTEGRITY'));
      assert.equal(artifacts.get(a.id).state, 'CORRUPT');
      writeFileSync(artifacts.objectPath(b.sha256), 'tampered too');
      const report = artifacts.verifyAll();
      assert.deepEqual(report, { checked: 2, ready: 0, missing: 0, corrupt: 2 });
      // Re-storing the true content repairs the object; verification promotes it back.
      artifacts.put({ content: 'original', mediaType: 'text/plain' });
      assert.deepEqual(artifacts.verifyAll(), { checked: 3, ready: 2, missing: 0, corrupt: 1 });
      assert.equal(artifacts.get(a.id).state, 'READY');
    } finally {
      h.close();
    }
  });

  test('metadata rows are durable history', () => {
    const h = harness();
    try {
      const rec = new ArtifactStore(h.store).put({ content: 'x', mediaType: 'text/plain' });
      h.store.close();
      const reopened = CompanyStore.open(h.root, { clock: h.clock });
      assert.equal(new ArtifactStore(reopened).get(rec.id).state, 'READY');
      reopened.close();
    } finally {
      h.close();
    }
  });
});
