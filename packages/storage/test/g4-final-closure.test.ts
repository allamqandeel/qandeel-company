/**
 * G4-FINAL-CLOSURE-01 (D-P1-17) — Founder decision continuity and the CEO's reply language, through the real stores, the
 * governed Founder confirmation and the real send → reply Work Item → claimed run → assembled context path (fixture
 * stores, synthetic text, no model, no provider call):
 *   - WP2: a decision is recorded only by the Founder's confirmed act, from the Founder's own message in the CEO
 *     conversation; it is a FOUNDER_DECISION knowledge item for the CEO's role (or the Company), its source the message;
 *     idempotent; amended through the supersession chain and revoked through ARCHIVED, history kept; refused for anyone but
 *     the authenticated Founder, for another conversation or an Employee's words; a failed confirmation records nothing;
 *     the audit is content-free; nothing moves a budget, grant or assignment; conversation alone records nothing;
 *   - WP3: the decision in force is retrieved after the turn left the history window (NORMAL and FULL, several phrasings),
 *     never for an unrelated message, never in its replaced or revoked version, never for another Employee unless the
 *     Founder said so, never from the future of a Work Item, never in an Academy attempt, always within the budget;
 *   - WP1: the CEO's reply is told the language of the CURRENT message (an English message after Arabic turns → English).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Id } from '@qandeel-company/domain';

import { AcademyStore, CommunicationStore, FounderActionStore, FounderAuthStore, MemoryStore, SkillStore } from '../src/index.js';
import { CEO_CONVERSATION_GUIDANCE, CEO_LANGUAGE_GUIDANCE, EMPLOYEE_COMMUNICATION_STANDARD, currentLanguageLine } from '../src/mind-writes.js';
import { assembleContext, recordStepResult, type AssembleResult } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { seed, type Seed } from './c2-helpers.js';
import { academyWorld, approvedSkill, claimFor, propose, workItem } from './c3-helpers.js';
import { claimItem, placed } from './c4-helpers.js';
import { harness, type Harness } from './helpers.js';

const reason = (r: string) => (e: unknown): boolean => isQandeelError(e) && e.details['reason'] === r;
const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;

function withSeed(fn: (h: Harness, s: Seed) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store, { companyCap: 500_000_000 }));
  } finally {
    h.close();
  }
}

const CEO_SKILLS = ['ceo.governance-discipline', 'ceo.founder-partnership', 'ceo.executive-judgment', 'ceo.evidence-and-economics', 'ceo.organization-leadership', 'ceo.cross-functional-synthesis'];
const skillText = (c: string): string => `Synthetic guidance for ${c.replace(/[.-]/g, ' ')}. ${'State the decision, the evidence and the owner; keep it short and concrete. '.repeat(22)}`;

interface World {
  readonly ceo: ReturnType<typeof placed>;
  readonly thread: Id;
  readonly versions: Map<string, Id>;
  say(body: string): Id;
  ask(body: string): Id;
  act(intent: string, payload: Record<string, unknown>): string;
  preview(intent: string, payload: Record<string, unknown>): ReturnType<FounderActionStore['preview']>;
  confirm(p: ReturnType<FounderActionStore['preview']>): string;
}

/** The CEO with its six Skills, the Founder ↔ CEO thread, and the Founder's authenticated session. */
function world(h: Harness, s: Seed): World {
  const ceo = placed(h, s, 'company.ceo', 9_000_000);
  const reg = SkillStore.for(h.store);
  const versions = new Map<string, Id>();
  for (const c of CEO_SKILLS) {
    const { version } = approvedSkill(h, s, c, { instructions: skillText(c) });
    reg.openPassportEntry(s.founder, ceo.id, version.id);
    versions.set(c, version.id);
  }
  const comm = CommunicationStore.for(h.store);
  const thread = comm.directThread(s.founder, null).id;
  const auth = FounderAuthStore.for(h.store);
  const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
  const actions = FounderActionStore.for(h.store, auth);
  const preview = (intent: string, payload: Record<string, unknown>) => actions.preview(session, intent, payload);
  const confirm = (p: ReturnType<FounderActionStore['preview']>): string => actions.confirm(session, p.id, p.fingerprint).resultRef;
  return {
    ceo,
    thread,
    versions,
    say: (body) => comm.send(s.founder, thread, { purpose: 'FYI', body }).message.id,
    ask: (body) => comm.send(s.founder, thread, { purpose: 'QUESTION', body }).replyWorkItemId as Id,
    act: (intent, payload) => confirm(preview(intent, payload)),
    preview,
    confirm,
  };
}

