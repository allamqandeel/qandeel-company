/**
 * L1-02 — "Activate the Company" (تفعيل الشركة): the first real CEO's production path in the command palette.
 *
 * It renders the durable activation view only (no client state survives a refresh): the stages, the CEO seat and its
 * holder ([portrait] name / title from the seat — presentation, never authority), the provider, the Academy package
 * with its static security reviews and bounded benchmark (each answer readable), the enrollment with every attempt's
 * real answer for the Founder evaluator, shadow work, probation, calibration and the activation request. Every act is a
 * structured preview of the governed confirmation: nothing changes until the Founder confirms its exact fingerprint.
 */
import { dirOf, fmtMoneyMicros, hasArabic, humanize } from '../model/format.js';
import { h, type PanelHost } from './panels.js';

type Json = Record<string, unknown>;

const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const content = (tag: string, text: string, cls = ''): HTMLElement => {
  const e = h(tag, { class: `${cls} content ${hasArabic(text) ? 'is-arabic' : ''}`.trim(), text });
  e.dir = dirOf(text);
  if (hasArabic(text)) e.lang = 'ar';
  return e;
};
const btn = (text: string, onClick: () => void, primary = false): HTMLElement => {
  const b = h('button', { type: 'button', class: primary ? 'btn btn-primary' : 'btn btn-quiet', text });
  b.addEventListener('click', onClick);
  return b;
};
const pill = (text: string, cls = ''): HTMLElement => h('span', { class: `pill ${cls}`.trim(), text });
const WORK_DONE = ['COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED'];

/** The next step in the Founder's words (English, Arabic). */
const NEXT: Readonly<Record<string, readonly [string, string]>> = {
  PROVISION_PROVIDER: ['Provision the model provider (identity check first)', 'تجهيز مزوّد النماذج'],
  NO_CEO_SEAT: ['No CEO seat exists', 'لا يوجد مقعد للرئيس التنفيذي'],
  HIRE_CEO: ['Hire the CEO into the vacant seat', 'تعيين الرئيس التنفيذي'],
  START_TRAINING: ['Start the CEO\'s training', 'بدء التدريب'],
  GRANT_MODEL_ACCESS: ['Open the CEO\'s bounded envelope and model access', 'فتح الميزانية والوصول المحدود للنموذج'],
  QUALIFY_PACKAGE: ['Qualify the CEO Academy package (security review + bounded benchmark)', 'تأهيل حزمة الأكاديمية'],
  BENCHMARK_RUNNING: ['The skill benchmark is running', 'اختبار المهارات قيد التشغيل'],
  INSTALL_PACKAGE: ['Install the qualified package (one decision)', 'تثبيت الحزمة المؤهلة'],
  BENCHMARK_UNCLASSIFIED_NO_ANSWER: ['A benchmark observation ended without an answer for an unexplained cause — qualification is blocked (never re-run as infrastructure)', 'ملاحظة اختبار انتهت دون إجابة لسبب غير مصنَّف — التأهيل متوقف (لا تُعاد كعطل بنية)'],
  PACKAGE_NOT_QUALIFIED: ['A skill did not qualify — the package cannot be installed', 'مهارة لم تتأهل — لا يمكن التثبيت'],
  ENROLL: ['Enroll the CEO in the Academy', 'التسجيل في الأكاديمية'],
  COMPLETE_MODULES: ['Acknowledge the curriculum modules', 'إقرار وحدات المنهج'],
  START_SIMULATION: ['Start a practice simulation', 'بدء محاكاة تدريبية'],
  START_ASSESSMENT: ['Start an assessment (and the hidden holdout)', 'بدء التقييم'],
  ATTEMPT_RUNNING: ['The attempt is running', 'المحاولة قيد التشغيل'],
  EVALUATE_ATTEMPT: ['Read the answer and score it', 'اقرأ الإجابة وقيّمها'],
  COMPLETE_RETRAINING: ['Diagnosis recorded — confirm the targeted retraining', 'تأكيد إعادة التدريب'],
  START_RETEST: ['Re-test after retraining', 'إعادة الاختبار'],
  ASSIGN_SHADOW_WORK: ['Assign the shadow work (launch-readiness brief)', 'إسناد العمل الظلي'],
  SHADOW_RUNNING: ['The shadow work is running', 'العمل الظلي قيد التشغيل'],
  RECORD_PROBATION_EVIDENCE: ['Read the brief and record probation evidence', 'تسجيل أدلة فترة الاختبار'],
  PROBATION_REVIEW: ['Decide the probation review', 'قرار مراجعة فترة الاختبار'],
  CERTIFICATION_WAITING: ['Certification is waiting on its evidence', 'الشهادة بانتظار الأدلة'],
  FOUNDER_CALIBRATION: ['Founder Calibration (your judgment of the CEO)', 'معايرة المؤسس'],
  MOVE_TO_PROBATION: ['Move the trainee to probation before activation', 'نقل المتدرب إلى فترة الاختبار'],
  DECIDE_ACTIVATION: ['Decide the activation', 'قرار التفعيل'],
  TALK_TO_CEO: ['The CEO is active — talk to the CEO', 'الرئيس التنفيذي نشط — تحدث معه'],
  BLOCKED: ['The Academy path is blocked (repeated critical failure)', 'مسار الأكاديمية متوقف'],
};

