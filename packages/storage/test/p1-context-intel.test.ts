/**
 * P1-CONTEXT-INTEL-01 (D-P1-14) and G4-SIMPLE-01 (D-P1-16) — G4 Context & Skill Intelligence through the real send → reply
 * Work Item → claimed run → assembled context path, on fixture stores (no model, no provider call, synthetic text only):
 *   - C1 / G4b: a new Founder reply plans 60,000 in the CP-1 order; in the CEO's thread it loads the CEO's Skills DIRECT (no
 *     classification, no extra Work Item, no delayed job), in another Founder thread it keeps the LEXICAL selection; a brief
 *     and earlier work keep 24,000; the history allowance is 11,750 bytes at 60K and 4,800 below 48K;
 *   - AC2: empty stores, a full history, simple to 4,000-character messages, 0 or 2 tool results — all six eligible CEO Skills
 *     and the history are selected, within the budget;
 *   - AC4: direct loading never widens eligibility: one verified payload read per selected Skill, a held Skill and a conflicting
 *     pair are recorded from metadata and never read, another Employee's Skill is never a candidate;
 *   - AC5 (DG-1n): new rows keep `terms_json`, content and hashes byte-identical and add `~` index rows only; the previous
 *     release's pool (its query and SQL, frozen here) on a mixed store is identical to its pool on the same store written
 *     by the old code — below and past the pool limits — and the new release keeps that whole pool as tier 1, adding at most
 *     25% (tier 2) of union-only matches;
 *   - summary terms carry no alphabetical cut; AC6: CP-1 on a full store keeps Canonical Truth, the history and the knowledge
 *     and memory shares while all six Skills load (content-free manifest).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { newId, sha256Hex, type Id } from '@qandeel-company/domain';
import { DEFAULT_CONTEXT_POLICY, SALIENCE_INDEX_PREFIX, contentFingerprint, salienceTerms, terms } from '@qandeel-company/mind';

import { CommunicationStore, MemoryStore, SkillStore } from '../src/index.js';
import { FOUNDER_REPLY_CONTEXT_BUDGET_TOKENS } from '../src/communications.js';
import { indexTerms } from '../src/mind-core.js';
import { CANONICAL_POOL_LIMIT, CONVERSATION_HISTORY_LARGE_MAX_BYTES, CONVERSATION_HISTORY_MAX_BYTES, KNOWLEDGE_POOL_LIMIT, MEMORY_POOL_LIMIT, POOL_EXTENSION_PCT } from '../src/mind-writes.js';
import { assembleContext, recordStepResult, type AssembleResult } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { seed, type Seed } from './c2-helpers.js';
import { approvedSkill, claimFor, propose, workItem } from './c3-helpers.js';
import { claimItem, placed } from './c4-helpers.js';
import { harness, type Harness } from './helpers.js';

function withSeed(fn: (h: Harness, s: Seed) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store, { companyCap: 500_000_000 }));
  } finally {
    h.close();
  }
}

const CEO_SKILLS = ['ceo.governance-discipline', 'ceo.founder-partnership', 'ceo.executive-judgment', 'ceo.evidence-and-economics', 'ceo.organization-leadership', 'ceo.cross-functional-synthesis'];
const skillText = (code: string): string => `Synthetic guidance for ${code.replace(/[.-]/g, ' ')}. ${'State the decision, the evidence and the owner; keep it short and concrete. '.repeat(22)}`;

/** The CEO with the six CEO Skills on its passport (approved, pinned, synthetic text) and the Founder ↔ CEO thread. */
function ceoWorld(h: Harness, s: Seed): { ceo: ReturnType<typeof placed>; versions: Map<string, Id>; thread: Id } {
  const ceo = placed(h, s, 'company.ceo', 9_000_000);
  const reg = SkillStore.for(h.store);
  const versions = new Map<string, Id>();
  for (const code of CEO_SKILLS) {
    const { version } = approvedSkill(h, s, code, { instructions: skillText(code) });
    reg.openPassportEntry(s.founder, ceo.id, version.id);
    versions.set(code, version.id);
  }
  const thread = CommunicationStore.for(h.store).directThread(s.founder, null).id;
  return { ceo, versions, thread };
}

