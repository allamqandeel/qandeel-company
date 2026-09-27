/**
 * Typed model proposals (Stage 13 D13-D.1): the runtime owns the loop; the model proposes one
 * governed next action. Model output is untrusted data (D14-A.6): it is parsed into a closed set of
 * proposal types, and nothing a model writes can name a grant, approval, budget, credential or
 * risk level. A proposal is only data; executing it is the runtime's decision.
 */
import { boundedText, type JsonObject } from '@qandeel-company/domain';

export type ModelProposal =
  | { readonly type: 'FINAL'; readonly summaryCode: string }
  | { readonly type: 'TOOL_REQUEST'; readonly tool: string; readonly action: string; readonly args: JsonObject }
  | { readonly type: 'INVALID'; readonly code: 'NOT_JSON' | 'UNKNOWN_TYPE' | 'MALFORMED' };

const CODE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7}$/;

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
  return { type: 'INVALID', code: 'UNKNOWN_TYPE' };
}
