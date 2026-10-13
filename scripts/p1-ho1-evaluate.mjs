#!/usr/bin/env node
// P1-CONTEXT-INTEL-01 (D-P1-14) — the one-shot evaluation of TS-1 + the need table SN-1 on the sealed held-out set HO-1
// (Task Contract v3.1 §10.1, AC3). Committed BEFORE the set is opened, on the frozen lexicon:
//
//   node scripts/p1-ho1-evaluate.mjs --set <heldout dir> --probe     field names, value types and counts only (no value)
//   node scripts/p1-ho1-evaluate.mjs --set <heldout dir>             the evaluation (run once)
//
// It verifies the sealed SHA-256 of the items and the reference before reading them, calls only the public `taskSignals`
// (governance) and `skillTier` (mind) outputs, and prints aggregate metrics only — never a message, a label of a specific
// item or an item id. It needs the built workspaces (`npm run build`). Nothing is written.
//
// Metrics (AC3). TASK_REQUIRED prediction vs the reference label, over the five task-dependent Skills; founder-partnership is
// TASK_REQUIRED in every Founder conversation by the approved need table (G2), so it is reported separately and, for
// transparency, also in six-Skill figures. Thresholds: recall micro >= 0.90 and >= 0.80 per Skill; precision micro >= 0.80;
// recall per language >= 0.85 with the best and worst language within 0.10; SIMPLE items: at most one task Skill, none with
// four or more Skills loaded (TASK_REQUIRED or SUPPORTING).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const SEAL = {
  'HO-1-items.jsonl': '7cab670fed26ede695d8ab0582b682b6b7fa89f030c2c6812a4c8089b2ac0b1d',
  'HO-1-reference.jsonl': '4c78c75be9bf602add9f53c622046ececcf8b685d396709e9fd1fc81de51d6d1',
};
const SKILLS = ['ceo.governance-discipline', 'ceo.founder-partnership', 'ceo.executive-judgment', 'ceo.evidence-and-economics', 'ceo.organization-leadership', 'ceo.cross-functional-synthesis'];
const TASK_SKILLS = SKILLS.filter((c) => c !== 'ceo.founder-partnership');
const PURPOSES = ['REQUEST', 'QUESTION', 'FYI', 'REVIEW', 'DECISION_REQUEST', 'BLOCKER', 'ESCALATION', 'RESULT', 'CORRECTION'];

const { values } = parseArgs({ strict: true, options: { set: { type: 'string' }, probe: { type: 'boolean', default: false } } });
const fail = (code, message) => {
  console.error(JSON.stringify({ ok: false, code, message }));
  process.exit(2);
};
if (!values.set) fail('USAGE', 'node scripts/p1-ho1-evaluate.mjs --set <heldout dir> [--probe]');

/** A sealed file, read only when its SHA-256 matches the seal. */
function sealed(name) {
  const buf = readFileSync(path.join(path.resolve(values.set), name));
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== SEAL[name]) fail('SEAL_MISMATCH', `${name} does not match its sealed SHA-256`);
  return buf.toString('utf8').split(/\r?\n/u).filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}
const items = sealed('HO-1-items.jsonl');
const reference = sealed('HO-1-reference.jsonl');

/** Field names and value types, recursively, without any value (strings show their kind only). */
function shape(v, depth = 0) {
  if (Array.isArray(v)) return depth > 3 ? 'array' : [v.length > 0 ? shape(v[0], depth + 1) : 'empty'];
  if (v !== null && typeof v === 'object') return depth > 3 ? 'object' : Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k], depth + 1)]));
  return v === null ? 'null' : typeof v;
}
if (values.probe) {
  const keys = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();
  console.log(JSON.stringify({ ok: true, mode: 'probe', items: { count: items.length, keys: keys(items), shape: shape(items[0]) }, reference: { count: reference.length, keys: keys(reference), shape: shape(reference[0]) } }, null, 1));
  process.exit(0);
}

