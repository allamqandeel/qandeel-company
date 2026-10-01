/** C7-D runtime fixtures: grants for the internal Digital Workshop and the Founder-registered GitHub adapter. */
import { DIGITAL_WORKSPACE_ACTIONS, DIGITAL_WORKSPACE_TOOL } from '@qandeel-company/governance';
import type { EmployeeRecord } from '@qandeel-company/storage';
import { GITHUB_TOOL_REGISTRATION } from '@qandeel-company/tool-drivers';

import type { CompanyRuntime } from '../../src/index.js';
import type { C2World } from '../c2/c2-seed.js';

const READS = new Set(['revision-inspect', 'file-read', 'seo-check', 'promotion-inspect']);

/** Explicit Founder grants for every internal workshop action (tools are never granted automatically). */
export function grantWorkshop(rt: CompanyRuntime, w: C2World, e: EmployeeRecord = w.employee, only?: readonly string[]): void {
  for (const a of DIGITAL_WORKSPACE_ACTIONS) {
    if (only && !only.includes(a)) continue;
    rt.governance.grant(w.founder, { employeeId: e.id, capability: `tool:${DIGITAL_WORKSPACE_TOOL}.${a}`, riskCeiling: READS.has(a) ? 'R0' : 'R1', dataClassCeiling: 'D2', reasonCode: 'seed' });
  }
}

/** The Founder registers the GitHub adapter tool exactly as its declaration states, and one allowlisted target. */
export function registerGitHub(rt: CompanyRuntime, w: C2World, repo = 'qandeel-test/site'): { toolId: string; targetId: string } {
  const r = GITHUB_TOOL_REGISTRATION;
  const tool = rt.governance.registerTool(w.founder, { ...r.tool, credentialRef: 'vault:github-app' });
  for (const a of r.actions) rt.governance.registerToolAction(w.founder, { toolId: tool.id, ...a });
  const target = rt.founder.digital.registerTarget(w.founder, { code: 'site-repo', targetClass: 'CODE_REPOSITORY', adapterCode: r.tool.driverCode, externalRef: `github:${repo}`, actions: r.promotionActions });
  return { toolId: tool.id, targetId: target.id };
}

export function grantGitHub(rt: CompanyRuntime, w: C2World, e: EmployeeRecord = w.employee): void {
  for (const a of GITHUB_TOOL_REGISTRATION.actions) rt.governance.grant(w.founder, { employeeId: e.id, capability: `tool:${GITHUB_TOOL_REGISTRATION.tool.code}.${a.code}`, riskCeiling: a.risk === 'R3' ? 'R3' : 'R0', dataClassCeiling: 'D2', reasonCode: 'seed' });
}

export const ws = (action: string, args: Record<string, unknown>): unknown => ({ type: 'TOOL_REQUEST', tool: DIGITAL_WORKSPACE_TOOL, action, args });
export const gh = (action: string, args: unknown): unknown => ({ type: 'TOOL_REQUEST', tool: GITHUB_TOOL_REGISTRATION.tool.code, action, args });

export const PAGE = (title: string, body = 'QANDEEL helps people think clearly.'): string =>
  `<!doctype html><html lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><meta name="description" content="${title} description"><link rel="canonical" href="https://example.org/"></head><body><h1>${title}</h1><p>${body}</p><a href="about/">About</a><img src="logo.png" alt="logo"></body></html>`;
