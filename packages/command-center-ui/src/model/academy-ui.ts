/**
 * COMPANY-MAJED-ACADEMY-01 — the seat case's Academy wording and offers that depend on the program (pure; no DOM). The
 * backend stays the authority: these only decide which governed previews the panel offers and how it states the goal.
 */

type Json = Record<string, unknown>;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Shadow work no longer live: the backend accepts the same assignment again. */
export const SHADOW_ENDED: readonly string[] = ['FAILED', 'CANCELLED', 'SUPERSEDED'];

/**
 * The package's shadow assignments the backend still accepts: every one without a live assignment of the same objective
 * (one in progress or finished is never offered twice; a failed, cancelled or superseded one may be assigned again),
 * mirroring the backend's own duplicate rule. A program may need several (its probation minCases).
 */
export const assignableShadow = <A extends Json>(assignments: readonly A[], shadow: readonly Json[]): A[] =>
  assignments.filter((a) => !shadow.some((s) => str(s.objective) === str(a.objective) && !SHADOW_ENDED.includes(str(s.state))));

/** The assessment prompt states the program's own assessmentTrials (never a fixed number). */
export const assessmentPrompt = (assessmentTrials: unknown): string => {
  const n = Number(assessmentTrials);
  return `Start an assessment (the program needs ${Number.isSafeInteger(n) && n > 0 ? `${n} passed` : 'its required passes'}, including a clean hidden holdout)`;
};