const M_BUDGET = 'SYNTHETIC-M1: قررنا إن ميزانية التسويق للربع الجاي ٤٠ ألف جنيه بالظبط، وسارة مدير النمو هي المسؤولة عنها، وأي زيادة ترجع لي.';
const SUBJECT = 'ميزانية التسويق للربع الجاي';
const STATEMENT = 'ميزانية التسويق للربع الجاي 40,000 جنيه بالظبط. سارة (مدير النمو) هي المسؤولة عنها. أي زيادة ترجع للمؤسس للموافقة.';
const AMENDED = 'ميزانية التسويق للربع الجاي 30,000 جنيه. سارة (مدير النمو) لسه هي المسؤولة عنها. أي زيادة ترجع للمؤسس للموافقة.';
const Q_RECALL = 'فكّرني، اتفقنا على إيه بالظبط في موضوع ميزانية التسويق للربع الجاي، ومين المسؤول عنها؟';

const db = (h: Harness) => storeContext(h.store).db;
const decisionRows = (h: Harness) => db(h).all<{ id: string; status: string; claim_key: string; claim_value: string; scope: string; scope_ref: string | null; data_class: string; provenance_ref: string; superseded_by_id: string | null; supersedes_id: string | null }>(`SELECT * FROM knowledge_items WHERE provenance_kind = 'FOUNDER_DECISION' AND topic = 'founder.decision' ORDER BY created_at, CAST(substr(claim_value, 2) AS INTEGER), id`);
const count = (h: Harness, table: string): number => Number(db(h).get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n);
const idOf = (ref: string): Id => ref.slice(ref.indexOf(':') + 1) as Id;
/** Earlier Founder turns (FYI) that push an old turn out of the 11,750-byte history window. */
function pushOutOfWindow(w: World, n = 14): void {
  for (let i = 0; i < n; i++) w.say(`SYNTHETIC-FILL ${i}: ${'ملاحظة سابقة عن خطة الفريق والإطلاق والمنتج. '.repeat(40)}`.slice(0, 1_200));
}
function assembled(h: Harness, workItemId: Id, worker: string, tools = 0): AssembleResult {
  const claim = claimItem(h, workItemId, worker);
  for (let i = 0; i < tools; i++) recordStepResult(h.store, claim.fence, i, 'TOOL_RESULT', `SYNTHETIC tool result ${i}: ${'x'.repeat(2_000)}`);
  return assembleContext(h.store, claim.fence, { step: tools });
}
const rendered = (ctx: AssembleResult): string => (ctx.outcome === 'OK' ? ctx.messages.map((m) => m.content).join('\n') : '');
const decisionEntry = (h: Harness, ctx: AssembleResult, id: string) => MemoryStore.for(h.store).manifestEntries(ctx.manifestId).find((e) => e.itemId === id);