// --- Field mapping (by name, decided before the set is read; a missing field stops before any metric) ----------------------
const pick = (o, names) => names.map((n) => o[n]).find((x) => x !== undefined);
const idOf = (o) => pick(o, ['id', 'itemId', 'item_id', 'key']);
const textOf = (o) => pick(o, ['text', 'message', 'body', 'content', 'prompt']);
const langOf = (o) => {
  const l = String(pick(o, ['lang', 'language', 'locale', 'variety']) ?? '').toLowerCase();
  return /eg|egy|masri|colloq/u.test(l) ? 'EG' : /msa|fus|standard|ar$|^ar-?sa/u.test(l) ? 'MSA' : /^en/u.test(l) ? 'EN' : l.toUpperCase() || 'UNKNOWN';
};
const categoryOf = (o) => String(pick(o, ['category', 'kind', 'type', 'class', 'complexity']) ?? '').toUpperCase();
const purposeOf = (o) => {
  const p = String(pick(o, ['purpose']) ?? '').toUpperCase();
  return PURPOSES.includes(p) ? p : 'QUESTION';
};
const normLabel = (x) => {
  const s = String(x ?? '').toUpperCase().replace(/[\s-]+/gu, '_');
  return s.startsWith('TASK_REQ') || s === 'REQUIRED' ? 'TASK_REQUIRED' : s.startsWith('SUPPORT') ? 'SUPPORTING' : s.startsWith('NOT') || s.startsWith('NON') ? 'NOT_NEEDED' : null;
};
/** The reference label of each Skill in one reference record, wherever it sits (a map by full or short code, or a list). */
function labelsOf(r) {
  const out = {};
  const visit = (v) => {
    if (Array.isArray(v)) {
      for (const e of v) {
        if (e && typeof e === 'object') {
          const code = String(pick(e, ['code', 'skill', 'skillCode', 'skill_code', 'name']) ?? '');
          const full = SKILLS.find((c) => c === code || c === `ceo.${code}`);
          const label = normLabel(pick(e, ['label', 'tier', 'need', 'value', 'decision']));
          if (full && label) out[full] = label;
          else visit(e);
        }
      }
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const full = SKILLS.find((c) => c === k || c === `ceo.${k}`);
        if (full && normLabel(x)) out[full] = normLabel(x);
        else if (x && typeof x === 'object') visit(x);
      }
    }
  };
  visit(r);
  return out;
}
const excludedOf = (r) => r.excluded === true || r.valid === false || /EXCLUDED|INVALID/u.test(String(r.status ?? r.validity ?? '').toUpperCase());

const refById = new Map(reference.map((r) => [String(idOf(r)), r]));
const rows = [];
for (const it of items) {
  const id = idOf(it);
  const text = textOf(it);
  if (id === undefined || typeof text !== 'string') fail('FIELD_MAPPING', 'an item has no id or text field the evaluator knows (run --probe)');
  const r = refById.get(String(id));
  if (!r || excludedOf(r)) continue;
  const labels = labelsOf(r);
  if (Object.keys(labels).length !== SKILLS.length) {
    if (Object.keys(labels).length === 0) continue; // an item the reference does not label (excluded)
    fail('FIELD_MAPPING', 'a reference record labels only some Skills (run --probe)');
  }
  rows.push({ text, lang: langOf(it), category: categoryOf(it) || categoryOf(r), purpose: purposeOf(it), labels });
}
if (rows.length === 0) fail('FIELD_MAPPING', 'no labelled item found (run --probe)');

// --- The frozen classifier, through its public outputs only ------------------------------------------------------------------
const gov = await import('@qandeel-company/governance');
const mind = await import('@qandeel-company/mind');
const predict = (row) => {
  const { signals } = gov.taskSignals({ text: row.text, purpose: row.purpose, executive: true });
  return Object.fromEntries(SKILLS.map((c) => [c, mind.skillTier(c, signals, 'founder.reply')]));
};

