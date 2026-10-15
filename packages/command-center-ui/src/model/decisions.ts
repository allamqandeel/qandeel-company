/**
 * G4-FINAL-CLOSURE-01 (D-P1-17) — recording a Founder decision from the Founder's own message in the CEO conversation.
 *
 * Nothing here records anything. A message becomes a decision only when the Founder opens "Record as decision", reviews the
 * subject and the words, and confirms the governed preview. `decisionCue` only decides which messages the action is
 * highlighted on (and which action it opens with): explicit, first-person, declarative decision wording — never a question,
 * a "what do you think", a hypothetical or a proposal to discuss.
 */

export type DecisionCue = 'RECORD' | 'AMEND' | 'REVOKE';
export type DecisionMode = 'RECORD' | 'AMEND' | 'REVOKE';

/** The bounds the store enforces (shown before the preview, so a long message is never cut silently). */
export const DECISION_SUBJECT_MAX = 160;
export const DECISION_STATEMENT_MAX = 1_500;

const norm = (s: string): string =>
  s
    .normalize('NFKC')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();

// Discussion, questions, proposals and hypotheticals: never offered as a decision.
const NOT_A_DECISION = /[?؟]|\b(?:what do you think|what if|should we|shall we|could we|maybe|perhaps|let'?s discuss|let'?s think|i(?:'m| am) thinking|suppose|if we)\b|(?:^|\s)(?:ايه رايك|رايك ايه|ممكن|يمكن|لو |خلينا نناقش|نناقش|نفكر|بفكر|افرض|هل |ازاي|امتي|مين )/;
const REVOKE = /(?:^|\s)(?:الغي|الغيت|الغينا|لغيت|نلغي|الغاء)(?:\s|$)|\b(?:i (?:cancel|revoke|withdraw)|cancel the decision|revoke the decision|withdraw the decision|is cancelled|is revoked)\b/;
const AMEND = /(?:^|\s)(?:عدل|عدلت|عدلنا|غير|غيرت|غيرنا)(?:\s|ها|ه)[^.\n]{0,80}(?:من|بدل)\s[^.\n]{0,40}(?:ل|الي|لحد|بقي|يبقي)/;
const AMEND_EN = /\b(?:change|changed|amend|amended|update|updated|raise|raised|lower|lowered|cut)\b[^.\n]{0,80}\bfrom\b[^.\n]{0,40}\bto\b/;
const RECORD = /(?:^|\s)(?:اعتمدت|اعتمدنا|قررت|قررنا|وافقت علي|موافق علي|اوافق علي|كلفت|نكلف|خلاص هنمشي)(?:\s|$)|\b(?:i approve|i(?:'ve| have)? approved|i(?:'ve| have)? decided|we(?:'ve| have)? decided|my decision|final decision|i assign|i(?:'ve| have)? assigned)\b/;

/**
 * The decision wording a Founder message carries, or null. Deterministic and conservative: a question, a request for an
 * opinion, a hypothetical or a proposal to discuss is never a cue, whatever else it says.
 */
export function decisionCue(body: string): DecisionCue | null {
  // Quoted words (an Employee's, a document's) are not the Founder deciding.
  const own = body
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/«[^»]*»|“[^”]*”|"[^"\n]*"/g, ' ');
  const s = norm(own);
  if (NOT_A_DECISION.test(s)) return null;
  if (REVOKE.test(s)) return 'REVOKE';
  if (AMEND.test(s) || AMEND_EN.test(s)) return 'AMEND';
  if (RECORD.test(s)) return 'RECORD';
  return null;
}

export interface DecisionRecord {
  readonly id: string;
  readonly decisionKey: string;
  readonly decisionVersion: number;
  readonly subject: string;
  readonly statement: string;
  readonly audience: 'CEO' | 'COMPANY';
  readonly dataClass: string;
  readonly status: string;
  readonly inForce: boolean;
  readonly sourceMessageId: string;
  readonly supersedesId: string | null;
  readonly supersededById: string | null;
  readonly recordedAt: string;
  readonly version: number;
}

export interface DecisionDraft {
  readonly messageId: string;
  mode: DecisionMode;
  subject: string;
  statement: string;
  audience: 'CEO' | 'COMPANY';
  dataClass: 'D1' | 'D2';
  /** The decision in force an amendment replaces or a revocation ends. */
  targetId: string | null;
}

/** A new draft from one Founder message: its words prefilled (bounded, never cut silently), its cue choosing the mode. */
export function newDecisionDraft(messageId: string, body: string, inForce: readonly DecisionRecord[]): DecisionDraft {
  const cue = decisionCue(body);
  const mode: DecisionMode = cue === 'REVOKE' && inForce.length > 0 ? 'REVOKE' : cue === 'AMEND' && inForce.length > 0 ? 'AMEND' : 'RECORD';
  const target = mode === 'RECORD' ? null : (inForce[inForce.length - 1]?.id ?? null);
  const prior = inForce.find((d) => d.id === target);
  return { messageId, mode, subject: mode === 'AMEND' && prior ? prior.subject : '', statement: body.trim(), audience: prior?.audience ?? 'CEO', dataClass: 'D2', targetId: target };
}

/** Why the draft cannot be previewed yet (in words), or null when it can. */
export function draftProblem(d: DecisionDraft): string | null {
  if (d.mode !== 'RECORD' && d.targetId === null) return 'Choose the decision in force this changes.';
  if (d.mode === 'REVOKE') return null;
  const subject = d.subject.trim();
  const statement = d.statement.trim();
  if (subject.length < 2) return 'Give the decision a short subject.';
  if (subject.length > DECISION_SUBJECT_MAX) return `The subject is at most ${DECISION_SUBJECT_MAX} characters.`;
  if (statement.length < 2) return 'Write the decision itself.';
  if (statement.length > DECISION_STATEMENT_MAX) return `The decision is at most ${DECISION_STATEMENT_MAX} characters (now ${statement.length}); shorten it to what you decided.`;
  return null;
}

/** The governed preview request for a draft (IDs, codes and the Founder's own words; the store re-validates everything). */
export function decisionRequest(d: DecisionDraft): { intent: 'FOUNDER_DECISION_RECORD' | 'FOUNDER_DECISION_REVOKE'; payload: Record<string, unknown> } {
  if (d.mode === 'REVOKE') return { intent: 'FOUNDER_DECISION_REVOKE', payload: { decisionId: d.targetId, messageId: d.messageId } };
  return {
    intent: 'FOUNDER_DECISION_RECORD',
    payload: { messageId: d.messageId, subject: d.subject.trim(), statement: d.statement.trim(), audience: d.audience, dataClass: d.dataClass, ...(d.mode === 'AMEND' && d.targetId !== null ? { supersedesId: d.targetId } : {}) },
  };
}

/** What a Founder message already holds: the decision recorded from it (and whether it is still in force), or null. */
export function decisionOfMessage(decisions: readonly DecisionRecord[], messageId: string): { readonly label: string; readonly inForce: boolean } | null {
  const own = decisions.filter((d) => d.sourceMessageId === messageId);
  const last = own[own.length - 1];
  if (!last) return null;
  const state = last.inForce ? 'in force' : last.status === 'SUPERSEDED' ? 'replaced by a later version' : last.status === 'ARCHIVED' ? 'revoked' : last.status.toLowerCase();
  return { label: `Recorded decision v${last.decisionVersion} · ${state}`, inForce: last.inForce };
}
