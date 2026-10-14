#!/usr/bin/env node
// G4-HO2-FINAL-01 (D-P1-15) — the Skill Need Assessment scorer, pure: tiers in, aggregate metrics and gate verdicts out.
// Extracted from scripts/p1-sna-evaluate.mjs unchanged in what it already measured (the self-test replays the recorded DEV
// and VAL runs and must reproduce their logged metrics exactly), and extended BEFORE HO-2 was opened with what the Founder
// asked for in G4-HO2-FINAL-01: the six-Skill scope, the loaded-set (content) metrics, the tier confusion, and the
// over-assignment evidence. Content-free: ids, codes and counts only.
//
//   node scripts/p1-sna-score.mjs --self-test [--replay <corr-01 dir>]
//
// Gates (pre-registered for HO-2; thresholds are the recorded ones of D-P1-14 AC3 / D-P1-15, none is new):
//   - numeric, recorded scope (the five task Skills, as every earlier run): micro R ≥ 0.90, micro P ≥ 0.80, per-language
//     R ≥ 0.85, language gap ≤ 0.10;
//   - per-Skill R ≥ 0.80 on all SIX Skills (founder-partnership included, as the Founder read it after VAL);
//   - the same micro / language gates on the six-Skill scope are reported; if the two scopes disagree on any of them the
//     verdict is AMBIGUOUS (the Founder decides), never the favourable one;
//   - rules already recorded: SIMPLE messages carry at most one task Skill and none loads four or more (D-P1-14); no
//     reference-TASK_REQUIRED Skill set NON_RELEVANT in a MULTI message; integrity checks supplied by the harness.
//   - executive-judgment / founder-partnership over-assignment is DESCRIPTIVE: evidence only, no threshold, never a verdict.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SIX = ['ceo.governance-discipline', 'ceo.founder-partnership', 'ceo.executive-judgment', 'ceo.evidence-and-economics', 'ceo.organization-leadership', 'ceo.cross-functional-synthesis'];
const PARTNER = 'ceo.founder-partnership';
const EXEC = 'ceo.executive-judgment';
export const N = (l) => (l === 'NOT_NEEDED' ? 'NON_RELEVANT' : l);
const r3 = (a, b) => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);
const SHORT = { TASK_REQUIRED: 'TR', SUPPORTING: 'SUP', NON_RELEVANT: 'NR' };

// TASK_REQUIRED recall / precision over a Skill scope (the recorded scorer when scope is the five task Skills).
function trScope(rows, scope) {
  const per = {}, lang = {}, cat = {};
  let tp = 0, fn = 0, fp = 0, loaded = 0, severe = 0, refTR = 0, multiLost = 0;
  for (const row of rows) {
    for (const s of scope) {
      const want = N(row.labels[s]), got = row.pred[s];
      per[s] ??= { tp: 0, fn: 0, fp: 0 };
      lang[row.lang] ??= { tp: 0, fn: 0 };
      cat[row.cat] ??= { tp: 0, fn: 0, fp: 0 };
      const w = want === 'TASK_REQUIRED', g = got === 'TASK_REQUIRED';
      if (w) {
        refTR++;
        if (got !== 'NON_RELEVANT') loaded++;
        else {
          severe++;
          if (row.cat === 'MULTI') multiLost++;
        }
      }
      if (w && g) { tp++; per[s].tp++; lang[row.lang].tp++; cat[row.cat].tp++; }
      else if (w) { fn++; per[s].fn++; lang[row.lang].fn++; cat[row.cat].fn++; }
      else if (g) { fp++; per[s].fp++; cat[row.cat].fp++; }
    }
  }
  const perLang = Object.fromEntries(Object.entries(lang).map(([l, x]) => [l, r3(x.tp, x.tp + x.fn)]));
  const lv = Object.values(perLang).filter((x) => x !== null);
  return {
    recallMicro: r3(tp, tp + fn), precisionMicro: r3(tp, tp + fp), tp, fn, fp,
    loadedRecall: r3(loaded, refTR), severeMisses: severe, multiLost,
    perSkill: Object.fromEntries(scope.map((s) => [s.replace('ceo.', ''), { R: r3(per[s]?.tp ?? 0, (per[s]?.tp ?? 0) + (per[s]?.fn ?? 0)), P: r3(per[s]?.tp ?? 0, (per[s]?.tp ?? 0) + (per[s]?.fp ?? 0)), ref: (per[s]?.tp ?? 0) + (per[s]?.fn ?? 0), pred: (per[s]?.tp ?? 0) + (per[s]?.fp ?? 0), fp: per[s]?.fp ?? 0, fn: per[s]?.fn ?? 0 }])),
    perLang, gap: lv.length ? Math.round((Math.max(...lv) - Math.min(...lv)) * 1000) / 1000 : null,
    perCat: Object.fromEntries(Object.entries(cat).map(([c, x]) => [c, { R: r3(x.tp, x.tp + x.fn), fp: x.fp }])),
  };
}

