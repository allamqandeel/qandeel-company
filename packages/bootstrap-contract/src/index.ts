/**
 * C0 bootstrap contract.
 *
 * This package exists only to prove the toolchain: TypeScript compilation,
 * npm workspace resolution, test execution and the Node 24 runtime line.
 * It deliberately contains no Company runtime behaviour. C1 owns the real
 * package structure.
 */

export const REQUIRED_NODE_MAJOR = 24;

export interface BootstrapMetadata {
  readonly project: 'qandeel-company';
  readonly stage: 'C0';
  readonly nextStage: 'C1';
  readonly companyRuntimeImplemented: false;
}

export const BOOTSTRAP_METADATA: BootstrapMetadata = Object.freeze({
  project: 'qandeel-company',
  stage: 'C0',
  nextStage: 'C1',
  companyRuntimeImplemented: false,
});

export type RuntimeCheck =
  | { readonly status: 'ok'; readonly nodeMajor: number; readonly requiredNodeMajor: number }
  | { readonly status: 'unsupported-runtime'; readonly nodeMajor: number; readonly requiredNodeMajor: number }
  | { readonly status: 'unparseable-version'; readonly received: string; readonly requiredNodeMajor: number };

/**
 * Deterministic check of a Node version string (as in `process.versions.node`).
 * Pure: the same input always yields the same result.
 */
export function checkRuntime(nodeVersion: string): RuntimeCheck {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion.trim());
  const majorText = match?.[1];
  if (majorText === undefined) {
    return { status: 'unparseable-version', received: nodeVersion, requiredNodeMajor: REQUIRED_NODE_MAJOR };
  }
  const nodeMajor = Number(majorText);
  return nodeMajor === REQUIRED_NODE_MAJOR
    ? { status: 'ok', nodeMajor, requiredNodeMajor: REQUIRED_NODE_MAJOR }
    : { status: 'unsupported-runtime', nodeMajor, requiredNodeMajor: REQUIRED_NODE_MAJOR };
}
