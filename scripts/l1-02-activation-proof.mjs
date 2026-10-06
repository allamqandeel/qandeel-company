#!/usr/bin/env node
// L1-02 — content-free proof of the first production Company activation, read from a live workspace (D-L1-16).
//
//   node scripts/l1-02-activation-proof.mjs --workspace E:\QANDEEL_COMPANY_DATA\LIVE [--secret-scan]
//
// Run while the Founder surface is STOPPED (it opens the workspace itself, verify-only: no migration, no write). It prints
// IDs, states, codes, counts and amounts only — never a message, an answer, a prompt or a key — so its output can go into
// the implementation report. It uses no Founder authority and no test seam: every value is a read of durable state.
//
// --secret-scan additionally asks the Windows vault (inside its own callback; the value is never printed, logged or
// stored) whether the DeepSeek key appears in the database or WAL files, and checks that no `Bearer ` header or thinking
// field was persisted.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ strict: true, options: { workspace: { type: 'string' }, 'secret-scan': { type: 'boolean', default: false } } });
if (!values.workspace) {
  console.error(JSON.stringify({ ok: false, code: 'USAGE', message: 'node scripts/l1-02-activation-proof.mjs --workspace <dir> [--secret-scan]' }));
  process.exit(2);
}
const workspace = path.resolve(values.workspace);

const { CompanyStore, GovernanceStore, OrganizationStore, AcademyStore, CommunicationStore, activationView } = await import('@qandeel-company/storage');
const { CEO_ACADEMY_PACKAGE_V1, academyPackageDigest } = await import('@qandeel-company/mind');

// The workspace lives outside every Git working tree (never committed).
let insideGit = false;
for (let dir = workspace; ; dir = path.dirname(dir)) {
  if (existsSync(path.join(dir, '.git'))) insideGit = true;
  if (path.dirname(dir) === dir) break;
}