const send = (h: Harness, s: Seed, thread: Id, body: string): Id => CommunicationStore.for(h.store).send(s.founder, thread, { purpose: 'QUESTION', body }).replyWorkItemId as Id;
/** Earlier Founder turns (FYI: no reply Work Item), each at the 1,200-character turn bound. */
function fillHistory(h: Harness, s: Seed, thread: Id, n = 12): void {
  for (let i = 0; i < n; i++) CommunicationStore.for(h.store).send(s.founder, thread, { purpose: 'FYI', body: `SYNTHETIC ${i}: ${'ملاحظة سابقة عن خطة الشركة والفريق والإطلاق. '.repeat(40)}`.slice(0, 1_200) });
}
function assembledAt(h: Harness, workItemId: Id, worker: string, tools = 0): AssembleResult {
  const claim = claimItem(h, workItemId, worker);
  for (let i = 0; i < tools; i++) recordStepResult(h.store, claim.fence, i, 'TOOL_RESULT', `SYNTHETIC tool result ${i}: ${'x'.repeat(2_000)}`);
  return assembleContext(h.store, claim.fence, { step: tools });
}
const policyOf = (h: Harness, manifestId: Id): Record<string, unknown> => JSON.parse(String(storeContext(h.store).db.get<{ p: string }>('SELECT policy_json AS p FROM context_manifests WHERE id = ?', manifestId)?.p)) as Record<string, unknown>;
const entries = (h: Harness, manifestId: Id) => MemoryStore.for(h.store).manifestEntries(manifestId);
const inputOf = (h: Harness, id: Id): Record<string, unknown> => h.store.getWorkItem(id).processorInput as Record<string, unknown>;
const workItemCount = (h: Harness): number => Number(storeContext(h.store).db.get<{ n: number }>('SELECT COUNT(*) AS n FROM work_items')?.n);

const S_ORG = 'SYNTHETIC: يا أحمد، الأسبوعين الجايين هبقى مسافر. عايزين نحسم مين أول ناس نعيّنهم، ونوقف أي صرف مش ضروري لحد الإطلاق. إنت شايف الفترة الجاية إزاي؟';
const S_MARKET = 'SYNTHETIC: قارن بين دخول السوق السعودي الآن والبقاء في مصر من حيث التكلفة والمخاطر، ومن يقود ذلك بين المنتج والنمو؟';
const S_AUTH = 'SYNTHETIC: Can you approve the Brand posts yourself, without my approval, and raise your own budget if needed?';
const S_PRIORITY = 'SYNTHETIC: Give me your top three priorities for next quarter across Product, Growth and Engineering, the evidence behind each, and what you would stop.';
const S_LONG = `${S_ORG} ${S_MARKET} `.repeat(30).slice(0, 4_000);
const S_THANKS = 'تمام، متشكر';

