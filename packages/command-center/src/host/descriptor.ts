/**
 * The Founder host descriptor (OPS, D-OPS-02) — how a launcher finds the ONE running Company host of a workspace without
 * trusting a PID, a port or a file alone.
 *
 *   <workspace>/runtime/founder-host.json            { version, instanceId, pid, port, startedAt, publicKey }
 *   <workspace>/runtime/founder-host.stop-request.json  a one-shot controlled-stop request (instanceId + requestId)
 *   <workspace>/runtime/founder-host.start.lock       held by the one launcher that is starting a host
 *   <workspace>/runtime/founder-host.log              the host's content-free JSON log lines (rotated)
 *
 * Content-free by construction: IDs, a PID, a loopback port, a timestamp and an Ed25519 PUBLIC key. No private key, no
 * token, no Founder or Company content is ever written here. The instance's private key lives only in the host process
 * memory; the launcher sends a random nonce and verifies the signature, so a process that later squats a freed port
 * cannot pass for the host. The canonical liveness truth stays the durable supervisor lease (D-C1-22): the descriptor
 * only says WHERE the lease holder's surface listens and how to recognise it.
 */
import { createPublicKey, generateKeyPairSync, randomBytes, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { layoutFor } from '@qandeel-company/storage';

export const HOST_DESCRIPTOR_FILE = 'founder-host.json';
export const HOST_STOP_REQUEST_FILE = 'founder-host.stop-request.json';
export const HOST_START_LOCK_FILE = 'founder-host.start.lock';
export const HOST_LOG_FILE = 'founder-host.log';
export const HOST_IDENTITY_PATH = '/host/identity';
export const HOST_STOP_PATH = '/host/stop';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NONCE = /^[0-9a-f]{64}$/;

export interface HostDescriptor {
  readonly version: 1;
  readonly instanceId: string;
  readonly pid: number;
  readonly port: number;
  readonly startedAt: string;
  /** Ed25519 SPKI public key, base64 (DER). Verifies the host's identity proofs; it unlocks nothing. */
  readonly publicKey: string;
}

export interface HostPaths {
  readonly root: string;
  readonly runtimeDir: string;
  readonly descriptor: string;
  readonly stopRequest: string;
  readonly startLock: string;
  readonly log: string;
}

/** The host files of a workspace (the canonical, real path when it exists, so every process names the same files). */
export function hostPaths(workspace: string): HostPaths {
  const resolved = path.resolve(workspace);
  let root = resolved;
  try {
    root = realpathSync.native(resolved);
  } catch {
    // A missing workspace is reported by discovery; its paths are still well defined.
  }
  const { runtimeDir } = layoutFor(root);
  return Object.freeze({
    root,
    runtimeDir,
    descriptor: path.join(runtimeDir, HOST_DESCRIPTOR_FILE),
    stopRequest: path.join(runtimeDir, HOST_STOP_REQUEST_FILE),
    startLock: path.join(runtimeDir, HOST_START_LOCK_FILE),
    log: path.join(runtimeDir, HOST_LOG_FILE),
  });
}

/** Atomic replace: a reader sees the old file or the new one, never a torn write (rename replaces on Windows too). */
export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    renameSync(tmp, file);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined; // present but unreadable / torn: the caller treats it as stale metadata
  }
}

/** The descriptor, `null` when absent, `undefined` when present but not a valid descriptor (stale / foreign metadata). */
export function readDescriptor(paths: HostPaths): HostDescriptor | null | undefined {
  const raw = readJson(paths.descriptor);
  if (raw === null || raw === undefined) return raw;
  const d = raw as Partial<HostDescriptor>;
  const valid =
    d.version === 1 &&
    typeof d.instanceId === 'string' &&
    UUID.test(d.instanceId) &&
    Number.isInteger(d.pid) &&
    (d.pid as number) > 0 &&
    Number.isInteger(d.port) &&
    (d.port as number) > 0 &&
    (d.port as number) <= 65535 &&
    typeof d.startedAt === 'string' &&
    typeof d.publicKey === 'string' &&
    d.publicKey.length < 512;
  return valid ? (d as HostDescriptor) : undefined;
}

/** Removes the descriptor only when it still names this instance (a newer host's descriptor is never touched). */
export function removeDescriptorIfOwned(paths: HostPaths, instanceId: string): boolean {
  const d = readDescriptor(paths);
  if (!d || d.instanceId !== instanceId) return false;
  rmSync(paths.descriptor, { force: true });
  return true;
}

export function removeStaleDescriptor(paths: HostPaths): void {
  rmSync(paths.descriptor, { force: true });
}

export const newNonce = (): string => randomBytes(32).toString('hex');
export const isNonce = (v: unknown): v is string => typeof v === 'string' && NONCE.test(v);

const identityMessage = (instanceId: string, port: number, nonce: string): Buffer => Buffer.from(`qandeel-founder-host|identity|v1|${instanceId}|${port}|${nonce}`, 'utf8');

/** Verifies a host's identity proof against the descriptor's public key (false on any malformed input). */
export function verifyIdentityProof(descriptor: HostDescriptor, nonce: string, proof: { instanceId?: unknown; signature?: unknown }): boolean {
  if (proof.instanceId !== descriptor.instanceId || typeof proof.signature !== 'string' || proof.signature.length > 256) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(descriptor.publicKey, 'base64'), format: 'der', type: 'spki' });
    return verify(null, identityMessage(descriptor.instanceId, descriptor.port, nonce), key, Buffer.from(proof.signature, 'base64'));
  } catch {
    return false;
  }
}

/**
 * The running host's identity (in the host process only). The private key never leaves this object: no getter, no
 * serialization, not in the descriptor, not in a log.
 */
export class HostIdentity {
  readonly instanceId: string;
  readonly publicKey: string;
  readonly #privateKey: KeyObject;

  constructor(instanceId: string) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    this.instanceId = instanceId;
    this.publicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    this.#privateKey = privateKey;
  }

  prove(port: number, nonce: string): { instanceId: string; signature: string } {
    return { instanceId: this.instanceId, signature: sign(null, identityMessage(this.instanceId, port, nonce), this.#privateKey).toString('base64') };
  }

  descriptor(pid: number, port: number, startedAt: string): HostDescriptor {
    return { version: 1, instanceId: this.instanceId, pid, port, startedAt, publicKey: this.publicKey };
  }

  toJSON(): Record<string, string> {
    return { instanceId: this.instanceId };
  }
}

export interface StopRequest {
  readonly version: 1;
  readonly instanceId: string;
  readonly requestId: string;
}

/**
 * The launcher's half of a controlled stop: it proves it can WRITE this workspace (the same trust anchor as `launch`,
 * which mints a Founder launch token from the same files) by leaving a one-shot request naming the instance.
 */
export function writeStopRequest(paths: HostPaths, instanceId: string): string {
  const requestId = newNonce();
  writeJsonAtomic(paths.stopRequest, { version: 1, instanceId, requestId } satisfies StopRequest);
  return requestId;
}

/** The host's half: accepts exactly one matching request and consumes it (no replay: the file is gone afterwards). */
export function consumeStopRequest(paths: HostPaths, instanceId: string, requestId: unknown): boolean {
  if (!isNonce(requestId)) return false;
  const raw = readJson(paths.stopRequest) as Partial<StopRequest> | null | undefined;
  if (!raw || raw.version !== 1 || raw.instanceId !== instanceId || !isNonce(raw.requestId)) return false;
  if (!timingSafeEqual(Buffer.from(raw.requestId, 'utf8'), Buffer.from(requestId, 'utf8'))) return false;
  rmSync(paths.stopRequest, { force: true });
  return true;
}
