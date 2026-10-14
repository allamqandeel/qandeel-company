#!/usr/bin/env node
// G4-HO2-FINAL-01 (D-P1-15) — the content effect of Skill-need tiers on Context Assembly (CP-1), free and local: no
// provider, no network. The G4-C2-TIER-01 simulation (evidence corr-01/sna/TIER-01-cp1-simulation.mjs) made reusable so the
// HO-2 one-shot can measure it in the same process, from tiers held in memory only. Output: aggregate counts only (no id,
// no text, no per-item row).
//
// Through the REAL storage path (send → recorded Skill need → claimed run → assembled context → manifest) with Ahmed's six
// real Skill payloads (package v7), each message is sent: #1 with the reference tiers, #2 again (the NULL CONTROL: what
// changes only because the thread grew), #3 with the classifier's tiers; and, when the two differ by TASK_REQUIRED ↔
// SUPPORTING somewhere, #4 with ONLY those priority differences applied plus #5 the reference again. Two worlds: EMPTY and
// FULL (canonical truth, 40 knowledge items, 30 memories, a full 11,750-byte history: the 60K budget saturates).
//
//   node --conditions=qandeel-test scripts/p1-sna-cp1-effect.mjs --self-test
// Needs the built test helpers of packages/storage (npm run build).

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => new URL(`../packages/storage/dist/test/${p}`, import.meta.url).href;

// A broad Company vocabulary (EN / MSA / EG), so that knowledge and memory are relevant to most messages: the FULL world is
// meant to saturate the budget, not to test retrieval.
const VOCAB = 'launch budget cost money spend price pricing market markets saudi egypt gulf team hire hiring director growth product engineering brand users user data privacy approval approve decision decide plan plans priority priorities quarter risk evidence report results metrics campaign agency vendor investor partner security incident onboarding retention churn revenue runway burn roadmap feature release date delay week month company founder ceo strategy قرار الإطلاق الميزانية التكلفة السوق السعودي مصر الخليج الفريق تعيين المدير النمو المنتج الهندسة العلامة المستخدمين البيانات الخصوصية موافقة خطة أولويات المخاطر الأدلة تقرير النتائج الحملة الوكالة المستثمر الشريك الأمان الإيرادات الأسبوع الشهر الشركة المؤسس عايز عايزين محتاج ليه إزاي امتى هنعمل الصرف الفلوس الناس الموظفين اطلاق ميزانية سوق فريق'.split(' ');
const filler = (i, bytes) => {
  let s = `SYNTHETIC ${i}: ${VOCAB.join(' ')}. `;
  while (Buffer.byteLength(s) < bytes) s += `تفاصيل إضافية عن الخطة والفريق والسوق ${i}. Further detail on the plan, the team and the market. `;
  return s.slice(0, Math.floor(bytes / 2));
};
const setDiff = (a, b) => [...a].filter((x) => !b.has(x)).length;

