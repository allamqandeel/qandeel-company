/**
 * C7-C Pilot kernel (pure, deterministic, no I/O): the Pilot's mode, its forward-only lifecycle and the two structured
 * Founder intents that move it.
 *
 * A Pilot is a CONTEXT over the canonical Company systems, never a second project-management engine and never
 * authority: every step is an explicit Founder act through the governed confirmation (preview → fingerprint →
 * confirm), no metric or message ever moves it, and its state grants no budget, tool, role or authority. The datastore
 * re-checks every rule here (migration 0014 triggers).
 */
import { QandeelError } from '@qandeel-company/domain';

/** TRAINING_INTERNAL proves capability and discipline only; CONTROLLED_REAL may support a real-world claim on C7-A evidence. */
export const PILOT_MODES = ['TRAINING_INTERNAL', 'CONTROLLED_REAL'] as const;
export type PilotMode = (typeof PILOT_MODES)[number];

export const PILOT_STATES = ['DRAFT', 'BRIEFING', 'READY', 'ACTIVE', 'REVIEWING', 'COMPLETED', 'STOPPED'] as const;
export type PilotState = (typeof PILOT_STATES)[number];

export const TERMINAL_PILOT_STATES: readonly PilotState[] = ['COMPLETED', 'STOPPED'];

const PILOT_TRANSITIONS: Readonly<Record<PilotState, readonly PilotState[]>> = {
  DRAFT: ['BRIEFING', 'STOPPED'],
  BRIEFING: ['READY', 'STOPPED'],
  READY: ['ACTIVE', 'STOPPED'],
  ACTIVE: ['REVIEWING', 'STOPPED'],
  REVIEWING: ['COMPLETED', 'STOPPED'],
  COMPLETED: [],
  STOPPED: [],
};

export const isPilotMode = (v: unknown): v is PilotMode => typeof v === 'string' && (PILOT_MODES as readonly string[]).includes(v);
export const isPilotState = (v: unknown): v is PilotState => typeof v === 'string' && (PILOT_STATES as readonly string[]).includes(v);

/** Forward only; a terminal Pilot never revives. */
export function assertPilotTransition(from: PilotState, to: PilotState): void {
  if (!PILOT_TRANSITIONS[from].includes(to)) throw new QandeelError('PILOT_INVALID', 'pilot transition is not allowed', { from, to });
}

/** The lifecycle step the Founder may take next from `from` (STOPPED aside), or null when the Pilot is terminal. */
export function nextPilotStep(from: PilotState): PilotState | null {
  return PILOT_TRANSITIONS[from].find((s) => s !== 'STOPPED') ?? null;
}

/**
 * A briefing conversation counts only through a Founder message that REQUIRES a governed response (Stage 9 §5):
 * a request, a question or a decision request. An FYI, a correction or silence proves nothing.
 */
export const BRIEFING_REQUEST_PURPOSES = ['REQUEST', 'QUESTION', 'DECISION_REQUEST'] as const;

/**
 * The two structured Pilot intents of the governed confirmation (no natural-language pattern produces them):
 * creating a Pilot (DRAFT, nothing bound) and taking exactly one lifecycle step.
 */
export const PILOT_INTENTS = ['PILOT_CREATE', 'PILOT_ADVANCE'] as const;
export type PilotIntent = (typeof PILOT_INTENTS)[number];
