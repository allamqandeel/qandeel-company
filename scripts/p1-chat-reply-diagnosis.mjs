#!/usr/bin/env node
// P1-CHAT-INTEL-01 — content-free diagnosis of every Founder conversation reply in a workspace (the read-only first step
// for a missing reply, e.g. R-D2-05). Same discipline as scripts/l1-02-activation-proof.mjs (D-L1-16):
//
//   node scripts/p1-chat-reply-diagnosis.mjs --workspace <dir>
//
// Run it while that Company is STOPPED (it opens the workspace itself, verify-only: no migration, no write of Company
// state; SQLite may still checkpoint its WAL on open, R-D2-03), or better on a restored copy of a verified backup. It prints
// IDs, states, codes, counts and amounts only — never a message body, a prompt, a model output or a key — so its output can
// go into a report. It uses no Founder authority and no test seam, retries nothing and changes nothing: every value is a read
// of durable state through the canonical stores (the same projection the Chat shows under each Founder message).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ strict: true, options: { workspace: { type: 'string' } } });
if (!values.workspace) {
  console.error(JSON.stringify({ ok: false, code: 'USAGE', message: 'node scripts/p1-chat-reply-diagnosis.mjs --workspace <dir>' }));
  process.exit(2);
}
const workspace = path.resolve(values.workspace);
if (!existsSync(path.join(workspace, 'state'))) {
  console.error(JSON.stringify({ ok: false, code: 'NOT_A_WORKSPACE', message: 'no state directory in the workspace' }));
  process.exit(2);
}

const { CompanyStore, GovernanceStore, CommunicationStore } = await import('@qandeel-company/storage');

const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
const out = { ok: true, schemaVersion: store.schemaVersion, threads: [] };
try {
  const gov = GovernanceStore.for(store);
  const comm = CommunicationStore.for(store);
  const company = gov.budgetFor('COMPANY', 'company');
  out.company = company ? { capMicros: company.capMoney, reservedMicros: company.reservedMoney, spentMicros: company.spentMoney, currency: company.currency } : null;
  out.reservationsHeld = gov.reservationsInState('RECONCILIATION_REQUIRED').map((r) => ({ id: r.id, workItemId: r.workItemId, purpose: r.purpose }));
  for (const t of comm.threads()) {
    if (t.kind === 'CEO_BRIEF') continue;
    const e = gov.getEmployee(t.employeeId);
    const env = gov.budgetFor('EMPLOYEE', e.id);
    const intel = gov.employeeIntelligence(e.id);
    const replies = comm.replyStates(t.id).map((r) => {
      const job = store.jobsFor(r.replyWorkItemId).at(-1) ?? null;
      const runs = store.runsForWorkItem(r.replyWorkItemId).map((x) => ({ attempt: x.attempt, state: x.state, failureCode: x.failureCode ?? null, startedAt: x.startedAt, endedAt: x.endedAt ?? null }));
      return {
        messageId: r.messageId,
        replyWorkItemId: r.replyWorkItemId,
        status: r.status,
        reasonCode: r.reasonCode,
        workItemState: r.workItemState,
        job: job ? { id: job.id, state: job.state, attempts: job.attemptCount, waitReason: job.waitReason ?? null, deadLetterReason: job.deadLetterReason ?? null, lastFailureCode: job.lastFailureCode ?? null } : null,
        runs,
        requestedClass: r.requestedClass,
        answeredClasses: r.answeredClasses,
        calls: r.calls,
        money: { currency: r.currency, capMicros: r.capMoney, reservedMicros: r.reservedMoney, spentMicros: r.spentMoney, billedMicros: r.billedMicros },
        updatedAt: r.updatedAt,
      };
    });
    out.threads.push({
      threadId: t.id,
      kind: t.kind,
      state: t.state,
      employee: { id: e.id, state: e.state, defaultClass: intel.defaultClass, ceilingClass: intel.ceilingClass, levels: intel.levels.map((l) => `${l.reasoningClass}:${l.availability}`) },
      envelope: env ? { capMicros: env.capMoney, reservedMicros: env.reservedMoney, spentMicros: env.spentMoney, currency: env.currency, status: env.status } : null,
      messages: comm.messageMeta(t.id).length,
      replies,
      byStatus: replies.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}),
    });
  }
} finally {
  store.close();
}
console.log(JSON.stringify(out, null, 2));