const tally = (skills) => {
  let tp = 0, fn = 0, fp = 0;
  const perSkill = Object.fromEntries(skills.map((s) => [s, { tp: 0, fn: 0, fp: 0 }]));
  const perLang = {};
  for (const row of rows) {
    const p = predict(row);
    for (const s of skills) {
      const want = row.labels[s] === 'TASK_REQUIRED', got = p[s] === 'TASK_REQUIRED';
      perLang[row.lang] ??= { tp: 0, fn: 0 };
      if (want && got) { tp++; perSkill[s].tp++; perLang[row.lang].tp++; }
      else if (want) { fn++; perSkill[s].fn++; perLang[row.lang].fn++; }
      else if (got) { fp++; perSkill[s].fp++; }
    }
  }
  const r3 = (a, b) => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);
  const langRecall = Object.fromEntries(Object.entries(perLang).map(([l, x]) => [l, r3(x.tp, x.tp + x.fn)]));
  const lr = Object.values(langRecall).filter((x) => x !== null);
  return {
    labels: tp + fn,
    recallMicro: r3(tp, tp + fn),
    precisionMicro: r3(tp, tp + fp),
    perSkill: Object.fromEntries(Object.entries(perSkill).map(([s, x]) => [s.replace('ceo.', ''), { recall: r3(x.tp, x.tp + x.fn), precision: r3(x.tp, x.tp + x.fp), referenceRequired: x.tp + x.fn, predictedRequired: x.tp + x.fp }])),
    perLanguageRecall: langRecall,
    languageGap: lr.length > 0 ? Math.round((Math.max(...lr) - Math.min(...lr)) * 1000) / 1000 : null,
  };
};

const primary = tally(TASK_SKILLS);
const six = tally(SKILLS);
const simple = rows.filter((r) => r.category.startsWith('SIMPLE'));
const simpleStats = simple.map((r) => {
  const p = predict(r);
  return { task: TASK_SKILLS.filter((s) => p[s] === 'TASK_REQUIRED').length, loaded: SKILLS.filter((s) => p[s] === 'TASK_REQUIRED' || p[s] === 'SUPPORTING').length };
});
const simpleOut = { items: simple.length, zeroTaskSkills: simpleStats.filter((x) => x.task === 0).length, atMostOne: simpleStats.filter((x) => x.task <= 1).length, loadsFourOrMore: simpleStats.filter((x) => x.loaded >= 4).length };

const perSkillOk = Object.values(primary.perSkill).every((x) => x.recall === null || x.recall >= 0.8);
const langOk = Object.values(primary.perLanguageRecall).every((x) => x === null || x >= 0.85) && (primary.languageGap ?? 0) <= 0.1;
const checks = {
  recallMicro: primary.recallMicro >= 0.9,
  recallPerSkill: perSkillOk,
  precisionMicro: primary.precisionMicro >= 0.8,
  languageParity: langOk,
  simpleAtMostOneTaskSkill: simpleOut.atMostOne === simpleOut.items,
  simpleNoneLoadsFour: simpleOut.loadsFourOrMore === 0,
};
console.log(JSON.stringify({
  ok: true,
  mode: 'evaluation',
  policy: { signals: gov.TASK_SIGNAL_POLICY, table: mind.SKILL_NEED_TABLE_VERSION },
  items: { evaluated: rows.length, byLanguage: Object.fromEntries(Object.entries(rows.reduce((m, r) => ({ ...m, [r.lang]: (m[r.lang] ?? 0) + 1 }), {}))), byCategory: Object.fromEntries(Object.entries(rows.reduce((m, r) => ({ ...m, [r.category || 'UNSPECIFIED']: (m[r.category || 'UNSPECIFIED'] ?? 0) + 1 }), {}))) },
  primaryFiveTaskSkills: primary,
  founderPartnership: six.perSkill['founder-partnership'],
  allSixSkills: { recallMicro: six.recallMicro, precisionMicro: six.precisionMicro },
  simple: simpleOut,
  checks,
  pass: Object.values(checks).every(Boolean),
}, null, 1));