describe('G4-FINAL-CLOSURE-01 WP2: the Founder records a decision from his own message — a confirmed act, never the conversation by itself', () => {
  test('record: one FOUNDER_DECISION knowledge item for the CEO role, its source the message, D2, v1; content-free audit; no budget, grant, assignment or Work Item', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      const m1 = w.say(M_BUDGET);
      const before = { budgets: count(h, 'budgets'), grants: count(h, 'permission_grants'), work: count(h, 'work_items') };
      const p = w.preview('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT });
      assert.equal(p.payload.audience, 'CEO');
      assert.equal(p.payload.dataClass, 'D2');
      assert.equal(p.payload.decisionVersion, 1);
      assert.equal(p.payload.budgetChange, 'NONE');
      assert.equal(p.payload.grantChange, 'NONE');
      assert.equal(p.payload.assignmentChange, 'NONE');
      assert.equal(decisionRows(h).length, 0, 'a preview records nothing');
      const ref = w.confirm(p);
      const rows = decisionRows(h);
      assert.equal(rows.length, 1);
      const k = rows[0]!;
      assert.equal(ref, `knowledge:${k.id}`);
      assert.deepEqual([k.status, k.scope, k.scope_ref, k.data_class, k.provenance_ref, k.claim_value], ['ACTIVE', 'ROLE', w.ceo.roleRef, 'D2', `communication_message:${m1}`, 'v1']);
      assert.match(k.claim_key, /^founder-decision\.[0-9a-f]{16}$/);
      assert.deepEqual({ budgets: count(h, 'budgets'), grants: count(h, 'permission_grants'), work: count(h, 'work_items') }, before, 'recording moves no budget or grant and starts no work');
      // Rule A: the audit and the history carry IDs and codes; the words live in the knowledge item only.
      const audit = JSON.stringify(db(h).all(`SELECT * FROM audit_events WHERE entity_id IN (?, ?)`, k.id, p.id));
      assert.match(audit, /founder_decision\.recorded/);
      for (const words of ['40,000', 'سارة', 'ميزانية']) assert.equal(audit.includes(words), false, `audit holds no decision text: ${words}`);
      assert.deepEqual(db(h).all<{ from_status: string | null; to_status: string }>('SELECT from_status, to_status FROM knowledge_history WHERE knowledge_id = ? ORDER BY version', k.id).map((r) => [r.from_status, r.to_status]), [[null, 'ACTIVE']]);
      const view = CommunicationStore.for(h.store).founderDecisions(w.thread);
      assert.deepEqual(view.map((d) => [d.subject, d.statement, d.inForce, d.decisionVersion, d.sourceMessageId]), [[SUBJECT, STATEMENT, true, 1, m1]]);
    });
  });

  test('idempotent: the same words from the same message are one decision — a second request is refused, never a duplicate', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      const m1 = w.say(M_BUDGET);
      const p = w.preview('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT });
      const p2 = w.preview('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT });
      w.confirm(p);
      assert.throws(() => w.confirm(p), 'a preview is decided once');
      assert.throws(() => w.confirm(p2), reason('ALREADY_RECORDED'), 'a parallel identical preview records nothing more');
      assert.throws(() => w.preview('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT }), reason('ALREADY_RECORDED'));
      assert.throws(() => w.preview('FOUNDER_DECISION_RECORD', { messageId: m1, subject: `  ${SUBJECT} `, statement: `${STATEMENT}\n` }), reason('ALREADY_RECORDED'), 'whitespace is not a new decision');
      assert.throws(() => w.preview('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: `${STATEMENT} تعديل` }), reason('ALREADY_RECORDED'), 'a second decision on the same subject from the same message is an amendment, never a twin');
      assert.equal(decisionRows(h).length, 1);
    });
  });

  test('only the Founder\'s own words in the CEO conversation, bounded, secret-free, D1 / D2; another session or an Employee cannot record; a direct store call needs Founder authority', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      const m1 = w.say(M_BUDGET);
      const other = CommunicationStore.for(h.store).directThread(s.founder, s.employee.id).id;
      const elsewhere = CommunicationStore.for(h.store).send(s.founder, other, { purpose: 'FYI', body: M_BUDGET }).message.id;
      const record = (over: Record<string, unknown>) => () => w.preview('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT, ...over });
      assert.throws(record({ messageId: elsewhere }), reason('NOT_CEO_CONVERSATION'));
      assert.throws(record({ messageId: '00000000-0000-4000-8000-000000000000' }), reason('MESSAGE_NOT_FOUND'));
      assert.throws(record({ subject: ' ' }), reason('TEXT_LENGTH'));
      assert.throws(record({ statement: 'x'.repeat(1_501) }), reason('TEXT_LENGTH'));
      assert.throws(record({ statement: `${STATEMENT} api_key=sk-live-${'A1b2C3d4'.repeat(6)}` }), reason('SECRET_MATERIAL'));
      assert.throws(record({ dataClass: 'D3' }), reason('DATA_CLASS'));
      assert.throws(record({ audience: 'DEPARTMENT' }), reason('AUDIENCE'));
      // Another Founder session cannot confirm this session's preview (the fingerprint binds the session).
      const p = w.preview('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT });
      const auth = FounderAuthStore.for(h.store);
      const { session: second } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
      assert.throws(() => FounderActionStore.for(h.store, auth).confirm(second, p.id, p.fingerprint));
      // A store call outside the Founder's authority (an Employee ref, or no authenticated surface) is refused.
      assert.throws(() => MemoryStore.for(h.store).recordFounderDecision(s.employee.ref, { messageId: m1, subject: SUBJECT, statement: STATEMENT }));
      assert.throws(() => MemoryStore.for(h.store).revokeFounderDecision(s.employee.ref, '00000000-0000-4000-8000-000000000000'));
      assert.equal(decisionRows(h).length, 0);
    });
  });

  test('amend → the earlier version is SUPERSEDED (linked), the new one in force under the same key; revoke → ARCHIVED; history kept; a replaced / revoked one cannot be changed again', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      const m1 = w.say(M_BUDGET);
      const v1 = idOf(w.act('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT }));
      const m2 = w.say('SYNTHETIC-M2: عدّل ميزانية التسويق من 40 لـ 30 ألف.');
      const p = w.preview('FOUNDER_DECISION_RECORD', { messageId: m2, subject: SUBJECT, statement: AMENDED, supersedesId: v1 });
      assert.deepEqual([p.payload.decisionVersion, p.payload.supersedesId], [2, v1]);
      const v2 = idOf(w.confirm(p));
      const [r1, r2] = decisionRows(h);
      assert.deepEqual([r1?.id, r1?.status, r1?.superseded_by_id], [v1, 'SUPERSEDED', v2]);
      assert.deepEqual([r2?.id, r2?.status, r2?.supersedes_id, r2?.claim_value, r2?.claim_key], [v2, 'ACTIVE', v1, 'v2', r1?.claim_key]);
      assert.throws(() => w.preview('FOUNDER_DECISION_RECORD', { messageId: m2, subject: SUBJECT, statement: STATEMENT, supersedesId: v1 }), reason('NOT_IN_FORCE'));
      const m0 = db(h).get<{ id: string }>('SELECT id FROM communication_messages WHERE thread_id = ? ORDER BY seq LIMIT 1', w.thread)?.id;
      assert.equal(m0, m1);
      const m3 = w.say('SYNTHETIC-M3: ألغي قرار ميزانية التسويق.');
      assert.throws(() => w.preview('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: `${AMENDED} ٢`, supersedesId: v2 }), reason('SOURCE_OLDER'));
      w.act('FOUNDER_DECISION_REVOKE', { decisionId: v2, messageId: m3 });
      assert.equal(decisionRows(h).find((r) => r.id === v2)?.status, 'ARCHIVED');
      assert.throws(() => w.preview('FOUNDER_DECISION_REVOKE', { decisionId: v2 }), reason('NOT_IN_FORCE'));
      assert.throws(() => w.preview('FOUNDER_DECISION_REVOKE', { decisionId: idOf(String(db(h).get<{ id: string }>(`SELECT id FROM knowledge_items WHERE provenance_kind <> 'FOUNDER_DECISION' LIMIT 1`)?.id ?? '00000000-0000-4000-8000-000000000000')) }));
      const hist = (id: Id) => db(h).all<{ to_status: string }>('SELECT to_status FROM knowledge_history WHERE knowledge_id = ? ORDER BY version', id).map((r) => r.to_status);
      assert.deepEqual(hist(v1), ['ACTIVE', 'SUPERSEDED']);
      assert.deepEqual(hist(v2), ['ACTIVE', 'ARCHIVED']);
      const view = CommunicationStore.for(h.store).founderDecisions(w.thread);
      assert.deepEqual(view.map((d) => [d.decisionVersion, d.status, d.inForce]), [[1, 'SUPERSEDED', false], [2, 'ARCHIVED', false]]);
      assert.match(JSON.stringify(db(h).all(`SELECT * FROM audit_events WHERE action = 'founder_decision.revoked'`)), new RegExp(m3));
    });
  });

  test('a confirmation that fails (its decision changed since the preview) records nothing and is FAILED — never an apparent success', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      const m1 = w.say(M_BUDGET);
      const v1 = idOf(w.act('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT }));
      const m2 = w.say('SYNTHETIC-M2: عدّل ميزانية التسويق من 40 لـ 30 ألف.');
      const amend = w.preview('FOUNDER_DECISION_RECORD', { messageId: m2, subject: SUBJECT, statement: AMENDED, supersedesId: v1 });
      w.act('FOUNDER_DECISION_REVOKE', { decisionId: v1 });
      const rows = decisionRows(h).length;
      assert.throws(() => w.confirm(amend), code('INVALID_TRANSITION'));
      assert.equal(decisionRows(h).length, rows, 'no row written');
      assert.equal(db(h).get<{ state: string }>('SELECT state FROM founder_action_previews WHERE id = ?', amend.id)?.state, 'FAILED');
    });
  });

  test('S10: discussion, proposals and even explicit decision wording record nothing without the Founder\'s confirmed act', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      for (const body of ['إيه رأيك في ميزانية 40 ألف؟', 'ممكن نفكر في تعيين سارة.', 'خلينا نناقش الموضوع.', 'سارة قالت: «اعتمدت الحملة».', 'اعتمدت ميزانية التسويق 40 ألف.', 'قررت تكليف سارة بالمهمة.']) w.ask(body);
      assert.equal(decisionRows(h).length, 0);
    });
  });
});

