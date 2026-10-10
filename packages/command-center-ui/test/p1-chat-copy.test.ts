/**
 * P1-CEO-CONVERSATION-UX-01 (CHAT-COPY-01) — what one chat message copies and when the UI may say "Copied": the complete
 * displayed text (body verbatim; a brief's four shown parts with their titles), never sender, time, purpose or status; a
 * success only when the clipboard (or its fallback) actually reported one. Synthetic fixture text only.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { briefRows, copyToClipboard, messageCopyText, type ClipboardLike } from '../src/model/message-copy.js';

const LONG = ['SYNTHETIC الفقرة الأولى: نص عربي طويل.', '', 'Second paragraph — English, with “quotes”, 1,234 and a tab\there.', 'سطر ثالث\r\nwith a CRLF line', ...Array.from({ length: 120 }, (_, i) => `سطر ${i} line ${i}`)].join('\n');

class FakeClipboard implements ClipboardLike {
  readonly written: string[] = [];
  constructor(private readonly refuse = false) {}
  writeText(text: string): Promise<void> {
    if (this.refuse) return Promise.reject(new Error('NotAllowedError'));
    this.written.push(text);
    return Promise.resolve();
  }
}

describe('CHAT-COPY-01: copy exactly the message', () => {
  test('a Founder or Employee message copies its body verbatim: Arabic, English, paragraphs, line breaks, length', () => {
    const founder = { senderKind: 'FOUNDER', purpose: 'QUESTION', createdAt: '2026-10-10T00:00:00Z', body: LONG, brief: null };
    const employee = { senderKind: 'EMPLOYEE', purpose: 'RESULT', createdAt: '2026-10-10T00:01:00Z', body: 'SYNTHETIC reply.\n\nسطر ثانٍ.', brief: null };
    assert.equal(messageCopyText(founder), LONG);
    assert.equal(messageCopyText(employee), 'SYNTHETIC reply.\n\nسطر ثانٍ.');
    for (const meta of ['FOUNDER', 'QUESTION', '2026-10-10']) assert.equal(messageCopyText(founder).includes(meta), false, `no ${meta}`);
  });

  test('a brief copies its four shown parts, in order, under the titles the bubble shows', () => {
    const brief = { happening: 'SYNTHETIC: يحدث شيء.', matters: 'It matters.\nTwo lines.', recommendation: 'Do X.', decisionNeeded: true, decision: 'Approve X?' };
    const text = messageCopyText({ body: 'SYNTHETIC hidden summary', brief });
    assert.equal(text, 'What is happening\nSYNTHETIC: يحدث شيء.\n\nWhy it matters\nIt matters.\nTwo lines.\n\nRecommendation\nDo X.\n\nDecision needed\nApprove X?');
    assert.equal(text, briefRows(brief).map((r) => `${r.title}\n${r.text}`).join('\n\n'), 'the same rows the renderer shows');
    assert.equal(briefRows({ ...brief, decisionNeeded: false }).at(-1)?.text, 'No decision needed');
  });

  test('success only when the clipboard reports it; a refusal falls back honestly; nothing copied is never "Copied"', async () => {
    const ok = new FakeClipboard();
    assert.equal(await copyToClipboard(LONG, ok), true);
    assert.deepEqual(ok.written, [LONG]);
    const seen: string[] = [];
    assert.equal(await copyToClipboard('x', new FakeClipboard(true), (t) => (seen.push(t), true)), true, 'refused API, working fallback');
    assert.deepEqual(seen, ['x']);
    assert.equal(await copyToClipboard('x', new FakeClipboard(true), () => false), false);
    assert.equal(await copyToClipboard('x', new FakeClipboard(true)), false, 'no fallback: a failure, not a success');
    assert.equal(await copyToClipboard('x', null, () => { throw new Error('execCommand unavailable'); }), false);
    assert.equal(await copyToClipboard('x', undefined), false);
    assert.equal(await copyToClipboard('', ok), false, 'an empty text is never a copy');
  });
});