/** data: [{ text, ref: {code: tier}, pred: {code: tier} }] over the six Skills (tiers already normalized). */
export async function cp1Effect(data) {
  const { harness } = await import(dist('helpers.js'));
  const { seed } = await import(dist('c2-helpers.js'));
  const { approvedSkill, assemble, claimFor, propose, workItem } = await import(dist('c3-helpers.js'));
  const { claimItem, placed } = await import(dist('c4-helpers.js'));
  const { assess, provisionSkillNeed } = await import(dist('sna-helpers.js'));
  const { CommunicationStore, MemoryStore, SkillStore } = await import('@qandeel-company/storage');
  const mind = await import('@qandeel-company/mind');
  const SKILLS = Object.keys(mind.SKILL_NEED_CARDS);
  const V7 = new Map(mind.CEO_ACADEMY_PACKAGE_V7.skills.map((s) => [s.code, s.instructions]));

  function world(kind) {
    const h = harness();
    const s = seed(h.store, { companyCap: 500_000_000 });
    const ceo = placed(h, s, 'company.ceo', 9_000_000);
    const reg = SkillStore.for(h.store);
    const versions = new Map();
    for (const code of SKILLS) {
      const { version } = approvedSkill(h, s, code, { instructions: V7.get(code) });
      reg.openPassportEntry(s.founder, ceo.id, version.id);
      versions.set(version.id, code);
    }
    provisionSkillNeed(s, ceo.id);
    const comm = CommunicationStore.for(h.store);
    const thread = comm.directThread(s.founder, null).id;
    if (kind === 'FULL') {
      const mem = MemoryStore.for(h.store);
      for (let i = 0; i < 3; i++) mem.recordCanonicalTruth(s.founder, { level: 'POLICY', topic: `company.policy${i}`, statement: filler(i, 3_800), dataClass: 'D1', sourceRef: 'authority:synthetic' });
      for (let i = 0; i < 40; i++) mem.recordKnowledge(s.founder, { scope: 'COMPANY', topic: `company.k${i}`, content: filler(100 + i, 7_800), dataClass: 'D1' });
      const { claim } = claimFor(h, workItem(h, s, ceo, { instructions: 'SYNTHETIC: notes' }), 'w-mem');
      for (let i = 0; i < 30; i++) propose(h, claim, i + 1, { topic: `company.m${i}`, content: filler(200 + i, 3_600), confidencePct: 90 });
    }
    let n = 0;
    const run = (text, tiers) => {
      n++;
      // FULL: twelve identical long turns before every measured message, so its history is full and the same for every
      // comparison (no drift from earlier measured sends).
      if (kind === 'FULL') for (let i = 0; i < 12; i++) comm.send(s.founder, thread, { purpose: 'FYI', body: `SYNTHETIC ${i}: ${'ملاحظة سابقة عن خطة الشركة والفريق والإطلاق والميزانية والسوق. '.repeat(40)}`.slice(0, 1_200) });
      const reply = comm.send(s.founder, thread, { purpose: 'QUESTION', body: text }).replyWorkItemId;
      assess(h, reply, tiers, `w-sna-${n}`);
      const claim = claimItem(h, reply, `w-${n}`);
      const ctx = assemble(h, claim, 0);
      const es = MemoryStore.for(h.store).manifestEntries(ctx.manifestId);
      const m = MemoryStore.for(h.store).manifest(ctx.manifestId);
      const sel = es.filter((e) => e.decision === 'SELECTED');
      return {
        outcome: ctx.outcome,
        used: m.usedTokens,
        skills: sel.filter((e) => e.itemKind === 'SKILL').sort((a, b) => a.ordinal - b.ordinal).map((e) => versions.get(e.itemId)),
        knowledge: new Set(sel.filter((e) => e.itemKind === 'KNOWLEDGE').map((e) => e.itemId)),
        memory: new Set(sel.filter((e) => e.itemKind === 'MEMORY' || e.itemKind === 'SUMMARY').map((e) => e.itemId)),
      };
    };
    return { run, close: () => h.close() };
  }

  function simulate(kind) {
    const w = world(kind);
    const agg = { kind, messages: 0, tierMismatchMessages: 0, referenceRequiredSkills: 0, referenceRequiredNotLoaded: 0, classifierRequiredNotLoaded: 0, loadedSkillSetDiffers: 0, onlyOrderDiffers: 0, setCause: {}, controlKnowledgeDrift: 0, controlMemoryDrift: 0, knowledgeDisplaced: 0, memoryDisplaced: 0, usedMin: Infinity, usedMax: 0, outcomes: {}, priorityOnly: { messages: 0, loadedSkillSetDiffers: 0, onlyOrderDiffers: 0, requiredNotLoaded: 0, knowledgeDisplaced: 0, memoryDisplaced: 0, controlKnowledgeDrift: 0, controlMemoryDrift: 0, usedDeltaMax: 0 } };
    for (const d of data) {
      const r1 = w.run(d.text, d.ref);
      const r2 = w.run(d.text, d.ref);
      const p3 = w.run(d.text, d.pred);
      agg.messages++;
      if (SKILLS.some((s) => d.ref[s] !== d.pred[s])) agg.tierMismatchMessages++;
      for (const s of SKILLS) {
        if (d.ref[s] !== 'TASK_REQUIRED') continue;
        agg.referenceRequiredSkills++;
        if (!r2.skills.includes(s)) agg.referenceRequiredNotLoaded++;
        if (!p3.skills.includes(s)) agg.classifierRequiredNotLoaded++;
      }
      if ([...r2.skills].sort().join() !== [...p3.skills].sort().join()) {
        agg.loadedSkillSetDiffers++;
        for (const s of SKILLS) {
          if (r2.skills.includes(s) && !p3.skills.includes(s)) agg.setCause[`missing:${d.ref[s]}->${d.pred[s]}`] = (agg.setCause[`missing:${d.ref[s]}->${d.pred[s]}`] ?? 0) + 1;
          if (!r2.skills.includes(s) && p3.skills.includes(s)) agg.setCause[`extra:${d.ref[s]}->${d.pred[s]}`] = (agg.setCause[`extra:${d.ref[s]}->${d.pred[s]}`] ?? 0) + 1;
        }
      } else if (r2.skills.join() !== p3.skills.join()) agg.onlyOrderDiffers++;
      // Priority-only: the reference with ONLY its TASK_REQUIRED ↔ SUPPORTING differences set to the classifier's tiers.
      const prio = SKILLS.filter((s) => d.ref[s] !== d.pred[s] && [d.ref[s], d.pred[s]].every((t) => t !== 'NON_RELEVANT'));
      if (prio.length > 0) {
        const x = w.run(d.text, { ...d.ref, ...Object.fromEntries(prio.map((s) => [s, d.pred[s]])) });
        const r5 = w.run(d.text, d.ref);
        const p = agg.priorityOnly;
        p.messages++;
        if ([...r5.skills].sort().join() !== [...x.skills].sort().join()) p.loadedSkillSetDiffers++;
        else if (r5.skills.join() !== x.skills.join()) p.onlyOrderDiffers++;
        for (const s of SKILLS) if (d.ref[s] === 'TASK_REQUIRED' && !x.skills.includes(s)) p.requiredNotLoaded++;
        p.knowledgeDisplaced += setDiff(r5.knowledge, x.knowledge);
        p.memoryDisplaced += setDiff(r5.memory, x.memory);
        p.controlKnowledgeDrift += setDiff(r2.knowledge, r5.knowledge);
        p.controlMemoryDrift += setDiff(r2.memory, r5.memory);
        p.usedDeltaMax = Math.max(p.usedDeltaMax, Math.abs(r5.used - x.used));
      }
      agg.controlKnowledgeDrift += setDiff(r1.knowledge, r2.knowledge);
      agg.controlMemoryDrift += setDiff(r1.memory, r2.memory);
      agg.knowledgeDisplaced += setDiff(r2.knowledge, p3.knowledge);
      agg.memoryDisplaced += setDiff(r2.memory, p3.memory);
      for (const r of [r2, p3]) {
        agg.usedMin = Math.min(agg.usedMin, r.used);
        agg.usedMax = Math.max(agg.usedMax, r.used);
        agg.outcomes[r.outcome] = (agg.outcomes[r.outcome] ?? 0) + 1;
      }
    }
    w.close();
    if (agg.messages === 0) agg.usedMin = 0;
    return agg;
  }

  const t0 = Date.now();
  const EMPTY = simulate('EMPTY');
  const FULL = simulate('FULL');
  return { skillBytesTotal: SKILLS.reduce((a, s) => a + Buffer.byteLength(V7.get(s)), 0), EMPTY, FULL, ms: Date.now() - t0 };
}