const STAGES: readonly [string, string][] = [
  ['Provider ready', 'المزوّد جاهز'],
  ['CEO hired (candidate)', 'تعيين المرشح'],
  ['Training + model access', 'التدريب والوصول'],
  ['Package qualified', 'تأهيل الحزمة'],
  ['Package installed', 'تثبيت الحزمة'],
  ['Academy', 'الأكاديمية'],
  ['Shadow / probation', 'العمل الظلي'],
  ['Certified', 'الشهادة'],
  ['Calibration', 'المعايرة'],
  ['Active', 'نشط'],
];

/** D-L1-19: the current package is the newest registered version; earlier versions are immutable history, shown read-only. */
function newest(list: Json[]): Json | undefined {
  return [...list].sort((a, b) => Number(b.version) - Number(a.version))[0];
}

function stagesDone(v: Json): number {
  const ceo = v.ceo as Json | null;
  const pkg = newest(arr(v.packages));
  const rec = (pkg?.record as Json | null) ?? null;
  const en = v.enrollment as Json | null;
  const stage = str(en?.stage);
  const marks = [
    (v.provider as Json).provisioned === true,
    ceo !== null,
    ceo !== null && ceo.state !== 'CANDIDATE' && arr(v.modelAccess).length > 0,
    pkg?.installable === true || rec?.state === 'INSTALLED',
    rec?.state === 'INSTALLED',
    ['SHADOW_WORK', 'PROBATION_REVIEW', 'CERTIFICATION', 'ACTIVATION_APPROVAL', 'ACTIVATED'].includes(stage),
    ['CERTIFICATION', 'ACTIVATION_APPROVAL', 'ACTIVATED'].includes(stage),
    (en?.certification as Json | null)?.status === 'VALID',
    (en?.calibration as Json | null)?.state === 'APPROVED',
    ceo?.state === 'ACTIVE',
  ];
  let n = 0;
  while (n < marks.length && marks[n]) n++;
  return n;
}

function identityCard(ceo: Json): HTMLElement {
  const name = str(ceo.name);
  const portrait = ceo.portraitAssetRef ? h('div', { class: 'act-portrait', 'aria-label': 'Portrait' }) : h('div', { class: 'act-portrait act-portrait-pending', 'aria-label': 'Portrait pending', text: name.split(/\s+/).map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase() });
  const lines = h('div', { class: 'act-identity-lines' }, h('strong', { text: name }));
  if (ceo.displayNameAr) lines.append(content('div', str(ceo.displayNameAr), 'act-name-ar'));
  lines.append(h('div', { class: 'muted small', text: `${str(ceo.jobTitle)} · ${humanize(str(ceo.state))}` }));
  return h('div', { class: 'act-identity' }, portrait, lines);
}

function answerBlock(answer: Json | null, label: string): HTMLElement {
  if (!answer) return h('p', { class: 'muted small', text: 'No answer recorded.' });
  const facets = (answer.facets as Json) ?? {};
  const details = h('details', { class: 'act-answer' }, h('summary', { text: label }));
  details.append(content('div', str(answer.body), 'act-answer-body'));
  details.append(h('p', { class: 'muted small', text: `Decision ${humanize(str(facets.decision))} · reversible ${facets.reversible ? 'yes' : 'no'} · authority ${humanize(str(facets.authority))} · evidence ${humanize(str(facets.evidence))} · confidence ${humanize(str(facets.confidence))} · Founder decision ${facets.founderDecisionNeeded ? 'needed' : 'not needed'} · proposed spend ${str(facets.spendMicros)} micro-units` }));
  return details;
}

function checks(result: Json | null): string {
  if (!result) return 'not scored';
  return `${str(result.scorePct)}% ${result.passed ? 'pass' : 'fail'} (${arr(result.checks).map((c) => `${str(c.key)} ${c.passed ? '✓' : '✗'}${c.critical ? '*' : ''}`).join(', ')})`;
}

