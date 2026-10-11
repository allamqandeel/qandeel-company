/**
 * P1-CHAT-REFS-CORR-01 — the parser's bounded recovery of a MESSAGE that broke only the grammar of its optional
 * `contextRefs`. The proposal itself is unchanged for every caller (MALFORMED / REFS_INVALID); the recovery is offered only
 * when every other MESSAGE field is valid and the list is bounded, keeps exactly the grammar-valid references in order,
 * never rewrites the body and never manufactures a reference. Every other proposal type keeps its strict rules.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isStructuredRef, parseProposal, parseProposalDetailed } from '../src/index.js';

const msg = (extra: Record<string, unknown> = {}): string => JSON.stringify({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'The roadmap is current (docs/ROADMAP.md @ 1a2b3c4).', brief: null, contextRefs: [], ...extra });

describe('P1-CHAT-REFS-CORR-01: MESSAGE contextRefs', () => {
  test('a valid MESSAGE with valid references, or with [], is accepted unchanged and offers no recovery', () => {
    for (const refs of [[], ['memory:abc123', 'work_item:9f.2-x', 'run:a:b']]) {
      const p = parseProposalDetailed(msg({ contextRefs: refs }));
      assert.deepEqual([p.proposal.type, p.reason, p.refsRecovery ?? null], ['MESSAGE', null, null]);
      assert.deepEqual(p.proposal.type === 'MESSAGE' ? p.proposal.contextRefs : null, refs);
    }
    assert.equal(parseProposalDetailed(msg({ contextRefs: undefined })).proposal.type, 'MESSAGE', 'contextRefs stays optional');
  });

  test('a product path (or URL, or prose) in contextRefs: the proposal stays MALFORMED / REFS_INVALID; the recovery keeps only the valid references, in order, and the body byte for byte', () => {
    const text = msg({ contextRefs: ['docs/ROADMAP.md@1a2b3c4', 'memory:abc123', 'https://github.com/o/r', 'see the roadmap', 'run:r1'] });
    const p = parseProposalDetailed(text);
    assert.deepEqual([p.proposal, p.reason], [{ type: 'INVALID', code: 'MALFORMED' }, 'REFS_INVALID']);
    assert.deepEqual(parseProposal(text), p.proposal, 'every caller of parseProposal sees exactly what it saw before');
    assert.ok(p.refsRecovery);
    assert.equal(p.refsRecovery.discarded, 3);
    assert.deepEqual(p.refsRecovery.message, { type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'The roadmap is current (docs/ROADMAP.md @ 1a2b3c4).', brief: null, contextRefs: ['memory:abc123', 'run:r1'] });
    // Every reference invalid: the recovery carries none (never a manufactured replacement).
    const none = parseProposalDetailed(msg({ contextRefs: ['docs/ROADMAP.md'] }));
    assert.deepEqual([none.refsRecovery?.message.contextRefs, none.refsRecovery?.discarded], [[], 1]);
  });

  test('a hostile or unbounded reference payload offers no recovery: it stays refused (nothing is truncated into metadata)', () => {
    const hostile: unknown[] = [
      'docs/ROADMAP.md', // not a list
      { a: 'memory:x' },
      Array.from({ length: 9 }, (_, i) => `memory:m${i}`), // over the bound, even if each is valid
      Array.from({ length: 9 }, () => 'docs/x.md'),
      ['memory:ok', 42],
      ['memory:ok', null],
      ['memory:ok', ''],
      ['memory:ok', 'x'.repeat(129)],
      ['p/'.repeat(5_000)],
    ];
    for (const refs of hostile) {
      const p = parseProposalDetailed(msg({ contextRefs: refs }));
      assert.deepEqual([p.proposal, p.reason, p.refsRecovery ?? null], [{ type: 'INVALID', code: 'MALFORMED' }, 'REFS_INVALID', null], JSON.stringify(refs).slice(0, 60));
    }
  });

  test('any other MESSAGE defect wins first and offers no recovery; invalid JSON stays NOT_JSON', () => {
    const bad = ['docs/ROADMAP.md'];
    const cases: [Record<string, unknown>, string][] = [
      [{ body: '   ' }, 'BODY_EMPTY'],
      [{ body: 'x'.repeat(4_001) }, 'BODY_TOO_LONG'],
      [{ purpose: 'SHOUT' }, 'PURPOSE_INVALID'],
      [{ attentionLevel: 'LOUD' }, 'ATTENTION_INVALID'],
      [{ note: 'extra' }, 'FIELD_SET'],
      [{ purpose: 'BRIEF' }, 'BRIEF_MISMATCH'],
    ];
    for (const [extra, reason] of cases) {
      const p = parseProposalDetailed(msg({ contextRefs: bad, ...extra }));
      assert.deepEqual([p.proposal.type, p.reason, p.refsRecovery ?? null], ['INVALID', reason, null], reason);
    }
    const truncatedJson = parseProposalDetailed('{"type":"MESSAGE","purpose":"RESULT","body":"cut');
    assert.deepEqual([truncatedJson.proposal, truncatedJson.refsRecovery ?? null], [{ type: 'INVALID', code: 'NOT_JSON' }, null]);
  });

  test('REVIEW_DECISION evidence references keep their strict rule: malformed ones are refused with no recovery', () => {
    const review = (refs: unknown): string => JSON.stringify({ type: 'REVIEW_DECISION', outcome: 'PASS', reasonCode: 'review.ok', evidenceRefs: refs });
    assert.equal(parseProposal(review(['work_item:abc'])).type, 'REVIEW_DECISION');
    for (const refs of [['docs/ROADMAP.md'], ['work_item:abc', 'https://x.y/z']]) {
      const p = parseProposalDetailed(review(refs));
      assert.deepEqual([p.proposal, p.reason, p.refsRecovery ?? null], [{ type: 'INVALID', code: 'MALFORMED' }, 'REFS_INVALID', null]);
    }
  });

  test('the shared grammar: kind:id only', () => {
    assert.deepEqual(['memory:abc123', 'work_item:a.b-c_d:e'].map(isStructuredRef), [true, true]);
    assert.deepEqual(['docs/ROADMAP.md', 'memory:a/b', 'Memory:x', 'memory:', ':x', 'memory:a b', 'memory:a@b', 42, null].map(isStructuredRef), [false, false, false, false, false, false, false, false, false]);
  });
});