// ------------------------------------------------------------------------------------------------------------ self-test
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href && process.argv.includes('--self-test')) {
  const mind = await import('@qandeel-company/mind');
  const SKILLS = Object.keys(mind.SKILL_NEED_CARDS);
  const all = (t, over = {}) => ({ ...Object.fromEntries(SKILLS.map((s) => [s, t])), ...over });
  const GOV = 'ceo.governance-discipline', EXEC = 'ceo.executive-judgment', XFN = 'ceo.cross-functional-synthesis';
  // Synthetic only: identical tiers, a priority-only difference, a required Skill excluded, an extra SUPPORTING Skill.
  const data = [
    { text: 'SYNTHETIC: should we approve the vendor contract this week?', ref: all('NON_RELEVANT', { [GOV]: 'TASK_REQUIRED' }), pred: all('NON_RELEVANT', { [GOV]: 'TASK_REQUIRED' }) },
    { text: 'SYNTHETIC: challenge my launch plan and the date.', ref: all('NON_RELEVANT', { [EXEC]: 'SUPPORTING', [XFN]: 'TASK_REQUIRED' }), pred: all('NON_RELEVANT', { [EXEC]: 'TASK_REQUIRED', [XFN]: 'TASK_REQUIRED' }) },
    { text: 'SYNTHETIC: هنعمل ايه في ميزانية الحملة؟', ref: all('NON_RELEVANT', { [XFN]: 'TASK_REQUIRED', [GOV]: 'SUPPORTING' }), pred: all('NON_RELEVANT', { [GOV]: 'SUPPORTING' }) },
    { text: 'SYNTHETIC: thanks, noted.', ref: all('NON_RELEVANT'), pred: all('NON_RELEVANT', { [EXEC]: 'SUPPORTING' }) },
  ];
  const r = await cp1Effect(data);
  const fail = (what) => {
    console.error(JSON.stringify({ selfTest: 'FAIL', what, r }));
    process.exit(1);
  };
  for (const w of [r.EMPTY, r.FULL]) {
    if (w.messages !== 4 || w.tierMismatchMessages !== 3) fail(`${w.kind}: counts`);
    if (w.referenceRequiredSkills !== 3 || w.referenceRequiredNotLoaded !== 0 || w.classifierRequiredNotLoaded !== 1) fail(`${w.kind}: the excluded required Skill is the only one not loaded`);
    if (w.loadedSkillSetDiffers !== 2 || w.setCause['missing:TASK_REQUIRED->NON_RELEVANT'] !== 1 || w.setCause['extra:NON_RELEVANT->SUPPORTING'] !== 1) fail(`${w.kind}: set causes`);
    if (w.priorityOnly.messages !== 1 || w.priorityOnly.loadedSkillSetDiffers !== 0 || w.priorityOnly.requiredNotLoaded !== 0) fail(`${w.kind}: a priority-only difference keeps the loaded set`);
    if (w.controlKnowledgeDrift !== 0 || w.controlMemoryDrift !== 0 || w.outcomes.OK !== 8) fail(`${w.kind}: control drift / outcomes`);
  }
  if (r.FULL.usedMin < 50_000) fail('FULL world saturates the 60K budget');
  console.log(JSON.stringify({ selfTest: 'SYNTHETIC_OK', EMPTY: { used: [r.EMPTY.usedMin, r.EMPTY.usedMax] }, FULL: { used: [r.FULL.usedMin, r.FULL.usedMax], knowledgeDisplaced: r.FULL.knowledgeDisplaced, memoryDisplaced: r.FULL.memoryDisplaced, priorityOnly: r.FULL.priorityOnly }, ms: r.ms }));
}
