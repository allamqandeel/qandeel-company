/**
 * Model-proposed memory (C3, Stage 5 Memory Write Policy). A model proposal is only a candidate: it is
 * submitted with runtime-set provenance (this run), then the runtime-owned policy decides it in a
 * separate transaction. Nothing here writes memory, knowledge, certification or authority directly;
 * a crash between the two steps leaves a SUBMITTED candidate that recovery decides.
 */
import type { CompanyStore, Fence } from '@qandeel-company/storage';
import { decideMemoryCandidate, submitMemoryCandidate } from '@qandeel-company/storage/runtime-authority';

import type { MemoryProposal, MemoryProposalOutcome } from '../c2/types.js';

export function proposeMemory(store: CompanyStore, fence: Fence, proposal: MemoryProposal, step: number): MemoryProposalOutcome {
  const submitted = submitMemoryCandidate(
    store,
    fence,
    step,
    proposal.type === 'MEMORY_CANDIDATE'
      ? { kind: 'MEMORY', memoryClass: proposal.memoryClass, topic: proposal.topic, claimKey: proposal.claimKey, claimValue: proposal.claimValue, content: proposal.content, confidencePct: proposal.confidencePct }
      : { kind: 'OBSERVATION', memoryClass: null, topic: proposal.topic, claimKey: null, claimValue: null, content: proposal.content, confidencePct: 0 },
  );
  if (submitted.kind === 'INVALID' || submitted.kind === 'REFUSED') return { kind: submitted.kind, code: submitted.code };
  const decided = decideMemoryCandidate(store, fence, submitted.candidateId);
  return { kind: 'DECIDED', state: decided.state, reasonCode: decided.decisionReason };
}
