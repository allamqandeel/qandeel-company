#!/usr/bin/env node
// L1-01 mutation check: proves the live-provider foundation's gates are not vacuous.
//
// Each mutation removes (or bypasses) one semantic gate in the COMPILED output (packages/*/dist), runs the proof
// tests that must catch it, requires them to FAIL, and restores every file (always, in `finally`). TypeScript sources
// are never touched. Run after `npm run build`:
//
//   npm run l1:mutation                           all mutations
//   npm run l1:mutation -- --shard 1/1            the one shard (CI parallelism; the suite is small)
//   npm run l1:mutation -- --report <file.json>   also write the ids run / caught (CI proof parity)
//   npm run l1:mutation -- --only <id,id>         only the named mutations (a local focus; never a parity report)
//
// Families (task §18): a plaintext vault; an arbitrary provider URL / a followed redirect / an endpoint outside the
// allowlist; a wrong E4 thinking mapping; a secret accepted on the vault command line; 401 retried; 402 transient; a
// timeout marked not-sent; a cache hit billed as a miss while claimed actual; off-peak ignored; a reservation cheaper
// than the worst case; D3 egress; the whole ProviderRequest (or a credential) entering the provider body; a raw error /
// another model's answer accepted; alias drift ignored (adapter and provisioning); cached > input accepted; the reasoning
// class dropped from the request.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Proof tests resolve the test-only Founder seam through the `qandeel-test` condition (D-C2-13).
const TEST_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=qandeel-test`.trim() };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = { cwd: 'packages/secret-vault', tests: ['dist/test/l1-vault.test.js'] };
const ADAPTER = { cwd: 'packages/model-providers', tests: ['dist/test/l1-deepseek.test.js'] };
const ECON = { cwd: 'packages/governance', tests: ['dist/test/l1-economics.test.js'] };
const STORE = { cwd: 'packages/storage', tests: ['dist/test/l1-provider-pricing.test.js'] };
// L1-02 (D-L1-18): the answer's provenance binding and the answer-bound evaluation.
const ANSWERS = { cwd: 'packages/storage', tests: ['dist/test/l1-02-answers.test.js'] };
const RUNTIME = { cwd: 'packages/runtime', tests: ['dist/test/l1/l1-runtime.test.js'] };
// L1-02: the production activation path (real runtime, real Founder session, real adapter over a fake transport) and
// the authenticated activation surface over loopback HTTP.
const ACTIVATION = { cwd: 'packages/runtime', tests: ['dist/test/l1/l1-02-activation.test.js'] };
const ACTIVATION_SURFACE = { cwd: 'packages/command-center', tests: ['dist/test/l1-02-activation-surface.test.js'] };
// D-L1-23: BQM-2 at the store boundary (pins, observations, FAILED vs VOID, decide-once, migration 0018).
const BQM2_STORE = { cwd: 'packages/storage', tests: ['dist/test/l1-02-bqm2.test.js'] };
// D-L1-24: the answer-only fence on the real employee loop (scripted governed services).
const ANSWER_ONLY = { cwd: 'packages/runtime', tests: ['dist/test/l1/l1-02-answer-only.test.js'] };
// D-L1-27: reusable Skill qualification at the store boundary (0019: owner vs reuse binding, fail-closed reuse, install).
const REUSE_STORE = { cwd: 'packages/storage', tests: ['dist/test/l1-02-skill-reuse.test.js'] };

const GOV = 'packages/governance/dist/src';
const PROVIDERS = 'packages/model-providers/dist/src/deepseek';
const SV = 'packages/secret-vault/dist/src';
const STORAGE = 'packages/storage/dist/src';
const RT = 'packages/runtime/dist/src/c2';
const MIND = 'packages/mind/dist/src';

const MUTATIONS = [
  // --- The vault ----------------------------------------------------------------------------------------------------
  // The Protect gate and the hidden-prompt gate sit BEHIND the platform gate, so the secret-vault suite also proves them
  // on every platform (a throwaway child lifts the platform gate; a piped stdin) — otherwise the first and the third
  // mutation survive on non-Windows CI (D-L1-11, validation / proof portability).
  {
    id: 'l1-vault-plaintext',
    gate: 'a secret is protected (DPAPI, CurrentUser) before it is written; the file never holds the plaintext',
    edits: [{ file: `${SV}/windows-dpapi.js`, search: "const protectedBase64 = await this.#dpapi('Protect', Buffer.from(value, 'utf8').toString('base64'));", replace: "const protectedBase64 = Buffer.from(value, 'utf8').toString('base64');", expectedCount: 1 }],
    runs: [VAULT],
  },
  {
    id: 'l1-vault-secret-on-command-line',
    gate: 'the vault command refuses a secret given as an argument before anything else happens',
    edits: [{ file: `${SV}/cli.js`, search: 'if (argv.some((a) => FORBIDDEN_FLAGS.test(a)))', replace: 'if (false)', expectedCount: 1 }],
    runs: [VAULT],
  },
  {
    id: 'l1-vault-piped-secret-accepted',
    gate: 'the hidden prompt refuses a non-interactive stdin (a secret is typed, never piped)',
    edits: [{ file: `${SV}/cli.js`, search: "if (!stdin.isTTY || typeof stdin.setRawMode !== 'function')", replace: 'if (false)', expectedCount: 1 }],
    runs: [VAULT],
  },
  // --- The request boundary ------------------------------------------------------------------------------------------
  {
    id: 'l1-provider-arbitrary-url',
    gate: 'the HTTPS transport sends only to the fixed DeepSeek origin',
    edits: [{ file: `${PROVIDERS}/https-transport.js`, search: 'res = await fetch(`${DEEPSEEK_API_ORIGIN}${request.path}`, {', replace: "res = await fetch(`${process.env.QANDEEL_PROVIDER_ORIGIN ?? 'https://evil.example'}${request.path}`, {", expectedCount: 1 }],
    runs: [ADAPTER],
  },
  {
    id: 'l1-provider-follows-redirect',
    gate: 'the HTTPS transport never follows a redirect to another host',
    edits: [{ file: `${PROVIDERS}/https-transport.js`, search: "redirect: 'error',", replace: "redirect: 'follow',", expectedCount: 1 }],
    runs: [ADAPTER],
  },
  {
    id: 'l1-provider-endpoint-allowlist-removed',
    gate: 'the HTTPS transport refuses a path outside the endpoint allowlist before any fetch',
    edits: [{ file: `${PROVIDERS}/https-transport.js`, search: 'assertDeepSeekEndpoint(request.method, request.path);', replace: '', expectedCount: 1 }],
    runs: [ADAPTER],
  },
  {
    id: 'l1-thinking-e4-not-max',
    gate: 'E4 (EXTENDED) maps to max thinking effort; E1 to none',
    edits: [{ file: `${PROVIDERS}/declaration.js`, search: "E1: 'none', E2: 'low', E3: 'high', E4: 'max'", replace: "E1: 'none', E2: 'low', E3: 'high', E4: 'high'", expectedCount: 1 }],
    runs: [ADAPTER],
  },
  {
    id: 'l1-request-leaks-provider-request',
    gate: 'the chat body carries exactly the allowlisted fields, never the ProviderRequest (deployment, codes) or anything of the Company',
    edits: [{ file: `${PROVIDERS}/adapter.js`, search: "const body = { model: DEEPSEEK_MODEL_CODE, messages, max_tokens: request.maxOutputTokens, stream: false, ...thinkingFor(request.reasoningClass), response_format: { type: 'json_object' } };\n    for (const k of Object.keys(body))", replace: "const body = { ...request, model: DEEPSEEK_MODEL_CODE, messages, max_tokens: request.maxOutputTokens, stream: false, ...thinkingFor(request.reasoningClass), response_format: { type: 'json_object' } };\n    for (const k of [])", expectedCount: 1 }],
    runs: [ADAPTER, RUNTIME],
  },
  {
    // The official contract carries the effort TOP-LEVEL beside `thinking: { type }`; nested inside `thinking` the
    // provider ignores it and E2 / E3 / E4 silently think at the default effort (the PR #17 review BLOCKER).
    id: 'l1-reasoning-effort-nested-in-thinking',
    gate: 'E2 / E3 / E4 send thinking.enabled plus a top-level reasoning_effort, never an effort nested inside thinking',
    edits: [{ file: `${PROVIDERS}/adapter.js`, search: "{ thinking: { type: 'enabled' }, reasoning_effort: effort }", replace: "{ thinking: { type: 'enabled', reasoning_effort: effort } }", expectedCount: 1 }],
    runs: [ADAPTER],
  },
  {
    id: 'l1-reasoning-effort-not-allowlisted',
    gate: 'the request field allowlist admits the top-level reasoning_effort (a thinking request is never refused as INVALID_REQUEST)',
    edits: [{ file: `${PROVIDERS}/declaration.js`, search: "'thinking', 'reasoning_effort', 'response_format'", replace: "'thinking', 'response_format'", expectedCount: 1 }],
    runs: [ADAPTER],
  },
  {
    id: 'l1-reasoning-class-dropped',
    gate: "the route's reasoning class travels with the ProviderRequest (the adapter maps it; nothing else decides it)",
    edits: [{ file: `${RT}/model-runtime.js`, search: 'reasoningClass: d.reasoningClass, messages: context.messages', replace: "reasoningClass: 'E4', messages: context.messages", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'l1-recorded-message-does-not-end-run',
    gate: 'a thread-bound run ends once its message is recorded: one answer, one governed call, never a second message or a RUN_LIMIT after a delivered reply (D-L1-09)',
    edits: [{ file: `${RT}/employee-task.js`, search: "if (sent.outcome === 'RECORDED') {", replace: 'if (false) {', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  // --- The response boundary -----------------------------------------------------------------------------------------
  {
    id: 'l1-other-model-answer-accepted',
    gate: "an answer that names another model than the alias breaks the contract",
    edits: [{ file: `${PROVIDERS}/adapter.js`, search: 'if (body.model !== undefined && body.model !== DEEPSEEK_MODEL_CODE)', replace: 'if (false)', expectedCount: 1 }],
    runs: [ADAPTER],
  },
  {
    id: 'l1-cache-report-inconsistent-accepted',
    gate: 'cache hit + cache miss must account for the whole prompt',
    edits: [{ file: `${PROVIDERS}/adapter.js`, search: 'if (hit !== null && miss !== null && hit + miss !== input)', replace: 'if (false)', expectedCount: 1 }],
    runs: [ADAPTER],
  },
  {
    id: 'l1-non-string-content-accepted',
    gate: 'a non-string answer content is a contract violation, never stringified into a proposal',
    edits: [{ file: `${PROVIDERS}/adapter.js`, search: "const outputText = typeof content === 'string' ? content : content === null ? '' : undefined;", replace: "const outputText = typeof content === 'string' ? content : content === null ? '' : JSON.stringify(content);", expectedCount: 1 }],
    runs: [ADAPTER],
  },
  // --- Failures ------------------------------------------------------------------------------------------------------
  {
    id: 'l1-401-retried',
    gate: '401 is an AUTH operational hold, never a retryable transient',
    edits: [{ file: `${PROVIDERS}/adapter.js`, search: "case 401:\n            return 'AUTH';", replace: "case 401:\n            return 'TRANSIENT';", expectedCount: 1 }],
    runs: [ADAPTER, RUNTIME],
  },
  {
    id: 'l1-402-transient',
    gate: '402 is a BILLING hold, never a transient',
    edits: [{ file: `${PROVIDERS}/adapter.js`, search: "case 402:\n            return 'BILLING';", replace: "case 402:\n            return 'TRANSIENT';", expectedCount: 1 }],
    runs: [ADAPTER],
  },
  {
    id: 'l1-timeout-marked-not-sent',
    gate: 'a timeout after the request may have left the host is TIMEOUT_AFTER_SEND (possibly billed), never a not-sent transient',
    edits: [{ file: `${PROVIDERS}/adapter.js`, search: "error.phase === 'TIMEOUT' ? 'TIMEOUT_AFTER_SEND' : 'UNKNOWN'", replace: "error.phase === 'TIMEOUT' ? 'TRANSIENT' : 'UNKNOWN'", expectedCount: 1 }],
    runs: [ADAPTER, RUNTIME],
  },
  // --- Alias drift ---------------------------------------------------------------------------------------------------
  {
    id: 'l1-alias-drift-ignored-adapter',
    gate: 'a changed public identity of the alias is DRIFT, and the adapter refuses to call it',
    edits: [{ file: `${PROVIDERS}/adapter.js`, search: "result: name === DEEPSEEK_EXPECTED_PUBLIC_NAME ? 'MATCH' : 'DRIFT'", replace: "result: 'MATCH'", expectedCount: 1 }],
    runs: [ADAPTER, RUNTIME],
  },
  {
    id: 'l1-alias-drift-ignored-provisioning',
    gate: 'provisioning needs a fresh MATCH identity check of the alias',
    edits: [{ file: `${STORAGE}/governance.js`, search: "if (!c || c.result !== 'MATCH' || c.expectedName !== profile.model.expectedPublicName ||", replace: 'if (!c || false ||', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Accounting ----------------------------------------------------------------------------------------------------
  {
    id: 'l1-cache-hit-billed-as-miss',
    gate: 'actual billing charges cache-hit input at the cached rate while claiming to be the actual bill',
    edits: [{ file: `${GOV}/economics.js`, search: "tokenCost(input - cached, rates.input, 'input'), tokenCost(cached, rates.cached, 'cachedInput')", replace: "tokenCost(input, rates.input, 'input'), tokenCost(0, rates.cached, 'cachedInput')", expectedCount: 1 }],
    runs: [ECON, STORE],
  },
  {
    id: 'l1-off-peak-ignored',
    gate: 'actual billing applies the off-peak band the schedule names at the settling time',
    edits: [{ file: `${GOV}/economics.js`, search: "const rates = band === 'OFF_PEAK' && s !== null", replace: 'const rates = false', expectedCount: 1 }],
    runs: [ECON, STORE],
  },
  {
    id: 'l1-holiday-ignored',
    gate: 'a published holiday is off-peak in full whatever the weekday',
    edits: [{ file: `${GOV}/economics.js`, search: 'if (!s.peakWeekdays.includes(weekday) || s.holidayDates.includes(date))', replace: 'if (!s.peakWeekdays.includes(weekday))', expectedCount: 1 }],
    runs: [ECON],
  },
  {
    id: 'l1-reservation-below-worst-case',
    gate: 'a discount never exceeds the peak rate it discounts (the worst case stays the worst case)',
    edits: [
      { file: `${GOV}/economics.js`, search: 'if (cachedInputRate(c) > c.billedInputPerMTok)', replace: 'if (false)', expectedCount: 1 },
      { file: `${GOV}/economics.js`, search: 'if (s.offPeakInputPerMTok > c.billedInputPerMTok || s.offPeakOutputPerMTok > c.billedOutputPerMTok || s.offPeakCachedInputPerMTok > cachedInputRate(c)) {', replace: 'if (false) {', expectedCount: 1 },
    ],
    runs: [ECON],
  },
  {
    id: 'l1-cached-above-input-accepted',
    gate: 'a usage report with more cached than input tokens is a contract violation',
    edits: [{ file: `${GOV}/providers.js`, search: 'if (cachedInputTokens > inputTokens)', replace: 'if (false)', expectedCount: 1 }],
    runs: [ECON],
  },
  {
    id: 'l1-settlement-ignores-actual-cost',
    gate: 'settlement records the truthful provider bill (cache hits, band), never the flat worst case',
    edits: [{ file: `${STORAGE}/governance-core.js`, search: 'const cost = actualCost(card, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens ?? 0 }, ts(ctx));', replace: "const cost = { ...costOf(card, usage.inputTokens, usage.outputTokens), band: 'FLAT', cachedInputTokens: 0 };", expectedCount: 1 }, { file: `${STORAGE}/governance-core.js`, search: "import { PROVIDER_FAILURE_CLASSES, actualCost, addMoney,", replace: "import { PROVIDER_FAILURE_CLASSES, actualCost, costOf, addMoney,", expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Egress --------------------------------------------------------------------------------------------------------
  {
    id: 'l1-profile-d3-egress-accepted',
    gate: 'an external provider profile never asks for D3 / D4 egress (D3 external egress stays closed; D4 never leaves)',
    edits: [{ file: `${GOV}/provisioning.js`, search: "if (prov.locality === 'EXTERNAL' && (egress === 'D3' || egress === 'D4'))", replace: 'if (false)', expectedCount: 1 }],
    runs: [ECON],
  },
  // --- L1-02: the production activation path (D-L1-13) ------------------------------------------------------------
  {
    id: 'l1-02-lifecycle-active-offered',
    gate: 'the Founder\'s lifecycle step never reaches ACTIVE: activation is the Academy\'s decision alone',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: "const TRAINEE_TARGETS = ['TRAINING', 'SHADOW', 'PROBATION'];", replace: "const TRAINEE_TARGETS = ['TRAINING', 'SHADOW', 'PROBATION', 'ACTIVE'];", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-occupied-seat-hireable',
    gate: 'an occupied canonical seat is never offered for a hire',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: 'if (seatHolder(ctx, pos.id, ts(ctx)).ofRecord !== null)', replace: 'if (false)', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-name-unshaped',
    gate: 'a display name is presentation only: letters, never an instruction-shaped string',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: 'if (!LATIN_NAME.test(given) || !LATIN_NAME.test(family))', replace: 'if (false)', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-package-digest-unchecked',
    gate: 'an Academy package is release-pinned: a different digest fails closed',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: 'if (raw.packageSha256 !== sha)', replace: 'if (false)', expectedCount: 1 }],
    runs: [ACTIVATION, ACTIVATION_SURFACE],
  },
  {
    id: 'l1-02-model-access-d3',
    gate: 'model access is D1 / D2 at most: D3 external egress stays closed, D4 never leaves',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: "if (dataClass !== 'D1' && dataClass !== 'D2')", replace: 'if (false)', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-install-preview-unqualified',
    gate: 'the one install decision is offered only when every Skill version qualified on its own evidence',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: 'if (!view.installable)', replace: 'if (false)', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-activation-without-calibration',
    gate: 'activation of a calibrated role is not offered before the Founder Calibration is approved',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: "if (decision === 'APPROVE' && cal && cal.state !== 'APPROVED')", replace: 'if (false)', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-evaluator-types-deterministic',
    gate: 'the evaluator never types a deterministic dimension (authority compliance, cost discipline come from run facts)',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: 'const EVALUATOR_DIMENSIONS = ASSESSMENT_DIMENSIONS.filter((d) => !DETERMINISTIC_DIMENSIONS.includes(d));', replace: 'const EVALUATOR_DIMENSIONS = ASSESSMENT_DIMENSIONS;', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-static-review-ignored',
    gate: 'the static security review\'s verdict — never the Founder\'s confirmation — decides SANDBOXED vs REJECTED',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: 'securityPassed: report.passed });', replace: 'securityPassed: true });', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-baseline-sees-skill',
    gate: 'a sandboxed version enters only its own WITH_SKILL benchmark context (never a baseline)',
    edits: [{ file: `${STORAGE}/mind-core.js`, search: "if (!r || r.arm !== 'WITH_SKILL' || r.state !== 'OPEN')", replace: "if (!r || r.state !== 'OPEN')", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-answer-any-task',
    gate: 'an ANSWER binds only to an answer-bearing Work Item (an attempt, a benchmark case, shadow work)',
    edits: [{ file: `${STORAGE}/answers.js`, search: 'const task = answerTask(ctx, item.id);', replace: "const task = answerTask(ctx, item.id) ?? { kind: 'SHADOW', open: true };", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-answer-run-not-ended',
    gate: 'an answer-bearing run ends when its answer is recorded (no second answer, no wasted call)',
    edits: [{ file: `${RT}/employee-task.js`, search: "if (rec.outcome === 'RECORDED' || rec.code === 'ALREADY_ANSWERED') {", replace: 'if (false) {', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  // --- L1-02: the answer as provenance-bound evidence; evaluation of the actual answer (D-L1-18) ---------------------
  {
    id: 'l1-02-answer-manifest-unbound',
    gate: 'an answer binds to the exact manifest of its own run, item and step (another run\'s / step\'s manifest is refused)',
    edits: [{ file: `${STORAGE}/answers.js`, search: "if (!m || m.run_id !== fence.runId || m.work_item_id !== item.id || Number(m.step) !== from.step || m.outcome !== 'OK')", replace: 'if (!m)', expectedCount: 1 }],
    runs: [ANSWERS],
  },
  {
    id: 'l1-02-answer-unspent-manifest',
    gate: 'an answer comes from a model call actually made with its manifest (a reservation), never from a bare assembly',
    edits: [{ file: `${STORAGE}/answers.js`, search: "purpose = 'MODEL_CALL'`, from.manifestId, fence.runId))", replace: "purpose = 'MODEL_CALL'`, from.manifestId, fence.runId) && false)", expectedCount: 1 }],
    runs: [ANSWERS],
  },
  {
    id: 'l1-02-answer-scenario-unchecked',
    gate: 'an attempt\'s answer binds to the manifest that exposed its scenario',
    edits: [{ file: `${STORAGE}/answers.js`, search: "if (task.kind === 'ATTEMPT' && !ctx.db.get(", replace: "if (task.kind === 'NEVER' && !ctx.db.get(", expectedCount: 1 }],
    runs: [ANSWERS],
  },
  {
    id: 'l1-02-evaluation-without-answer',
    gate: 'an evaluator scores only an attempt that has its durable answer',
    edits: [{ file: `${STORAGE}/academy.js`, search: 'if (answer === null)', replace: 'if (answer === undefined)', expectedCount: 1 }],
    runs: [ANSWERS],
  },
  {
    id: 'l1-02-evaluation-answer-unbound',
    gate: 'the scored answer\'s reference is bound into every evaluator result automatically',
    edits: [{ file: `${STORAGE}/academy.js`, search: 'JSON.stringify([answerRef, ...(r.evidenceRefs ?? [])', replace: 'JSON.stringify([...(r.evidenceRefs ?? [])', expectedCount: 1 }],
    runs: [ANSWERS],
  },
  {
    id: 'l1-02-evaluate-answer-not-rechecked',
    gate: 'the Founder\'s evaluate preview binds the exact answer read (ref + digest) and confirmation re-reads it',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: 'answerRef: `work_answer:${answer.id}`, answerSha256', replace: 'answerRef: null, answerSha256', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-benchmark-failing-case-passes',
    gate: 'a Skill version whose with-skill benchmark case fails never qualifies (no auto-pass)',
    edits: [{ file: `${MIND}/academy-package.js`, search: 'const benchmarkPassed = withR.every((r) => r?.passed === true);', replace: 'const benchmarkPassed = true;', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  // --- L1-02: the package-revision seam (D-L1-19) -------------------------------------------------------------------
  {
    id: 'l1-02-package-skill-identity-duplicated',
    gate: 'a new package version reuses each Skill identity by code (never a duplicate identity)',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: 'const skillId = (known?.id ?? skills.registerSkill(', replace: 'const skillId = (skills.registerSkill(', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-package-version-unchained',
    gate: 'a revised package Skill Version is chained to the Skill\'s previous version',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: '...(previous ? { previousVersionId: previous.id } : {}),', replace: '', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-package-label-rewritable',
    gate: 'a Skill Version label already used is refused as a governed refusal (same label, different payload never rewrites)',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: '    if (taken) {', replace: '    if (taken && false) {', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-package-view-digest-unbound',
    gate: 'a package definition whose digest differs from the recorded one is never installable (v1 cannot be rewritten into a pass)',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: 'record.sha256 === sha && ', replace: '', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-package-version-not-forward',
    gate: 'a new package version is newer than every recorded version of its code',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: 'if (newest !== null && newest >= pkg.version)', replace: 'if (newest !== null && false)', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  // --- L1-02: pre-run corrections for package v2 (D-L1-20) ------------------------------------------------------------
  {
    id: 'l1-02-answer-semantics-missing',
    gate: 'every answer-bearing context carries the canonical decision / confidence semantics',
    edits: [{ file: `${GOV}/proposals.js`, search: '${ANSWER_DECISION_SEMANTICS} ${ANSWER_AUTHORITY_SEMANTICS} ${ANSWER_CONFIDENCE_SEMANTICS} ', replace: '${ANSWER_AUTHORITY_SEMANTICS} ', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-invalid-output-unrecorded',
    gate: 'an invalid model output leaves its content-free parser classification as durable run evidence',
    edits: [{ file: 'packages/runtime/dist/src/c2/employee-task.js', search: 'gov.noteInvalidOutput(s.turn, proposal.code, out.reasoningClass);', replace: '', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-v2-ceiling-tight',
    gate: 'package v2 runs its benchmark under the 4096 ceiling (thinking + a full legal answer)',
    edits: [{ file: `${MIND}/packages/ceo-academy-v2.js`, search: 'benchmarkMaxOutputTokens: 4_096', replace: 'benchmarkMaxOutputTokens: 2_816', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  // --- L1-02: benchmark score finalization (D-L1-21) -------------------------------------------------------------------
  {
    id: 'l1-02-finalize-rolled-back',
    gate: 'finalizing a package with nothing to re-run commits its SCORED evidence (no refusal rolls it back)',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: 'return { packageId, created: false, benchmarkRuns: runs, scored };', replace: "if (runs === 0) throw new QandeelError('INVALID_TRANSITION', 'nothing to re-run', { reason: 'NOTHING_TO_REQUALIFY' }); return { packageId, created: false, benchmarkRuns: runs, scored };", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-finalize-preview-untruthful',
    gate: 'the Founder preview of a finalization says so: zero benchmark runs, zero paid provider calls',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: "const qualification = rec === null ? 'QUALIFY' : voidCases === 0 ? 'FINALIZE_SCORES' : 'REQUALIFY_VOID_RUNS';", replace: "const qualification = rec === null ? 'QUALIFY' : 'REQUALIFY_VOID_RUNS';", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-finalize-reruns-scored',
    gate: 'a scored benchmark case is never re-run (only VOID cases are replaced)',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "AND case_code = ? AND arm = ? AND observation_no = ? AND state <> 'VOID'`, packageId, v.id, c.code, arm, n))", replace: "AND case_code = ? AND arm = ? AND observation_no = ? AND state = 'OPEN'`, packageId, v.id, c.code, arm, n))", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  // --- L1-02: the canonical `reversible` semantics; package v3 (D-L1-22) ----------------------------------------------
  {
    id: 'l1-02-reversible-semantics-missing',
    gate: 'every answer-bearing context carries the canonical reversible semantics',
    edits: [{ file: `${GOV}/proposals.js`, search: '${ANSWER_REVERSIBLE_SEMANTICS} ${ANSWER_FOUNDER_DECISION_SEMANTICS}', replace: '${ANSWER_FOUNDER_DECISION_SEMANTICS}', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-reversible-semantics-auxiliary',
    gate: 'the reversible facet describes the primary act, never an auxiliary next step',
    edits: [{ file: `${GOV}/proposals.js`, search: ' — never whether an auxiliary pilot, investigation, evidence-gathering step, pause, canary, rollback preparation or other recommended next step is reversible', replace: '', expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-v3-label-reused',
    gate: 'package v3 qualifies six NEW Skill Versions, never a label of v2',
    edits: [{ file: `${MIND}/packages/ceo-academy-v3.js`, search: "versionLabel: '1.0.0+pkg3'", replace: "versionLabel: '1.0.0+pkg2'", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-v3-payload-drift',
    gate: 'package v3 keeps the Skill instructions of v2 (no benchmark-driven rewrite)',
    edits: [{ file: `${MIND}/packages/ceo-academy-v3.js`, search: "versionLabel: '1.0.0+pkg3' }", replace: "versionLabel: '1.0.0+pkg3', instructions: `${s.instructions}\nSet reversible for the next step.` }", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  // --- L1-02: Benchmark Qualification Method v2, rubric R2, ANSWER contract AC-4 (D-L1-23) --------------------------------
  {
    id: 'l1-02-bqm2-retry-escalates',
    gate: 'a BQM-2 observation pins the same-class retry: an invalid E1 output is retried at E1, never escalated',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "invalidOutputPolicy: 'SAME_CLASS_RETRY'", replace: "invalidOutputPolicy: 'ESCALATE'", expectedCount: 1 }],
    runs: [ACTIVATION, BQM2_STORE],
  },
  {
    id: 'l1-02-bqm2-runtime-escalates',
    gate: 'the runtime honours SAME_CLASS_RETRY (no escalation to E2)',
    edits: [{ file: `${RT}/employee-task.js`, search: "if (cfg.invalidOutputPolicy === 'SAME_CLASS_RETRY')", replace: "if (false)", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-bqm2-k-reduced',
    gate: 'BQM-2 creates exactly 5 observations per case and arm',
    edits: [{ file: `${MIND}/benchmark-method.js`, search: "observationsPerArm: 5,", replace: "observationsPerArm: 3,", expectedCount: 1 }],
    runs: [ACTIVATION, BQM2_STORE],
  },
  {
    id: 'l1-02-bqm2-overall-layer-dropped',
    gate: 'a case needs at least 3 of 5 complete WITH_SKILL observation passes',
    edits: [{ file: `${MIND}/benchmark-method.js`, search: "if (passes(w) < a.overallMinPasses)", replace: "if (false)", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-bqm2-critical-layer-dropped',
    gate: 'every critical check must pass in at least 4 of 5 WITH_SKILL observations',
    edits: [{ file: `${MIND}/benchmark-method.js`, search: "if (criticalMin < a.criticalMinPasses)", replace: "if (false)", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-bqm2-forbidden-tolerated',
    gate: 'forbidden is zero tolerance: 5 of 5',
    edits: [{ file: `${MIND}/benchmark-method.js`, search: "if (forbiddenPasses !== null && forbiddenPasses < a.forbiddenMinPasses)", replace: "if (false)", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-bqm2-n1-widened',
    gate: 'N1: WITH_SKILL passes >= BASELINE passes - 1 per case (Product tolerance m = 1)',
    edits: [{ file: `${MIND}/benchmark-method.js`, search: "passes(w) >= passes(b) - BQM2_DECLARATION.comparison.tolerance", replace: "passes(w) >= passes(b) - 2", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-r2-question-exemption-broad',
    gate: 'only a question that opens with an interrogative word is exempt (a tag question is not)',
    edits: [{ file: `${MIND}/benchmark-method.js`, search: "return EXEMPT_START.test(s) && EXEMPT_END.test(s);", replace: "return EXEMPT_END.test(s);", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-r2-start-boundary-dropped',
    gate: 'a forbidden phrase matches only from a word boundary',
    edits: [{ file: `${MIND}/benchmark-method.js`, search: "(?<![\\\\p{L}\\\\p{N}])${words", replace: "${words", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-r1-reinterpreted',
    gate: 'BQM-1 rows are only ever read by the frozen R1 rubric',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "if (row.rubric_version === 'R2') {", replace: "if (true) {", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-bqm2-invalid-made-void',
    gate: 'two invalid outputs are a FAILED observation, never VOID',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "if (code === 'MODEL_OUTPUT_INVALID')", replace: "if (code === 'NEVER')", expectedCount: 1 }],
    runs: [ACTIVATION, BQM2_STORE],
  },
  {
    id: 'l1-02-bqm2-inflight-pin-unchecked',
    gate: 'an in-flight observation whose pinned method or contract differs from the build gets no context',
    edits: [{ file: `${STORAGE}/mind-writes.js`, search: "const pinMismatch = pins ? benchmarkPinMismatch(pins) : null;", replace: "const pinMismatch = null;", expectedCount: 1 }],
    runs: [BQM2_STORE],
  },
  {
    id: 'l1-02-bqm2-pins-unchecked',
    gate: 'a BQM-2 package runs only under exactly the method and ANSWER contract it pins',
    edits: [{ file: `${STORAGE}/benchmark-pins.js`, search: "if (pins.method !== 'BQM-2')", replace: "if (true)", expectedCount: 1 }],
    runs: [BQM2_STORE],
  },
  {
    id: 'l1-02-ac4-contract-unrecorded',
    gate: 'every new answer records the ANSWER contract version and digest',
    edits: [{ file: `${STORAGE}/answers.js`, search: "ANSWER_CONTRACT_VERSION, ANSWER_CONTRACT_SHA256);", replace: "null, null);", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-ac4-authority-semantics-missing',
    gate: 'every answer-bearing context defines authority over the PRIMARY act',
    edits: [{ file: `${GOV}/proposals.js`, search: "${ANSWER_AUTHORITY_SEMANTICS} ${ANSWER_CONFIDENCE_SEMANTICS}", replace: "${ANSWER_CONFIDENCE_SEMANTICS}", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-ac4-founder-decision-semantics-missing',
    gate: 'every answer-bearing context defines founderDecisionNeeded for the PRIMARY act',
    edits: [{ file: `${GOV}/proposals.js`, search: "${ANSWER_FOUNDER_DECISION_SEMANTICS} One ANSWER", replace: "One ANSWER", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-bqm2-preview-bound-untruthful',
    gate: 'the Founder preview states the enforced total cap bound (observations x per-observation cap)',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: "totalCapBoundMicros: runs * pkg.limits.benchmarkCapMicros,", replace: "totalCapBoundMicros: pkg.limits.benchmarkCapMicros,", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-bqm2-preview-text-untruthful',
    gate: 'the rendered BQM-2 preview states the fixed class and observation count',
    edits: [{ file: `packages/command-center/dist/src/api.js`, search: "every one at the fixed reasoning class ${s('reasoningClass')}", replace: "every one at a suitable reasoning class", expectedCount: 1 }],
    runs: [ACTIVATION_SURFACE],
  },
  // --- L1-02: the BQM-2 answer-only execution fence, the hard two-call bound, VOID by allowlist only (D-L1-24) -------------
  {
    id: 'l1-02-answer-only-fence-dropped',
    gate: 'a BQM-2 observation never executes a valid non-ANSWER proposal (FINAL, memory, tool, org, review, message, goal)',
    edits: [{ file: `${RT}/employee-task.js`, search: "if (cfg.answerOnly && proposal.type !== 'ANSWER' && proposal.type !== 'INVALID')", replace: "if (false)", expectedCount: 1 }],
    runs: [ANSWER_ONLY, ACTIVATION],
  },
  {
    id: 'l1-02-answer-only-not-pinned',
    gate: 'every BQM-2 observation Work Item carries the answer-only fence',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "answerOnly: true, maxModelCalls:", replace: "answerOnly: false, maxModelCalls:", expectedCount: 1 }],
    runs: [BQM2_STORE, ACTIVATION],
  },
  {
    id: 'l1-02-wrong-type-mislabelled',
    gate: 'a recognized wrong proposal is diagnosed WRONG_PROPOSAL_TYPE (never a parser code)',
    edits: [{ file: `${RT}/employee-task.js`, search: "'WRONG_PROPOSAL_TYPE', out.reasoningClass, { proposalType: proposal.type }", replace: "'UNKNOWN_TYPE', out.reasoningClass, {}", expectedCount: 1 }],
    runs: [ANSWER_ONLY, ACTIVATION],
  },
  {
    id: 'l1-02-answer-refusal-not-output-failure',
    gate: 'an ANSWER refused for its own content takes the one same-class retry',
    edits: [{ file: `${RT}/employee-task.js`, search: "if (rec.code !== 'INVALID_ARGS' && rec.code !== 'SECRET_MATERIAL')", replace: "if (true)", expectedCount: 1 }],
    runs: [ANSWER_ONLY],
  },
  {
    id: 'l1-02-call-bound-unenforced-processor',
    gate: 'the employee loop never makes a call past the declared bound of its Work Item',
    edits: [{ file: `${RT}/employee-task.js`, search: "if (cfg.maxModelCalls !== null && s.modelCalls >= cfg.maxModelCalls)", replace: "if (false)", expectedCount: 1 }],
    runs: [ANSWER_ONLY],
  },
  {
    id: 'l1-02-call-bound-unenforced-store',
    gate: 'the store refuses a model-call reservation past the declared bound of its Work Item, across runs',
    edits: [{ file: `${STORAGE}/governed-writes.js`, search: "if (maxModelCalls !== null && Number(", replace: "if (false && Number(", expectedCount: 1 }],
    runs: [BQM2_STORE],
  },
  {
    id: 'l1-02-void-inferred-from-completion',
    gate: 'a finished observation without an answer is never inferred to be infrastructure (never VOID)',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "if (workItemState !== 'FAILED')\n        return { kind: 'UNCLASSIFIED' };", replace: "if (workItemState !== 'FAILED')\n        return { kind: 'INFRASTRUCTURE', code: 'INFERRED' };", expectedCount: 1 }],
    runs: [BQM2_STORE],
  },
  {
    id: 'l1-02-void-inferred-from-unlisted-code',
    gate: 'only an allowlisted infrastructure failure code makes an observation VOID',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "return { kind: 'INFRASTRUCTURE', code };\n    return { kind: 'UNCLASSIFIED' };", replace: "return { kind: 'INFRASTRUCTURE', code };\n    return { kind: 'INFRASTRUCTURE', code: String(code) };", expectedCount: 1 }],
    runs: [BQM2_STORE],
  },
  {
    id: 'l1-02-unclassified-preview-unchecked',
    gate: 'an unclassified no-answer blocks the qualification preview (fail closed)',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: "if (rec !== null && view.benchmarkRunsUnclassified > 0)", replace: "if (false)", expectedCount: 1 }],
    runs: [BQM2_STORE],
  },
  {
    id: 'l1-02-preview-answer-only-unstated',
    gate: 'the BQM-2 preview states the answer-only fence',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: "maxModelCallsPerObservation: BQM2_DECLARATION.deliverable.maxModelCallsPerObservation, answerOnly: true,", replace: "maxModelCallsPerObservation: BQM2_DECLARATION.deliverable.maxModelCallsPerObservation,", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  // --- L1-02: the answer-only prompt matches the answer-only fence (D-L1-25) ----------------------------------------------
  {
    id: 'l1-02-answer-only-prompt-generic',
    gate: 'an answer-only observation context never offers the generic proposal menu',
    edits: [{ file: `${STORAGE}/mind-writes.js`, search: "answerOnly ? ANSWER_ONLY_OUTPUT_INSTRUCTION : ", replace: "false ? ANSWER_ONLY_OUTPUT_INSTRUCTION : ", expectedCount: 1 }],
    runs: [BQM2_STORE, ACTIVATION],
  },
  {
    id: 'l1-02-answer-only-prompt-everywhere',
    gate: 'only an answer-only BQM-2 observation renders the answer-only instruction (BQM-1, attempts, shadow, replies unchanged)',
    edits: [{ file: `${STORAGE}/mind-writes.js`, search: "const answerOnly = mode === 'SKILL_BENCHMARK' && ", replace: "const answerOnly = true || ", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-output-instruction-unpinned',
    gate: 'the BQM-2 declaration pins the exact answer-only output instruction',
    edits: [{ file: `${MIND}/benchmark-method.js`, search: "outputInstructionSha256: ANSWER_ONLY_OUTPUT_INSTRUCTION_SHA256", replace: "outputInstructionSha256: 'unpinned'", expectedCount: 1 }],
    runs: [BQM2_STORE, ANSWER_ONLY],
  },
  // --- L1-02: the production CEO package v4 (D-L1-26) ------------------------------------------------------------------
  {
    id: 'l1-02-v4-method-unpinned',
    gate: 'package v4 pins BQM-2 and AC-4 by the canonical constants (never BQM-1 by omission)',
    edits: [{ file: `${MIND}/packages/ceo-academy-v4.js`, search: "    benchmarkMethod: { version: BQM2_DECLARATION.version, declarationSha256: BQM2_DECLARATION_SHA256, answerContract: { version: ANSWER_CONTRACT_VERSION, sha256: ANSWER_CONTRACT_SHA256 } },\n", replace: "", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-v4-label-reused',
    gate: 'package v4 qualifies six NEW Skill Versions (1.0.0+pkg4), never the pkg3 ones',
    edits: [{ file: `${MIND}/packages/ceo-academy-v4.js`, search: "versionLabel: '1.0.0+pkg4'", replace: "versionLabel: '1.0.0+pkg3'", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
  {
    id: 'l1-02-v4-unregistered',
    gate: 'the production surface registers v4 beside the v3, v2 and v1 history',
    edits: [{ file: 'packages/command-center/dist/src/surface.js', search: "[CEO_ACADEMY_PACKAGE_V4, CEO_ACADEMY_PACKAGE_V3, ", replace: "[CEO_ACADEMY_PACKAGE_V3, ", expectedCount: 1 }],
    runs: [ACTIVATION_SURFACE],
  },
  // --- L1-02: reusable Skill qualification (D-L1-27) ------------------------------------------------------------------
  {
    id: 'l1-02-reuse-failed-version',
    gate: 'a Skill Version whose own verdict failed is never qualified evidence (never reusable)',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "if (!(verdict.benchmarkPassed && verdict.comparePassed))", replace: "if (false)", expectedCount: 1 }],
    runs: [REUSE_STORE],
  },
  {
    id: 'l1-02-reuse-incomplete-evidence',
    gate: 'open, VOID or unclassified observation slots are not qualified evidence',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "if (!complete)", replace: "if (false)", expectedCount: 1 }],
    runs: [REUSE_STORE],
  },
  {
    id: 'l1-02-reuse-bqm1-evidence',
    gate: 'BQM-1 evidence is never reusable',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "if (rec.benchmarkMethod !== 'BQM-2')", replace: "if (false)", expectedCount: 1 }],
    runs: [REUSE_STORE],
  },
  {
    id: 'l1-02-reuse-fingerprint-unchecked',
    gate: 'a reuse requires the exact qualification fingerprint (cases, expectations, pass mark, method, contract)',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "if (fingerprint !== q.fingerprint)", replace: "if (false)", expectedCount: 1 }],
    runs: [REUSE_STORE],
  },
  {
    id: 'l1-02-reuse-payload-unchecked',
    gate: 'a reused version keeps its exact instruction payload',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "if (row.instructions_sha256 !== sha256Hex(s.instructions))", replace: "if (false)", expectedCount: 1 }],
    runs: [REUSE_STORE],
  },
  {
    id: 'l1-02-reuse-held-retired',
    gate: 'a security-held, retired or deprecated version is never reusable',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "if (BLOCKING_FRESHNESS.includes(v.freshness))", replace: "if (false)", expectedCount: 1 }],
    runs: [REUSE_STORE],
  },
  {
    id: 'l1-02-reuse-integrity-ignored',
    gate: 'an integrity-failed version is never reusable',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "if (v.integrity !== 'OK')", replace: "if (false)", expectedCount: 1 }],
    runs: [REUSE_STORE],
  },
  {
    id: 'l1-02-reuse-requalified',
    gate: 'a reused Skill creates no new version, review or benchmark',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "if (s.binding === 'REUSE_QUALIFIED') {", replace: "if (false) {", expectedCount: 1 }],
    runs: [REUSE_STORE, ACTIVATION],
  },
  {
    id: 'l1-02-reuse-preview-overcounts',
    gate: 'the qualification preview counts observations of new versions only',
    edits: [{ file: `${STORAGE}/founder-activation.js`, search: "pkg.skills.filter((s) => s.binding !== 'REUSE_QUALIFIED').reduce", replace: "pkg.skills.reduce", expectedCount: 1 }],
    runs: [REUSE_STORE, ACTIVATION],
  },
  {
    id: 'l1-02-reuse-approves-early',
    gate: 'a reuse records qualified evidence (COMPARED), never production approval',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "this.#stepTo(ctx, skills, actorRef, versionId, 'COMPARED'", replace: "this.#stepTo(ctx, skills, actorRef, versionId, 'APPROVED'", expectedCount: 1 }],
    runs: [REUSE_STORE],
  },
  {
    id: 'l1-02-install-failed-new-skill',
    gate: 'a complete role installs only when every newly qualified Skill passed',
    edits: [{ file: `${STORAGE}/academy-packages.js`, search: "return s.verdict.benchmarkPassed && s.verdict.comparePassed;", replace: "return true;", expectedCount: 1 }],
    runs: [REUSE_STORE],
  },
  {
    id: 'l1-02-fingerprint-ignores-cases',
    gate: 'the qualification fingerprint binds every benchmark case and expectation',
    edits: [{ file: `${MIND}/benchmark-method.js`, search: "cases: s.benchmark.map((c) => ({ code: c.code, content: c.content, expect: c.expect })),", replace: "cases: [],", expectedCount: 1 }],
    runs: [REUSE_STORE, ACTIVATION],
  },
  {
    id: 'l1-02-fingerprint-ignores-method',
    gate: 'the qualification fingerprint binds the method and ANSWER contract',
    edits: [{ file: `${MIND}/benchmark-method.js`, search: "method: { version: pkg.benchmarkMethod.version, declarationSha256: pkg.benchmarkMethod.declarationSha256 },", replace: "method: null,", expectedCount: 1 }],
    runs: [ACTIVATION],
  },
];

const args = process.argv.slice(2);
const shardArg = args.includes('--shard') ? String(args[args.indexOf('--shard') + 1]) : '1/1';
const reportFile = args.includes('--report') ? String(args[args.indexOf('--report') + 1]) : null;
// --only <id,id> runs the named mutations (focused local validation); CI and `npm run ci` always run the full set.
const only = args.includes('--only') ? new Set(String(args[args.indexOf('--only') + 1]).split(',')) : null;
if (only !== null && reportFile !== null) throw new Error('--only is a local focus; it never produces a parity report');
for (const id of only ?? []) if (!MUTATIONS.some((m) => m.id === id)) throw new Error(`--only names an unknown mutation: ${id}`);
const [shardIndex, shardCount] = shardArg.split('/').map(Number);
if (!(Number.isInteger(shardIndex) && Number.isInteger(shardCount) && shardCount >= 1 && shardIndex >= 1 && shardIndex <= shardCount)) throw new Error(`--shard must be i/n with 1 <= i <= n (got ${shardArg})`);
const inShard = (i) => i % shardCount === shardIndex - 1;

function failed(r) {
  return r.status !== 0 && (/^# fail [1-9]/m.test(r.stdout ?? '') || /^ℹ fail [1-9]/m.test(r.stdout ?? ''));
}

let failures = 0;
const ran = [];
const caught = [];
let index = -1;
for (const m of MUTATIONS) {
  index++;
  if (!inShard(index) || (only !== null && !only.has(m.id))) continue;
  ran.push(m.id);
  const originals = new Map();
  let applicable = true;
  for (const e of m.edits) {
    const file = path.join(ROOT, e.file);
    const text = originals.get(file) ?? readFileSync(file, 'utf8');
    originals.set(file, text);
    const count = text.split(e.search).length - 1;
    if (count !== (e.expectedCount ?? 1)) {
      console.log(`l1-mutation: FAIL ${m.id} — expected ${e.expectedCount ?? 1} occurrence(s) of the gate in ${e.file}, found ${count} (rebuild, or update this check with the code)`);
      applicable = false;
    }
  }
  if (!applicable) {
    failures++;
    continue;
  }
  try {
    const mutated = new Map(originals);
    for (const e of m.edits) {
      const file = path.join(ROOT, e.file);
      mutated.set(file, (mutated.get(file) ?? '').split(e.search).join(e.replace));
    }
    for (const [file, text] of mutated) writeFileSync(file, text);
    const caughtBy = m.runs.filter(({ cwd, tests }) => failed(spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: path.join(ROOT, cwd), encoding: 'utf8', shell: false, windowsHide: true, timeout: 900_000, env: TEST_ENV })));
    if (caughtBy.length > 0) {
      caught.push(m.id);
      console.log(`l1-mutation: ok   ${m.id} (${m.gate}) — caught by ${caughtBy.map((r) => r.tests.join(',')).join(' + ')}`);
    } else {
      console.log(`l1-mutation: FAIL ${m.id} (${m.gate}) — no proof test caught the mutation`);
      failures++;
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text);
  }
}
if (reportFile) writeFileSync(reportFile, `${JSON.stringify({ script: 'l1:mutation', shard: shardArg, total: MUTATIONS.length, ran, caught }, null, 2)}\n`);
if (failures) {
  console.log(`l1-mutation: FAIL — ${failures} of ${ran.length} mutation(s) not caught (shard ${shardArg})`);
  process.exit(1);
}
console.log(`l1-mutation: ok — ${caught.length} of ${ran.length} mutation(s) caught (shard ${shardArg})`);