describe('P1-CONTEXT-INTEL-01 C1 / G4b, G4-SIMPLE-01: a new Founder reply plans 60,000; the CEO loads its Skills directly; everything else keeps its input', () => {
  test('the CEO reply carries 60,000 and DIRECT; no assessment Work Item and no delayed job; the manifest records CP-1, DIRECT and the tiers (content-free); a brief keeps 24,000', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const before = workItemCount(h);
      const reply = send(h, s, w.thread, S_ORG);
      assert.equal(workItemCount(h), before + 1, 'the send creates the reply Work Item only (no Skill Need Assessment)');
      const input = inputOf(h, reply);
      assert.equal(input.contextBudgetTokens, FOUNDER_REPLY_CONTEXT_BUDGET_TOKENS);
      assert.equal(FOUNDER_REPLY_CONTEXT_BUDGET_TOKENS, 60_000);
      assert.equal(input.skillSelection, 'DIRECT');
      assert.equal('skillNeed' in input, false);
      const job = storeContext(h.store).db.get<{ a: string; c: string }>("SELECT available_at AS a, created_at AS c FROM queue_jobs WHERE work_item_id = ?", reply);
      assert.ok(job && job.a <= job.c, 'the reply job is available at once (no dependency window)');
      const ctx = assembledAt(h, reply, 'w-c1-reply');
      assert.equal(ctx.outcome, 'OK');
      assert.equal(MemoryStore.for(h.store).manifest(ctx.manifestId).totalBudget, 60_000);
      const policy = policyOf(h, ctx.manifestId);
      assert.equal(policy.order, 'CP1');
      assert.deepEqual(policy.skillSelection, { mode: 'DIRECT', tiers: { TASK_REQUIRED: 0, SUPPORTING: 6 } });
      assert.equal(JSON.stringify(policy).includes('أحمد'), false, 'never the text');
      const brief = CommunicationStore.for(h.store).requestCeoBrief({ subject: 'SYNTHETIC brief', contextKind: 'APPROVAL', contextRef: 'approval:1', reasonCode: 'brief.test', instructions: 'Brief the Founder as a MESSAGE proposal with purpose BRIEF.' });
      const briefInput = inputOf(h, brief.workItemId);
      assert.equal(briefInput.contextBudgetTokens, undefined);
      assert.equal(briefInput.skillSelection, undefined);
      const b = assembledAt(h, brief.workItemId, 'w-c1-brief');
      assert.equal(MemoryStore.for(h.store).manifest(b.manifestId).totalBudget, 24_000);
      assert.deepEqual(Object.keys(policyOf(h, b.manifestId)).sort(), ['ceiling', 'frameTokens', 'importance', 'maxItemsPerLayer', 'totalTokens'], 'a brief keeps its exact policy record');
    });
  });

  test('a reply in another Employee\'s Founder thread keeps LEXICAL: a Skill its message does not touch is not even a candidate', () => {
    withSeed((h, s) => {
      ceoWorld(h, s);
      const other = approvedSkill(h, s, 'market.research', { instructions: 'Market research guidance: name sources, sample sizes and dates.' });
      SkillStore.for(h.store).openPassportEntry(s.founder, s.employee.id, other.version.id);
      const thread = CommunicationStore.for(h.store).directThread(s.founder, s.employee.id).id;
      const reply = send(h, s, thread, S_THANKS);
      assert.equal(inputOf(h, reply).skillSelection, 'LEXICAL');
      const ctx = assembledAt(h, reply, 'w-c1-lexical');
      assert.equal(ctx.outcome, 'OK');
      assert.deepEqual(policyOf(h, ctx.manifestId).skillSelection, { mode: 'LEXICAL', tiers: { TASK_REQUIRED: 0, SUPPORTING: 0 } });
      assert.equal(entries(h, ctx.manifestId).some((e) => e.itemKind === 'SKILL'), false, 'unchanged lexical path');
    });
  });

  test('G4b: the history allowance is 11,750 bytes for a 60K reply and stays 4,800 for a Work Item created before (24K)', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      fillHistory(h, s, w.thread);
      const reply = send(h, s, w.thread, S_PRIORITY);
      const ctx = assembledAt(h, reply, 'w-g4b-new');
      const conv = entries(h, ctx.manifestId).find((e) => e.provenanceRef.startsWith('communication_thread:'));
      assert.ok(conv && conv.decision === 'SELECTED', 'history selected');
      assert.ok(conv.estTokens > CONVERSATION_HISTORY_MAX_BYTES + 96 && conv.estTokens <= CONVERSATION_HISTORY_LARGE_MAX_BYTES + 96 + 200, `history ${conv.estTokens}`);
      // A Work Item created before: the same reply input without the new fields (its recorded input is never rewritten).
      const { contextBudgetTokens: _b, skillSelection: _t, ...earlier } = inputOf(h, reply);
      void _b;
      void _t;
      const { workItem: old } = h.store.createWorkItem({ objective: 'earlier reply', ownerRef: w.ceo.ref, processorKind: h.store.getWorkItem(reply).processorKind as string, processorInput: earlier as never, riskLevel: 'R1' });
      s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: old.id, capMoney: 500_000, capTokens: 200_000, reasonCode: 'seed' });
      h.store.transitionWorkItem(old.id, { to: 'READY', reasonCode: 'release' });
      const prior = assembledAt(h, old.id, 'w-g4b-old');
      const convOld = entries(h, prior.manifestId).find((e) => e.provenanceRef.startsWith('communication_thread:'));
      assert.equal(MemoryStore.for(h.store).manifest(prior.manifestId).totalBudget, 24_000);
      assert.ok(convOld && convOld.estTokens <= CONVERSATION_HISTORY_MAX_BYTES + 96 + 200, `earlier work keeps 4,800 (${convOld?.estTokens})`);
      assert.equal(policyOf(h, prior.manifestId).order, undefined, 'and the layered order');
    });
  });
});

describe('P1-CONTEXT-INTEL-01 AC2 / G4-SIMPLE-01: empty stores, a full history, simple to 4,000-character messages, 0 or 2 tool results', () => {
  test('all six CEO Skills and the history are selected for every message, within the budget', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      fillHistory(h, s, w.thread);
      let n = 0;
      for (const body of [S_ORG, S_MARKET, S_AUTH, S_PRIORITY, S_LONG, S_THANKS]) {
        for (const tools of [0, 2]) {
          const reply = send(h, s, w.thread, body);
          const ctx = assembledAt(h, reply, `w-ac2-${n++}`, tools);
          assert.equal(ctx.outcome, 'OK', body.slice(0, 30));
          const es = entries(h, ctx.manifestId);
          const selected = new Set(es.filter((e) => e.decision === 'SELECTED').map((e) => e.itemId));
          for (const code of CEO_SKILLS) assert.ok(selected.has(w.versions.get(code) as string), `${code} for ${body.slice(0, 24)} / ${tools}`);
          assert.ok(es.some((e) => e.provenanceRef.startsWith('communication_thread:') && e.decision === 'SELECTED'), 'history');
          const m = MemoryStore.for(h.store).manifest(ctx.manifestId);
          assert.ok(m.usedTokens <= m.totalBudget - 512 && m.estimatedInputTokens <= m.totalBudget, `${m.usedTokens} / ${m.estimatedInputTokens}`);
        }
      }
    });
  });
});

