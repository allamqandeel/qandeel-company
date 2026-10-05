/**
 * The vault contract. A reference is `vault:<name>`; a value exists only inside `use`'s callback. No method
 * returns, logs, stores or echoes a value, and no error carries one.
 */

export const VAULT_REF = /^vault:([a-z0-9][a-z0-9.-]{0,57})$/;

export type VaultErrorCode = 'INVALID_REF' | 'VAULT_UNAVAILABLE' | 'SECRET_NOT_FOUND' | 'SECRET_INVALID' | 'PROTECTION_FAILED' | 'VAULT_TAMPERED' | 'ALREADY_EXISTS';

/** The only error the vault throws: a code and a content-free message (never a value, a path's contents or provider text). */
export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

/** The name inside a `vault:<name>` reference, or INVALID_REF. */
export function vaultName(ref: string): string {
  const m = typeof ref === 'string' ? VAULT_REF.exec(ref) : null;
  if (!m || m[1] === undefined) throw new VaultError('INVALID_REF', 'a vault reference is "vault:<name>" (lower-case letters, digits, dots, dashes)');
  return m[1];
}

/** A secret value is one bounded line: never empty, no control characters, at most 4096 characters. */
export function assertSecretValue(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /\p{Cc}/u.test(value) || value.trim().length !== value.length) {
    throw new VaultError('SECRET_INVALID', 'a secret is one non-empty line of at most 4096 characters without surrounding whitespace');
  }
  return value;
}

export interface SecretVault {
  /** A short code naming the protection in force (recorded in health; never a value). */
  readonly kind: string;
  has(ref: string): Promise<boolean>;
  /**
   * Resolves the reference and hands the value to `fn` for the duration of the call only. The value never
   * escapes this module except through that callback; callers never keep it.
   */
  use<T>(ref: string, fn: (secret: string) => Promise<T> | T): Promise<T>;
}

/** The CI / test vault: values live in process memory only (never on disk, never in a log). */
export class InMemorySecretVault implements SecretVault {
  readonly kind = 'IN_MEMORY';
  readonly #values = new Map<string, string>();

  set(name: string, value: string): this {
    this.#values.set(vaultName(`vault:${name}`), assertSecretValue(value));
    return this;
  }

  remove(name: string): boolean {
    return this.#values.delete(vaultName(`vault:${name}`));
  }

  async has(ref: string): Promise<boolean> {
    return this.#values.has(vaultName(ref));
  }

  async use<T>(ref: string, fn: (secret: string) => Promise<T> | T): Promise<T> {
    const value = this.#values.get(vaultName(ref));
    if (value === undefined) throw new VaultError('SECRET_NOT_FOUND', `no secret is stored for ${ref}`);
    return fn(value);
  }
}
