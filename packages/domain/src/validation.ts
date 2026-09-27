import { createHash } from 'node:crypto';

import { QandeelError } from './errors.js';

/** JSON-compatible value accepted for bounded metadata and checkpoint state. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Keys that name credential material. Metadata, checkpoints and events must never carry secrets
 * (Stage 12 §23, Stage 14 D14-A). This is defense in depth — a key-name guard cannot prove a value
 * is not secret — so the rule remains: callers never put secrets in Company state.
 */
const SECRET_KEY = /password|passwd|passphrase|secret|apikey|accesstoken|refreshtoken|authtoken|bearertoken|idtoken|sessiontoken|sessionkey|credential|privatekey|authorization|cookie/;
const isSecretKey = (key: string): boolean => {
  const k = key.toLowerCase().replace(/[-_\s]/g, '');
  return k === 'token' || k === 'pat' || SECRET_KEY.test(k);
};

export function boundedText(value: unknown, field: string, maxLength: number, { allowEmpty = false } = {}): string {
  if (typeof value !== 'string') throw new QandeelError('VALIDATION_FAILED', `${field} must be a string`, { field });
  if (!allowEmpty && value.trim().length === 0) throw new QandeelError('VALIDATION_FAILED', `${field} must not be empty`, { field });
  if (value.length > maxLength) throw new QandeelError('VALIDATION_FAILED', `${field} exceeds ${maxLength} characters`, { field, maxLength });
  // Control characters other than tab/newline are rejected: they have no place in Company text.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new QandeelError('VALIDATION_FAILED', `${field} contains control characters`, { field });
  }
  return value;
}

/** Short machine code such as a reason or failure code: `UPPER_SNAKE` or `dotted.lower`. */
export function assertCode(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value)) {
    throw new QandeelError('VALIDATION_FAILED', `${field} must be a short machine code`, { field });
  }
  return value;
}

export function assertIntInRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new QandeelError('VALIDATION_FAILED', `${field} must be an integer in [${min}, ${max}]`, { field, min, max });
  }
  return value;
}

/**
 * Deterministic JSON encoding: object keys sorted, no whitespace. Used for fingerprints and
 * checksums so equal values always hash equally regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, '$', 0, false));
}

/**
 * Validates `value` as bounded JSON (size, depth, finite numbers, no secret-named keys) and returns
 * its canonical encoding.
 */
export function boundedJson(value: unknown, field: string, maxBytes: number): string {
  const encoded = JSON.stringify(normalize(value, field, 0, true));
  const bytes = Buffer.byteLength(encoded, 'utf8');
  if (bytes > maxBytes) throw new QandeelError('VALIDATION_FAILED', `${field} exceeds ${maxBytes} bytes`, { field, maxBytes, bytes });
  return encoded;
}

function normalize(value: unknown, path: string, depth: number, guardSecrets: boolean): JsonValue {
  if (depth > 16) throw new QandeelError('VALIDATION_FAILED', 'JSON nesting is too deep', { field: path });
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new QandeelError('VALIDATION_FAILED', 'JSON numbers must be finite', { field: path });
    return value;
  }
  if (Array.isArray(value)) return value.map((v, i) => normalize(v, `${path}[${i}]`, depth + 1, guardSecrets));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      if (guardSecrets && isSecretKey(key)) {
        throw new QandeelError('VALIDATION_FAILED', 'JSON key names credential material; secrets never enter Company state', { field: path });
      }
      out[key] = normalize((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1, guardSecrets);
    }
    return out;
  }
  throw new QandeelError('VALIDATION_FAILED', 'value is not plain JSON', { field: path });
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
