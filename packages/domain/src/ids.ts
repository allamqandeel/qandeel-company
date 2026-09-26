import { randomUUID } from 'node:crypto';

import { QandeelError } from './errors.js';

/**
 * Stable opaque identifiers (Stage 2 §8). IDs are random UUIDv4 values from the Node standard
 * library and carry no business meaning: names, owners, states and priorities can change without
 * changing identity.
 */
export type Id = string & { readonly __brand: 'Id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newId(): Id {
  return randomUUID() as Id;
}

export function isId(value: unknown): value is Id {
  return typeof value === 'string' && UUID.test(value);
}

export function assertId(value: unknown, field: string): Id {
  if (!isId(value)) throw new QandeelError('VALIDATION_FAILED', `${field} is not a valid id`, { field });
  return value;
}

/**
 * Opaque reference to an entity owned by a later subsystem (Owner, Actor, Contributor, Policy…).
 * C1 stores the reference verbatim and never claims it was authenticated or authorized: no
 * identity, permission or approval system exists in C1.
 */
export type OpaqueRef = string & { readonly __brand: 'OpaqueRef' };

const OPAQUE_REF = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:-]{1,128}$/;

export function isOpaqueRef(value: unknown): value is OpaqueRef {
  return typeof value === 'string' && OPAQUE_REF.test(value);
}

export function assertOpaqueRef(value: unknown, field: string): OpaqueRef {
  if (!isOpaqueRef(value)) {
    throw new QandeelError('VALIDATION_FAILED', `${field} must be an opaque reference "<kind>:<id>"`, { field });
  }
  return value;
}