/**
 * rows: [{ id, lang, cat (upper case), labels (reference, raw), pred (six tiers: what the reply plans with), source, outcome }]
 * integrity: harness facts, each `true` when held (e.g. { singleDeployment, noReplyCall, allTemperatureZero, ... }).
 */
export function score(rows, integrity = {}) {
  const TASK = SIX.filter((s) => s !== PARTNER);
  const five = trScope(rows, TASK);
  const six = trScope(rows, SIX);
  const pr = (s) => {
    const pred = rows.filter((r) => r.pred[s] === 'TASK_REQUIRED').length;
    const ref = rows.filter((r) => r.labels[s] === 'TASK_REQUIRED').length;
    const hit = rows.filter((r) => r.pred[s] === 'TASK_REQUIRED' && r.labels[s] === 'TASK_REQUIRED').length;
    return { R: r3(hit, ref), P: r3(hit, pred), ref, pred, fp: pred - hit, fn: ref - hit };
  };
  const simple = rows.filter((r) => r.cat.startsWith('SIMPLE'));
  // The recorded metric block (field for field what scripts/p1-sna-evaluate.mjs printed before G4-HO2-FINAL-01).
  const metrics = {
    items: rows.length,
    recallMicro: five.recallMicro, precisionMicro: five.precisionMicro, tp: five.tp, fn: five.fn, fp: five.fp,
    loadedRecall: five.loadedRecall, severeMisses: five.severeMisses, multiLost: five.multiLost,
    perSkill: five.perSkill, partnership: pr(PARTNER), executive: pr(EXEC),
    perLang: five.perLang, gap: five.gap, perCat: five.perCat,
    simple: { n: simple.length, atMostOneTask: simple.filter((r) => TASK.filter((s) => r.pred[s] === 'TASK_REQUIRED').length <= 1).length, noTask: simple.filter((r) => TASK.every((s) => r.pred[s] !== 'TASK_REQUIRED')).length, loadsFour: simple.filter((r) => SIX.filter((s) => r.pred[s] !== 'NON_RELEVANT').length >= 4).length },
  };

  // Content: what CP-1 loads is every non-NON_RELEVANT Skill (the tier only orders them; Ahmed's six fit the SKILL share).
  const confusion = {};
  const confusionBySkill = {};
  let refReq = 0, refReqLoaded = 0, refReqExcluded = 0, refLoaded = 0, predLoaded = 0, bothLoaded = 0;
  const compound = {};
  for (const r of rows) {
    for (const s of SIX) {
      const ref = N(r.labels[s]), got = r.pred[s];
      if (ref !== got) {
        const k = `${SHORT[ref]}>${SHORT[got]}`;
        confusion[k] = (confusion[k] ?? 0) + 1;
        confusionBySkill[s.replace('ceo.', '')] ??= {};
        confusionBySkill[s.replace('ceo.', '')][k] = (confusionBySkill[s.replace('ceo.', '')][k] ?? 0) + 1;
      }
      if (ref === 'TASK_REQUIRED') {
        refReq++;
        if (got !== 'NON_RELEVANT') refReqLoaded++;
        else {
          refReqExcluded++;
          compound[r.cat] = (compound[r.cat] ?? 0) + 1;
        }
      }
      if (ref !== 'NON_RELEVANT') refLoaded++;
      if (got !== 'NON_RELEVANT') predLoaded++;
      if (ref !== 'NON_RELEVANT' && got !== 'NON_RELEVANT') bothLoaded++;
    }
  }
  const content = {
    requiredLoadedCoverage: r3(refReqLoaded, refReq), requiredSkills: refReq,
    requiredExcludedByNonRelevant: refReqExcluded, requiredExcludedRate: r3(refReqExcluded, refReq), requiredExcludedByCategory: compound,
    loadedSetRecall: r3(bothLoaded, refLoaded), loadedSetPrecision: r3(bothLoaded, predLoaded), referenceLoaded: refLoaded, predictedLoaded: predLoaded,
    priorityErrors: { 'TR>SUP': confusion['TR>SUP'] ?? 0, 'SUP>TR': confusion['SUP>TR'] ?? 0 },
    boundaryErrors: { 'SUP>NR': confusion['SUP>NR'] ?? 0, 'NR>SUP': confusion['NR>SUP'] ?? 0, 'TR>NR': confusion['TR>NR'] ?? 0, 'NR>TR': confusion['NR>TR'] ?? 0 },
    confusion, confusionBySkill,
  };
  const over = (s) => {
    const x = pr(s);
    const fpRef = rows.filter((r) => r.pred[s] === 'TASK_REQUIRED' && r.labels[s] !== 'TASK_REQUIRED').reduce((a, r) => ({ ...a, [SHORT[N(r.labels[s])]]: (a[SHORT[N(r.labels[s])]] ?? 0) + 1 }), {});
    return { ...x, falsePositivesByReferenceTier: fpRef };
  };
  const overAssignment = { executive: over(EXEC), partnership: over(PARTNER) };

  const g = (m, perSkill) => ({
    recallMicro: m.recallMicro !== null && m.recallMicro >= 0.9,
    precisionMicro: m.precisionMicro !== null && m.precisionMicro >= 0.8,
    perSkillRecall: Object.values(perSkill).every((x) => x.R === null || x.R >= 0.8),
    perLangRecall: Object.values(m.perLang).every((x) => x === null || x >= 0.85),
    langGap: m.gap !== null && m.gap <= 0.1,
  });
  const gates = {
    recorded: g(five, six.perSkill), // per-Skill on all six
    sixSkillScope: g(six, six.perSkill),
    rules: { simpleLimits: metrics.simple.atMostOneTask === metrics.simple.n && metrics.simple.loadsFour === 0, noLostInCompound: five.multiLost === 0 && six.multiLost === 0, ...integrity },
  };
  // FAIL: a rule fails, or a numeric gate fails on BOTH scopes. AMBIGUOUS: the two scopes disagree on a numeric gate.
  const disagree = Object.keys(gates.recorded).filter((k) => gates.recorded[k] !== gates.sixSkillScope[k]);
  const failedBoth = Object.keys(gates.recorded).filter((k) => !gates.recorded[k] && !gates.sixSkillScope[k]);
  const failedRules = Object.entries(gates.rules).filter(([, v]) => !v).map(([k]) => k);
  const failed = [...failedBoth.map((k) => `numeric.${k}`), ...failedRules.map((k) => `rules.${k}`)];
  const verdict = failed.length > 0 ? 'FAIL' : disagree.length > 0 ? 'AMBIGUOUS' : 'PASS';
  return { metrics, six: { ...six, perCat: undefined }, content, overAssignment, gates, scopeDisagreement: disagree, failed, verdict };
}

