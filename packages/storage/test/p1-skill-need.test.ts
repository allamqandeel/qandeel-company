/**
 * G4-C2-SNA-01 (D-P1-15) — Skill Need Assessment through the real send → assessment Work Item → fenced result → reply
 * Context Assembly path, on fixture stores (no model, no provider call, synthetic text only):
 *   - the send opens one assessment (child of the reply, own task class, E1, one call, own cap) and delays the reply's job
 *     by the dependency window — or seals the fallback when the task class is not provisioned for the Employee;
 *   - the assessment's context is its preamble, the need cards and the message only (never a Skill payload, knowledge,
 *     memory, canonical truth or history); its result is bound to exactly the offered Skills and its own manifest;
 *   - exactly one decision per reply: a late or second result is refused, the reply seals the fallback when the window passed
 *     or the assessment ended, a result for other Skill versions is not applied (STALE_RESULT);
 *   - the reply plans with the decision: NON_RELEVANT Skills are never read, the fallback keeps every eligible Skill
 *     SUPPORTING within CP-1 and the 60K budget, recorded truthfully in the manifest; records are content-free.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';
import { SKILL_NEED_CAP, SKILL_NEED_PREAMBLE, SKILL_NEED_PREAMBLE_SHA256, SKILL_NEED_PROMPT_VERSION, SKILL_NEED_TASK_CLASS, SKILL_NEED_WINDOW_MS, type SkillNeedTier } from '@qandeel-company/governance';
import { SKILL_NEED_CARDS } from '@qandeel-company/mind';

import { CommunicationStore, MemoryStore, SKILL_NEED_ASSESSMENT_KIND, SkillNeedStore, SkillStore } from '../src/index.js';
import { assembleContext, recordSkillNeed } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { seed, type Seed } from './c2-helpers.js';
import { approvedSkill, claimFor, propose, workItem } from './c3-helpers.js';
import { claimItem, placed } from './c4-helpers.js';
import { harness, type Harness } from './helpers.js';
import { assess, assessmentOf, claimAssessment, proposalOf, provisionSkillNeed } from './sna-helpers.js';

function withSeed(fn: (h: Harness, s: Seed) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store, { companyCap: 500_000_000 }));
  } finally {
    h.close();
  }
}

const CEO_SKILLS = Object.keys(SKILL_NEED_CARDS);
const skillText = (code: string): string => `PAYLOAD-${code}: synthetic certified guidance for ${code.replace(/[.-]/g, ' ')}. ${'State the decision, the evidence and the owner; keep it short and concrete. '.repeat(22)}`;

function ceoWorld(h: Harness, s: Seed, opts: { provision?: boolean } = {}): { ceo: ReturnType<typeof placed>; versions: Map<string, Id>; thread: Id } {
  const ceo = placed(h, s, 'company.ceo', 9_000_000);
  const reg = SkillStore.for(h.store);
  const versions = new Map<string, Id>();
  for (const code of CEO_SKILLS) {
    const { version } = approvedSkill(h, s, code, { instructions: skillText(code) });
    reg.openPassportEntry(s.founder, ceo.id, version.id);
    versions.set(code, version.id);
  }
  if (opts.provision !== false) provisionSkillNeed(s, ceo.id);
  return { ceo, versions, thread: CommunicationStore.for(h.store).directThread(s.founder, null).id };
}

const send = (h: Harness, s: Seed, thread: Id, body: string, clientKey?: string): Id => CommunicationStore.for(h.store).send(s.founder, thread, { purpose: 'QUESTION', body, ...(clientKey ? { clientKey } : {}) }).replyWorkItemId as Id;
const inputOf = (h: Harness, id: Id): Record<string, unknown> => h.store.getWorkItem(id).processorInput as Record<string, unknown>;
const policyOf = (h: Harness, manifestId: Id): Record<string, unknown> => JSON.parse(String(storeContext(h.store).db.get<{ p: string }>('SELECT policy_json AS p FROM context_manifests WHERE id = ?', manifestId)?.p)) as Record<string, unknown>;
const entries = (h: Harness, manifestId: Id) => MemoryStore.for(h.store).manifestEntries(manifestId);
const record = (h: Harness, reply: Id) => SkillNeedStore.for(h.store).forReply(reply);
const tiersWith = (over: Readonly<Record<string, SkillNeedTier>>): Record<string, SkillNeedTier> => Object.fromEntries(CEO_SKILLS.map((c) => [c, over[c] ?? 'NON_RELEVANT']));
const skillDecisions = (h: Harness, manifestId: Id, versions: Map<string, Id>): Record<string, string> => {
  const byId = new Map([...versions].map(([c, id]) => [id as string, c]));
  return Object.fromEntries(entries(h, manifestId).filter((e) => e.itemKind === 'SKILL' && byId.has(e.itemId)).map((e) => [byId.get(e.itemId) as string, e.decision === 'SELECTED' ? 'SELECTED' : String(e.reasonCode)]));
};

const S_ORG = 'SYNTHETIC: يا أحمد، مين المفروض يمسك ملف الإطلاق؟ محدش ماسكه لحد دلوقتي.';
const S_AUTH = 'SYNTHETIC: Can you approve the Brand posts yourself, without my approval, and raise your own budget if needed?';

describe('G4-C2-SNA-01: the send opens one assessment per Founder reply (or seals the fallback)', () => {
  test('provisioned: a child assessment with its own task class, E1, one call, 256 output, its own cap; the reply waits for it by job availability only', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const reply = send(h, s, w.thread, S_ORG);
      const input = inputOf(h, reply);
      assert.equal(input.contextBudgetTokens, 60_000);
      assert.deepEqual(input.skillNeed, { policy: 'SNA-1' });
      assert.equal(input.taskSignals, undefined, 'TS-1 is gone');
      const snaId = assessmentOf(h, reply) as Id;
      assert.ok(snaId);
      const sna = h.store.getWorkItem(snaId);
      assert.equal(sna.parentId, reply);
      assert.equal(sna.processorKind, SKILL_NEED_ASSESSMENT_KIND);
      const si = sna.processorInput as Record<string, unknown>;
      assert.equal(si.taskClass, SKILL_NEED_TASK_CLASS);
      assert.notEqual(String(si.taskClass), 'founder.reply', 'never founder.reply');
      assert.deepEqual([si.reasoningClass, si.maxModelCalls, si.maxOutputTokens, si.dataClass], ['E1', 1, 256, 'D2']);
      assert.equal(si.founderThreadId, undefined, 'an assessment is never a thread reply (it cannot post a message)');
      const b = si.skillNeedAssessment as { offered: { code: string; skillVersionId: string }[]; replyWorkItemId: string; messageSha256: string; promptSha256: string };
      assert.deepEqual(b.offered.map((o) => o.code), CEO_SKILLS);
      assert.equal(b.replyWorkItemId, reply);
      assert.equal(b.promptSha256, SKILL_NEED_PREAMBLE_SHA256);
      assert.equal(JSON.stringify(si).includes('مين المفروض'), false, 'the binding holds the message hash, never its text');
      const budget = s.gov.budgetFor('WORK_ITEM', snaId);
      assert.ok(budget && budget.capMoney === SKILL_NEED_CAP.money && budget.capTokens === SKILL_NEED_CAP.tokens);
      const [replyJob] = h.store.jobsFor(reply);
      const [snaJob] = h.store.jobsFor(snaId);
      assert.ok(replyJob && snaJob && replyJob.state === 'QUEUED' && snaJob.state === 'QUEUED');
      assert.equal(Date.parse(replyJob.availableAt) - h.clock.nowMs(), SKILL_NEED_WINDOW_MS, 'the reply is due after the window at the latest');
      assert.equal(Date.parse(snaJob.availableAt), h.clock.nowMs(), 'the assessment is due now');
      assert.ok(snaJob.priority > replyJob.priority, 'and runs first');
      assert.throws(() => claimItem(h, reply, 'w-early'), /claim failed/, 'nobody can start the reply before its decision or its window');
      assert.equal(record(h, reply), null, 'no decision yet');
    });
  });

  test('idempotent: replaying the same send creates no second reply and no second assessment', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const a = send(h, s, w.thread, S_ORG, 'sna-key-0001');
      const b = send(h, s, w.thread, S_ORG, 'sna-key-0001');
      assert.equal(a, b);
      const n = storeContext(h.store).db.get<{ n: number }>('SELECT COUNT(*) AS n FROM work_items WHERE processor_kind = ?', SKILL_NEED_ASSESSMENT_KIND)?.n;
      assert.equal(n, 1);
    });
  });

  test('not provisioned (no route policy, or no model access for the task class): the send seals the fallback and the reply is due now', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s, { provision: false });
      const reply = send(h, s, w.thread, S_AUTH);
      assert.equal(assessmentOf(h, reply), null);
      const r = record(h, reply);
      assert.ok(r);
      assert.deepEqual([r.source, r.outcome, r.sealedBy, r.assessmentWorkItemId, r.promptSha256], ['FALLBACK', 'NOT_PROVISIONED', 'SEND', null, null]);
      assert.deepEqual(Object.values(r.tiers), CEO_SKILLS.map(() => 'SUPPORTING'));
      const [job] = h.store.jobsFor(reply);
      assert.equal(Date.parse(job?.availableAt ?? ''), h.clock.nowMs());
      const ctx = assembleContext(h.store, claimItem(h, reply, 'w-np').fence, { step: 0 });
      const sel = policyOf(h, ctx.manifestId).skillSelection as Record<string, unknown>;
      assert.deepEqual([sel.policy, sel.source, sel.outcome, sel.cards, sel.recordId], ['SNA-1', 'FALLBACK', 'NOT_PROVISIONED', 'SNC-1', r.id]);
    });
  });

  test('a route policy without the Employee\'s model access for it is not provisioned either', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s, { provision: false });
      // The seeded CEO holds a wildcard model.invoke: revoke it so only explicit task-class access counts.
      const db = storeContext(h.store).db;
      for (const g of db.all<{ id: string }>(`SELECT id FROM permission_grants WHERE employee_id = ? AND capability = 'model.invoke' AND status = 'ACTIVE'`, w.ceo.id)) s.gov.revokeGrant(s.founder, g.id, 'test.revoke');
      provisionSkillNeed(s, w.ceo.id, { grant: false });
      const reply = send(h, s, w.thread, S_AUTH);
      assert.equal(assessmentOf(h, reply), null);
      assert.equal(record(h, reply)?.outcome, 'NOT_PROVISIONED');
    });
  });
});

describe('G4-C2-SNA-01: the assessment reads only its preamble, the need cards and the message', () => {
  test('two required items; no Skill payload, knowledge, memory, canonical truth or history, whatever the stores hold', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const mem = MemoryStore.for(h.store);
      mem.recordCanonicalTruth(s.founder, { level: 'POLICY', topic: 'company.launch', statement: 'SYNTHETIC canonical: الإطلاق والتعيين والملف', dataClass: 'D1', sourceRef: 'authority:synthetic' });
      mem.recordKnowledge(s.founder, { scope: 'COMPANY', topic: 'company.launch', content: 'SYNTHETIC knowledge: ملف الإطلاق والمسؤول', dataClass: 'D1' });
      const { claim } = claimFor(h, workItem(h, s, w.ceo, { instructions: 'SYNTHETIC notes about the launch owner' }), 'w-sna-mem');
      propose(h, claim, 1, { topic: 'company.launch', content: 'SYNTHETIC memory: مين ماسك ملف الإطلاق', confidencePct: 90 });
      CommunicationStore.for(h.store).send(s.founder, w.thread, { purpose: 'FYI', body: 'SYNTHETIC earlier turn: الإطلاق قرب' });
      const reply = send(h, s, w.thread, S_ORG);
      const snaId = assessmentOf(h, reply) as Id;
      const run = claimAssessment(h, snaId);
      const ctx = assembleContext(h.store, run.fence, { step: 0 });
      assert.equal(ctx.outcome, 'OK');
      if (ctx.outcome !== 'OK') return;
      const es = entries(h, ctx.manifestId);
      assert.deepEqual(es.map((e) => [e.itemKind, e.decision]), [['PREAMBLE', 'SELECTED'], ['WORK_INSTRUCTIONS', 'SELECTED']]);
      const text = ctx.messages.map((m) => m.content).join('\n');
      assert.ok(text.includes(SKILL_NEED_PREAMBLE.split('\n')[0] as string), 'the classifier preamble');
      assert.ok(text.includes(S_ORG), 'the message');
      for (const c of CEO_SKILLS) {
        assert.ok(text.includes(`Skill ${c} — `), `${c} card`);
        assert.equal(text.includes(`PAYLOAD-${c}`), false, `${c}: never the certified instructions`);
      }
      for (const never of ['SYNTHETIC canonical', 'SYNTHETIC knowledge', 'SYNTHETIC memory', 'SYNTHETIC earlier turn', 'Identity kernel', '"type":"MESSAGE"']) assert.equal(text.includes(never), false, never);
      assert.equal(ctx.dataClass, 'D2');
      const m = MemoryStore.for(h.store).manifest(ctx.manifestId);
      assert.ok(m.totalBudget === 24_000 && m.estimatedInputTokens < 24_000);
    });
  });
});

describe('G4-C2-SNA-01: exactly one decision per reply', () => {
  test('a valid SKILL_NEED is recorded once (MODEL / CLASSIFIED), bound to its manifest, and makes the reply due at once', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const reply = send(h, s, w.thread, S_ORG);
      const tiers = tiersWith({ 'ceo.organization-leadership': 'TASK_REQUIRED', 'ceo.founder-partnership': 'SUPPORTING' });
      const { recorded, context, snaId } = assess(h, reply, tiers);
      assert.equal(recorded.recorded, true);
      const r = record(h, reply);
      assert.ok(r);
      assert.deepEqual([r.source, r.outcome, r.sealedBy, r.assessmentWorkItemId, r.manifestId, r.promptVersion], ['MODEL', 'CLASSIFIED', 'ASSESSMENT', snaId, context.manifestId, SKILL_NEED_PROMPT_VERSION]);
      assert.deepEqual(r.tiers, Object.fromEntries(Object.entries(tiers).sort(([a], [b]) => (a < b ? -1 : 1))));
      const [job] = h.store.jobsFor(reply);
      assert.equal(Date.parse(job?.availableAt ?? ''), h.clock.nowMs(), 'the reply is due now');
      // The reply plans with the decision: TASK_REQUIRED selected, NON_RELEVANT never a payload read.
      const ctx = assembleContext(h.store, claimItem(h, reply, 'w-reply').fence, { step: 0 });
      assert.equal(ctx.outcome, 'OK');
      const d = skillDecisions(h, ctx.manifestId, w.versions);
      assert.equal(d['ceo.organization-leadership'], 'SELECTED');
      assert.equal(d['ceo.founder-partnership'], 'SELECTED');
      for (const c of ['ceo.governance-discipline', 'ceo.executive-judgment', 'ceo.evidence-and-economics', 'ceo.cross-functional-synthesis']) assert.equal(d[c], 'NOT_RELEVANT', c);
      const sel = policyOf(h, ctx.manifestId).skillSelection as Record<string, unknown>;
      assert.deepEqual([sel.source, sel.outcome, sel.recordId], ['MODEL', 'CLASSIFIED', r.id]);
      assert.deepEqual(sel.tiers, { TASK_REQUIRED: 1, SUPPORTING: 1, NON_RELEVANT: 4 });
    });
  });

  test('an answer naming an unknown Skill or missing an offered one is refused whole (OUTPUT_INVALID fallback); a manifest of another run is refused', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const r1 = send(h, s, w.thread, S_ORG);
      assess(h, r1, { ...tiersWith({ 'ceo.governance-discipline': 'TASK_REQUIRED' }), 'market.research': 'SUPPORTING' });
      assert.deepEqual([record(h, r1)?.source, record(h, r1)?.outcome], ['FALLBACK', 'OUTPUT_INVALID']);
      assert.deepEqual(Object.values(record(h, r1)?.tiers ?? {}), CEO_SKILLS.map(() => 'SUPPORTING'), 'nothing of the refused answer is kept');
      const r2 = send(h, s, w.thread, S_AUTH);
      const { 'ceo.cross-functional-synthesis': _, ...missing } = tiersWith({ 'ceo.governance-discipline': 'TASK_REQUIRED' });
      void _;
      assess(h, r2, missing);
      assert.equal(record(h, r2)?.outcome, 'OUTPUT_INVALID');
      const r3 = send(h, s, w.thread, S_AUTH);
      const run = claimAssessment(h, assessmentOf(h, r3) as Id, 'w-sna-3');
      const other = assembleContext(h.store, claimItem(h, r1, 'w-other').fence, { step: 0 });
      assert.throws(() => recordSkillNeed(h.store, run.fence, { kind: 'PROPOSAL', proposal: proposalOf(tiersWith({})), manifestId: other.manifestId as Id }), /own assembled context/);
      assert.equal(record(h, r3), null);
    });
  });

  test('a second or late result never replaces the decision; the reply seals WINDOW_EXPIRED when the window passed and keeps it', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const reply = send(h, s, w.thread, S_ORG);
      const snaId = assessmentOf(h, reply) as Id;
      const run = claimAssessment(h, snaId, 'w-slow');
      const sctx = assembleContext(h.store, run.fence, { step: 0 });
      // The assessment is slow: the window passes and the reply starts with the fallback.
      h.clock.advance(SKILL_NEED_WINDOW_MS);
      const rc = claimItem(h, reply, 'w-reply');
      const first = assembleContext(h.store, rc.fence, { step: 0 });
      assert.deepEqual([record(h, reply)?.source, record(h, reply)?.outcome, record(h, reply)?.sealedBy], ['FALLBACK', 'WINDOW_EXPIRED', 'REPLY']);
      const late = recordSkillNeed(h.store, run.fence, { kind: 'PROPOSAL', proposal: proposalOf(tiersWith({ 'ceo.organization-leadership': 'TASK_REQUIRED' })), manifestId: sctx.manifestId });
      assert.deepEqual([late.recorded, late.recorded ? null : late.code], [false, 'ALREADY_DECIDED']);
      const again = recordSkillNeed(h.store, run.fence, { kind: 'FALLBACK', outcome: 'PROVIDER_FAILED' });
      assert.equal(again.recorded, false);
      const second = assembleContext(h.store, rc.fence, { step: 1 });
      for (const m of [first, second]) {
        const sel = policyOf(h, m.manifestId).skillSelection as Record<string, unknown>;
        assert.deepEqual([sel.source, sel.outcome], ['FALLBACK', 'WINDOW_EXPIRED'], 'every step plans with the same decision');
      }
      assert.equal(storeContext(h.store).db.get<{ n: number }>('SELECT COUNT(*) AS n FROM skill_need_assessments WHERE reply_work_item_id = ?', reply)?.n, 1);
      assert.throws(() => storeContext(h.store).db.run(`UPDATE skill_need_assessments SET outcome = 'CLASSIFIED' WHERE reply_work_item_id = ?`, reply), (e: unknown) => /append-only/.test(String((e as { cause?: { message?: string } }).cause?.message)));
    });
  });

  test('an assessment that ended without a result: the reply seals ASSESSMENT_ENDED; cancelling the reply cancels its assessment', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const reply = send(h, s, w.thread, S_ORG);
      const snaId = assessmentOf(h, reply) as Id;
      h.store.requestCancellation(snaId, { reasonCode: 'test.cancel' });
      assert.equal(h.store.getWorkItem(snaId).state, 'CANCELLED');
      h.clock.advance(SKILL_NEED_WINDOW_MS);
      assembleContext(h.store, claimItem(h, reply, 'w-ended').fence, { step: 0 });
      assert.deepEqual([record(h, reply)?.outcome, record(h, reply)?.sealedBy], ['ASSESSMENT_ENDED', 'REPLY']);
      const r2 = send(h, s, w.thread, S_AUTH);
      const sna2 = assessmentOf(h, r2) as Id;
      h.store.requestCancellation(r2, { reasonCode: 'test.cancel_reply' });
      assert.equal(h.store.getWorkItem(sna2).state, 'CANCELLED', 'the assessment never outlives its reply');
    });
  });

  test('a classification is applied only to the Skill versions it was given: a changed offer makes it STALE_RESULT (fallback)', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const reply = send(h, s, w.thread, S_ORG);
      assess(h, reply, tiersWith({ 'ceo.organization-leadership': 'TASK_REQUIRED' }));
      SkillStore.for(h.store).setFreshness(s.founder, w.versions.get('ceo.cross-functional-synthesis') as string, 'SECURITY_HOLD', 'test.hold');
      const ctx = assembleContext(h.store, claimItem(h, reply, 'w-stale').fence, { step: 0 });
      const sel = policyOf(h, ctx.manifestId).skillSelection as Record<string, unknown>;
      assert.deepEqual([sel.source, sel.outcome], ['FALLBACK', 'STALE_RESULT']);
      const d = skillDecisions(h, ctx.manifestId, w.versions);
      assert.equal(d['ceo.cross-functional-synthesis'], 'STATUS_NOT_RETRIEVABLE', 'an ineligible Skill is never offered as available');
      assert.equal(Object.values(d).includes('NOT_RELEVANT'), false, 'the fallback drops nothing as not relevant');
    });
  });

  test('every fallback cause the assessment may record is accepted; CLASSIFIED and the reply-side codes are not', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      for (const outcome of ['PROVIDER_UNAVAILABLE', 'BUDGET_REFUSED', 'OUTPUT_TRUNCATED'] as const) {
        const reply = send(h, s, w.thread, `${S_AUTH} ${outcome}`);
        assess(h, reply, { fallback: outcome });
        assert.deepEqual([record(h, reply)?.source, record(h, reply)?.outcome, record(h, reply)?.manifestId], ['FALLBACK', outcome, null]);
      }
      const reply = send(h, s, w.thread, S_ORG);
      const run = claimAssessment(h, assessmentOf(h, reply) as Id, 'w-codes');
      for (const bad of ['CLASSIFIED', 'WINDOW_EXPIRED', 'NOT_PROVISIONED', 'ASSESSMENT_ENDED'] as const) assert.throws(() => recordSkillNeed(h.store, run.fence, { kind: 'FALLBACK', outcome: bad }), /names why no classification exists/, bad);
    });
  });
});

describe('G4-C2-SNA-01: the conservative fallback on a populated store (six Skills, canonical truth, knowledge, memory, full history, 4,000 characters)', () => {
  test('every eligible Skill is SUPPORTING (none dropped as not relevant); each is selected or rejected with a recorded reason; used <= budget', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s, { provision: false });
      const mem = MemoryStore.for(h.store);
      const fact = (i: number) => `SYNTHETIC ${i}: الميزانية والتعيين والإطلاق والسوق السعودي ومصر والصرف والمنتج والنمو. ${'تفاصيل إضافية عن الخطة والفريق. '.repeat(6 + (i % 5) * 8)}`;
      for (let i = 0; i < 3; i++) mem.recordCanonicalTruth(s.founder, { level: 'POLICY', topic: `company.policy${i}`, statement: fact(i).slice(0, 1_900), dataClass: 'D1', sourceRef: 'authority:synthetic' });
      for (let i = 0; i < 14; i++) mem.recordKnowledge(s.founder, { scope: 'COMPANY', topic: `company.k${i}`, content: fact(10 + i).slice(0, 3_900), dataClass: 'D1' });
      const { claim } = claimFor(h, workItem(h, s, w.ceo, { instructions: 'SYNTHETIC: notes about the budget and hiring' }), 'w-fb-mem');
      for (let i = 0; i < 16; i++) propose(h, claim, i + 1, { topic: `company.m${i}`, content: fact(40 + i).slice(0, 1_800), confidencePct: 90 });
      for (let i = 0; i < 12; i++) CommunicationStore.for(h.store).send(s.founder, w.thread, { purpose: 'FYI', body: `SYNTHETIC ${i}: ${'ملاحظة سابقة عن خطة الشركة والفريق والإطلاق. '.repeat(40)}`.slice(0, 1_200) });
      const reply = send(h, s, w.thread, `${S_ORG} ${S_AUTH} `.repeat(40).slice(0, 4_000));
      const ctx = assembleContext(h.store, claimItem(h, reply, 'w-fb').fence, { step: 0 });
      assert.equal(ctx.outcome, 'OK');
      const d = skillDecisions(h, ctx.manifestId, w.versions);
      assert.deepEqual(Object.keys(d).sort(), [...CEO_SKILLS].sort(), 'all six are candidates');
      for (const [c, v] of Object.entries(d)) assert.ok(v === 'SELECTED' || (v !== 'NOT_RELEVANT' && v.length > 0), `${c}: ${v}`);
      const selected = Object.values(d).filter((v) => v === 'SELECTED').length;
      const m = MemoryStore.for(h.store).manifest(ctx.manifestId);
      assert.ok(m.usedTokens <= 60_000 - 512 && m.estimatedInputTokens <= 60_000);
      const sel = policyOf(h, ctx.manifestId).skillSelection as { source: string; outcome: string; tiers: Record<string, number> };
      assert.deepEqual([sel.source, sel.outcome, sel.tiers.SUPPORTING, sel.tiers.NON_RELEVANT], ['FALLBACK', 'NOT_PROVISIONED', 6, 0]);
      // Measured, not assumed: how many of the six the SKILL share holds next to a full store (reported, never claimed as 100%).
      assert.ok(selected >= 1, `selected ${selected} of 6`);
      process.stdout.write(`# SNA fallback on a populated store: ${selected}/6 Skills selected, used ${m.usedTokens}/${m.totalBudget}\n`);
    });
  });
});

describe('G4-C2-SNA-01: content-free records (Rule A)', () => {
  test('the decision record and its audit rows hold codes, ids and hashes — never the message, a card or a Skill text', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const reply = send(h, s, w.thread, S_ORG);
      assess(h, reply, tiersWith({ 'ceo.organization-leadership': 'TASK_REQUIRED' }));
      const db = storeContext(h.store).db;
      const row = JSON.stringify(db.get('SELECT * FROM skill_need_assessments WHERE reply_work_item_id = ?', reply));
      const audit = JSON.stringify(db.all(`SELECT * FROM audit_events WHERE action LIKE 'skill_need.%'`));
      for (const text of [row, audit]) {
        assert.equal(text.includes('مين المفروض'), false);
        assert.equal(text.includes('TASK_REQUIRED when'), false);
        assert.equal(text.includes('PAYLOAD-'), false);
      }
      assert.ok(audit.includes('skill_need.recorded') && audit.includes('skill_need.opened'));
    });
  });
});
