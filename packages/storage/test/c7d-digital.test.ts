/**
 * C7-D storage: the internal Digital Workshop through the exact Tool Executor sequence (fenced intent → fenced act +
 * result), and every datastore gate attacked directly. File content lives in the Artifact Store only; a finalized
 * revision, a preview, a candidate and a promotion are immutable; a corrupt object invalidates the candidate; a promotion
 * binds an active target, its own adapter's governed action and the candidate's exact manifest hash; secrets never enter
 * content, labels, audit or tool history; restart keeps everything exact; nothing here is a Pilot or market outcome.
 * C7D-PROOF: storage-digital
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { canonicalJson, newId, sha256Hex, type Id, type JsonObject } from '@qandeel-company/domain';
import { DIGITAL_WORKSPACE_TOOL, digitalManifestSha256 } from '@qandeel-company/governance';

import { ArtifactStore, DigitalStore, GovernanceStore, resolvePromotionExport, type CompanyStore, type Fence } from '../src/index.js';
import { recordDigitalWorkspaceAct, recordToolIntent, settle } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { claimGoverned, governedItem, seed, type Seed } from './c2-helpers.js';
import { backoff, harness, type Harness } from './helpers.js';

const READS = new Set(['revision-inspect', 'file-read', 'seo-check', 'promotion-inspect']);
const ACTIONS = ['project-create', 'project-activate', 'project-archive', 'revision-open', 'file-put', 'upload-begin', 'upload-chunk', 'upload-commit', 'file-remove', 'revision-finalize', 'revision-inspect', 'file-read', 'preview-create', 'seo-check', 'candidate-create', 'promotion-prepare', 'promotion-inspect'];

interface World {
  readonly h: Harness;
  readonly s: Seed;
  readonly fence: Fence;
  readonly workItemId: Id;
  step: number;
  act(action: string, args: JsonObject): { ok: boolean; result: Record<string, unknown>; code: string | null; kind: string };
}

function world(): World {
  const h = harness();
  const s = seed(h.store);
  for (const a of ACTIONS) s.gov.grant(s.founder, { employeeId: s.employee.id, capability: `tool:${DIGITAL_WORKSPACE_TOOL}.${a}`, riskCeiling: READS.has(a) ? 'R0' : 'R1', dataClassCeiling: 'D2', reasonCode: 'seed' });
  const workItemId = governedItem(h, s);
  const { claim } = claimGoverned(h);
  const w: World = {
    h, s, fence: claim.fence, workItemId, step: 0,
    act(action, args) {
      const step = ++w.step;
      // Exactly what the Tool Executor does for the Company-native workshop.
      const intent = recordToolIntent(h.store, claim.fence, { toolCode: DIGITAL_WORKSPACE_TOOL, actionCode: action, args, idempotencyKey: `wi:${workItemId}:s${step}` });
      if (intent.kind !== 'EXECUTE') return { ok: false, result: {}, code: 'code' in intent ? intent.code : intent.kind, kind: intent.kind };
      const { outcome } = recordDigitalWorkspaceAct(h.store, claim.fence, intent.invocationId, intent.actionCode, intent.args);
      return outcome.ok ? { ok: true, result: outcome.result as Record<string, unknown>, code: null, kind: 'EXECUTE' } : { ok: false, result: {}, code: outcome.code, kind: 'EXECUTE' };
    },
  };
  return w;
}

const db = (store: CompanyStore) => storeContext(store).db;
const sql = (store: CompanyStore, q: string, ...p: (string | number | null)[]): void => {
  db(store).immediate('direct sql', () => db(store).run(q, ...p));
};
const rejects = (store: CompanyStore, q: string, ...p: (string | number | null)[]): void => assert.throws(() => sql(store, q, ...p), /./, q.slice(0, 80));

function finalizedRevision(w: World, files: Record<string, string> = { 'index.html': '<!doctype html><html lang="en"><head><title>Home</title></head><body><h1>Home</h1></body></html>' }): { projectId: string; revisionId: string; manifest: string } {
  const p = w.act('project-create', { projectType: 'WEBSITE', title: `Site ${w.step}` });
  assert.ok(p.ok, String(p.code));
  const r = w.act('revision-open', { projectId: String(p.result.projectId) });
  for (const [path, content] of Object.entries(files)) assert.ok(w.act('file-put', { revisionId: String(r.result.revisionId), path, encoding: 'utf8', content }).ok, path);
  const f = w.act('revision-finalize', { revisionId: String(r.result.revisionId) });
  assert.ok(f.ok, String(f.code));
  return { projectId: String(p.result.projectId), revisionId: String(r.result.revisionId), manifest: String(f.result.manifestSha256) };
}

describe('C7-D Digital Workshop storage', () => {
  test('1/3/4/5 a project needs no external target; a finalized revision is immutable in code and datastore; the manifest is deterministic; content is artifact-backed only', () => {
    const w = world();
    try {
      assert.equal(DigitalStore.for(w.h.store).targets().length, 0);
      const { revisionId, manifest } = finalizedRevision(w, { 'index.html': '<h1>QANDEEL</h1>', 'ar/index.html': '<h1>قنديل</h1>' });
      const files = DigitalStore.for(w.h.store).revisionFiles(revisionId);
      assert.equal(manifest, digitalManifestSha256(files.map((f) => ({ path: f.path, sha256: f.sha256, sizeBytes: f.sizeBytes, mediaType: f.mediaType }))));
      // The content is the Artifact Store's: its object hashes to the mapped hash; no digital column holds it.
      const a = new ArtifactStore(w.h.store);
      for (const f of files) assert.equal(sha256Hex(a.read(f.artifactId)), f.sha256);
      for (const t of ['digital_projects', 'digital_revisions', 'digital_revision_files', 'digital_uploads', 'digital_upload_chunks', 'digital_previews', 'digital_release_candidates', 'digital_promotion_targets', 'digital_promotions']) {
        const dump = JSON.stringify(db(w.h.store).all(`SELECT * FROM ${t}`));
        assert.doesNotMatch(dump, /QANDEEL<\/h1>|قنديل<\/h1>/, `${t} holds no file content`);
      }
      // The tool history of a read keeps a digest, never the bytes.
      const read = w.act('file-read', { revisionId, path: 'ar/index.html' });
      assert.match(String(read.result.content), /قنديل/);
      assert.doesNotMatch(JSON.stringify(db(w.h.store).all('SELECT result_json FROM tool_invocations')), /قنديل/);
      // Code: a finalized revision refuses every edit.
      assert.equal(w.act('file-put', { revisionId, path: 'x.html', encoding: 'utf8', content: 'x' }).code, 'REVISION_NOT_WORKING');
      assert.equal(w.act('file-remove', { revisionId, path: 'index.html' }).code, 'REVISION_NOT_WORKING');
      // Datastore: the same, whatever code tries.
      rejects(w.h.store, `UPDATE digital_revision_files SET sha256 = ? WHERE revision_id = ?`, 'f'.repeat(64), revisionId);
      rejects(w.h.store, `UPDATE digital_revision_files SET state = 'REMOVED' WHERE revision_id = ?`, revisionId);
      rejects(w.h.store, `INSERT INTO digital_revision_files (revision_id, path_key, path, artifact_id, sha256, size_bytes, media_type, state, updated_at) SELECT revision_id, 'new.html', 'new.html', artifact_id, sha256, size_bytes, media_type, 'ACTIVE', updated_at FROM digital_revision_files WHERE revision_id = ? LIMIT 1`, revisionId);
      rejects(w.h.store, `UPDATE digital_revisions SET manifest_sha256 = ? WHERE id = ?`, 'e'.repeat(64), revisionId);
      rejects(w.h.store, `UPDATE digital_revisions SET state = 'WORKING' WHERE id = ?`, revisionId);
      rejects(w.h.store, `DELETE FROM digital_revisions WHERE id = ?`, revisionId);
      rejects(w.h.store, `DELETE FROM digital_revision_files WHERE revision_id = ?`, revisionId);
    } finally {
      w.h.close();
    }
  });

  test('2/40/41 paths are validated; secret material never enters content, labels, audit or tool history; working revisions belong to their own Work Item', () => {
    const w = world();
    try {
      const p = w.act('project-create', { projectType: 'WEBSITE', title: 'Paths' });
      const r = w.act('revision-open', { projectId: String(p.result.projectId) });
      const revisionId = String(r.result.revisionId);
      for (const path of ['../escape.html', '/abs.html', 'C:/x.html', '.env', 'config/.env.production', 'node_modules/a.js', '.git/HEAD', 'keys/server.pem', 'a\\b.html', 'CON.html', 'x.exe']) {
        const out = w.act('file-put', { revisionId, path, encoding: 'utf8', content: 'x' });
        assert.equal(out.ok, false, path);
      }
      const secret = 'AKIA' + 'IOSFODNN7EXAMPLE';
      assert.equal(w.act('file-put', { revisionId, path: 'config.js', encoding: 'utf8', content: `const key = "${secret}";` }).code, 'SECRET_MATERIAL');
      assert.equal(w.act('file-put', { revisionId, path: 'notes.md', encoding: 'utf8', content: '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----' }).code, 'SECRET_MATERIAL');
      assert.equal(w.act('project-create', { projectType: 'WEBSITE', title: `token ${'ghp_' + 'a'.repeat(36)}` }).code, 'SECRET_MATERIAL');
      assert.equal(w.act('file-put', { revisionId, path: 'bad.html', encoding: 'base64', content: '!!!' }).code, 'BASE64_INVALID');
      // Nothing secret-shaped, and no Company title, is in audit, events or tool history.
      const telemetry = JSON.stringify([db(w.h.store).all('SELECT details_json FROM audit_events'), db(w.h.store).all('SELECT payload_json FROM events'), db(w.h.store).all('SELECT result_json FROM tool_invocations')]);
      assert.doesNotMatch(telemetry, /AKIA|PRIVATE KEY|ghp_/);
      assert.doesNotMatch(telemetry, /"Paths"/);
      // The datastore refuses a traversal path even from direct SQL.
      rejects(w.h.store, `INSERT INTO digital_revision_files (revision_id, path_key, path, artifact_id, sha256, size_bytes, media_type, state, updated_at) VALUES (?, '../x', '../x', ?, ?, 1, 'text/html', 'ACTIVE', ?)`, revisionId, newId(), 'a'.repeat(64), w.h.store.now());
      // A second Work Item cannot edit this Work Item's working revision.
      settle(w.h.store, w.fence, { type: 'COMPLETED' }, { backoff });
      const other = world2(w);
      assert.equal(other.act('file-put', { revisionId, path: 'x.html', encoding: 'utf8', content: 'x' }).code, 'REVISION_NOT_OWNED');
    } finally {
      w.h.close();
    }
  });

  test('chunked authoring: exact sizes and hashes, no partial file, idempotent chunks, a conflicting chunk refused, and an orphan object never becomes a file', () => {
    const w = world();
    try {
      const p = w.act('project-create', { projectType: 'WEBSITE', title: 'Upload' });
      const revisionId = String(w.act('revision-open', { projectId: String(p.result.projectId) }).result.revisionId);
      const bytes = Buffer.alloc(9000, 7);
      const begin = w.act('upload-begin', { revisionId, path: 'hero.png', sizeBytes: bytes.length, sha256: sha256Hex(bytes) });
      assert.equal(begin.result.chunkCount, 3);
      const uploadId = String(begin.result.uploadId);
      const chunk = (seq: number, data: Buffer): ReturnType<World['act']> => w.act('upload-chunk', { uploadId, seq, data: data.toString('base64'), chunkSha256: sha256Hex(data) });
      assert.equal(chunk(0, bytes.subarray(0, 100)).code, 'CHUNK_SIZE', 'a non-final chunk is exactly 4 096 bytes');
      assert.ok(chunk(0, bytes.subarray(0, 4096)).ok);
      assert.ok(chunk(0, bytes.subarray(0, 4096)).ok, 'the same chunk again is idempotent');
      assert.equal(chunk(0, Buffer.alloc(4096, 1)).code, 'CHUNK_CONFLICT');
      assert.equal(w.act('upload-chunk', { uploadId, seq: 1, data: bytes.subarray(4096, 8192).toString('base64'), chunkSha256: 'a'.repeat(64) }).code, 'CHUNK_HASH_MISMATCH');
      assert.equal(w.act('upload-commit', { uploadId }).code, 'UPLOAD_INCOMPLETE');
      assert.equal(DigitalStore.for(w.h.store).revisionFiles(revisionId).length, 0, 'no partial file is ever mapped');
      assert.equal(w.act('revision-finalize', { revisionId }).code, 'REVISION_EMPTY');
      assert.ok(chunk(1, bytes.subarray(4096, 8192)).ok);
      assert.ok(chunk(2, bytes.subarray(8192)).ok);
      const commit = w.act('upload-commit', { uploadId });
      assert.ok(commit.ok, String(commit.code));
      assert.equal(commit.result.sha256, sha256Hex(bytes));
      const files = DigitalStore.for(w.h.store).revisionFiles(revisionId);
      assert.deepEqual(files.map((f) => [f.path, f.sizeBytes]), [['hero.png', 9000]]);
      rejects(w.h.store, `UPDATE digital_uploads SET state = 'OPEN' WHERE id = ?`, uploadId);
    } finally {
      w.h.close();
    }
  });

  test('6/10 a corrupt object invalidates the candidate; a changed revision is a new candidate; candidates, previews and the internal catalogue are immutable', () => {
    const w = world();
    try {
      const a = finalizedRevision(w, { 'index.html': '<h1>v1</h1>', 'style.css': 'h1{}' });
      const pv = w.act('preview-create', { revisionId: a.revisionId });
      assert.equal(pv.result.state, 'READY');
      assert.equal(w.act('preview-create', { revisionId: a.revisionId }).result.previewId, pv.result.previewId, 'one preview per exact revision');
      const c1 = w.act('candidate-create', { revisionId: a.revisionId, kind: 'WEBSITE', summary: 'v1' });
      assert.ok(c1.ok);
      assert.equal(c1.result.manifestSha256, a.manifest);
      // A second revision (the same project, the first as base, one byte changed) is a different candidate.
      const r2 = w.act('revision-open', { projectId: a.projectId, baseRevisionId: a.revisionId });
      assert.equal(r2.result.fileCount, 2);
      w.act('file-put', { revisionId: String(r2.result.revisionId), path: 'index.html', encoding: 'utf8', content: '<h1>v2</h1>' });
      const f2 = w.act('revision-finalize', { revisionId: String(r2.result.revisionId) });
      assert.notEqual(f2.result.manifestSha256, a.manifest);
      const c2 = w.act('candidate-create', { revisionId: String(r2.result.revisionId), kind: 'WEBSITE', summary: 'v2' });
      assert.notEqual(c2.result.candidateId, c1.result.candidateId);
      rejects(w.h.store, `UPDATE digital_release_candidates SET manifest_sha256 = ? WHERE id = ?`, String(f2.result.manifestSha256), String(c1.result.candidateId));
      rejects(w.h.store, `UPDATE digital_release_candidates SET revision_id = ? WHERE id = ?`, String(r2.result.revisionId), String(c1.result.candidateId));
      rejects(w.h.store, `DELETE FROM digital_release_candidates WHERE id = ?`, String(c1.result.candidateId));
      rejects(w.h.store, `UPDATE digital_previews SET revision_id = ? WHERE id = ?`, String(r2.result.revisionId), String(pv.result.previewId));
      rejects(w.h.store, `INSERT INTO digital_release_candidates (id, project_id, revision_id, manifest_sha256, kind, summary, fingerprint, work_item_id, maker_employee_id, created_at) VALUES (?, ?, ?, ?, 'WEBSITE', 's', ?, ?, ?, ?)`, newId(), a.projectId, a.revisionId, 'b'.repeat(64), 'c'.repeat(64), w.workItemId, w.s.employee.id, w.h.store.now());
      rejects(w.h.store, `INSERT INTO tool_actions (id, tool_id, code, risk_level, side_effects, mutates_external, requires_idempotency, data_class_ceiling, result_data_class, args_schema_json, cost_per_call_micros, status, created_at) VALUES (?, 'c7d00000-0000-4000-8000-000000000001', 'shell', 'R1', 'NONE', 0, 0, 'D1', 'D1', '{"fields":{}}', 0, 'ACTIVE', ?)`, newId(), w.h.store.now());
      assert.throws(() => GovernanceStore.for(w.h.store).registerTool(w.s.founder, { code: 'my-workspace', driverCode: 'company.digital-workspace', egress: 'NONE' }));
      // Corrupt one object of the first revision on disk: its candidate can no longer be packaged or promoted.
      const css = DigitalStore.for(w.h.store).revisionFiles(a.revisionId).find((f) => f.path === 'style.css')!;
      writeFileSync(new ArtifactStore(w.h.store).objectPath(css.sha256), 'tampered');
      assert.equal(w.act('candidate-create', { revisionId: a.revisionId, kind: 'CONTENT_PACKAGE', summary: 'again' }).code, 'ARTIFACT_INTEGRITY');
      const view = DigitalStore.for(w.h.store).project(a.projectId);
      assert.equal(view.candidates.find((c) => c.id === c1.result.candidateId)?.intact, false);
      assert.equal(view.candidates.find((c) => c.id === c2.result.candidateId)?.intact, false, 'the shared object is corrupt for both revisions');
      assert.throws(() => DigitalStore.for(w.h.store).previewResolution(String(pv.result.previewId)), /PREVIEW_CONTENT_INTEGRITY/);
    } finally {
      w.h.close();
    }
  });

  test('12/24 a promotion binds an active Founder-registered target, its own adapter\'s governed R3 action and the exact manifest; the export resolution re-verifies everything', () => {
    const w = world();
    try {
      const gov = GovernanceStore.for(w.h.store);
      const tool = gov.registerTool(w.s.founder, { code: 'code-host', driverCode: 'test.code-host', egress: 'EXTERNAL', credentialRef: 'vault:code-host' });
      const sha64 = { type: 'string' as const, required: true, maxLength: 64 };
      const id = { type: 'string' as const, required: true, maxLength: 36 };
      const exportAction = gov.registerToolAction(w.s.founder, { toolId: tool.id, code: 'candidate-export', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true, dataClassCeiling: 'D1', argsSchema: { fields: { promotionId: id, candidateId: id, manifestSha256: sha64, targetId: id, branch: { type: 'string', required: true, maxLength: 64 } } }, costPerCallMicros: 0 });
      // A target is a typed, allowlisted identifier — never a URL — and only the Founder registers it.
      assert.throws(() => DigitalStore.for(w.h.store).registerTarget(w.s.founder, { code: 'bad', targetClass: 'CODE_REPOSITORY', adapterCode: 'test.code-host', externalRef: 'https://evil.example/repo', actions: { EXPORT_SOURCE: 'candidate-export' } }));
      assert.throws(() => DigitalStore.for(w.h.store).registerTarget(w.s.employee.ref, { code: 'mine', targetClass: 'CODE_REPOSITORY', adapterCode: 'test.code-host', externalRef: 'github:o/r', actions: { EXPORT_SOURCE: 'candidate-export' } }));
      const target = DigitalStore.for(w.h.store).registerTarget(w.s.founder, { code: 'site', targetClass: 'CODE_REPOSITORY', adapterCode: 'test.code-host', externalRef: 'github:o/r', actions: { EXPORT_SOURCE: 'candidate-export' } });
      const social = DigitalStore.for(w.h.store).registerTarget(w.s.founder, { code: 'channel', targetClass: 'SOCIAL_CHANNEL', adapterCode: 'test.social', externalRef: 'social:page-1', actions: { SOCIAL_PUBLISH: 'post' } });
      const a = finalizedRevision(w);
      const c = w.act('candidate-create', { revisionId: a.revisionId, kind: 'WEBSITE', summary: 'v1' });
      const candidateId = String(c.result.candidateId);
      assert.equal(w.act('promotion-prepare', { candidateId, targetId: social.id, kind: 'SOCIAL_PUBLISH', notBefore: '2030-01-01T09:00:00.000Z', notAfter: '2030-01-01T10:00:00.000Z' }).code, 'CANDIDATE_KIND_MISMATCH');
      assert.equal(w.act('promotion-prepare', { candidateId, targetId: target.id, kind: 'MERGE_PRODUCTION' }).code, 'TARGET_DOES_NOT_SUPPORT_KIND');
      const prep = w.act('promotion-prepare', { candidateId, targetId: target.id, kind: 'EXPORT_SOURCE' });
      assert.ok(prep.ok, String(prep.code));
      const args = prep.result.args as JsonObject;
      assert.equal(args.manifestSha256, a.manifest);
      assert.equal(w.act('promotion-prepare', { candidateId, targetId: target.id, kind: 'EXPORT_SOURCE' }).result.promotionId, prep.result.promotionId, 'the live act is idempotent');
      assert.equal(DigitalStore.for(w.h.store).promotion(String(prep.result.promotionId)).state, 'PREPARED');
      // Datastore gates: a promotion with another candidate's hash, an internal action, or a suspended target is refused.
      const now = w.h.store.now();
      const forged = (over: Record<string, unknown>): string => canonicalJson({ ...args, promotionId: 'P', ...over });
      const pid = newId();
      rejects(w.h.store, `INSERT INTO digital_promotions (id, candidate_id, target_id, kind, tool_action_id, work_item_id, employee_id, args_json, args_sha256, created_at) VALUES (?, ?, ?, 'EXPORT_SOURCE', ?, ?, ?, ?, ?, ?)`, pid, candidateId, target.id, exportAction.id, w.workItemId, w.s.employee.id, forged({ promotionId: pid, manifestSha256: 'f'.repeat(64) }), 'a'.repeat(64), now);
      rejects(w.h.store, `INSERT INTO digital_promotions (id, candidate_id, target_id, kind, tool_action_id, work_item_id, employee_id, args_json, args_sha256, created_at) VALUES (?, ?, ?, 'EXPORT_SOURCE', 'c7d00000-0000-4000-8000-000000000105', ?, ?, ?, ?, ?)`, pid, candidateId, target.id, w.workItemId, w.s.employee.id, forged({ promotionId: pid }), 'a'.repeat(64), now);
      rejects(w.h.store, `UPDATE digital_promotions SET args_json = ? WHERE id = ?`, '{}', String(prep.result.promotionId));
      rejects(w.h.store, `UPDATE digital_promotion_targets SET external_ref = 'github:other/repo' WHERE id = ?`, target.id);
      // The export resolution: exact args only; any change (another hash, another branch) refuses before a driver sends anything.
      const ok = resolvePromotionExport(w.h.store, 'test.code-host', args);
      assert.ok(ok.ok && ok.export.files.length === 1 && ok.export.manifestSha256 === a.manifest);
      assert.deepEqual(resolvePromotionExport(w.h.store, 'test.code-host', { ...args, manifestSha256: 'f'.repeat(64) }), { ok: false, code: 'PROMOTION_ARGS_MISMATCH' });
      assert.deepEqual(resolvePromotionExport(w.h.store, 'test.code-host', { ...args, branch: 'main' }), { ok: false, code: 'PROMOTION_ARGS_MISMATCH' });
      assert.deepEqual(resolvePromotionExport(w.h.store, 'other.adapter', args), { ok: false, code: 'ADAPTER_MISMATCH' });
      DigitalStore.for(w.h.store).setTargetState(w.s.founder, target.id, 'SUSPENDED');
      assert.deepEqual(resolvePromotionExport(w.h.store, 'test.code-host', args), { ok: false, code: 'TARGET_NOT_ACTIVE' });
      // 45: a prepared or published promotion never counts as a Pilot / market outcome, and nothing evaluative was written.
      const ev = DigitalStore.for(w.h.store).evidenceForWorkItems([w.workItemId]);
      assert.equal(ev.publicationIsMarketSuccess, false);
      assert.equal(ev.countsAsOutcome, false);
      for (const t of ['evaluation_results', 'causal_attributions', 'learning_signals', 'external_records', 'outcome_verifications']) assert.equal(Number(db(w.h.store).get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0), 0, t);
    } finally {
      w.h.close();
    }
  });

  test('17/37/38 a scheduled post binds its exact window (the calendar shows it; a moved window is a different act needing its own approval)', () => {
    const w = world();
    try {
      const gov = GovernanceStore.for(w.h.store);
      const tool = gov.registerTool(w.s.founder, { code: 'social-x', driverCode: 'test.social', egress: 'EXTERNAL', credentialRef: 'vault:social-x' });
      const id = { type: 'string' as const, required: true, maxLength: 36 };
      const ts = { type: 'string' as const, required: true, maxLength: 24 };
      gov.registerToolAction(w.s.founder, { toolId: tool.id, code: 'post', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true, dataClassCeiling: 'D1', argsSchema: { fields: { promotionId: id, candidateId: id, manifestSha256: { type: 'string', required: true, maxLength: 64 }, targetId: id, notBefore: ts, notAfter: ts } }, costPerCallMicros: 0 });
      const target = DigitalStore.for(w.h.store).registerTarget(w.s.founder, { code: 'page', targetClass: 'SOCIAL_CHANNEL', adapterCode: 'test.social', externalRef: 'social:page-1', actions: { SOCIAL_PUBLISH: 'post' } });
      const pkg = { v: 1, channelIntent: 'LAUNCH_TEASER', text: 'QANDEEL', media: [], links: [], timing: null, goalRefs: [], hypothesis: 'Invite early interest.' };
      const a = finalizedRevision(w, { 'social/post.json': JSON.stringify(pkg) });
      const c = w.act('candidate-create', { revisionId: a.revisionId, kind: 'SOCIAL_POST', summary: 'Launch teaser' });
      assert.ok(c.ok, String(c.code));
      const p1 = w.act('promotion-prepare', { candidateId: String(c.result.candidateId), targetId: target.id, kind: 'SOCIAL_PUBLISH', notBefore: '2030-01-01T09:00:00.000Z', notAfter: '2030-01-01T10:00:00.000Z' });
      assert.ok(p1.ok, String(p1.code));
      const windows = DigitalStore.for(w.h.store).publicationWindows('2029-12-31T00:00:00.000Z', '2030-01-02T00:00:00.000Z');
      assert.deepEqual(windows.map((x) => [x.promotionId, x.notBefore, x.notAfter, x.state]), [[p1.result.promotionId, '2030-01-01T09:00:00.000Z', '2030-01-01T10:00:00.000Z', 'PREPARED']]);
      assert.equal(w.act('promotion-prepare', { candidateId: String(c.result.candidateId), targetId: target.id, kind: 'SOCIAL_PUBLISH', notBefore: '2020-01-01T09:00:00.000Z', notAfter: '2020-01-01T10:00:00.000Z' }).code, 'SCHEDULE_WINDOW_PASSED');
      // Another future window while this act is live is never silently swapped for it.
      assert.equal(w.act('promotion-prepare', { candidateId: String(c.result.candidateId), targetId: target.id, kind: 'SOCIAL_PUBLISH', notBefore: '2030-02-01T09:00:00.000Z', notAfter: '2030-02-01T10:00:00.000Z' }).code, 'PROMOTION_LIVE_WITH_OTHER_TERMS');
      assert.equal(w.act('promotion-prepare', { candidateId: String(c.result.candidateId), targetId: target.id, kind: 'SOCIAL_PUBLISH', notBefore: '2030-01-01T09:00:00.000Z', notAfter: '2030-01-01T10:00:00.000Z' }).result.promotionId, p1.result.promotionId, 'the same terms are idempotent');
      const args1 = p1.result.args as JsonObject;
      assert.equal(args1.notBefore, '2030-01-01T09:00:00.000Z');
      // The approval fingerprint binds the argument hash: a different window can never reuse this act's approval.
      const row = db(w.h.store).get<{ h: string }>('SELECT args_sha256 AS h FROM digital_promotions WHERE id = ?', String(p1.result.promotionId));
      assert.equal(row?.h, sha256Hex(canonicalJson(args1)));
      assert.notEqual(sha256Hex(canonicalJson({ ...args1, notAfter: '2030-01-01T12:00:00.000Z' })), row?.h);
    } finally {
      w.h.close();
    }
  });

  test('33 restart keeps revisions, previews, candidates and promotions exact (no Cloud-session source of truth)', () => {
    const w = world();
    try {
      const a = finalizedRevision(w, { 'index.html': '<h1>x</h1>' });
      w.act('preview-create', { revisionId: a.revisionId });
      w.act('candidate-create', { revisionId: a.revisionId, kind: 'WEBSITE', summary: 'x' });
      const before = JSON.stringify(DigitalStore.for(w.h.store).project(a.projectId));
      w.h.store.close();
      const reopened = w.h.open();
      assert.equal(JSON.stringify(DigitalStore.for(reopened).project(a.projectId)), before);
      const previewId = DigitalStore.for(reopened).project(a.projectId).previews[0]!.id;
      assert.equal(DigitalStore.for(reopened).previewResolution(previewId).manifestSha256, a.manifest);
    } finally {
      w.h.close();
    }
  });
});
/** A second Work Item of the same Company (after the first run settled), on its own fenced run. */
function world2(prev: World): World {
  const { h, s } = prev;
  const workItemId = governedItem(h, s);
  const { claim } = claimGoverned(h, 'w2');
  const w: World = {
    h, s, fence: claim.fence, workItemId, step: 0,
    act(action, args) {
      const step = ++w.step;
      const intent = recordToolIntent(h.store, claim.fence, { toolCode: DIGITAL_WORKSPACE_TOOL, actionCode: action, args, idempotencyKey: `wi:${workItemId}:s${step}` });
      if (intent.kind !== 'EXECUTE') return { ok: false, result: {}, code: 'code' in intent ? intent.code : intent.kind, kind: intent.kind };
      const { outcome } = recordDigitalWorkspaceAct(h.store, claim.fence, intent.invocationId, intent.actionCode, intent.args);
      return outcome.ok ? { ok: true, result: outcome.result as Record<string, unknown>, code: null, kind: 'EXECUTE' } : { ok: false, result: {}, code: outcome.code, kind: 'EXECUTE' };
    },
  };
  return w;
}
