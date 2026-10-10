/**
 * P1-PRODUCT-KNOWLEDGE-01 (D-P1-06) — the Founder's governed rename of an Employee's display name.
 *
 * A name is presentation, never identity (Stage 4 §2): the Employee ID, seat, lifecycle, grants, budget, memory, skills,
 * certifications, conversations and history are untouched — the same Employee, renamed. The act is structured-only and
 * confirmed through the governed preview → fingerprint → confirm boundary, version-safe against the version previewed.
 *
 * - It rewrites nothing that happened before it: Employee history gains one PROFILE row (old name → new name, dated, by
 *   the Founder), the audit row carries codes only, and every earlier record keeps referring to the same Employee ID.
 *   Surfaces that resolve a person by ID show the current name, as they always did.
 * - The approved identity kernel names no one, so it is unchanged; so are the reasoning profile and every certification
 *   (a display name is not a material change to competence).
 */
import { QandeelError, assertId, canonicalJson, type Id } from '@qandeel-company/domain';
import { assertEmployeeName } from '@qandeel-company/governance';
import { containsSecretMaterial } from '@qandeel-company/mind';

import { getEmployeeRow, writeEmployeeHistory } from './governance-core.js';
import type { EmployeeRecord } from './governance-records.js';
import { appendAudit, ts, type StoreContext } from './internal.js';

/** The Founder-hire shapes (D-L1-13): letters, spaces, hyphens, apostrophes — a name can carry no instruction. */
const LATIN_NAME = /^[A-Za-z][A-Za-z' -]{1,39}$/;
const ARABIC_NAME = /^[ء-ي٠-٩][ء-ي٠-٩ ]{1,59}$/;

const refuse = (reason: string, message: string, field: string): never => {
  throw new QandeelError('VALIDATION_FAILED', message, { reason, field });
};

export interface EmployeeRenamePlan {
  readonly employee: EmployeeRecord;
  readonly previous: { readonly given: string; readonly family: string; readonly ar: string | null };
  readonly next: { readonly given: string; readonly family: string; readonly ar: string | null };
}

const arOf = (e: EmployeeRecord): string | null => {
  const ar = (e.profile as { displayName?: { ar?: unknown } } | null)?.displayName?.ar;
  return typeof ar === 'string' ? ar : null;
};

/** Validates a rename against durable state (the preview and the confirm run the same check). */
export function txPlanEmployeeRename(ctx: StoreContext, input: { employeeId: unknown; givenName: unknown; familyName: unknown; displayNameAr?: unknown }): EmployeeRenamePlan {
  const e = getEmployeeRow(ctx, assertId(input.employeeId, 'employeeId'));
  if (e.state === 'RETIRED') throw new QandeelError('INVALID_TRANSITION', 'a retired Employee record is history', { reason: 'RETIRED' });
  const given = typeof input.givenName === 'string' ? input.givenName.trim() : '';
  const family = typeof input.familyName === 'string' ? input.familyName.trim() : '';
  if (!LATIN_NAME.test(given) || !LATIN_NAME.test(family)) refuse('NAME_SHAPE', 'the name is two words of letters (2..40 each)', 'givenName');
  assertEmployeeName({ given, family });
  const ar = input.displayNameAr === undefined || input.displayNameAr === null || input.displayNameAr === '' ? null : String(input.displayNameAr).trim().replace(/\s+/g, ' ');
  if (ar !== null && !ARABIC_NAME.test(ar)) refuse('NAME_SHAPE', 'the Arabic display name is Arabic letters and spaces', 'displayNameAr');
  const previous = { given: e.name.given, family: e.name.family, ar: arOf(e) };
  if (previous.given === given && previous.family === family && previous.ar === ar) throw new QandeelError('INVALID_TRANSITION', 'the Employee already has this name', { reason: 'NAME_UNCHANGED' });
  // Stage 1 §4: every persistent Employee has a distinct name (another Employee's name is never taken).
  if (ctx.db.get('SELECT 1 AS x FROM employees WHERE given_name = ? AND family_name = ? AND id <> ?', given, family, e.id)) refuse('NAME_TAKEN', 'an Employee already has this name', 'givenName');
  return { employee: e, previous, next: { given, family, ar } };
}

/** Writes a confirmed rename (inside a Founder-authority write): one version, one PROFILE history row, one audit row. */
export function txRenameEmployee(ctx: StoreContext, actorRef: string, input: { employeeId: Id; givenName: string; familyName: string; displayNameAr: string | null; expectedVersion: number; reasonCode: string }): EmployeeRecord {
  const plan = txPlanEmployeeRename(ctx, input);
  const e = plan.employee;
  if (e.version !== input.expectedVersion) throw new QandeelError('VERSION_CONFLICT', 'the Employee changed since the preview', { employeeId: e.id, expected: input.expectedVersion, actual: e.version });
  const profile = { ...((e.profile as Record<string, unknown> | null) ?? {}) };
  const displayName = { en: `${plan.next.given} ${plan.next.family}`, ...(plan.next.ar === null ? {} : { ar: plan.next.ar }) };
  profile.displayName = displayName;
  const json = canonicalJson(profile as never);
  if (containsSecretMaterial(json) || json.length > 8_192) throw new QandeelError('VALIDATION_FAILED', 'the profile cannot carry this name', { reason: 'PROFILE_INVALID' });
  const changed = ctx.db.run(`UPDATE employees SET given_name = ?, family_name = ?, profile_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, plan.next.given, plan.next.family, json, ts(ctx), e.id, e.version).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'the Employee changed concurrently', { employeeId: e.id });
  const next = getEmployeeRow(ctx, e.id);
  const from = `${plan.previous.given} ${plan.previous.family}`;
  const to = `${plan.next.given} ${plan.next.family}`;
  writeEmployeeHistory(ctx, next, 'PROFILE', from, to, input.reasonCode, actorRef, { field: 'displayName', previousAr: plan.previous.ar, newAr: plan.next.ar });
  // Rule A: the audit row carries codes and versions only (the names live in the Employee's own history).
  appendAudit(ctx, 'employee.renamed', 'employee', e.id, { actorRef }, 'OK', input.reasonCode, { fromVersion: e.version, toVersion: next.version, arabicName: plan.next.ar === null ? 'NONE' : 'SET' });
  return next;
}
