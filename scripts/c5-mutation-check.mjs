#!/usr/bin/env node
// C5 mutation check: proves the Founder Command Center gates are not vacuous.
//
// Each mutation removes (or bypasses) one gate in the COMPILED output (packages/*/dist), runs the proof tests
// that must catch it, requires them to FAIL, and restores every file (always, in `finally`). Sources are never
// touched; released migrations are never edited (they are pinned by checksum). Run after `npm run build`:
//
//   npm run c5:mutation                          all mutations
//   npm run c5:mutation -- --shard 2/3           the second of three disjoint shards (CI parallelism)
//   npm run c5:mutation -- --report <file.json>  also write the ids run / caught (CI proof parity)
//
// A mutation the tests do not catch — or one that no longer applies because the guarded code moved — fails
// this script. No mutation targets rendering cosmetics: every one is an authority, privacy, truth or
// confirmation boundary (C5 brief §33).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Proof tests resolve the test-only Founder seam through the `qandeel-test` condition (D-C2-13).
const TEST_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=qandeel-test`.trim() };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORAGE = { cwd: 'packages/storage', tests: ['dist/test/c5-founder-surface.test.js'] };
const SURFACE = { cwd: 'packages/command-center', tests: ['dist/test/surface.test.js'] };
const SECURITY = { cwd: 'packages/command-center', tests: ['dist/test/security.test.js'] };
const LAYOUT = { cwd: 'packages/command-center-ui', tests: ['dist/test/layout.test.js'] };

const STORE = 'packages/storage/dist/src';
const CC = 'packages/command-center/dist/src';
const UI = 'packages/command-center-ui/dist/src';

const MUTATIONS = [
  {
    id: 'c5-founder-ref-is-authentication',
    gate: 'a Founder session handle must be one the auth store verified; a look-alike object (or a ref) is not authentication',
    edits: [{ file: `${STORE}/founder-auth.js`, search: "if (!VERIFIED.has(session))\n            throw new QandeelError('FOUNDER_SESSION_INVALID', 'not a verified session handle', { reason: 'UNVERIFIED_HANDLE' });", replace: '/* mutation: any handle accepted */', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'c5-session-expiry-ignored',
    gate: 'an expired session fails closed at every verification (read and scope entry)',
    edits: [{ file: `${STORE}/founder-auth.js`, search: 'if (s.expiresAt <= now)', replace: 'if (false)', expectedCount: 2 }],
    runs: [STORAGE],
  },
  {
    id: 'c5-session-scope-stays-armed',
    gate: 'the Founder chokepoint disarms when the synchronous session scope ends',
    edits: [{ file: `${STORE}/governance.js`, search: 'if (!alreadyArmed)\n                for (const armed of [...armedFounderSurfaces])', replace: 'if (false)\n                for (const armed of [...armedFounderSurfaces])', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'c5-csrf-gate-removed',
    gate: 'every state change carries the session CSRF secret (double submit)',
    edits: [{ file: `${CC}/security.js`, search: 'if (facts.csrfHeader === undefined || csrfCookie === undefined || facts.csrfHeader !== csrfCookie)', replace: 'if (false)', expectedCount: 1 }],
    runs: [SECURITY, SURFACE],
  },
  {
    id: 'c5-host-gate-removed',
    gate: 'only the exact loopback Host is served (DNS rebinding sends another Host)',
    edits: [{ file: `${CC}/security.js`, search: 'if (facts.host === undefined || !allowedHosts(port).includes(facts.host.toLowerCase()))', replace: 'if (false)', expectedCount: 1 }],
    runs: [SECURITY],
  },
  {
    id: 'c5-text-mutates-without-confirmation',
    gate: 'a natural-language mutating command yields a preview only; nothing executes before the explicit confirmation',
    edits: [{ file: `${CC}/api.js`, search: 'const preview = ctx.runtime.founder.actions.preview(ctx.session, target.intent, target.payload);', replace: 'const preview = ctx.runtime.founder.actions.preview(ctx.session, target.intent, target.payload); ctx.runtime.founder.actions.confirm(ctx.session, preview.id, preview.fingerprint);', expectedCount: 1 }],
    runs: [SURFACE],
  },
  {
    id: 'c5-preview-fingerprint-unchecked',
    gate: 'a confirmation must present the exact preview fingerprint',
    edits: [{ file: `${STORE}/founder-actions.js`, search: "if (typeof fingerprint !== 'string' || fingerprint !== preview.fingerprint)\n                refuse('FINGERPRINT_MISMATCH');", replace: '/* mutation: fingerprint unchecked */', expectedCount: 1 }],
    runs: [STORAGE, SURFACE],
  },
  {
    id: 'c5-rank-radius-inverted',
    gate: 'rank = radius: closer to the Founder is higher (CEO nearest, specialists outermost)',
    edits: [
      { file: `${UI}/model/layout.js`, search: 'CEO: 2.6,', replace: 'CEO: 11,', expectedCount: 1 },
      { file: `${UI}/model/layout.js`, search: 'SPECIALIST: 11,', replace: 'SPECIALIST: 2.6,', expectedCount: 1 },
    ],
    runs: [LAYOUT],
  },
  {
    id: 'c5-department-sector-collapsed',
    gate: 'Department = sector: five disjoint sectors, never a shared wedge',
    edits: [{ file: `${UI}/model/layout.js`, search: 'const start = origin + i * span;', replace: 'const start = origin;', expectedCount: 1 }],
    runs: [LAYOUT],
  },
  {
    id: 'c5-goal-work-link-dropped',
    gate: 'Goal → Work traceability comes from durable links, never from a story',
    edits: [{ file: `${STORE}/universe.js`, search: 'goalIds: goalsOfWork.get(w.id) ?? [],', replace: 'goalIds: [],', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'c5-attention-widened-to-routine',
    gate: 'Founder Attention holds only what needs the Founder: a decided approval leaves it',
    edits: [{ file: `${STORE}/attention.js`, search: "WHERE state = 'PENDING' AND risk_level IN ('R1', 'R3')", replace: "WHERE risk_level IN ('R1', 'R3')", expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'c5-message-grants-authority',
    gate: 'an Employee speaks in a Founder thread only from its own bound run: a foreign run cannot speak for it (conversation binding is authority-shaped)',
    edits: [{ file: `${STORE}/communications.js`, search: 'if (t.employeeId !== attributedEmployeeId || employeeIdFromRef(item.ownerRef) !== attributedEmployeeId)', replace: 'if (false)', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'c5-message-body-in-audit',
    gate: 'Rule A: message bodies never enter audit',
    edits: [{ file: `${STORE}/communications.js`, search: "appendAudit(ctx, 'communication.message', 'thread', t.id, { actorRef: m.senderRef }, 'OK', m.purpose, { messageId: id, seq, level: m.level, responseRequired: m.responseRequired, replyWorkItemId: m.replyWorkItemId, runId: m.runId });", replace: "appendAudit(ctx, 'communication.message', 'thread', t.id, { actorRef: m.senderRef }, 'OK', m.purpose, { messageId: id, seq, level: m.level, note: m.body.slice(0, 120), replyWorkItemId: m.replyWorkItemId, runId: m.runId });", expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'c5-history-uses-current-truth',
    gate: 'Historical Focus reads seat holders at T from effective-dated assignments, never from current rows',
    edits: [{ file: `${STORE}/universe.js`, search: 'const h = seatHolder(ctx, p.id, at);', replace: 'const h = seatHolder(ctx, p.id, now);', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'c5-r4-offered-as-approvable',
    gate: 'R4 (Founder-only sovereignty) and R2 (review-only) are never offered as approvable previews',
    edits: [{ file: `${STORE}/founder-actions.js`, search: "if (a.risk_level === 'R4' || a.risk_level === 'R2')", replace: 'if (false)', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'c5-company-goal-without-founder',
    gate: 'a Department goal derives only from a Founder-approved company goal',
    edits: [{ file: `${STORE}/goals.js`, search: "if (parent !== null && (parent.kind !== 'COMPANY' || (parent.state !== 'APPROVED' && parent.state !== 'ACTIVE')))", replace: 'if (false)', expectedCount: 1 }],
    runs: [STORAGE],
  },
];

// --shard i/n (1-based) runs a disjoint slice; --report <file> records the ids run and caught.
const args = process.argv.slice(2);
const shardArg = args.includes('--shard') ? String(args[args.indexOf('--shard') + 1]) : '1/1';
const reportFile = args.includes('--report') ? String(args[args.indexOf('--report') + 1]) : null;
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
  if (!inShard(index)) continue;
  ran.push(m.id);
  const originals = new Map();
  let applicable = true;
  for (const e of m.edits) {
    const file = path.join(ROOT, e.file);
    const text = originals.get(file) ?? readFileSync(file, 'utf8');
    originals.set(file, text);
    const count = text.split(e.search).length - 1;
    if (count !== (e.expectedCount ?? 1)) {
      console.log(`c5-mutation: FAIL ${m.id} — expected ${e.expectedCount ?? 1} occurrence(s) of the gate in ${e.file}, found ${count} (rebuild, or update this check with the code)`);
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
      console.log(`c5-mutation: ok   ${m.id} (${m.gate}) — caught by ${caughtBy.map((r) => r.tests.join(',')).join(' + ')}`);
    } else {
      console.log(`c5-mutation: FAIL ${m.id} (${m.gate}) — no proof test caught the mutation`);
      failures++;
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text);
  }
}
if (reportFile) writeFileSync(reportFile, `${JSON.stringify({ script: 'c5:mutation', shard: shardArg, total: MUTATIONS.length, ran, caught }, null, 2)}\n`);
if (failures) {
  console.log(`c5-mutation: FAIL — ${failures} of ${ran.length} mutation(s) not caught (shard ${shardArg})`);
  process.exit(1);
}
console.log(`c5-mutation: PASS — ${caught.length}/${ran.length} mutations caught (shard ${shardArg}, ${MUTATIONS.length} total)`);
