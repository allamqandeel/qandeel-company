/**
 * TEST-ONLY Founder seam. It is not part of the production package surface:
 *
 * - `@qandeel-company/storage/testing` resolves only under the `qandeel-test` export condition
 *   (production resolution maps it to nothing);
 * - importing this module outside a process started with that condition throws;
 * - the verifier forbids any production source from importing it.
 *
 * Production has no Founder-authority surface in C2: a Founder reference is not authentication, and
 * the authenticated Founder surface is C5 (D-C2-13). Tests arm a workspace here to exercise the
 * Founder-authority paths, and reach ACTIVE Employees without the C3 Academy, which C2 must never
 * fake in production.
 */
import { QandeelError } from '@qandeel-company/domain';

import { founderSurfaceInternals, type GovernanceStore } from '../governance.js';
import type { EmployeeRecord } from '../governance-records.js';

export const TEST_CONDITION = 'qandeel-test';

const startedWithTestCondition = [...process.execArgv, ...(process.env['NODE_OPTIONS'] ?? '').split(/\s+/)].some((a) => a === `--conditions=${TEST_CONDITION}` || a === `-C=${TEST_CONDITION}`);
if (!startedWithTestCondition) {
  throw new QandeelError('FOUNDER_SURFACE_UNAVAILABLE', `the Founder test seam loads only in a process started with --conditions=${TEST_CONDITION}`);
}

/** Arms the Founder-authority surface for one workspace root in this process (tests only). */
export function armFounderTestSurface(root: string): void {
  founderSurfaceInternals.arm(root);
}

export function disarmFounderTestSurface(root: string): void {
  founderSurfaceInternals.disarm(root);
}

/** SHADOW / PROBATION → ACTIVE without Academy certification: a test fixture, never a product path. */
export function activateEmployeeForTest(gov: GovernanceStore, founderRef: string, employeeId: string): EmployeeRecord {
  return founderSurfaceInternals.activateEmployee(gov, founderRef, employeeId);
}
