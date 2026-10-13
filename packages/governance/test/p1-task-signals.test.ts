/**
 * P1-CONTEXT-INTEL-01 (D-P1-14) — Task Signals (TS-1): what a Founder request needs, as closed, content-free codes for the
 * Skill need table. RD-1 is unchanged (its demands are pinned byte for byte); TS-1 only adds signals. Measured on the
 * synthetic development set (the sealed held-out set HO-1 is evaluated once, outside the repository, after the freeze).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEMAND_REASONS, TASK_SIGNALS, TASK_SIGNAL_FAMILIES, TASK_SIGNAL_POLICY, assessReasoningDemand, isTaskSignals, taskSignals } from '../src/index.js';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures');
const rd1 = JSON.parse(readFileSync(path.join(fixtures, 'reasoning-demand-cases.json'), 'utf8')) as { cases: { text: string; executive?: boolean }[] };
const dev = JSON.parse(readFileSync(path.join(fixtures, 'task-signals-dev-set.json'), 'utf8')) as { cases: { id: string; kind: string; text: string }[] };
const of = (text: string) => taskSignals({ text, purpose: 'QUESTION', executive: true });

describe('P1-CONTEXT-INTEL-01 TS-1: task signals beside an unchanged RD-1', () => {
  test('RD-1 is byte-identical: the demands of the RD-1 expectation set and the development set are pinned', () => {
    const all = [
      ...rd1.cases.map((c) => assessReasoningDemand({ text: c.text, purpose: 'QUESTION', attentionLevel: 'INFORMATIONAL', executive: c.executive === true })),
      ...dev.cases.map((c) => assessReasoningDemand({ text: c.text, purpose: 'QUESTION', executive: true })),
    ];
    assert.equal(all.length, 280);
    // The demands of the previous release (origin/main 2be1b68): TS-1 adds code beside RD-1 and changes none of it.
    assert.equal(createHash('sha256').update(JSON.stringify(all)).digest('hex'), 'b8f8350321ad3e348c84e70a04c2812200f3e83375e9e9e76b7dd9914149ba2f');
  });

  test('closed, content-free and deterministic: RD-1 reasons plus the TS-1 families, in a fixed order; the text never appears', () => {
    assert.equal(TASK_SIGNAL_POLICY, 'TS-1');
    assert.deepEqual(TASK_SIGNALS, [...DEMAND_REASONS, ...TASK_SIGNAL_FAMILIES]);
    for (const c of dev.cases) {
      const s = of(c.text);
      assert.deepEqual(of(c.text), s);
      assert.ok(isTaskSignals(JSON.parse(JSON.stringify(s))), c.id);
      assert.deepEqual(s.signals, TASK_SIGNALS.filter((x) => s.signals.includes(x)), 'canonical order');
      const demand = assessReasoningDemand({ text: c.text, purpose: 'QUESTION', executive: true });
      // TS-1 drops RD-1 reasons only where it reads the message as a note, a transformation, a factual question or a routing question.
      for (const r of s.signals) assert.ok((TASK_SIGNALS as readonly string[]).includes(r));
      assert.ok(demand.reasons.length > 0);
      if (c.text.length > 12) assert.equal(JSON.stringify(s).includes(c.text.slice(0, 12)), false, 'never the text');
    }
    assert.equal(isTaskSignals({ policy: 'TS-1', signals: ['FREE TEXT'] }), false);
    assert.equal(isTaskSignals({ policy: 'TS-2', signals: [] }), false);
    assert.equal(isTaskSignals({ policy: 'TS-1', signals: ['EVIDENCE', 'EVIDENCE'] }), false);
  });

  test('notes, thanks and transformations raise no task need; a governance boundary inside a note still does', () => {
    for (const t of ['Thanks, noted.', 'FYI, I moved our call to Sunday.', 'شكرا، وصلت.', 'للعلم، تم تأجيل الاجتماع إلى الأحد.', 'تمام، متشكر']) {
      assert.deepEqual(of(t).signals.filter((x) => (TASK_SIGNAL_FAMILIES as readonly string[]).includes(x)), [], t);
    }
    const translate = of('Translate this: our strategy is to launch in the Gulf, compare pricing and sign the contract.');
    assert.ok(translate.signals.includes('TRANSFORMATION_TASK'));
    assert.deepEqual(translate.signals.filter((x) => (TASK_SIGNAL_FAMILIES as readonly string[]).includes(x)), [], 'the material to transform is not the task');
    assert.ok(of('FYI: Growth will start posting without approval from tomorrow.').signals.includes('AUTHORITY'));
  });

  test('cue families: Arabic articles on Latin names, distinct departments, a market place vs a launch date, factual questions', () => {
    assert.ok(of('مين المفروض يمسك الإطلاق، الـProduct ولا الـGrowth؟').signals.includes('CROSS_DEPARTMENT'), 'الـGrowth is Growth');
    assert.equal(of('راجع خطة التوظيف في قسم الهندسة وأخبرني إن كان العدد منطقيا.').signals.includes('CROSS_DEPARTMENT'), false, 'one department named twice is one department');
    assert.equal(of('تفتكر نعيّن مدير Growth دلوقتي ولا نستنى لبعد الإطلاق؟').signals.includes('MARKET_DECISION'), false, 'a launch date is not a market');
    assert.ok(of('Should we enter Saudi Arabia before the UAE?').signals.includes('MARKET_DECISION'));
    assert.equal(of('Is our data retention policy compliant with the privacy rules?').signals.includes('EVIDENCE'), false, 'data retention is not user retention');
    const status = of('Where do we stand today? How many employees do we have and how is spending going?').signals;
    assert.ok(status.includes('STATUS_QUERY'));
    for (const x of ['ORG_ROLE', 'BUDGET_SUFFIXED', 'EXECUTIVE_DECISION']) assert.equal(status.includes(x as never), false, x);
    assert.ok(of('A competitor just cut their price by half. Do we react?').signals.includes('EXECUTIVE_DECISION'));
    assert.equal(of('Who should I talk to about the delayed invoices?').signals.includes('EXECUTIVE_DECISION'), false, 'a routing question');
  });
});