export function renderActivation(data: Json, host: PanelHost): HTMLElement {
  const v = (data.view as Json) ?? {};
  const reg = (data.registry as Json) ?? {};
  const pkgReg = newest(arr(reg.packages));
  const pkgArgs = pkgReg ? { packageCode: str(pkgReg.code), packageVersion: Number(pkgReg.version), packageSha256: str(pkgReg.sha256) } : null;
  const section = h('section', { class: 'pilots activation', 'aria-label': 'Activate the Company' });
  section.append(h('h3', { class: 'section-title' }, 'Activate the Company · ', content('span', 'تفعيل الشركة')));
  const next = str(v.next);
  const [en, ar] = NEXT[next] ?? [humanize(next), ''];
  section.append(h('p', { class: 'act-next' }, pill('Next', 'pill-needs_decision'), ' ', h('span', { text: en }), ' ', ar ? content('span', `· ${ar}`) : ''));
  const done = stagesDone(v);
  const ol = h('ol', { class: 'act-stages' });
  STAGES.forEach(([s, a], i) => ol.append(h('li', { class: i < done ? 'done' : i === done ? 'current' : '' }, h('span', { text: s }), ' ', content('span', a, 'muted small'))));
  section.append(ol);
  section.append(h('p', { class: 'muted small', text: 'Every step below is a structured preview: nothing changes until you confirm it. External side-effect capability: none.' }));

  // --- Provider -------------------------------------------------------------------------------------------------------
  const provider = (v.provider as Json) ?? {};
  const company = v.companyBudget as Json | null;
  const prov = h('div', { class: 'pilot' }, h('strong', { text: 'Model provider' }), ' ', pill(provider.provisioned ? `Provisioned (${str(provider.status)})` : 'Not provisioned'));
  if (company) prov.append(h('p', { class: 'muted small', text: `Company cap ${fmtMoneyMicros(Number(company.capMoney), str(company.currency))} · spent ${fmtMoneyMicros(Number(company.spentMoney), str(company.currency))} · reserved ${fmtMoneyMicros(Number(company.reservedMoney), str(company.currency))} · routed task classes: ${arr(provider.routedTaskClasses).join(', ')}` }));
  if (!provider.provisioned) {
    for (const p of arr((reg.providers as Json | undefined)?.profiles)) {
      const check = (p.latestCheck as Json | null) ?? null;
      const line = h('p', { class: 'muted small', text: `${str(p.code)}: ${str(p.deployments)} deployments, task classes ${arr(p.taskClasses).join(', ')}. Identity check: ${check ? `${str(check.result)} (${str(check.observedName)})` : 'none yet — run “qandeel-founder provider-check --provider deepseek” on the host'}.` });
      prov.append(line);
      if (check?.result === 'MATCH') {
        const form = h('form', { class: 'pilot-create' });
        const cap = h('input', { type: 'number', min: '0.01', step: '0.01', value: '1', 'aria-label': `Company cap in ${str(p.currency)}`, required: true }) as HTMLInputElement;
        form.append(h('label', { class: 'muted small', text: `Company cap (${str(p.currency)}, hard, no automatic top-up)` }), cap, h('button', { type: 'submit', class: 'btn btn-quiet', text: `Preview: provision ${str(p.code)}` }));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const micros = Math.round(Number(cap.value) * 1_000_000);
          if (Number.isSafeInteger(micros) && micros > 0) void host.previewAction('PROVIDER_PROVISION', { profileCode: str(p.code), profileSha256: str(p.sha256), capMoney: micros, capTokens: Math.max(1_000_000, micros * 20) });
        });
        prov.append(form);
      }
    }
  }
  section.append(prov);

  // --- The CEO seat and its holder ------------------------------------------------------------------------------------
  const seat = v.seat as Json | null;
  const ceo = v.ceo as Json | null;
  const seatBox = h('div', { class: 'pilot' }, h('strong', { text: 'CEO seat' }), ' ', pill(seat ? str(seat.title) : 'missing'));
  if (ceo) seatBox.append(identityCard(ceo));
  if (seat && !ceo && provider.provisioned) {
    const form = h('form', { class: 'pilot-create act-hire' });
    const given = h('input', { type: 'text', placeholder: 'Given name (Latin)', 'aria-label': 'Given name', required: true, maxlength: 40 }) as HTMLInputElement;
    const family = h('input', { type: 'text', placeholder: 'Family name (Latin)', 'aria-label': 'Family name', required: true, maxlength: 40 }) as HTMLInputElement;
    const arName = h('input', { type: 'text', placeholder: 'الاسم بالعربية', 'aria-label': 'Arabic display name', dir: 'rtl', maxlength: 60 }) as HTMLInputElement;
    const ident = h('select', { 'aria-label': 'Identity profile' }) as HTMLSelectElement;
    ident.append(h('option', { value: '', text: 'No identity profile' }));
    for (const i of arr(reg.identities)) if (str(i.roleRef) === str(seat.roleRef)) ident.append(h('option', { value: str(i.code), text: `${str(i.code)} (${str(i.sourceRef)})` }));
    if (ident.options.length > 1) ident.selectedIndex = 1;
    form.append(h('label', { class: 'muted small', text: 'The CEO\'s name is your decision. The hire is a CANDIDATE: no authority, no budget, not active.' }), given, family, arName, ident, h('button', { type: 'submit', class: 'btn btn-quiet', text: 'Preview: hire' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void host.previewAction('EMPLOYEE_HIRE', { positionId: str(seat.positionId), givenName: given.value.trim(), familyName: family.value.trim(), ...(arName.value.trim() ? { displayNameAr: arName.value.trim() } : {}), ...(ident.value ? { identityProfileCode: ident.value } : {}) });
    });
    seatBox.append(form);
  }
  if (ceo?.state === 'CANDIDATE') seatBox.append(h('div', { class: 'pilot-actions' }, btn('Preview: start training (CANDIDATE → TRAINING)', () => void host.previewAction('EMPLOYEE_LIFECYCLE', { employeeId: str(ceo.employeeId), to: 'TRAINING' }))));
  const envelope = v.envelope as Json | null;
  if (ceo && ceo.state !== 'CANDIDATE') {
    seatBox.append(h('p', { class: 'muted small', text: envelope ? `Envelope ${fmtMoneyMicros(Number(envelope.capMoney), str(envelope.currency))} · spent ${fmtMoneyMicros(Number(envelope.spentMoney), str(envelope.currency))} · reserved ${fmtMoneyMicros(Number(envelope.reservedMoney), str(envelope.currency))} · model access: ${arr(v.modelAccess).join(', ') || 'none'}` : 'No envelope and no model access yet.' }));
    const wanted = pkgReg ? [...Object.values((pkgReg.taskClasses as Json) ?? {}).map(str), 'founder.reply', 'founder.brief'] : ['founder.reply', 'founder.brief'];
    const missing = wanted.filter((c) => !arr(v.modelAccess).map(str).includes(c));
    if ((!envelope || missing.length > 0) && ceo.state !== 'ACTIVE') {
      const form = h('form', { class: 'pilot-create' });
      const cap = h('input', { type: 'number', min: '0.01', step: '0.01', value: '0.5', 'aria-label': 'Envelope', required: !envelope }) as HTMLInputElement;
      form.append(h('label', { class: 'muted small', text: `Hard envelope (USD; L1-02 bound: 0.50) and R0 model access up to D2 for: ${missing.join(', ')}` }), cap, h('button', { type: 'submit', class: 'btn btn-quiet', text: 'Preview: model access' }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const micros = Math.round(Number(cap.value) * 1_000_000);
        void host.previewAction('EMPLOYEE_MODEL_ACCESS', { employeeId: str(ceo.employeeId), capMoney: micros, taskClasses: missing, dataClassCeiling: 'D2' });
      });
      seatBox.append(form);
    }
  }
  if (ceo?.state === 'ACTIVE') seatBox.append(h('div', { class: 'pilot-actions' }, btn(`Talk to ${str(ceo.name)}`, () => host.startConversation(null), true)));
  section.append(seatBox);

  // --- The Academy package --------------------------------------------------------------------------------------------
  const pkg = arr(v.packages).find((p) => p.code === pkgReg?.code && Number(p.version) === Number(pkgReg?.version));
  if (pkgReg && pkgArgs && ceo && ceo.state !== 'CANDIDATE') {
    const rec = (pkg?.record as Json | null) ?? null;
    const box = h('div', { class: 'pilot' }, h('strong', { text: `Academy package ${str(pkgReg.code)} v${str(pkgReg.version)}` }), ' ', pill(rec ? humanize(str(rec.state)) : 'not qualified'));
    for (const old of arr(v.packages).filter((p) => p !== pkg && p.record)) {
      box.append(h('p', { class: 'muted small', text: `Earlier version v${str(old.version)} (digest ${str(old.sha256).slice(0, 12)}…): ${humanize(str((old.record as Json).state))}, ${old.installable ? 'installable' : 'not installable'}, benchmark method ${str((old.method as Json | undefined)?.version ?? 'BQM-1')} — kept unchanged as history; its package result never counts for another version (a Skill Version it qualified on its own evidence may be reused, shown per Skill).` }));
    }
    box.append(h('p', { class: 'muted small', text: `Digest ${str(pkgReg.sha256).slice(0, 16)}… · ${arr(pkgReg.skills).length} skills · ${arr(pkgReg.scenarios).length} scenarios · calibration ${pkgReg.founderCalibrationRequired ? 'required' : 'not required'} · benchmark spent ${fmtMoneyMicros(Number(pkg?.spentMicros ?? 0), 'USD')}` }));
    // D-L1-23: the benchmark method the evidence is (or would be) produced under — never inferred, always the declared one.
    const method = (pkg?.method as Json | undefined) ?? {};
    const k = Number(method.observationsPerArm ?? 1);
    const ac = (method.answerContract as Json | null) ?? null;
    box.append(h('p', { class: 'muted small', text: method.version === 'BQM-2' ? `Current candidate under benchmark method BQM-2 (declaration ${str(method.declarationSha256).slice(0, 12)}…): ${k} observations per case and arm, all at ${str(method.reasoningClass)}, rubric ${str(method.rubricVersion)}, ANSWER contract ${str(ac?.version)} (${str(ac?.sha256).slice(0, 12)}…)` : 'Benchmark method BQM-1 (one observation per case and arm, rubric R1) — frozen history' }));
    for (const s of arr(pkg?.skills)) {
      const verdict = (s.verdict as Json) ?? {};
      const sec = s.security as Json | null;
      const sb = h('details', { class: 'act-skill' }, h('summary', {}, h('strong', { text: str(s.name) }), ' ', pill(humanize(str(s.pipelineState))), ' ', h('span', { class: 'muted small', text: `security ${sec ? (sec.passed ? 'passed (static, deterministic)' : 'FAILED') : '—'} · benchmark ${str(verdict.withPct)}% with vs ${str(verdict.baselinePct)}% baseline → ${humanize(str(verdict.reason))}` })));
      // D-L1-27: how the package binds the Skill, and the Skill Version's own qualification (never the package's outcome).
      const q = (s.qualification as Json | undefined) ?? {};
      const src = (q.sourcePackage as Json | null) ?? null;
      sb.append(h('p', { class: 'muted small', text: s.binding === 'REUSE_QUALIFIED' ? `Reused qualified Skill Version (no new version, review or benchmark) — qualified in ${str(src?.code)} v${str(src?.version)}; fingerprint ${str(q.fingerprint).slice(0, 12)}… · ${s.bindingValid ? 'binding valid' : 'binding NO LONGER VALID'}` : `Skill Version qualification: ${q.status === 'QUALIFIED' ? 'QUALIFIED on its own evidence (reusable by a later package)' : `not qualified (${humanize(str(q.reason))})`}` }));
      // BQM-2: each case's layered verdict (passes of 5 per arm; failed layers; forbidden hits) and its N1 comparison.
      for (const c of arr(verdict.cases)) sb.append(h('p', { class: 'small', text: `${str(c.caseCode)}: with skill ${str(c.withPasses)}/${k} vs baseline ${str(c.baselinePasses)}/${k} · ${c.absolutePassed ? 'absolute rule met' : `failed: ${arr(c.failedLayers as unknown as Json[]).map((l) => humanize(String(l))).join(', ')}`}${Number(c.forbiddenHits ?? 0) > 0 ? ` · ${str(c.forbiddenHits)} forbidden hit(s)` : ''} · comparison ${c.comparePassed ? 'within tolerance' : 'WORSE than baseline'}` }));
      for (const r of arr(s.runs)) {
        sb.append(h('p', { class: 'muted small', text: `${str(r.caseCode)} · ${r.arm === 'WITH_SKILL' ? 'with skill' : 'baseline'}${k > 1 ? ` · observation ${str(r.observationNo)}` : ''} · ${humanize(str(r.workItemState))}${r.outcome === 'INVALID_OUTPUT' ? ' · two invalid outputs (failed observation)' : r.outcome === 'UNCLASSIFIED_NO_ANSWER' ? ' · no answer, unclassified cause (blocks qualification)' : ''}${r.answeredClass ? ` · ${str(r.answeredClass)}` : ''} · ${checks((r.result as Json | null) ?? null)}` }));
        if (r.answer) sb.append(answerBlock(r.answer as Json, 'Read the answer'));
      }
      box.append(sb);
    }
    const actions = h('div', { class: 'pilot-actions' });
    if (!rec) actions.append(btn('Preview: qualify (security review + bounded benchmark)', () => void host.previewAction('SKILL_PACKAGE_QUALIFY', { ...pkgArgs, subjectEmployeeId: str(ceo.employeeId) }), true));
    if (rec?.state === 'QUALIFYING' && pkg?.installable === true) actions.append(btn('Preview: install (one decision)', () => void host.previewAction('ACADEMY_PACKAGE_INSTALL', pkgArgs), true));
    // D-L1-21: finished answered runs to finalize (OPEN) or cases without a live run (VOID) — never a scored case.
    const pending = arr(pkg?.skills).some((s) => arr(s.runs).some((r) => r.state === 'OPEN') || (s.pipelineState === 'SANDBOXED' && arr(s.runs).length < 2 * k * Number(arr(pkgReg.skills).find((d) => d.code === s.code)?.cases ?? 0)));
    if (rec?.state === 'QUALIFYING' && Number(pkg?.benchmarkRunsOpen ?? 0) === 0 && pkg?.installable !== true && pending) actions.append(btn('Preview: finalize benchmark scores / re-run void cases', () => void host.previewAction('SKILL_PACKAGE_QUALIFY', { ...pkgArgs, subjectEmployeeId: str(ceo.employeeId) })));
    if (rec?.state === 'INSTALLED' && !v.enrollment) actions.append(btn('Preview: enroll in the Academy', () => void host.previewAction('ACADEMY_ENROLL', { ...pkgArgs, employeeId: str(ceo.employeeId) }), true));
    box.append(actions);
    section.append(box);
  }

  // --- The enrollment -------------------------------------------------------------------------------------------------
  const enr = v.enrollment as Json | null;
  if (enr && ceo && pkgArgs) {
    const stage = str(enr.stage);
    const box = h('div', { class: 'pilot' }, h('strong', { text: 'Academy' }), ' ', pill(humanize(stage)));
    box.append(h('p', { class: 'muted small', text: `History: ${arr(enr.history).map((x) => humanize(str(x.toStage))).join(' → ')}` }));
    const modules = arr(enr.modules);
    const openModules = (cat: (c: string) => boolean): string[] => modules.filter((m) => !m.done && cat(str(m.category))).map((m) => str(m.code));
    if (stage === 'LEARN' && openModules((c) => c !== 'REAL_CASE_STUDIES').length > 0) box.append(h('div', { class: 'pilot-actions' }, btn('Preview: acknowledge the curriculum modules', () => void host.previewAction('ACADEMY_MODULES_COMPLETE', { enrollmentId: str(enr.id), moduleCodes: openModules((c) => c !== 'REAL_CASE_STUDIES') }))));
    if (stage === 'CASE_STUDIES') box.append(h('div', { class: 'pilot-actions' }, btn('Preview: acknowledge the case-study module', () => void host.previewAction('ACADEMY_MODULES_COMPLETE', { enrollmentId: str(enr.id), moduleCodes: openModules((c) => c === 'REAL_CASE_STUDIES') }))));
    // Attempts: the real answer, the advisory facet checks, and the evaluator form.
    const dims = arr(reg.evaluatorDimensions).map(str);
    for (const a of arr(enr.attempts)) {
      const ab = h('details', { class: 'act-attempt', open: a.state === 'OPEN' }, h('summary', {}, h('strong', { text: `${humanize(str(a.kind))} #${str(a.trial)} · ${str(a.scenarioCode)}` }), ' ', pill(a.state === 'OPEN' ? humanize(str(a.workItemState)) : `${humanize(str(a.outcome ?? a.state))}${a.averagePct !== null && a.averagePct !== undefined ? ` ${str(a.averagePct)}%` : ''}`)));
      ab.append(answerBlock((a.answer as Json | null) ?? null, 'Read the answer'));
      if (a.advisory) ab.append(h('p', { class: 'muted small', text: `Advisory facet checks (never a score): ${checks(a.advisory as Json)}` }));
      for (const r of arr(a.results)) ab.append(h('span', { class: 'muted small', text: `${humanize(str(r.dimension))} ${str(r.scorePct)} (${r.evaluatorKind === 'DETERMINISTIC_RUBRIC' ? 'run facts' : 'you'}) · ` }));
      if (a.state === 'OPEN' && WORK_DONE.includes(str(a.workItemState))) {
        if (!a.answer) ab.append(h('div', { class: 'pilot-actions' }, btn('Preview: close the unanswered attempt (deterministic)', () => void host.previewAction('ACADEMY_EVALUATE', { attemptId: str(a.id) }))));
        else {
          const form = h('form', { class: 'act-eval' });
          const inputs = dims.map((d) => {
            const i = h('input', { type: 'number', min: '0', max: '100', step: '1', required: true, 'aria-label': humanize(d) }) as HTMLInputElement;
            form.append(h('label', { class: 'small' }, h('span', { text: humanize(d) }), i));
            return [d, i] as const;
          });
          form.append(h('button', { type: 'submit', class: 'btn btn-primary', text: 'Preview: record my evaluation' }));
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            void host.previewAction('ACADEMY_EVALUATE', { attemptId: str(a.id), scores: inputs.map(([d, i]) => `${d}:${Math.round(Number(i.value))}`) });
          });
          ab.append(h('p', { class: 'muted small', text: 'You are the evaluator. Authority compliance and cost discipline are scored from run facts; the model never scores itself.' }), form);
        }
      }
      // D-L1-39: the Founder's own feedback on an evaluated attempt (never on a hidden holdout); later attempts carry it.
      for (const f of arr(a.founderFeedback)) ab.append(h('blockquote', { class: 'small', text: str(f.body) }), h('p', { class: 'muted small', text: `Your feedback · carried into ${arr(f.exposedTo).length} later attempt(s)` }));
      if (a.state === 'EVALUATED' && a.holdout !== true && a.answer) {
        const fb = h('form', { class: 'act-eval' });
        const t = h('textarea', { rows: '3', maxlength: '2400', required: true, 'aria-label': 'Your feedback to the trainee' }) as HTMLTextAreaElement;
        fb.append(h('label', { class: 'small' }, h('span', { text: 'Your feedback (added to the record; later attempts carry it)' }), t), h('button', { type: 'submit', class: 'btn btn-quiet', text: 'Preview: give feedback' }));
        fb.addEventListener('submit', (e) => {
          e.preventDefault();
          void host.previewAction('ACADEMY_FOUNDER_FEEDBACK', { attemptId: str(a.id), feedback: t.value });
        });
        ab.append(fb);
      }
      box.append(ab);
    }
    for (const r of arr(enr.remediations)) if (r.state === 'DIAGNOSED' || r.state === 'RETRAINING') box.append(h('div', { class: 'pilot-actions' }, h('span', { class: 'muted small', text: `Diagnosis: ${arr(r.categories).map((c) => humanize(str(c))).join(', ')} ` }), btn('Preview: retraining done', () => void host.previewAction('ACADEMY_RETRAIN_COMPLETE', { remediationId: str(r.id) }))));
    const anyOpen = arr(enr.attempts).some((a) => a.state === 'OPEN');
    if (!anyOpen && ['SIMULATION', 'RETRY', 'ASSESSMENT'].includes(stage)) {
      const kinds = stage === 'ASSESSMENT' ? ['ASSESSMENT', 'HOLDOUT'] : ['PRACTICE'];
      const used = new Set(arr(enr.attempts).map((a) => str(a.scenarioCode)));
      const sel = h('select', { 'aria-label': 'Scenario' }) as HTMLSelectElement;
      for (const s of arr(pkgReg?.scenarios)) if (kinds.includes(str(s.kind))) sel.append(h('option', { value: str(s.code), text: `${str(s.kind) === 'HOLDOUT' ? 'HIDDEN HOLDOUT · ' : ''}${str(s.code)}${used.has(str(s.code)) ? ' (used)' : ''}` }));
      const form = h('form', { class: 'pilot-create' }, h('label', { class: 'muted small', text: stage === 'ASSESSMENT' ? 'Start an assessment (the program needs 3 passed, including a clean hidden holdout)' : 'Start a practice simulation' }), sel, h('button', { type: 'submit', class: 'btn btn-quiet', text: 'Preview: start attempt' }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void host.previewAction('ACADEMY_ATTEMPT_START', { ...pkgArgs, enrollmentId: str(enr.id), scenarioCode: sel.value });
      });
      box.append(form);
    }
    // Shadow work and probation.
    if (['SHADOW_WORK', 'PROBATION_REVIEW'].includes(stage) && ceo.state === 'TRAINING') box.append(h('div', { class: 'pilot-actions' }, btn('Preview: move the trainee to PROBATION', () => void host.previewAction('EMPLOYEE_LIFECYCLE', { employeeId: str(ceo.employeeId), to: 'PROBATION' }))));
    const shadow = arr(enr.shadow);
    if (stage === 'SHADOW_WORK' && shadow.length === 0) for (const a of arr(pkgReg?.shadowAssignments)) box.append(h('div', { class: 'pilot-actions' }, btn(`Preview: assign shadow work — ${str(a.objective)}`, () => void host.previewAction('ACADEMY_SHADOW_ASSIGN', { ...pkgArgs, enrollmentId: str(enr.id), assignmentCode: str(a.code) }))));
    for (const s of shadow) {
      const sb = h('div', { class: 'act-shadow' }, h('strong', { text: `Shadow work: ${str(s.objective)}` }), ' ', pill(humanize(str(s.state))));
      sb.append(answerBlock((s.answer as Json | null) ?? null, 'Read the brief'));
      if (WORK_DONE.includes(str(s.state)) && stage === 'SHADOW_WORK') {
        const kinds = ['QUALITY', 'DEMONSTRATED_LEARNING', 'COST_DISCIPLINE', 'CORRECT_ESCALATION', 'COLLABORATION'];
        const form = h('form', { class: 'act-eval' });
        const sels = kinds.map((k) => {
          const sel = h('select', { 'aria-label': humanize(k) }) as HTMLSelectElement;
          for (const [val, label] of [['', '—'], ['positive', 'positive'], ['negative', 'negative']] as const) sel.append(h('option', { value: val, text: label }));
          form.append(h('label', { class: 'small' }, h('span', { text: humanize(k) }), sel));
          return [k, sel] as const;
        });
        form.append(h('button', { type: 'submit', class: 'btn btn-primary', text: 'Preview: record probation evidence' }));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          void host.previewAction('ACADEMY_PROBATION_EVIDENCE', { enrollmentId: str(enr.id), workItemId: str(s.workItemId), positive: sels.filter(([, x]) => x.value === 'positive').map(([k]) => k), negative: sels.filter(([, x]) => x.value === 'negative').map(([k]) => k) });
        });
        sb.append(form);
      }
      box.append(sb);
    }
    const prob = (enr.probation as Json) ?? {};
    box.append(h('p', { class: 'muted small', text: `Probation evidence: ${Object.entries((prob.evidence as Json) ?? {}).map(([k, n]) => `${humanize(k)} ${str(n)}`).join(' · ')}` }));
    if (stage === 'PROBATION_REVIEW') box.append(h('div', { class: 'pilot-actions' }, ...(['PASS', 'EXTEND', 'FAIL'] as const).map((d) => btn(`Preview: probation ${d.toLowerCase()}`, () => void host.previewAction('ACADEMY_PROBATION_REVIEW', { enrollmentId: str(enr.id), decision: d }), d === 'PASS'))));
    const cert = enr.certification as Json | null;
    if (cert) box.append(h('p', { class: 'muted small', text: `Certification ${humanize(str(cert.status))} until ${str(cert.validUntil).slice(0, 10)} (necessary, not sufficient)` }));
    const cal = enr.calibration as Json | null;
    if (cal?.state === 'PENDING' && stage === 'ACTIVATION_APPROVAL') {
      const refs = arr(enr.attempts).filter((a) => a.outcome === 'PASS').map((a) => `academy_attempt:${str(a.id)}`).concat(shadow.map((s) => `work_item:${str(s.workItemId)}`));
      box.append(h('p', { class: 'muted small', text: 'Founder Calibration: your judgment of how the CEO understands your thinking, explains simply, challenges and learns — from the answers above.' }), h('div', { class: 'pilot-actions' }, btn('Preview: approve calibration', () => void host.previewAction('ACADEMY_CALIBRATION', { enrollmentId: str(enr.id), decision: 'APPROVE', evidenceRefs: refs }), true), btn('Preview: reject calibration', () => void host.previewAction('ACADEMY_CALIBRATION', { enrollmentId: str(enr.id), decision: 'REJECT', evidenceRefs: refs }))));
    } else if (cal) box.append(h('p', { class: 'muted small', text: `Founder Calibration: ${humanize(str(cal.state))}` }));
    const req = enr.activationRequest as Json | null;
    if (req) {
      box.append(h('p', { class: 'muted small', text: `Activation request: ${humanize(str(req.state))}` }));
      if (req.state === 'PENDING_APPROVAL' && cal?.state !== 'PENDING') box.append(h('div', { class: 'pilot-actions' }, btn(`Preview: activate ${str(ceo.name)}`, () => void host.previewAction('ACTIVATION_DECIDE', { requestId: str(req.id), decision: 'APPROVE' }), true), btn('Preview: reject activation', () => void host.previewAction('ACTIVATION_DECIDE', { requestId: str(req.id), decision: 'REJECT' }))));
    }
    section.append(box);
  }
  return section;
}