// ------------------------------------------------------------------------------------------------------------ self-test
function selfTest(replayDir) {
  const ok = (cond, what) => {
    if (!cond) {
      console.error(JSON.stringify({ selfTest: 'FAIL', what }));
      process.exit(1);
    }
  };
  const tiers = (o) => Object.fromEntries(SIX.map((s) => [s, o[s.replace('ceo.', '')] ?? 'NON_RELEVANT']));
  const labels = (o) => Object.fromEntries(SIX.map((s) => [s, o[s.replace('ceo.', '')] ?? 'NOT_NEEDED']));
  // Hand-computed synthetic fixture (no real message): four rows, two languages.
  const rows = [
    { id: 'S1', lang: 'EN', cat: 'SIMPLE', labels: labels({}), pred: tiers({}) },
    { id: 'S2', lang: 'EN', cat: 'MULTI', labels: labels({ 'governance-discipline': 'TASK_REQUIRED', 'executive-judgment': 'SUPPORTING', 'founder-partnership': 'TASK_REQUIRED' }), pred: tiers({ 'governance-discipline': 'TASK_REQUIRED', 'executive-judgment': 'TASK_REQUIRED', 'founder-partnership': 'SUPPORTING' }) },
    { id: 'S3', lang: 'EG', cat: 'SUBSTANTIVE', labels: labels({ 'evidence-and-economics': 'TASK_REQUIRED', 'organization-leadership': 'SUPPORTING' }), pred: tiers({ 'evidence-and-economics': 'TASK_REQUIRED' }) },
    { id: 'S4', lang: 'EG', cat: 'MULTI', labels: labels({ 'cross-functional-synthesis': 'TASK_REQUIRED', 'executive-judgment': 'TASK_REQUIRED' }), pred: tiers({ 'cross-functional-synthesis': 'NON_RELEVANT', 'executive-judgment': 'TASK_REQUIRED', 'governance-discipline': 'SUPPORTING' }) },
  ];
  const s = score(rows, { probe: true });
  // five task Skills: ref TR = gov(S2), evid(S3), xfn(S4), exec(S4) = 4; pred TR = gov(S2), exec(S2), evid(S3), exec(S4) = 4.
  ok(s.metrics.tp === 3 && s.metrics.fn === 1 && s.metrics.fp === 1, 'five-scope tp/fn/fp 3/1/1');
  ok(s.metrics.recallMicro === 0.75 && s.metrics.precisionMicro === 0.75, 'five-scope R/P 0.75');
  ok(s.metrics.severeMisses === 1 && s.metrics.multiLost === 1, 'one required Skill excluded, in MULTI');
  ok(s.six.tp === 3 && s.six.fn === 2 && s.six.fp === 1, 'six-scope adds the partnership demotion');
  ok(s.metrics.perLang.EN === 1 && s.metrics.perLang.EG === 0.667 && s.metrics.gap === 0.333, 'per language');
  ok(s.content.requiredSkills === 5 && s.content.requiredExcludedByNonRelevant === 1 && s.content.requiredLoadedCoverage === 0.8, 'loaded coverage');
  // loaded: ref non-NR = S2 gov,exec,partner (3) + S3 evid,org (2) + S4 xfn,exec (2) = 7; pred non-NR = S2 3 + S3 1 + S4 exec,gov 2 = 6; both = 3+1+1 = 5.
  ok(s.content.referenceLoaded === 7 && s.content.predictedLoaded === 6 && s.content.loadedSetRecall === 0.714 && s.content.loadedSetPrecision === 0.833, 'loaded set');
  ok(s.content.priorityErrors['SUP>TR'] === 1 && s.content.priorityErrors['TR>SUP'] === 1, 'priority errors');
  ok(s.content.boundaryErrors['SUP>NR'] === 1 && s.content.boundaryErrors['TR>NR'] === 1 && s.content.boundaryErrors['NR>SUP'] === 1, 'boundary errors');
  ok(s.overAssignment.executive.pred === 2 && s.overAssignment.executive.ref === 1 && s.overAssignment.executive.falsePositivesByReferenceTier.SUP === 1, 'over-assignment evidence');
  ok(s.metrics.simple.n === 1 && s.metrics.simple.atMostOneTask === 1 && s.metrics.simple.loadsFour === 0, 'simple');
  ok(s.verdict === 'FAIL' && s.failed.includes('rules.noLostInCompound'), 'verdict FAIL on the lost compound Skill');
  // A perfect classifier passes; a disagreement between scopes is AMBIGUOUS, never PASS.
  const perfect = rows.map((r) => ({ ...r, pred: Object.fromEntries(SIX.map((k) => [k, N(r.labels[k])])) }));
  ok(score(perfect).verdict === 'PASS', 'a perfect classifier passes');
  const mix = [...perfect, ...Array.from({ length: 9 }, (_, i) => ({ id: `P${i}`, lang: i % 2 ? 'EN' : 'EG', cat: 'SUBSTANTIVE', labels: labels({ 'governance-discipline': 'TASK_REQUIRED', 'founder-partnership': 'TASK_REQUIRED' }), pred: tiers({ 'governance-discipline': 'TASK_REQUIRED', 'founder-partnership': i < 1 ? 'TASK_REQUIRED' : 'SUPPORTING' }) }))];
  const m = score(mix);
  ok(m.gates.recorded.perSkillRecall === false && m.verdict === 'FAIL' && m.failed.includes('numeric.perSkillRecall'), 'partnership recall below 0.80 fails the per-Skill gate');
  // Recorded scope 9/10 = 0.90 passes; six-Skill scope (9 + 8) / 20 = 0.85 does not; partnership 0.80 passes per Skill.
  const amb = Array.from({ length: 10 }, (_, i) => ({ id: `A${i}`, lang: 'EN', cat: 'SUBSTANTIVE', labels: labels({ 'governance-discipline': 'TASK_REQUIRED', 'founder-partnership': 'TASK_REQUIRED' }), pred: tiers({ 'governance-discipline': i < 9 ? 'TASK_REQUIRED' : 'SUPPORTING', 'founder-partnership': i < 8 ? 'TASK_REQUIRED' : 'SUPPORTING' }) }));
  const a = score(amb);
  ok(a.metrics.recallMicro === 0.9 && a.six.recallMicro === 0.85 && a.verdict === 'AMBIGUOUS' && a.scopeDisagreement.join() === 'recallMicro', 'a scope disagreement is AMBIGUOUS, never PASS');
  const results = { selfTest: 'SYNTHETIC_OK', checks: 16 };

  if (replayDir) {
    // Replay the recorded paid runs: the extracted scorer must reproduce every logged metric exactly.
    const rd = (f) => readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    const runs = [['SNP-2-T0-DEV', ['dev/DEVA', 'dev/DEVB']], ['SNP-2-T0-DEV-r2', ['dev/DEVA', 'dev/DEVB']], ['SNP-2-T0-VAL', ['val/VAL1', 'val/VAL2', 'val/VAL3', 'val/VAL4']], ['SNP-2-VAL', ['val/VAL1', 'val/VAL2', 'val/VAL3', 'val/VAL4']]];
    results.replayed = [];
    for (const [label, sets] of runs) {
      const items = new Map(rd(path.join(replayDir, 'sna', `${label}-items.jsonl`)).map((x) => [x.id, x]));
      const logged = rd(path.join(replayDir, 'sna', `${label}.log`)).find((x) => x.step === 'result').metrics;
      const rr = [];
      for (const set of sets) {
        const ref = new Map(rd(path.join(replayDir, `${set}-reference.jsonl`)).map((r) => [r.id, r]));
        for (const it of rd(path.join(replayDir, `${set}-items.jsonl`))) {
          const r = ref.get(it.id);
          if (!r || r.excluded || !items.has(it.id)) continue;
          const x = items.get(it.id);
          rr.push({ id: it.id, lang: it.lang, cat: String(it.category).toUpperCase(), labels: r.labels, pred: x.pred, source: x.source, outcome: x.outcome });
        }
      }
      ok(JSON.stringify(score(rr).metrics) === JSON.stringify(logged), `replay ${label} reproduces the logged metrics`);
      results.replayed.push(label);
    }
  }
  console.log(JSON.stringify(results));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href && process.argv.includes('--self-test')) {
  const i = process.argv.indexOf('--replay');
  selfTest(i > 0 ? process.argv[i + 1] : null);
}
