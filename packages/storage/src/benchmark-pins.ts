/**
 * L1-02 / D-L1-23 — the pins of a BQM-2 Academy package: the exact Benchmark Qualification Method declaration digest and
 * the ANSWER contract version + digest it runs under, recorded on the package row at registration (0018) and never
 * rewritten. A BQM-2 package runs only under exactly those pins: the store refuses to create observations, and the
 * Context Assembler refuses an in-flight observation's context (zero tokens), whenever the running build differs. A
 * BQM-1 package (v1, v2, v3) pins nothing and is never affected.
 */
import { ANSWER_CONTRACT_SHA256, ANSWER_CONTRACT_VERSION } from '@qandeel-company/governance';
import { BQM2_DECLARATION_SHA256, packageMethod, type AcademyPackage, type BenchmarkMethodVersion } from '@qandeel-company/mind';

import type { StoreContext } from './internal.js';

export interface BenchmarkPins {
  readonly method: BenchmarkMethodVersion;
  readonly methodSha256: string | null;
  readonly answerContractVersion: string | null;
  readonly answerContractSha256: string | null;
}

export type BenchmarkPinMismatch = 'BENCHMARK_METHOD_MISMATCH' | 'ANSWER_CONTRACT_MISMATCH';

/** Null when the pins are exactly this build's (or the package is BQM-1); otherwise which pin differs. */
export function benchmarkPinMismatch(pins: BenchmarkPins): BenchmarkPinMismatch | null {
  if (pins.method !== 'BQM-2') return null;
  if (pins.methodSha256 !== BQM2_DECLARATION_SHA256) return 'BENCHMARK_METHOD_MISMATCH';
  if (pins.answerContractVersion !== ANSWER_CONTRACT_VERSION || pins.answerContractSha256 !== ANSWER_CONTRACT_SHA256) return 'ANSWER_CONTRACT_MISMATCH';
  return null;
}

/** The pins a package definition declares. */
export function pinsOfPackage(pkg: AcademyPackage): BenchmarkPins {
  return { method: packageMethod(pkg), methodSha256: pkg.benchmarkMethod?.declarationSha256 ?? null, answerContractVersion: pkg.benchmarkMethod?.answerContract.version ?? null, answerContractSha256: pkg.benchmarkMethod?.answerContract.sha256 ?? null };
}

/** The pins recorded on a package row. */
export function pinsOfRow(r: Record<string, unknown>): BenchmarkPins {
  const s = (k: string): string | null => (r[k] == null ? null : String(r[k]));
  return { method: r.benchmark_method === 'BQM-2' ? 'BQM-2' : 'BQM-1', methodSha256: s('method_sha256'), answerContractVersion: s('answer_contract_version'), answerContractSha256: s('answer_contract_sha256') };
}

/** The recorded pins of the package a benchmark run belongs to. */
export function txBenchmarkRunPins(ctx: StoreContext, benchmarkRunId: string): BenchmarkPins | null {
  const r = ctx.db.get('SELECT p.benchmark_method, p.method_sha256, p.answer_contract_version, p.answer_contract_sha256 FROM skill_benchmark_runs b JOIN academy_packages p ON p.id = b.package_id WHERE b.id = ?', benchmarkRunId);
  return r ? pinsOfRow(r) : null;
}
