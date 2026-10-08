/**
 * D2-UX-01 — the two halls the Founder reaches from the top bar without opening anyone's profile.
 *
 * The Academy: a read-only, company-wide overview of the canonical Academy, Skills and Employee records — who is where
 * on the learning path, attempts and scores, certification, the Skill Passport and the installed / qualifying packages.
 * It holds no Academy act: training, qualification, shadow work and activation stay governed previews in the
 * "Activate the Company" flow. An empty record reads as empty; nothing is filled in.
 *
 * The Meeting Room: an honest notice. Company meetings (Stage 9) are not built yet, so the room has no conversation, no
 * input, no attendees and no tasks, and it reads nothing from the Company — opening it changes nothing and calls nothing.
 */
import { dirOf, fmtDate, hasArabic, humanize, plural, STATE_LABEL, t } from '../model/format.js';
import { h } from './panels.js';

type Json = Record<string, unknown>;

export interface HallHost {
  openEmployee(id: string): void;
  deptNameOf(id: string): string;
  closeHall(): void;
}

const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const STAGE_LABEL: Readonly<Record<string, string>> = {
  LEARN: 'Learning',
  CASE_STUDIES: 'Case studies',
  SIMULATION: 'Simulation',
  FEEDBACK: 'Feedback',
  RETRY: 'Retraining and retest',
  ASSESSMENT: 'Assessment',
  SHADOW_WORK: 'Shadow work',
  PROBATION_REVIEW: 'Probation review',
  CERTIFICATION: 'Certification',
  ACTIVATION_APPROVAL: 'Awaiting activation approval',
  ACTIVATED: 'Activated',
  BLOCKED: 'Blocked',
  WITHDRAWN: 'Withdrawn',
};
const CERT_LABEL: Readonly<Record<string, string>> = { VALID: 'Valid', REVIEW_DUE: 'Review due', EXPIRED: 'Expired', REVOKED: 'Revoked', SUPERSEDED: 'Superseded' };

function hallHead(host: HallHost, title: string, sub: string, icon: string): HTMLElement {
  const close = h('button', { type: 'button', class: 'btn btn-ghost hall-close', 'aria-label': `Close the ${title}`, title: 'Close (Esc)' }, h('span', { 'aria-hidden': 'true', text: '×' }));
  close.addEventListener('click', () => host.closeHall());
  const mark = h('span', { class: `hall-mark hall-mark-${icon}`, 'aria-hidden': 'true' });
  return h('header', { class: 'hall-head' }, mark, h('div', { class: 'hall-titles' }, h('h2', { id: 'hall-title', class: 'hall-title', text: title }), h('p', { class: 'hall-sub', text: sub })), close);
}

const name = (text: string, cls = ''): HTMLElement => {
  const e = h('span', { class: cls, text });
  e.dir = dirOf(text);
  if (hasArabic(text)) e.lang = 'ar';
  return e;
};

/** One Employee's Academy line, from the overview's employee view (also used by the profile sheet). */
export function trainingFacts(e: Json): { stage: string; modules: string; attempts: string; certification: string; skills: string } {
  const en = e.enrollment as Json | null;
  const attempts = arr(en?.attempts);
  const evaluated = attempts.filter((a) => a.state === 'EVALUATED');
  const passed = evaluated.filter((a) => a.outcome === 'PASS').length;
  const latest = evaluated.at(-1);
  const open = attempts.filter((a) => a.state === 'OPEN').length;
  const cert = e.certification as Json | null;
  const skills = arr(e.skills);
  const qualified = skills.filter((s) => s.proficiency !== 'LEARNING').length;
  return {
    stage: en ? `${t(STAGE_LABEL, str(en.stage))}${en.blockedReason ? ` (${humanize(str(en.blockedReason))})` : ''}` : 'Not enrolled',
    modules: en ? (Number(en.modulesTotal) > 0 ? `${str(en.modulesDone)} of ${str(en.modulesTotal)} modules` : 'No modules in the programme') : '—',
    attempts: attempts.length === 0 ? 'No attempts' : `${passed} of ${plural(evaluated.length, 'evaluated attempt', 'evaluated attempts')} passed${latest && latest.averagePct !== null ? ` · latest ${str(latest.averagePct)}%` : ''}${open ? ` · ${open} open` : ''}`,
    certification: cert ? `${t(CERT_LABEL, str(cert.status))}${cert.status === 'VALID' || cert.status === 'REVIEW_DUE' ? ` until ${fmtDate(str(cert.validUntil))}` : ''}` : 'No certification',
    skills: skills.length === 0 ? 'No skills on the passport' : `${plural(skills.length, 'skill', 'skills')}${qualified ? ` · ${qualified} qualified or above` : ' · all learning'}`,
  };
}

