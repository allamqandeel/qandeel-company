/**
 * G4-C2-SNA-01 (D-P1-15) — the SKILL_NEED proposal grammar and the classifier contract (pure): a closed list of
 * {code, tier}, refused whole on any extra field, duplicate code, unknown tier, empty or oversize list; bound to exactly the
 * offered Skills; the preamble is versioned, digested and Employee-neutral; RD-1 is untouched (TS-1 is gone).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MALFORMED_REASONS,
  PROPOSAL_TYPES,
  PROVIDER_SAMPLINGS,
  SKILL_NEED_CAP,
  SKILL_NEED_MAX_SKILLS,
  SKILL_NEED_OUTCOMES,
  SKILL_NEED_POLICY,
  SKILL_NEED_PREAMBLE,
  SKILL_NEED_PREAMBLE_SHA256,
  SKILL_NEED_PROMPT_VERSION,
  SKILL_NEED_TASK_CLASS,
  SKILL_NEED_TIERS,
  SKILL_NEED_WINDOW_MS,
  checkSkillNeed,
  parseProposalDetailed,
  samplingForTaskClass,
  type SkillNeedProposal,
} from '../src/index.js';
import * as gov from '../src/index.js';

const out = (o: unknown): string => JSON.stringify(o);
const valid = { type: 'SKILL_NEED', skills: [{ code: 'ceo.governance-discipline', tier: 'TASK_REQUIRED' }, { code: 'ceo.founder-partnership', tier: 'SUPPORTING' }] };

describe('G4-C2-SNA-01: the SKILL_NEED proposal', () => {
  test('a closed list of {code, tier} parses to the typed proposal', () => {
    const p = parseProposalDetailed(out(valid));
    assert.deepEqual(p, { proposal: valid, reason: null });
    assert.ok(PROPOSAL_TYPES.includes('SKILL_NEED'));
    assert.ok(MALFORMED_REASONS.includes('SKILLS_INVALID'));
    assert.deepEqual([...SKILL_NEED_TIERS], ['TASK_REQUIRED', 'SUPPORTING', 'NON_RELEVANT']);
  });

  test('refused whole: extra fields, a duplicate code, an unknown tier, a bad code, an empty or oversize list, prose', () => {
    const malformed = (o: unknown): string | null => {
      const p = parseProposalDetailed(typeof o === 'string' ? o : out(o));
      assert.equal(p.proposal.type, 'INVALID');
      return p.reason;
    };
    assert.equal(malformed({ ...valid, reasons: 'because' }), 'FIELD_SET');
    assert.equal(malformed({ type: 'SKILL_NEED', skills: [{ code: 'ceo.a', tier: 'SUPPORTING' }, { code: 'ceo.a', tier: 'NON_RELEVANT' }] }), 'SKILLS_INVALID');
    assert.equal(malformed({ type: 'SKILL_NEED', skills: [{ code: 'ceo.a', tier: 'NOT_NEEDED' }] }), 'SKILLS_INVALID');
    assert.equal(malformed({ type: 'SKILL_NEED', skills: [{ code: 'CEO A', tier: 'SUPPORTING' }] }), 'SKILLS_INVALID');
    assert.equal(malformed({ type: 'SKILL_NEED', skills: [{ code: 'ceo.a', tier: 'SUPPORTING', why: 'x' }] }), 'SKILLS_INVALID');
    assert.equal(malformed({ type: 'SKILL_NEED', skills: [] }), 'SKILLS_INVALID');
    assert.equal(malformed({ type: 'SKILL_NEED', skills: Array.from({ length: SKILL_NEED_MAX_SKILLS + 1 }, (_, i) => ({ code: `s.c${i}`, tier: 'SUPPORTING' })) }), 'SKILLS_INVALID');
    assert.equal(malformed({ type: 'SKILL_NEED', skills: { 'ceo.a': 'SUPPORTING' } }), 'SKILLS_INVALID');
    assert.equal(parseProposalDetailed('The reply needs governance.').proposal.type, 'INVALID');
  });

  test('bound to exactly the offered Skills: an unknown or a missing code refuses the whole answer', () => {
    const offered = ['ceo.governance-discipline', 'ceo.founder-partnership'];
    const p = parseProposalDetailed(out(valid)).proposal as SkillNeedProposal;
    assert.deepEqual(checkSkillNeed(p, offered), { ok: true, tiers: { 'ceo.founder-partnership': 'SUPPORTING', 'ceo.governance-discipline': 'TASK_REQUIRED' } });
    assert.deepEqual(checkSkillNeed(p, [...offered, 'ceo.executive-judgment']), { ok: false, code: 'CODE_MISSING' });
    assert.deepEqual(checkSkillNeed(p, ['ceo.governance-discipline']), { ok: false, code: 'CODE_UNKNOWN' });
  });
});

describe('G4-C2-SNA-01: the classifier contract', () => {
  test('its own task class, the approved bounds, versioned and digested preamble, closed outcome codes', () => {
    assert.equal(SKILL_NEED_TASK_CLASS, 'skill.need.assessment');
    assert.equal(SKILL_NEED_POLICY, 'SNA-1');
    assert.equal(SKILL_NEED_PROMPT_VERSION, 'SNP-2');
    assert.match(SKILL_NEED_PREAMBLE_SHA256, /^[0-9a-f]{64}$/);
    assert.equal(SKILL_NEED_WINDOW_MS, 20_000);
    assert.deepEqual({ ...SKILL_NEED_CAP }, { money: 20_000, tokens: 40_000 });
    assert.equal(SKILL_NEED_OUTCOMES[0], 'CLASSIFIED');
    assert.ok(SKILL_NEED_PREAMBLE.includes('You do not answer the Founder'));
    assert.ok(SKILL_NEED_PREAMBLE.includes('{"type":"SKILL_NEED","skills":[{"code":"<skill code>","tier":"TASK_REQUIRED|SUPPORTING|NON_RELEVANT"}]}'));
    for (const name of ['Ahmed', 'أحمد', 'ceo.']) assert.equal(SKILL_NEED_PREAMBLE.includes(name), false, `Employee-neutral: ${name}`);
  });

  test('G4-C2-TEMP-01: the frozen SNP-2 is unchanged, and only the assessment task class is sampled deterministically', () => {
    assert.equal(SKILL_NEED_PREAMBLE_SHA256, '8367fe1c5b2e9235f7f3311ae995baf2e229f59a3071980640678fb542c3d3fd', 'SNP-2 byte for byte (the hash frozen before the temperature correction)');
    assert.deepEqual([...PROVIDER_SAMPLINGS], ['DETERMINISTIC'], 'a closed code, never a number');
    assert.equal(samplingForTaskClass(SKILL_NEED_TASK_CLASS), 'DETERMINISTIC');
    for (const other of ['founder.reply', 'founder.brief', 'academy.answer', 'employee.task', '', ' skill.need.assessment', 'SKILL.NEED.ASSESSMENT', '__proto__', 'constructor']) assert.equal(samplingForTaskClass(other), undefined, `"${other}" keeps the provider default`);
  });

  test('TS-1 is gone: no task-signal export remains beside RD-1', () => {
    for (const name of ['taskSignals', 'isTaskSignals', 'TASK_SIGNALS', 'TASK_SIGNAL_POLICY', 'understandTask']) assert.equal(name in gov, false, name);
    assert.equal(typeof gov.assessReasoningDemand, 'function', 'RD-1 stays');
  });
});