describe('G4-FINAL-CLOSURE-01 WP3: the decision in force is retrieved after the turn left the history, and only where it bears', () => {
  test('S4 / NORMAL: the recorded decision is selected for the recall question once its turn is out of the history window; several phrasings; never for an unrelated or thank-you message', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      const m1 = w.say(M_BUDGET);
      const id = idOf(w.act('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT }));
      pushOutOfWindow(w);
      const recall = assembled(h, w.ask(Q_RECALL), 'w-recall');
      assert.equal(recall.outcome, 'OK');
      const text = rendered(recall);
      assert.equal(text.includes('SYNTHETIC-M1'), false, 'the original turn is out of the history window');
      assert.ok(text.includes(STATEMENT), 'the decision itself is in the context');
      assert.equal(decisionEntry(h, recall, id)?.decision, 'SELECTED');
      for (const [i, q] of ['الميزانية بتاعة التسويق كام الربع ده؟', 'مين المسؤول عن ميزانية التسويق؟', 'هل نقدر نزود صرف التسويق؟'].entries()) {
        const ctx = assembled(h, w.ask(q), `w-phrase-${i}`);
        assert.equal(decisionEntry(h, ctx, id)?.decision, 'SELECTED', q);
      }
      for (const [i, q] of ['تمام، شكرًا يا أحمد.', 'كام سعر باقة Pro في التطبيق دلوقتي؟', 'The board update is due on the 30th; keep it to one page.'].entries()) {
        const ctx = assembled(h, w.ask(q), `w-unrelated-${i}`);
        const e = decisionEntry(h, ctx, id);
        assert.notEqual(e?.decision, 'SELECTED', `not injected: ${q}`);
        assert.equal(rendered(ctx).includes(STATEMENT), false);
      }
    });
  });

  test('S11 / FULL: on a saturated store (canonical truth, large knowledge, memories, full history, six Skills, a 4,000-character message, tools) the decision is still selected, canonical truth kept, within the budget', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      const mem = MemoryStore.for(h.store);
      const fact = (i: number) => `SYNTHETIC ${i}: الميزانية والتسويق والتعيين والإطلاق والسوق السعودي والصرف والمنتج والنمو للربع الجاي. ${'تفاصيل إضافية عن الخطة والفريق والميزانية. '.repeat(6 + (i % 5) * 8)}`;
      const canon = [0, 1, 2].map((i) => mem.recordCanonicalTruth(s.founder, { level: 'POLICY', topic: `company.policy${i}`, statement: fact(i).slice(0, 1_900), dataClass: 'D1', sourceRef: 'authority:synthetic' }).id);
      for (let i = 0; i < 20; i++) mem.recordKnowledge(s.founder, { scope: 'COMPANY', topic: `company.k${i}`, content: fact(10 + i).slice(0, 3_900), dataClass: 'D1' });
      const { claim } = claimFor(h, workItem(h, s, w.ceo, { instructions: 'SYNTHETIC: notes about the marketing budget' }), 'w-full-mem');
      for (let i = 0; i < 16; i++) propose(h, claim, i + 1, { topic: `company.m${i}`, content: fact(40 + i).slice(0, 1_800), confidencePct: 90 });
      const m1 = w.say(M_BUDGET);
      const id = idOf(w.act('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT }));
      pushOutOfWindow(w, 30);
      const long = `${Q_RECALL} ${'وكمان عايز رأيك في خطة الربع الجاي كلها والتعيين والصرف. '.repeat(70)}`.slice(0, 4_000);
      const ctx = assembled(h, w.ask(long), 'w-full', 2);
      assert.equal(ctx.outcome, 'OK');
      const es = MemoryStore.for(h.store).manifestEntries(ctx.manifestId);
      const sel = new Set(es.filter((e) => e.decision === 'SELECTED').map((e) => e.itemId));
      assert.ok(sel.has(id), 'the decision in force');
      for (const c of canon) assert.ok(sel.has(c), 'canonical truth');
      assert.ok(es.some((e) => e.provenanceRef.startsWith('communication_thread:') && e.decision === 'SELECTED'), 'history');
      const m = MemoryStore.for(h.store).manifest(ctx.manifestId);
      assert.ok(m.usedTokens <= 60_000 - 512 && m.estimatedInputTokens <= 60_000, `used ${m.usedTokens}`);
      assert.ok(rendered(ctx).includes(STATEMENT));
    });
  });

  test('S8 / S9: after an amendment only the version in force is retrieved; after the revocation none is', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      const m1 = w.say(M_BUDGET);
      const v1 = idOf(w.act('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT }));
      const m2 = w.say('SYNTHETIC-M2: عدّل ميزانية التسويق من 40 لـ 30 ألف.');
      const v2 = idOf(w.act('FOUNDER_DECISION_RECORD', { messageId: m2, subject: SUBJECT, statement: AMENDED, supersedesId: v1 }));
      pushOutOfWindow(w);
      const after = assembled(h, w.ask(Q_RECALL), 'w-amended');
      assert.equal(decisionEntry(h, after, v2)?.decision, 'SELECTED');
      assert.equal(decisionEntry(h, after, v1), undefined, 'the replaced version is not even a candidate');
      assert.ok(rendered(after).includes(AMENDED));
      assert.equal(rendered(after).includes(STATEMENT), false);
      w.act('FOUNDER_DECISION_REVOKE', { decisionId: v2, messageId: w.say('SYNTHETIC-M3: ألغي قرار ميزانية التسويق.') });
      pushOutOfWindow(w);
      const revoked = assembled(h, w.ask(Q_RECALL), 'w-revoked');
      assert.equal(decisionEntry(h, revoked, v2), undefined);
      assert.equal(decisionEntry(h, revoked, v1), undefined);
      assert.equal(rendered(revoked).includes('30,000'), false);
    });
  });

  test('S12: a CEO decision is never a candidate for another Employee; a Company-wide one is, where it bears; neither enters an Academy attempt', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      const m1 = w.say(M_BUDGET);
      const ceoOnly = idOf(w.act('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT }));
      const m2 = w.say('SYNTHETIC-M4: اعتمدت إن أبحاث السوق في مصر Egypt market research تبدأ الشهر الجاي.');
      const company = idOf(w.act('FOUNDER_DECISION_RECORD', { messageId: m2, subject: 'Egypt market research', statement: 'Egypt market research starts next month, owned by Growth.', audience: 'COMPANY', dataClass: 'D1' }));
      const sara = (instructions: string, worker: string): AssembleResult => assembleContext(h.store, claimFor(h, workItem(h, s, s.employee, { instructions }), worker).claim.fence, { step: 0 });
      const own = sara(`SYNTHETIC: ${STATEMENT} Egypt market research plan.`, 'w-sara');
      assert.equal(own.outcome, 'OK');
      const es = MemoryStore.for(h.store).manifestEntries(own.manifestId);
      assert.equal(es.find((e) => e.itemId === ceoOnly), undefined, 'the CEO\'s decision is not even a candidate for another Employee');
      assert.equal(es.find((e) => e.itemId === company)?.decision, 'SELECTED', 'a Company-wide decision reaches whom it bears on');
      // An Academy attempt about the same subject never sees a live Founder decision (training isolation).
      const aw = academyWorld(h, s);
      const a = AcademyStore.for(h.store);
      const e = a.enroll(s.founder, s.employee.id, aw.programVersionId);
      for (let i = 0; i < 6; i++) a.recordModuleCompletion(s.founder, e.id, `module-${i}`, `evidence:m${i}`);
      a.advance(e.id);
      const started = a.startAttempt(e.id, { scenarioId: aw.scenarios.practice, kind: 'SIMULATION', taskClass: 'draft.memo' });
      h.store.transitionWorkItem(started.workItemId, { to: 'READY', reasonCode: 'release' });
      const at = claimFor(h, started.workItemId, 'w-attempt');
      assert.ok(at.begun.ok && at.begun.context.executionMode === 'ACADEMY_ATTEMPT');
      const ctx = assembleContext(h.store, at.claim.fence, { step: 1 });
      assert.equal(ctx.outcome, 'OK');
      assert.equal(MemoryStore.for(h.store).manifestEntries(ctx.manifestId).some((x) => x.itemId === company || x.itemId === ceoOnly), false);
    });
  });

  test('as-of: a reply asked before the decision was recorded never sees it (a re-assembled turn has no future); the next one does', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      const m1 = w.say(M_BUDGET);
      const early = w.ask(Q_RECALL);
      h.clock.advance(1_000);
      const id = idOf(w.act('FOUNDER_DECISION_RECORD', { messageId: m1, subject: SUBJECT, statement: STATEMENT }));
      const old = assembled(h, early, 'w-early');
      assert.equal(decisionEntry(h, old, id), undefined, 'not from its future');
      h.clock.advance(1_000);
      const later = assembled(h, w.ask(Q_RECALL), 'w-later');
      assert.equal(decisionEntry(h, later, id)?.decision, 'SELECTED');
    });
  });
});