export function renderAcademy(root: HTMLElement, data: Json | null, host: HallHost, error: string | null): void {
  root.replaceChildren();
  root.dataset.hall = 'academy';
  root.append(hallHead(host, 'Academy', 'Read-only. Opening the Academy starts no training, test, certification or model call.', 'academy'));
  const body = h('div', { class: 'hall-body' });
  root.append(body);
  if (error !== null) {
    body.append(h('p', { class: 'empty', text: `The Academy could not be read (${error}). Nothing was changed.` }));
    return;
  }
  if (data === null) {
    body.append(h('p', { class: 'muted', text: 'Reading the Academy…' }));
    return;
  }
  const totals = (data.totals as Json) ?? {};
  const stat = (n: unknown, label: string): HTMLElement => h('div', { class: 'hall-stat' }, h('strong', { text: str(n) }), h('span', { text: label }));
  body.append(h('div', { class: 'hall-stats', role: 'group', 'aria-label': 'Academy totals' }, stat(totals.employees, 'employees'), stat(totals.enrolled, 'in the Academy'), stat(totals.certifiedValid, 'with a valid certification'), stat(`${str(totals.attemptsPassed)}/${str(totals.attemptsEvaluated)}`, 'evaluated attempts passed'), stat(totals.packagesInstalled, 'skill packages installed')));

  // --- People -------------------------------------------------------------------------------------------------------
  // Those with an Academy record first (furthest along the path first); the rest, never enrolled, as one quiet line each.
  const ORDER = Object.keys(STAGE_LABEL);
  const inAcademy = (e: Json): boolean => e.enrollment !== null || e.certification !== null || arr(e.skills).length > 0;
  const rank = (e: Json): number => (inAcademy(e) ? ORDER.length - ORDER.indexOf(str((e.enrollment as Json | null)?.stage)) : 1000);
  const people = arr(data.employees).map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e);
  const list = h('ul', { class: 'academy-people', role: 'list', 'aria-label': 'Employees in the Academy' });
  if (people.length === 0) list.append(h('li', { class: 'empty', text: 'No employees on record yet.' }));
  for (const e of people) {
    const f = trainingFacts(e);
    const open = h('button', { type: 'button', class: 'link academy-name', 'aria-label': `Open ${str(e.name)}'s profile` }, name(str(e.name)));
    open.addEventListener('click', () => {
      host.closeHall();
      host.openEmployee(str(e.employeeId));
    });
    const role = [e.jobTitle ? str(e.jobTitle) : humanize(str(e.roleRef)), e.departmentId ? host.deptNameOf(str(e.departmentId)) : 'Company'].join(' · ');
    const fact = (label: string, value: string, cls = ''): HTMLElement => h('div', { class: `academy-fact ${cls}`.trim() }, h('dt', { text: label }), h('dd', { text: value }));
    list.append(
      h('li', { class: `academy-person${inAcademy(e) ? '' : ' is-quiet'}` },
        h('div', { class: 'academy-who' }, open, h('span', { class: 'muted small', text: role }), h('span', { class: `pill pill-state state-${str(e.lifecycle).toLowerCase()}`, text: t(STATE_LABEL, str(e.lifecycle)) })),
        inAcademy(e) ? h('dl', { class: 'academy-facts' }, fact('Academy', f.stage), fact('Programme', f.modules), fact('Attempts', f.attempts), fact('Certification', f.certification), fact('Skills', f.skills)) : h('p', { class: 'muted academy-none', text: 'Not in the Academy · no certification · no skills on the passport' }),
      ),
    );
  }
  body.append(h('section', { class: 'hall-section' }, h('h3', { text: 'People' }), list));

  // --- Programmes ------------------------------------------------------------------------------------------------------
  const programs = arr(data.programs);
  const progList = h('ul', { class: 'plain hall-list' });
  if (programs.length === 0) progList.append(h('li', { class: 'empty', text: 'No Academy programme is installed yet. A programme arrives when a skill package is installed through the activation flow.' }));
  for (const p of programs) progList.append(h('li', {}, h('strong', { text: str(p.code) }), h('span', { class: 'muted', text: ` v${str(p.version)} · for ${humanize(str(p.roleRef))} · ${plural(Number(p.modules), 'module', 'modules')} · ${plural(Number(p.scenarios), 'scenario', 'scenarios')} · ${plural(Number(p.enrollments), 'enrolment', 'enrolments')}` })));
  body.append(h('section', { class: 'hall-section' }, h('h3', { text: 'Programmes' }), progList));

  // --- Skill packages ----------------------------------------------------------------------------------------------------
  const packages = arr(data.packages);
  const pkgList = h('ul', { class: 'plain hall-list' });
  if (packages.length === 0) pkgList.append(h('li', { class: 'empty', text: 'No skill package has been qualified or installed yet.' }));
  for (const p of packages) {
    const skills = arr(p.skills).map((s) => `${str(s.code)} (security review ${str(s.securityReview).toLowerCase()}, ${plural(Number(s.benchmarkRuns), 'benchmark run', 'benchmark runs')})`);
    pkgList.append(
      h('li', {},
        h('strong', { text: p.title ? str(p.title) : str(p.code) }),
        h('span', { class: 'muted', text: ` v${str(p.version)} · ${p.state === 'INSTALLED' ? `installed ${p.installedAt ? fmtDate(str(p.installedAt)) : ''}` : 'qualifying'} · for ${humanize(str(p.roleRef))}` }),
        skills.length ? h('p', { class: 'muted small hall-skill-line', text: `Skills: ${skills.join('; ')}` }) : null,
      ),
    );
  }
  body.append(h('section', { class: 'hall-section' }, h('h3', { text: 'Skill packages' }), pkgList));
  body.append(h('p', { class: 'muted small hall-foot', text: 'Training, qualification, shadow work and activation are governed steps in “Activate the Company”: each is a preview you confirm yourself. This view only reads.' }));
}

export function renderMeetingRoom(root: HTMLElement, host: HallHost): void {
  root.replaceChildren();
  root.dataset.hall = 'meeting';
  root.append(hallHead(host, 'Meeting Room', 'Company meetings are not available yet.', 'meeting'));
  root.append(
    h('div', { class: 'hall-body' },
      h('p', { class: 'hall-notice' }, h('span', { class: 'pill', text: 'Not available yet' }), ' ', h('span', { text: 'There is no meeting to join here, and nothing in this room acts: it creates no work, calls no model and spends nothing.' })),
      h('section', { class: 'hall-section' },
        h('h3', { text: 'What the Meeting Room will be' }),
        h('p', { text: 'Text meetings between you, the CEO and the employees you choose: an agenda, a moderated discussion, decisions and disagreements on the record, tasks delegated only through your governed confirmation, and follow-up.' }),
      ),
      h('section', { class: 'hall-section' },
        h('h3', { text: 'Today' }),
        h('p', { text: 'You can talk with the CEO or with one employee at a time: open their profile and choose “Talk”. Each conversation is one-to-one.' }),
      ),
    ),
  );
}
