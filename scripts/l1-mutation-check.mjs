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
const RUNTIME = { cwd: 'packages/runtime', tests: ['dist/test/l1/l1-runtime.test.js'] };

const GOV = 'packages/governance/dist/src';
const PROVIDERS = 'packages/model-providers/dist/src/deepseek';
const SV = 'packages/secret-vault/dist/src';
const STORAGE = 'packages/storage/dist/src';
const RT = 'packages/runtime/dist/src/c2';

const MUTATIONS = [
  // --- The vault ----------------------------------------------------------------------------------------------------
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
    edits: [{ file: `${PROVIDERS}/adapter.js`, search: "const body = { model: DEEPSEEK_MODEL_CODE, messages, max_tokens: request.maxOutputTokens, stream: false, thinking: thinkingFor(request.reasoningClass), response_format: { type: 'json_object' } };\n    for (const k of Object.keys(body))", replace: "const body = { ...request, model: DEEPSEEK_MODEL_CODE, messages, max_tokens: request.maxOutputTokens, stream: false, thinking: thinkingFor(request.reasoningClass), response_format: { type: 'json_object' } };\n    for (const k of [])", expectedCount: 1 }],
    runs: [ADAPTER, RUNTIME],
  },
  {
    id: 'l1-reasoning-class-dropped',
    gate: "the route's reasoning class travels with the ProviderRequest (the adapter maps it; nothing else decides it)",
    edits: [{ file: `${RT}/model-runtime.js`, search: 'reasoningClass: d.reasoningClass, messages: context.messages', replace: "reasoningClass: 'E4', messages: context.messages", expectedCount: 1 }],
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