describe('G4-FINAL-CLOSURE-01 WP1: the CEO answers in the language of the current message and in proportion to it', () => {
  test('an English message after Arabic turns carries the English line; an Arabic one the Arabic line; a mixed one none; another Employee and a brief none', () => {
    withSeed((h, s) => {
      const w = world(h, s);
      w.say(M_BUDGET);
      w.say('خلّي بالك إن فريق الهندسة عنده 4 مهندسين بس دلوقتي.');
      const sys = (ctx: AssembleResult): string => (ctx.outcome === 'OK' ? (ctx.messages.find((m) => m.role === 'system')?.content ?? '') : '');
      const en = sys(assembled(h, w.ask('We have budget for only one of two things next quarter. Which do you recommend, and what would change your mind?'), 'w-en'));
      assert.ok(en.includes(currentLanguageLine('ENGLISH')));
      assert.equal(en.includes(currentLanguageLine('ARABIC')), false);
      const ar = sys(assembled(h, w.ask('يا أحمد، عايز نناقش تأسيس قسم Strategic Market Intelligence في الشركة. إيه رأيك في الفكرة، وإزاي تقترح نبدأه: مين يقوده، يبدأ بكام شخص، وأول حاجة يطلّعها لنا إيه؟'), 'w-ar'));
      assert.ok(ar.includes(currentLanguageLine('ARABIC')));
      const quoted = sys(assembled(h, w.ask('ترجم لي ده: "We have budget for only one of two things next quarter, which one?"'), 'w-quoted'));
      assert.ok(quoted.includes(currentLanguageLine('ARABIC')), 'quoted text does not decide');
      const mixed = sys(assembled(h, w.ask('OK تمام go ahead يلا'), 'w-mixed'));
      assert.equal(mixed.includes(currentLanguageLine('ENGLISH')) || mixed.includes(currentLanguageLine('ARABIC')), false, 'a mixed message names no language');
      const director = placed(h, s, 'director.product');
      const dThread = CommunicationStore.for(h.store).directThread(s.founder, director.id).id;
      const dReply = CommunicationStore.for(h.store).send(s.founder, dThread, { purpose: 'QUESTION', body: 'Which do you recommend?' }).replyWorkItemId as Id;
      const dSys = sys(assembled(h, dReply, 'w-director'));
      assert.equal(dSys.includes(currentLanguageLine('ENGLISH')), false, 'another Employee keeps its context');
      assert.ok(dSys.includes(EMPLOYEE_COMMUNICATION_STANDARD), 'the shared standard (current-message language) reaches every Employee');
    });
  });

  test('the guidance: proportion by message type, insight only when it matters, no recap / closing offer / decision closer, facts only from the context, recorded decisions in force; bounded', () => {
    for (const must of ['thanks or a greeting gets one or two natural lines', 'a factual or simple question gets the answer itself, briefly, with no analysis, advice or report around it', 'never add one just to have something to add', 'no recap of earlier turns, no closing offer of more help', 'never close a reply by asking for one', 'your disagreement and its reason']) assert.ok(CEO_CONVERSATION_GUIDANCE.includes(must), must);
    for (const must of ['never a coined or literal rendering', 'say plainly that you do not have it on record, never fill the gap with a plausible number, date, rule, timeline or event', 'A recorded Founder decision in your context is the decision in force; one it replaced or the Founder revoked is not']) assert.ok(CEO_LANGUAGE_GUIDANCE.includes(must), must);
    assert.ok(EMPLOYEE_COMMUNICATION_STANDARD.includes("answer in the language of the Founder's current message"));
    for (const g of [CEO_CONVERSATION_GUIDANCE, CEO_LANGUAGE_GUIDANCE, EMPLOYEE_COMMUNICATION_STANDARD]) assert.ok(g.length <= 2_000);
  });
});
