/**
 * Typed model proposals (Stage 13 D13-D.1): the runtime owns the loop; the model proposes one
 * governed next action. Model output is untrusted data (D14-A.6): it is parsed into a closed set of
 * proposal types, and nothing a model writes can name a grant, approval, budget, credential or
 * risk level. A proposal is only data; executing it is the runtime's decision.
 */
import { boundedText, type JsonObject } from '@qandeel-company/domain';

export type ModelProposal =
  | { readonly type: 'FINAL'; readonly summaryCode: string }
  /**
   * C3: a structured memory CANDIDATE. It is only a proposal: the runtime-owned Memory Write Policy
   * decides whether and how it is stored. Provenance, data class, scope and status are never taken
   * from the model.
   */
  | {
      readonly type: 'MEMORY_CANDIDATE';
      readonly memoryClass: string;
      readonly topic: string;
      readonly claimKey: string | null;
      readonly claimValue: string | null;
      readonly content: string;
      readonly confidencePct: number;
    }
  /** C3: an observation about this Work Item's outcome — the first step of the learning path, never a lesson. */
  | { readonly type: 'OBSERVATION'; readonly topic: string; readonly content: string }
  | { readonly type: 'TOOL_REQUEST'; readonly tool: string; readonly action: string; readonly args: JsonObject }
  | { readonly type: 'INVALID'; readonly code: 'NOT_JSON' | 'UNKNOWN_TYPE' | 'MALFORMED' };

const CODE_SHAPE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7}$/;
/**
 * A proposal code is a short machine code, bounded in length (R1 K4): an unbounded "code" could carry
 * free text into the run evidence, and an oversize one used to break the settle (retry loop).
 * Summary / tool / action codes ≤ 64; topic / claim codes ≤ 96 (the Memory key limit).
 */
const CODE = { test: (s: string): boolean => s.length <= 64 && CODE_SHAPE.test(s) };
const KEY = { test: (s: string): boolean => s.length <= 96 && CODE_SHAPE.test(s) };

export function parseProposal(outputText: string): ModelProposal {
  let raw: unknown;
  try {
    raw = JSON.parse(boundedText(outputText, 'output', 65_536, { allowEmpty: true }));
  } catch {
    return { type: 'INVALID', code: 'NOT_JSON' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { type: 'INVALID', code: 'MALFORMED' };
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  if (o.type === 'FINAL') {
    if (keys !== 'summaryCode,type' || typeof o.summaryCode !== 'string' || !CODE.test(o.summaryCode)) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'FINAL', summaryCode: o.summaryCode };
  }
  if (o.type === 'TOOL_REQUEST') {
    if (keys !== 'action,args,tool,type' || typeof o.tool !== 'string' || !CODE.test(o.tool) || typeof o.action !== 'string' || !CODE.test(o.action)) return { type: 'INVALID', code: 'MALFORMED' };
    if (typeof o.args !== 'object' || o.args === null || Array.isArray(o.args)) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'TOOL_REQUEST', tool: o.tool, action: o.action, args: o.args as JsonObject };
  }
  if (o.type === 'MEMORY_CANDIDATE') {
    const allowed = new Set(['type', 'memoryClass', 'topic', 'claimKey', 'claimValue', 'content', 'confidencePct']);
    if (Object.keys(o).some((k) => !allowed.has(k))) return { type: 'INVALID', code: 'MALFORMED' };
    if (typeof o.memoryClass !== 'string' || typeof o.topic !== 'string' || !KEY.test(o.topic) || typeof o.content !== 'string' || o.content.length === 0 || o.content.length > 2_000) return { type: 'INVALID', code: 'MALFORMED' };
    if (typeof o.confidencePct !== 'number' || !Number.isInteger(o.confidencePct) || o.confidencePct < 0 || o.confidencePct > 100) return { type: 'INVALID', code: 'MALFORMED' };
    const claimKey = o.claimKey === undefined || o.claimKey === null ? null : o.claimKey;
    const claimValue = o.claimValue === undefined || o.claimValue === null ? null : o.claimValue;
    if ((claimKey !== null && (typeof claimKey !== 'string' || !KEY.test(claimKey))) || (claimValue !== null && (typeof claimValue !== 'string' || !KEY.test(claimValue)))) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'MEMORY_CANDIDATE', memoryClass: o.memoryClass, topic: o.topic, claimKey: claimKey as string | null, claimValue: claimValue as string | null, content: o.content, confidencePct: o.confidencePct };
  }
  if (o.type === 'OBSERVATION') {
    if (keys !== 'content,topic,type' || typeof o.topic !== 'string' || !KEY.test(o.topic) || typeof o.content !== 'string' || o.content.length === 0 || o.content.length > 2_000) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'OBSERVATION', topic: o.topic, content: o.content };
  }
  return { type: 'INVALID', code: 'UNKNOWN_TYPE' };
}
