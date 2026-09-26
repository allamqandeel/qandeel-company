/**
 * Artifact Store (Stage 12 §21): content outside SQLite, metadata inside.
 *
 * SQLite and the filesystem cannot share one atomic transaction, and this module does not pretend
 * otherwise. The write protocol makes every crash window recoverable:
 *
 *   1. write content to a task-owned temp file `tmp/<artifactId>.part` (exclusive create), fsync
 *   2. commit a STAGED metadata row (intent: id, sha256, size)
 *   3. atomically rename the temp file to its content-addressed path `objects/ab/cd/<sha256>`
 *      (same filesystem), fsync the directory where the platform supports it
 *   4. commit READY — only after the object exists with the expected size
 *
 *   crash after 1   → temp file without a row: startup deletes it
 *   crash after 2   → STAGED row + temp file: startup re-hashes and finishes the rename, or
 *                     marks the row ABANDONED; it never becomes READY without verified content
 *   crash after 3   → STAGED row + object: startup verifies the hash and promotes to READY
 *   object, no row  → (e.g. restored older DB) startup quarantines the orphan, never deletes it
 *   row, no object  → READY row is demoted to MISSING and reported unhealthy
 *   bad content     → verification re-hashes and demotes to CORRUPT
 *
 * Paths are derived only from validated UUIDs and SHA-256 hex; a caller's label is display
 * metadata and never becomes a filesystem path.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';

import { QandeelError, assertId, boundedText, isId, isSha256Hex, newId, sha256Hex, type Id, type Timestamp } from '@qandeel-company/domain';

import { appendAudit, appendEvent, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { storeContext, type CompanyStore } from './store.js';
import { containedPath, type WorkspaceLayout } from './workspace.js';

export type ArtifactState = 'STAGED' | 'READY' | 'MISSING' | 'CORRUPT' | 'ABANDONED';

export interface ArtifactRecord {
  readonly id: Id;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mediaType: string;
  readonly label: string | null;
  readonly state: ArtifactState;
  readonly workItemId: Id | null;
  readonly runId: Id | null;
  readonly createdAt: Timestamp;
  readonly verifiedAt: Timestamp | null;
}

export interface PutArtifactInput {
  readonly content: Uint8Array | string;
  readonly mediaType: string;
  readonly label?: string;
  readonly workItemId?: Id;
  readonly runId?: Id;
}

export const ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;
const MEDIA_TYPE = /^[a-z]+\/[a-z0-9][a-z0-9.+-]{0,80}$/;
const TEMP_NAME = /^([0-9a-f-]{36})\.part$/;

function mapArtifact(r: Record<string, unknown>): ArtifactRecord {
  return {
    id: String(r.id) as Id,
    sha256: String(r.sha256),
    sizeBytes: Number(r.size_bytes),
    mediaType: String(r.media_type),
    label: r.label === null ? null : String(r.label),
    state: String(r.state) as ArtifactState,
    workItemId: r.work_item_id === null ? null : (String(r.work_item_id) as Id),
    runId: r.run_id === null ? null : (String(r.run_id) as Id),
    createdAt: String(r.created_at) as Timestamp,
    verifiedAt: r.verified_at === null ? null : (String(r.verified_at) as Timestamp),
  };
}

function fsyncDir(dir: string): void {
  // Directory fsync is unsupported on Windows (NTFS journals the rename itself).
  if (process.platform === 'win32') return;
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function hashFile(file: string): { sha256: string; size: number } | null {
  if (!existsSync(file)) return null;
  const data = readFileSync(file);
  return { sha256: sha256Hex(data), size: data.byteLength };
}

export interface ArtifactRecoveryReport {
  promoted: number;
  abandoned: number;
  tempFilesRemoved: number;
  missing: number;
  orphansQuarantined: number;
  unknownFiles: number;
}

export interface ArtifactVerifyReport {
  checked: number;
  ready: number;
  missing: number;
  corrupt: number;
}

export class ArtifactStore {
  readonly #store: CompanyStore;
  readonly #layout: WorkspaceLayout;

  constructor(store: CompanyStore) {
    this.#store = store;
    this.#layout = store.workspace;
  }

  get #ctx(): StoreContext {
    return storeContext(this.#store);
  }

  objectPath(sha256: string): string {
    if (!isSha256Hex(sha256)) throw new QandeelError('VALIDATION_FAILED', 'artifact hash must be SHA-256 hex');
    return containedPath(this.#layout.objectsDir, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }

  #tempPath(id: Id): string {
    return containedPath(this.#layout.artifactTmpDir, `${assertId(id, 'artifactId')}.part`);
  }

  get quarantineDir(): string {
    return path.join(this.#layout.artifactsDir, 'quarantine');
  }

  put(input: PutArtifactInput): ArtifactRecord {
    const content = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content;
    if (content.byteLength > ARTIFACT_MAX_BYTES) throw new QandeelError('VALIDATION_FAILED', 'artifact exceeds the C1 size ceiling', { maxBytes: ARTIFACT_MAX_BYTES });
    if (!MEDIA_TYPE.test(input.mediaType)) throw new QandeelError('VALIDATION_FAILED', 'mediaType must be a simple type/subtype', { field: 'mediaType' });
    const label = input.label === undefined ? null : boundedText(input.label, 'label', 200);
    const workItemId = input.workItemId === undefined ? null : assertId(input.workItemId, 'workItemId');
    const runId = input.runId === undefined ? null : assertId(input.runId, 'runId');
    const id = newId();
    const sha256 = sha256Hex(content);
    const ctx = this.#ctx;

    // 1. task-owned temp file
    const temp = this.#tempPath(id);
    const fd = openSync(temp, 'wx');
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    ctx.fault('artifact.afterTempWrite');

    // 2. STAGED intent
    ctx.db.immediate('stage artifact', () => {
      const correlationId = workItemId ? getWorkItemRow(ctx, workItemId).correlationId : null;
      const at = ts(ctx);
      ctx.db.run(
        `INSERT INTO artifacts (id, sha256, size_bytes, media_type, label, state, work_item_id, run_id, correlation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'STAGED', ?, ?, ?, ?, ?)`,
        id,
        sha256,
        content.byteLength,
        input.mediaType,
        label,
        workItemId,
        runId,
        correlationId,
        at,
        at,
      );
    });
    ctx.fault('artifact.afterStage');

    // 3. content-addressed publish
    this.#publish(temp, sha256);
    ctx.fault('artifact.afterRename');

    // 4. READY only after the object exists
    return this.#promote(id, 'artifact.put');
  }

  /** Moves a verified temp file into the object store (deduplicating identical content). */
  #publish(temp: string, sha256: string): void {
    const target = this.objectPath(sha256);
    mkdirSync(path.dirname(target), { recursive: true });
    const existing = hashFile(target);
    if (existing && existing.sha256 === sha256) {
      unlinkSync(temp); // identical content already stored: one object, many metadata rows
      return;
    }
    renameSync(temp, target); // replaces a corrupt object of the same name, if any
    fsyncDir(path.dirname(target));
  }

  #promote(id: Id, reason: string): ArtifactRecord {
    const ctx = this.#ctx;
    return ctx.db.immediate('promote artifact', () => {
      const row = ctx.db.get('SELECT * FROM artifacts WHERE id = ?', id);
      if (!row) throw new QandeelError('NOT_FOUND', 'artifact not found', { artifactId: id });
      const record = mapArtifact(row);
      const object = hashFile(this.objectPath(record.sha256));
      if (!object || object.sha256 !== record.sha256 || object.size !== record.sizeBytes) {
        throw new QandeelError('ARTIFACT_INTEGRITY', 'artifact object is absent or does not match its hash; not promoted', { artifactId: id });
      }
      const at = ts(ctx);
      ctx.db.run(`UPDATE artifacts SET state = 'READY', verified_at = ?, updated_at = ? WHERE id = ?`, at, at, id);
      const trace = { correlationId: (record.workItemId ? getWorkItemRow(ctx, record.workItemId).correlationId : id) as Id };
      appendEvent(ctx, 'artifact.ready', 'artifact', id, trace, { sha256: record.sha256, size: record.sizeBytes });
      appendAudit(ctx, 'artifact.ready', 'artifact', id, trace, 'OK', reason, { sha256: record.sha256 });
      return mapArtifact(ctx.db.get('SELECT * FROM artifacts WHERE id = ?', id) ?? {});
    });
  }

  get(id: Id): ArtifactRecord {
    const row = this.#ctx.db.get('SELECT * FROM artifacts WHERE id = ?', assertId(id, 'artifactId'));
    if (!row) throw new QandeelError('NOT_FOUND', 'artifact not found', { artifactId: id });
    return mapArtifact(row);
  }

  listForWorkItem(workItemId: Id): ArtifactRecord[] {
    return this.#ctx.db.all('SELECT * FROM artifacts WHERE work_item_id = ? ORDER BY created_at, id', workItemId).map(mapArtifact);
  }

  /** Reads READY content, re-hashing it; corruption or absence demotes the row and throws. */
  read(id: Id): Buffer {
    const record = this.get(id);
    if (record.state !== 'READY') throw new QandeelError('ARTIFACT_NOT_READY', 'artifact is not READY', { artifactId: id, state: record.state });
    const file = this.objectPath(record.sha256);
    if (!existsSync(file)) {
      this.#demote(record, 'MISSING');
      throw new QandeelError('ARTIFACT_NOT_READY', 'artifact content is missing', { artifactId: id });
    }
    const data = readFileSync(file);
    if (sha256Hex(data) !== record.sha256 || data.byteLength !== record.sizeBytes) {
      this.#demote(record, 'CORRUPT');
      throw new QandeelError('ARTIFACT_INTEGRITY', 'artifact content does not match its hash', { artifactId: id });
    }
    return data;
  }

  #demote(record: ArtifactRecord, state: 'MISSING' | 'CORRUPT' | 'ABANDONED'): void {
    const ctx = this.#ctx;
    ctx.db.immediate('demote artifact', () => {
      const at = ts(ctx);
      ctx.db.run('UPDATE artifacts SET state = ?, updated_at = ? WHERE id = ? AND state = ?', state, at, record.id, record.state);
      appendAudit(ctx, `artifact.${state.toLowerCase()}`, 'artifact', record.id, {}, 'OK', state, { sha256: record.sha256 });
    });
  }

  /** Full integrity verification: re-hashes every READY/MISSING/CORRUPT object. */
  verifyAll(): ArtifactVerifyReport {
    const report: ArtifactVerifyReport = { checked: 0, ready: 0, missing: 0, corrupt: 0 };
    const rows = this.#ctx.db.all(`SELECT * FROM artifacts WHERE state IN ('READY', 'MISSING', 'CORRUPT') ORDER BY id`).map(mapArtifact);
    for (const record of rows) {
      report.checked++;
      const object = hashFile(this.objectPath(record.sha256));
      if (!object) {
        if (record.state !== 'MISSING') this.#demote(record, 'MISSING');
        report.missing++;
      } else if (object.sha256 !== record.sha256 || object.size !== record.sizeBytes) {
        if (record.state !== 'CORRUPT') this.#demote(record, 'CORRUPT');
        report.corrupt++;
      } else {
        if (record.state !== 'READY') this.#promote(record.id, 'artifact.reverified');
        report.ready++;
      }
    }
    return report;
  }

  /** Startup recovery of the cross-store boundary (bounded; idempotent across restarts). */
  recover(limit = 10_000): ArtifactRecoveryReport {
    const report: ArtifactRecoveryReport = { promoted: 0, abandoned: 0, tempFilesRemoved: 0, missing: 0, orphansQuarantined: 0, unknownFiles: 0 };
    const ctx = this.#ctx;

    // STAGED rows: finish the protocol or abandon — never READY without verified content.
    for (const record of ctx.db.all(`SELECT * FROM artifacts WHERE state = 'STAGED' ORDER BY id LIMIT ?`, limit).map(mapArtifact)) {
      const temp = this.#tempPath(record.id);
      const tempHash = hashFile(temp);
      if (tempHash && tempHash.sha256 === record.sha256 && tempHash.size === record.sizeBytes) this.#publish(temp, record.sha256);
      const object = hashFile(this.objectPath(record.sha256));
      if (object && object.sha256 === record.sha256 && object.size === record.sizeBytes) {
        this.#promote(record.id, 'recovery.promoted');
        report.promoted++;
      } else {
        this.#demote(record, 'ABANDONED');
        report.abandoned++;
      }
    }

    // Temp files: task-owned staging only; anything left now has no live writer.
    for (const name of readdirSync(this.#layout.artifactTmpDir)) {
      const match = TEMP_NAME.exec(name);
      if (!match || !isId(match[1])) {
        report.unknownFiles++;
        continue;
      }
      unlinkSync(containedPath(this.#layout.artifactTmpDir, name));
      report.tempFilesRemoved++;
    }

    // READY rows whose object vanished (cheap existence/size check; full re-hash is verifyAll).
    for (const record of ctx.db.all(`SELECT * FROM artifacts WHERE state = 'READY' ORDER BY id LIMIT ?`, limit).map(mapArtifact)) {
      const file = this.objectPath(record.sha256);
      if (!existsSync(file) || statSync(file).size !== record.sizeBytes) {
        this.#demote(record, 'MISSING');
        report.missing++;
      }
    }

    // Orphan objects: content without any metadata row. Quarantined, never deleted.
    let seen = 0;
    for (const a of existsSync(this.#layout.objectsDir) ? readdirSync(this.#layout.objectsDir) : []) {
      const dirA = containedPath(this.#layout.objectsDir, a);
      if (!/^[0-9a-f]{2}$/.test(a) || !statSync(dirA).isDirectory()) {
        report.unknownFiles++;
        continue;
      }
      for (const b of readdirSync(dirA)) {
        const dirB = containedPath(dirA, b);
        if (!/^[0-9a-f]{2}$/.test(b) || !statSync(dirB).isDirectory()) {
          report.unknownFiles++;
          continue;
        }
        for (const name of readdirSync(dirB)) {
          if (++seen > limit) return report;
          if (!isSha256Hex(name) || !name.startsWith(a + b)) {
            report.unknownFiles++;
            continue;
          }
          const referenced = ctx.db.get('SELECT 1 AS present FROM artifacts WHERE sha256 = ? LIMIT 1', name);
          if (referenced) continue;
          mkdirSync(this.quarantineDir, { recursive: true });
          renameSync(containedPath(dirB, name), containedPath(this.quarantineDir, `${name}.${Date.now()}.orphan`));
          ctx.db.immediate('audit orphan', () => appendAudit(ctx, 'artifact.orphan_quarantined', 'artifact', name.slice(0, 64), {}, 'OK', 'ORPHAN_OBJECT', {}));
          report.orphansQuarantined++;
        }
      }
    }
    return report;
  }

  /** READY artifacts for a backup manifest (IDs and hashes only). */
  manifestEntries(): { id: Id; sha256: string; sizeBytes: number }[] {
    return this.#ctx.db
      .all<{ id: string; sha256: string; size_bytes: number }>(`SELECT id, sha256, size_bytes FROM artifacts WHERE state = 'READY' ORDER BY id`)
      .map((r) => ({ id: r.id as Id, sha256: r.sha256, sizeBytes: Number(r.size_bytes) }));
  }
}