describe('G4-SIMPLE-01 AC4: direct loading never widens eligibility; one verified payload read per selected Skill', () => {
  /** Runs `fn` with the store's statements observed: verified payload reads and any unverified payload fetch of skill_versions. */
  function observed<T>(h: Harness, fn: () => T): { result: T; verified: string[]; unverified: number } {
    const db = storeContext(h.store).db as unknown as Record<'get' | 'all', (sql: string, ...p: unknown[]) => unknown>;
    const verified: string[] = [];
    let unverified = 0;
    const orig = { get: db.get, all: db.all };
    for (const k of ['get', 'all'] as const) {
      db[k] = function (this: unknown, sql: string, ...p: unknown[]) {
        const flat = sql.replace(/\s+/g, ' ');
        if (/FROM skill_versions/.test(flat)) {
          if (/^SELECT instructions AS t\b/.test(flat)) verified.push(String(p[0]));
          else if (/SELECT \* FROM skill_versions/.test(flat) || /\binstructions\b/.test(flat.replace(/length\(CAST\(instructions AS BLOB\)\)/g, ''))) unverified++;
        }
        return orig[k].call(this, sql, ...p);
      };
    }
    try {
      return { result: fn(), verified, unverified };
    } finally {
      db.get = orig.get;
      db.all = orig.all;
    }
  }

  test('a held Skill and a conflicting pair on the CEO passport are rejected from metadata and never read; another Employee\'s Skill is never a candidate; each selected Skill is read once, hash-verified', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const reg = SkillStore.for(h.store);
      // Certification / eligibility: a security hold makes a pinned version unretrievable at once.
      const held = approvedSkill(h, s, 'ceo.held-skill', { instructions: 'Held guidance.' });
      reg.openPassportEntry(s.founder, w.ceo.id, held.version.id);
      reg.setFreshness(s.founder, held.version.id, 'SECURITY_HOLD', 'advisory.cve');
      // Conflict: two Skills whose directives disagree are surfaced, never combined (neither loads).
      const a = approvedSkill(h, s, 'memo.formal', { directives: { 'tone.formality': 'formal' }, instructions: 'Memo writing guidance: formal tone.' });
      const b = approvedSkill(h, s, 'memo.casual', { directives: { 'tone.formality': 'casual' }, instructions: 'Memo writing guidance: casual tone.' });
      reg.openPassportEntry(s.founder, w.ceo.id, a.version.id);
      reg.openPassportEntry(s.founder, w.ceo.id, b.version.id);
      // Data access: a Skill on another Employee's passport only.
      const foreign = approvedSkill(h, s, 'market.research', { instructions: 'Market research guidance: name sources, sample sizes and dates.' });
      reg.openPassportEntry(s.founder, s.employee.id, foreign.version.id);
      const reply = send(h, s, w.thread, S_MARKET);
      const claim = claimItem(h, reply, 'w-ac4');
      const run = observed(h, () => assembleContext(h.store, claim.fence, { step: 0 }));
      assert.equal(run.result.outcome, 'OK', 'an unloadable Skill never fails the reply');
      const skillEntries = entries(h, run.result.manifestId).filter((e) => e.itemKind === 'SKILL');
      const why = Object.fromEntries(skillEntries.map((e) => [e.itemId, e.decision === 'SELECTED' ? 'SELECTED' : e.reasonCode]));
      assert.equal(why[held.version.id], 'STATUS_NOT_RETRIEVABLE');
      assert.deepEqual([why[a.version.id], why[b.version.id]], ['SKILL_CONFLICT', 'SKILL_CONFLICT']);
      assert.equal(foreign.version.id in why, false, 'another Employee\'s Skill is never a candidate');
      const selected = skillEntries.filter((e) => e.decision === 'SELECTED').map((e) => e.itemId);
      assert.deepEqual([...selected].sort(), [...w.versions.values()].sort(), 'exactly the six eligible, unconflicted CEO Skills');
      assert.deepEqual([...run.verified].sort(), [...selected].sort(), 'exactly one verified read per selected Skill');
      for (const id of [held.version.id, a.version.id, b.version.id, foreign.version.id]) assert.equal(run.verified.includes(id), false, 'a rejected payload is never read');
      assert.equal(run.unverified, 0, 'no metadata read fetches a payload');
      assert.deepEqual(policyOf(h, run.result.manifestId).skillSelection, { mode: 'DIRECT', tiers: { TASK_REQUIRED: 0, SUPPORTING: 9 } });
    });
  });
});

// --- AC5: DG-1n -------------------------------------------------------------------------------------