const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
const out = { ok: true, workspace, outsideAnyGitWorkingTree: !insideGit, schemaVersion: store.schemaVersion };
try {
  const gov = GovernanceStore.for(store);
  const org = OrganizationStore.for(store);
  const academy = AcademyStore.for(store);
  const comm = CommunicationStore.for(store);
  const v = activationView(store, [CEO_ACADEMY_PACKAGE_V1]);
  out.next = v.next;
  out.seat = v.seat ? { positionId: v.seat.positionId, code: v.seat.code, roleRef: v.seat.roleRef, title: v.seat.title } : null;
  out.ceo = v.ceo ? { employeeId: v.ceo.employeeId, name: v.ceo.name, displayNameAr: v.ceo.displayNameAr, jobTitle: v.ceo.jobTitle, state: v.ceo.state, portraitAssetRef: v.ceo.portraitAssetRef, identityProfile: v.ceo.identityProfile } : null;
  if (v.ceo) {
    const assignments = org.assignmentsOfEmployee(v.ceo.employeeId).map((a) => ({ id: a.id, positionId: a.positionId, kind: a.kind, status: a.status, from: a.effectiveFrom }));
    out.seatAssignments = assignments;
    const e = gov.getEmployee(v.ceo.employeeId);
    out.qualificationRefKinds = e.qualificationRefs.map((r) => r.split(':')[0]);
    out.activationRequests = academy.activationRequests(v.ceo.employeeId).map((r) => ({ id: r.id, state: r.state, decidedBy: r.decidedByRef ? r.decidedByRef.split(':')[0] : null }));
    out.certifications = academy.certifications(v.ceo.employeeId).map((c) => ({ id: c.id, status: c.status, roleRef: c.roleRef, validUntil: c.validUntil }));
    const b = gov.budgetFor('EMPLOYEE', v.ceo.employeeId);
    out.envelope = b ? { capMicros: b.capMoney, spentMicros: b.spentMoney, reservedMicros: b.reservedMoney, currency: b.currency } : null;
    const usage = gov.usage({ employeeId: v.ceo.employeeId });
    out.usage = {
      calls: usage.length,
      inputTokens: usage.reduce((n, u) => n + u.inputTokens, 0),
      cachedInputTokens: usage.reduce((n, u) => n + (u.cachedInputTokens ?? 0), 0),
      outputTokens: usage.reduce((n, u) => n + u.outputTokens, 0),
      billedMicros: usage.reduce((n, u) => n + u.billedMicros, 0),
      economicMicros: usage.reduce((n, u) => n + u.economicMicros, 0),
      bands: [...new Set(usage.map((u) => u.billingBand))],
      allWithinBounds: usage.every((u) => u.withinBounds),
      outcomes: Object.fromEntries([...new Set(usage.map((u) => u.outcome))].map((o) => [o, usage.filter((u) => u.outcome === o).length])),
      maxReservedMicros: Math.max(0, ...usage.map((u) => u.runId).flatMap((r) => gov.reservations(r).map((x) => x.money))),
    };
  }
  const c = gov.budgetFor('COMPANY', 'company');
  out.companyBudget = c ? { capMicros: c.capMoney, spentMicros: c.spentMoney, reservedMicros: c.reservedMoney, currency: c.currency } : null;
  const prov = gov.providerByCode('deepseek');
  out.provider = prov ? { status: prov.status, credentialRefKind: String(prov.credentialRef ?? '').split(':')[0], routedTaskClasses: v.provider.routedTaskClasses } : null;
  out.modelAccess = v.modelAccess;
  out.accountingInvariants = gov.accountingInvariants();
  const pkg = v.packages[0];
  out.package = pkg
    ? {
        code: pkg.code,
        version: pkg.version,
        sha256: pkg.sha256,
        registeredDigestMatches: pkg.sha256 === academyPackageDigest(CEO_ACADEMY_PACKAGE_V1),
        state: pkg.record?.state ?? null,
        installedAt: pkg.record?.installedAt ?? null,
        benchmarkSpentMicros: pkg.spentMicros,
        skills: pkg.skills.map((s) => ({ code: s.code, pipelineState: s.pipelineState, security: s.security ? { passed: s.security.passed, reviewer: s.security.reviewer } : null, verdict: s.verdict, runs: s.runs.map((r) => ({ caseCode: r.caseCode, arm: r.arm, state: r.state, workItemState: r.workItemState, scorePct: r.result?.scorePct ?? null, passed: r.result?.passed ?? null, answered: r.answer !== null })) })),
      }
    : null;
  const en = v.enrollment;
  out.enrollment = en
    ? {
        id: en.id,
        stage: en.stage,
        stageHistory: en.history.map((x) => `${x.toStage}:${x.reasonCode}`),
        modulesCompleted: en.modules.filter((m) => m.done).length,
        modulesTotal: en.modules.length,
        attempts: en.attempts.map((a) => ({ id: a.id, kind: a.kind, trial: a.trial, scenarioCode: a.scenarioCode, holdout: a.holdout, state: a.state, outcome: a.outcome, averagePct: a.averagePct, answered: a.answer !== null, results: a.results.map((r) => `${r.dimension}:${r.scorePct}:${r.evaluatorKind === 'DETERMINISTIC_RUBRIC' ? 'rubric' : 'founder'}`) })),
        remediations: en.remediations.map((r) => ({ id: r.id, state: r.state, categories: r.categories })),
        shadow: en.shadow.map((s) => ({ workItemId: s.workItemId, state: s.state, answered: s.answer !== null })),
        probation: en.probation,
        calibration: en.calibration,
        certification: en.certification,
        activationRequest: en.activationRequest,
      }
    : null;
  if (v.ceo) {
    const threads = comm.threads().filter((t) => t.employeeId === v.ceo.employeeId);
    out.threads = threads.map((t) => {
      const ms = comm.messages(t.id);
      return { id: t.id, kind: t.kind, state: t.state, founderMessages: ms.filter((m) => m.senderKind === 'FOUNDER').length, ceoMessages: ms.filter((m) => m.senderKind === 'EMPLOYEE').length, founderArabic: ms.filter((m) => m.senderKind === 'FOUNDER').some((m) => /[\u0600-\u06FF]/.test(m.body)), ceoArabic: ms.filter((m) => m.senderKind === 'EMPLOYEE').some((m) => /[\u0600-\u06FF]/.test(m.body)) };
    });
  }
} finally {
  store.close();
}

if (values['secret-scan']) {
  const { WindowsUserVault } = await import('@qandeel-company/secret-vault');
  const { DEEPSEEK_CREDENTIAL_REF } = await import('@qandeel-company/model-providers');
  const stateDir = path.join(workspace, 'state');
  const files = readdirSync(stateDir).filter((f) => /\.sqlite3(-wal|-shm)?$/.test(f)).map((f) => readFileSync(path.join(stateDir, f)));
  const vault = new WindowsUserVault();
  // The value stays inside the vault's callback; only a boolean leaves it.
  const keyFound = await vault.use(DEEPSEEK_CREDENTIAL_REF, (key) => files.some((b) => b.includes(key)));
  out.secretScan = { stateFiles: files.length, credentialInDurableState: keyFound, bearerInDurableState: files.some((b) => b.includes('Bearer ')), thinkingFieldInDurableState: files.some((b) => b.includes('reasoning_' + 'content')) };
}

console.log(JSON.stringify(out, null, 1));