/** The previous release's pool lookup, frozen verbatim (today's `termMatches`). */
function oldMatches(h: Harness, kind: string, owner: string, q: readonly string[], limit: number, table: string, where: string, params: readonly (string | number)[], withoutNewRows = false): string[] {
  return storeContext(h.store).db.all<{ id: string }>(
    `SELECT t.item_id AS id, COUNT(*) AS n FROM mind_terms t JOIN ${table} x ON x.id = t.item_id
      WHERE t.item_kind = ? AND t.owner_key = ? AND t.term IN (SELECT value FROM json_each(?)) AND (${where})${withoutNewRows ? " AND substr(t.term, 1, 1) <> '~'" : ''}
      GROUP BY t.item_id ORDER BY n DESC, t.item_id LIMIT ?`,
    kind, owner, JSON.stringify(q), ...params, limit,
  ).map((r) => r.id);
}
/** The previous release's knowledge pool: 800 term-matched, re-ranked by count, newest, id, cut to 200 (frozen). */
function oldKnowledgePool(h: Harness, q: readonly string[], withoutNewRows = false): string[] {
  const db = storeContext(h.store).db;
  const n = new Map(db.all<{ id: string; n: number }>(
    `SELECT t.item_id AS id, COUNT(*) AS n FROM mind_terms t JOIN knowledge_items x ON x.id = t.item_id
      WHERE t.item_kind = 'KNOWLEDGE' AND t.owner_key = '' AND t.term IN (SELECT value FROM json_each(?)) AND x.status = 'ACTIVE'${withoutNewRows ? " AND substr(t.term, 1, 1) <> '~'" : ''}
      GROUP BY t.item_id ORDER BY n DESC, t.item_id LIMIT ?`, JSON.stringify(q), KNOWLEDGE_POOL_LIMIT * 4).map((r) => [r.id, Number(r.n)]));
  const at = new Map(db.all<{ id: string; c: string }>('SELECT id, created_at AS c FROM knowledge_items WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify([...n.keys()])).map((r) => [r.id, r.c]));
  return [...n.keys()].sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || ((at.get(b) ?? '') < (at.get(a) ?? '') ? -1 : (at.get(b) ?? '') > (at.get(a) ?? '') ? 1 : 0) || (a < b ? -1 : 1)).slice(0, KNOWLEDGE_POOL_LIMIT);
}

/** A row exactly as the previous release writes it: a copy of a template row with new content, its hashes and TI-0 rows only. */
function writeOld(h: Harness, table: 'canonical_truth' | 'knowledge_items' | 'memory_records', kind: 'CANONICAL' | 'KNOWLEDGE' | 'MEMORY', owner: string, templateId: string, topic: string, text: string, createdAt: string): string {
  const db = storeContext(h.store).db;
  const id = newId();
  const ti0 = indexTerms(topic, text);
  const textCol = table === 'canonical_truth' ? 'statement' : 'content';
  const over: Record<string, unknown> = { id, topic, [textCol]: text, [`${textCol}_sha256`]: sha256Hex(text), terms_json: JSON.stringify(ti0), ...(table === 'canonical_truth' ? { recorded_at: createdAt } : { created_at: createdAt, fingerprint: contentFingerprint(text) }), ...(table === 'memory_records' ? { candidate_id: null } : {}) };
  const cols = db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
  db.run(`INSERT INTO ${table} (${cols.join(', ')}) SELECT ${cols.map((c) => (c in over ? '?' : c)).join(', ')} FROM ${table} WHERE id = ?`, ...(cols.filter((c) => c in over).map((c) => over[c]) as never[]), templateId);
  for (const t of ti0) db.run('INSERT INTO mind_terms (item_kind, owner_key, term, item_id) VALUES (?, ?, ?, ?)', kind, owner, t, id);
  return id;
}

/** Words that sort first (TI-0 keeps them), filler, and two salient words that sort last (only TI-1 keeps them). */
const Q0 = ['aa05', 'aa10', 'aa15'];
const FILL = Array.from({ length: 56 }, (_, i) => `ab${String(i).padStart(2, '0')}`);
const ZW = ['zpay', 'zwallet'];
const textOf = (q0: readonly string[], salient: boolean, i: number): string => [...q0, ...FILL, `ac${i}`, ...(salient ? [...ZW, ...ZW, ...ZW] : [])].join(' ');
const QUERY = `${Q0.join(' ')} ${ZW.join(' ')}`;

describe('P1-CONTEXT-INTEL-01 AC5 (DG-1n): new rows keep every stored value and add only `~` index rows', () => {
  test('knowledge, canonical and memory written now: terms_json, content and hashes exactly as before; index = TI-0 rows ∪ `~` TI-1 rows; existing rows untouched', () => {
    withSeed((h, s) => {
      const mem = MemoryStore.for(h.store);
      const before = mem.recordKnowledge(s.founder, { scope: 'COMPANY', topic: 'fix.before', content: textOf(Q0, false, 0), dataClass: 'D1' });
      const db = storeContext(h.store).db;
      const rowsOf = (id: string): string[] => db.all<{ t: string }>('SELECT term AS t FROM mind_terms WHERE item_id = ? ORDER BY term', id).map((r) => r.t);
      const beforeRows = rowsOf(before.id);
      const text = textOf(Q0, true, 1);
      const k = mem.recordKnowledge(s.founder, { scope: 'COMPANY', topic: 'fix.k', content: text, dataClass: 'D1' });
      const c = mem.recordCanonicalTruth(s.founder, { level: 'VERIFIED_FACT', topic: 'fix.c', statement: text, dataClass: 'D1', sourceRef: 'authority:synthetic' });
      const { claim } = claimFor(h, workItem(h, s, s.employee, { instructions: QUERY }));
      const m = propose(h, claim, 1, { topic: 'fix.m', content: text, confidencePct: 90 }).decided;
      const memId = (m && 'resultMemoryId' in m ? m.resultMemoryId : null) as string | null;
      assert.ok(memId);
      for (const [table, id, topic, col] of [['knowledge_items', k.id, 'fix.k', 'content'], ['canonical_truth', c.id, 'fix.c', 'statement'], ['memory_records', memId, 'fix.m', 'content']] as const) {
        const r = db.get<Record<string, string>>(`SELECT * FROM ${table} WHERE id = ?`, id) as Record<string, string>;
        const ti0 = indexTerms(topic, text);
        assert.equal(r.terms_json, JSON.stringify(ti0), `${table}: terms_json = TI-0, byte-identical`);
        assert.equal(r[col], text);
        assert.equal(r[`${col}_sha256`], sha256Hex(text));
        if (table !== 'canonical_truth') assert.equal(r.fingerprint, contentFingerprint(text));
        const extra = salienceTerms(`${topic.replace(/[.-]/g, ' ')} ${text}`).filter((t) => !ti0.includes(t)).map((t) => `${SALIENCE_INDEX_PREFIX}${t}`);
        assert.ok(extra.includes('~zpay') && extra.includes('~zwallet'), 'the salient words cut from TI-0 are indexed as `~` rows');
        assert.deepEqual(rowsOf(id), [...ti0, ...extra].sort(), `${table}: TI-0 rows ∪ ~TI-1 rows`);
        assert.ok(rowsOf(id).every((t) => t.length <= 64));
      }
      assert.deepEqual(rowsOf(before.id), beforeRows, 'no write to an existing item');
      assert.deepEqual(terms('Egypt payments wallets'), ['egypt', 'payments', 'wallets']);
    });
  });

  for (const scale of ['below', 'past'] as const) {
    test(`the previous release's pools are identical on a mixed store and on the same store written by the old code, and the new release keeps them whole as tier 1 (${scale} the pool limits)`, () => {
      withSeed((h, s) => {
        const mem = MemoryStore.for(h.store);
        const db = storeContext(h.store).db;
        const { claim } = claimFor(h, workItem(h, s, s.employee, { instructions: QUERY }), 'w-ac5-mem');
        // Templates for old-code copies (their own text matches nothing in the query).
        const kT = mem.recordKnowledge(s.founder, { scope: 'COMPANY', topic: 'fix.template', content: 'template row', dataClass: 'D1' }).id;
        const cT = mem.recordCanonicalTruth(s.founder, { level: 'VERIFIED_FACT', topic: 'fix.template', statement: 'template row', dataClass: 'D1', sourceRef: 'authority:synthetic' }).id;
        const mT = (propose(h, claim, 1, { topic: 'fix.template', content: 'template row', confidencePct: 90 }).decided as { resultMemoryId?: string } | null)?.resultMemoryId as string;
        const size: Record<'k' | 'c' | 'm', readonly [number, number]> = scale === 'past' ? { k: [500, 900], c: [140, 300], m: [200, 450] } : { k: [40, 30], c: [20, 20], m: [25, 25] };
        const critical = new Set<string>();
        // OLD rows (critical: three query words in TI-0; ordinary: one); NEW rows: one query word in TI-0 plus the salient words.
        db.immediate('fixture', () => {
          for (const [table, kind, owner, tmpl, n] of [['knowledge_items', 'KNOWLEDGE', '', kT, size.k[0]], ['canonical_truth', 'CANONICAL', '', cT, size.c[0]], ['memory_records', 'MEMORY', s.employee.id, mT, size.m[0]]] as const) {
            for (let i = 0; i < n; i++) {
              const crit = i % 4 === 0;
              const id = writeOld(h, table, kind, owner, tmpl, `fix.${kind.toLowerCase()}${i}`, textOf(crit ? Q0 : [Q0[0] as string], false, i), '2026-09-01T00:00:00.000Z');
              if (crit) critical.add(id);
            }
          }
        });
        for (let i = 0; i < size.k[1]; i++) mem.recordKnowledge(s.founder, { scope: 'COMPANY', topic: `fix.knew${i}`, content: textOf([Q0[0] as string], true, 10_000 + i), dataClass: 'D1' });
        for (let i = 0; i < size.c[1]; i++) mem.recordCanonicalTruth(s.founder, { level: 'VERIFIED_FACT', topic: `fix.cnew${i}`, statement: textOf([Q0[0] as string], true, 20_000 + i), dataClass: 'D1', sourceRef: 'authority:synthetic' });
        for (let i = 0; i < size.m[1]; i++) propose(h, claim, 2 + i, { topic: `fix.mnew${i}`, content: textOf([Q0[0] as string], true, 30_000 + i), confidencePct: 90 });
        // The previous release's query for this Work Item (topics ∪ TI-0 of the instructions ∪ codes; here TI-0 only).
        const legacyQ = [...new Set(terms(QUERY))].sort().slice(0, 96);
        const canonLive = "x.status = 'ACTIVE' AND x.integrity = 'OK'";
        const memLive = "x.employee_id = ? AND x.integrity = 'OK' AND x.status IN ('ACTIVE', 'LOW_CONFIDENCE')";
        const pools = (withoutNewRows: boolean) => ({
          k: oldKnowledgePool(h, legacyQ, withoutNewRows),
          c: oldMatches(h, 'CANONICAL', '', legacyQ, CANONICAL_POOL_LIMIT, 'canonical_truth', canonLive, [], withoutNewRows),
          m: oldMatches(h, 'MEMORY', s.employee.id, legacyQ, MEMORY_POOL_LIMIT, 'memory_records', memLive, [s.employee.id], withoutNewRows),
        });
        const mixed = pools(false);
        const oldOnly = pools(true);
        assert.deepEqual(mixed, oldOnly, 'the previous release never matches a `~` row: identical ids and order');
        if (scale === 'past') {
          assert.equal(mixed.c.length, CANONICAL_POOL_LIMIT);
          assert.equal(mixed.m.length, MEMORY_POOL_LIMIT);
          assert.equal(mixed.k.length, KNOWLEDGE_POOL_LIMIT);
        }
        for (const id of critical) assert.ok(mixed.k.includes(id) || mixed.c.includes(id) || mixed.m.includes(id), 'every old critical row is in the previous release\'s pool');
        // The new release on the same store: its candidates (the manifest) hold the whole previous pool plus at most 25%.
        const { claim: reader } = claimFor(h, workItem(h, s, s.employee, { instructions: QUERY }), 'w-ac5-read');
        const ctx = assembleContext(h.store, reader.fence, { step: 0 });
        const es = entries(h, ctx.manifestId);
        for (const [kind, pool, limit] of [['KNOWLEDGE', mixed.k, KNOWLEDGE_POOL_LIMIT], ['CANONICAL', mixed.c, CANONICAL_POOL_LIMIT], ['MEMORY', mixed.m, MEMORY_POOL_LIMIT]] as const) {
          const ids = new Set(es.filter((e) => e.itemKind === kind).map((e) => e.itemId));
          for (const id of pool) assert.ok(ids.has(id), `${kind}: an old row of the previous pool is never missing from the new pool`);
          const tier2 = [...ids].filter((id) => !pool.includes(id));
          assert.ok(tier2.length <= Math.floor((limit * POOL_EXTENSION_PCT) / 100), `${kind}: tier 2 ${tier2.length}`);
          if (scale === 'past') assert.ok(tier2.length > 0, `${kind}: the union query finds new rows the previous query cannot`);
        }
      });
    });
  }
});

describe('P1-CONTEXT-INTEL-01 C3: summary terms carry no alphabetical cut', () => {
  test('a topic summary is relevant through a term every source shares even when it sorts after the first 48 of their union', () => {
    withSeed((h, s) => {
      const { claim } = claimFor(h, workItem(h, s, s.employee, { instructions: 'zledger settlement' }), 'w-sum');
      for (let i = 0; i < 6; i++) propose(h, claim, i + 1, { topic: 'egypt.ledger', content: `${Array.from({ length: 12 }, (_, j) => `aa${i}x${j}`).join(' ')} zledger note ${i}.`, confidencePct: 100 });
      const { claim: reader } = claimFor(h, workItem(h, s, s.employee, { instructions: 'zledger settlement' }), 'w-sum-read');
      const ctx = assembleContext(h.store, reader.fence, { step: 0 });
      const summary = entries(h, ctx.manifestId).find((e) => e.itemKind === 'SUMMARY');
      assert.ok(summary, 'the topic is compacted');
      assert.notEqual(summary.reasonCode, 'NOT_RELEVANT', 'the shared term beyond the first 48 keeps the summary relevant');
    });
  });
});

describe('P1-CONTEXT-INTEL-01 AC6 / G4-SIMPLE-01: CP-1 on a populated store (canonical, knowledge, memory, a rule item, six Skills, full history, 4,000 characters, 2 tools)', () => {
  test('canonical truth, all six Skills and the history are selected; the Skills stay within their share and the knowledge and memory shares are filled; every candidate is accounted for; used <= budget', () => {
    withSeed((h, s) => {
      const w = ceoWorld(h, s);
      const mem = MemoryStore.for(h.store);
      const fact = (i: number) => `SYNTHETIC ${i}: الميزانية والتعيين والإطلاق والسوق السعودي ومصر والصرف والمنتج والنمو. ${'تفاصيل إضافية عن الخطة والفريق. '.repeat(6 + (i % 5) * 8)}`;
      const canon = [0, 1, 2].map((i) => mem.recordCanonicalTruth(s.founder, { level: 'POLICY', topic: `company.policy${i}`, statement: fact(i).slice(0, 1_900), dataClass: 'D1', sourceRef: 'authority:synthetic' }).id);
      for (let i = 0; i < 14; i++) mem.recordKnowledge(s.founder, { scope: 'COMPANY', topic: `company.k${i}`, content: fact(10 + i).slice(0, 3_900), dataClass: 'D1' });
      const d3 = mem.recordKnowledge(s.founder, { scope: 'COMPANY', topic: 'company.restricted', content: fact(99).slice(0, 1_500), dataClass: 'D3' }).id;
      const { claim } = claimFor(h, workItem(h, s, w.ceo, { instructions: 'SYNTHETIC: notes about the budget and hiring' }), 'w-ac6-mem');
      for (let i = 0; i < 16; i++) propose(h, claim, i + 1, { topic: `company.m${i}`, content: fact(40 + i).slice(0, 1_800), confidencePct: 90 });
      fillHistory(h, s, w.thread);
      const reply = send(h, s, w.thread, S_LONG);
      const ctx = assembledAt(h, reply, 'w-ac6', 2);
      assert.equal(ctx.outcome, 'OK');
      const es = entries(h, ctx.manifestId);
      const sel = new Set(es.filter((e) => e.decision === 'SELECTED').map((e) => e.itemId));
      for (const id of canon) assert.ok(sel.has(id), 'relevant canonical truth');
      for (const code of CEO_SKILLS) assert.ok(sel.has(w.versions.get(code) as string), code);
      assert.ok(es.some((e) => e.provenanceRef.startsWith('communication_thread:') && e.decision === 'SELECTED'), 'history');
      assert.equal(es.find((e) => e.itemId === d3)?.reasonCode, 'DATA_CLASS_ABOVE_CONTEXT');
      for (const e of es) assert.ok(e.decision === 'SELECTED' || (e.reasonCode !== null && e.reasonCode.length > 0), `${e.itemKind} ${e.itemId} is classified`);
      const m = MemoryStore.for(h.store).manifest(ctx.manifestId);
      assert.ok(m.usedTokens <= 60_000 - 512 && m.estimatedInputTokens <= 60_000);
      assert.equal(policyOf(h, ctx.manifestId).order, 'CP1');
      // The six Skills take no more than the SKILL share; knowledge and memory each fill their own share as far as their
      // items fit (a budget-rejected item is larger than the room its share had left): loading every Skill displaces neither.
      const share = (pct: number): number => Math.floor(((60_000 - DEFAULT_CONTEXT_POLICY.frameTokens) * pct) / 100);
      assert.ok((m.perLayer.SKILL ?? 0) <= share(DEFAULT_CONTEXT_POLICY.layerSharePct.SKILL), `skills ${m.perLayer.SKILL}`);
      for (const kind of ['KNOWLEDGE', 'MEMORY'] as const) {
        const own = es.filter((e) => e.itemKind === kind);
        const used = own.filter((e) => e.decision === 'SELECTED').reduce((n, e) => n + e.estTokens, 0);
        const smallestLeft = Math.min(...own.filter((e) => e.reasonCode === 'BUDGET_EXCEEDED').map((e) => e.estTokens));
        assert.ok(used > 0, `${kind} anchor`);
        assert.ok(used + smallestLeft > share(DEFAULT_CONTEXT_POLICY.layerSharePct[kind]), `${kind}: ${used} used, the next item (${smallestLeft}) would pass the share`);
      }
    });
  });
});
