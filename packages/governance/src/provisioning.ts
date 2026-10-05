/**
 * Provider provisioning profiles (L1-01, D-L1-06). A profile is release-pinned, provider-neutral DATA that
 * names everything a Founder provisions in one governed act: the provider, one model identity, its immutable
 * deployment profiles (one per reasoning class, each with conservative Company-side limits), the versioned
 * pricing basis, the egress ceiling and the route policies the pilot needs. It carries no credential (only an
 * opaque `vault:<name>` reference), grants nothing by itself, and is validated here before any store touches it.
 * The confirmed preview carries the profile's digest, so what the Founder saw is exactly what is registered.
 */
import { QandeelError, assertCode, canonicalJson, sha256Hex } from '@qandeel-company/domain';

import { assertDataClass, assertReasoningClass, assertTaskClass, type DataClass, type ReasoningClass } from './classes.js';
import { assertPriceCardRates, assertTokens, type PriceCard } from './economics.js';
import { QUALIFICATION_STATES, assertRoutePolicyBody, type QualificationState, type RoutePolicyBody } from './routing.js';

export interface ProvisioningDeployment {
  readonly code: string;
  readonly reasoningClass: Exclude<ReasoningClass, 'E0'>;
  /** The provider revision / alias the deployment was qualified against (an alias, never a cryptographic pin). */
  readonly pinnedRevision: string;
  /** Conservative Company-side limits (never the provider's absolute maxima by default). */
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly taskClasses: readonly string[];
}

export interface ProviderProvisioningProfile {
  /** Short release code of the profile (e.g. `deepseek-v4-1-flash`). */
  readonly code: string;
  readonly provider: { readonly code: string; readonly locality: 'LOCAL' | 'EXTERNAL'; readonly credentialRef: string | null };
  readonly model: { readonly code: string; readonly expectedPublicName: string };
  readonly deployments: readonly ProvisioningDeployment[];
  readonly priceCard: Omit<PriceCard, 'id' | 'version'>;
  /** Highest data class approved to leave for this provider (an external profile never exceeds D2). */
  readonly egressMaxDataClass: DataClass;
  /** The qualification state the deployments are activated at for the pilot (LIMITED_PRODUCTION until requalified). */
  readonly qualificationTarget: QualificationState;
  readonly routePolicies: readonly { readonly taskClass: string; readonly body: RoutePolicyBody }[];
}

const VAULT_REF = /^vault:[a-z0-9][a-z0-9.-]{0,57}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,118}$/;

export function assertProvisioningProfile(input: unknown): ProviderProvisioningProfile {
  const p = input as Partial<ProviderProvisioningProfile> | null;
  if (typeof p !== 'object' || p === null) throw new QandeelError('VALIDATION_FAILED', 'profile must be an object', { field: 'profile' });
  const code = assertCode(p.code, 'profile.code');
  const prov = p.provider as Partial<ProviderProvisioningProfile['provider']> | undefined;
  if (!prov || (prov.locality !== 'LOCAL' && prov.locality !== 'EXTERNAL')) throw new QandeelError('VALIDATION_FAILED', 'provider locality is LOCAL or EXTERNAL', { field: 'provider.locality' });
  const providerCode = assertCode(prov.code, 'provider.code');
  const credentialRef = prov.credentialRef === undefined || prov.credentialRef === null ? null : prov.credentialRef;
  if (credentialRef !== null && (typeof credentialRef !== 'string' || !VAULT_REF.test(credentialRef))) throw new QandeelError('VALIDATION_FAILED', 'credentialRef is a vault reference "vault:<name>", never a secret value', { field: 'provider.credentialRef' });
  const model = p.model as Partial<ProviderProvisioningProfile['model']> | undefined;
  const modelCode = assertCode(model?.code, 'model.code');
  if (typeof model?.expectedPublicName !== 'string' || !NAME.test(model.expectedPublicName)) throw new QandeelError('VALIDATION_FAILED', 'expectedPublicName is a bounded display name', { field: 'model.expectedPublicName' });
  if (!Array.isArray(p.deployments) || p.deployments.length === 0 || p.deployments.length > 8) throw new QandeelError('VALIDATION_FAILED', 'a profile has 1..8 deployments', { field: 'deployments' });
  const deployments = p.deployments.map((d, i) => {
    const o = d as Partial<ProvisioningDeployment> | null;
    const field = `deployments[${i}]`;
    const cls = assertReasoningClass(o?.reasoningClass, `${field}.reasoningClass`);
    if (cls === 'E0') throw new QandeelError('VALIDATION_FAILED', 'E0 is NO_LLM and has no deployment', { field: `${field}.reasoningClass` });
    if (!Array.isArray(o?.taskClasses) || o.taskClasses.length === 0 || o.taskClasses.length > 32) throw new QandeelError('VALIDATION_FAILED', 'a deployment names 1..32 task classes', { field: `${field}.taskClasses` });
    return {
      code: assertCode(o?.code, `${field}.code`),
      reasoningClass: cls,
      pinnedRevision: assertCode(o?.pinnedRevision, `${field}.pinnedRevision`),
      contextWindowTokens: assertTokens(o?.contextWindowTokens, `${field}.contextWindowTokens`),
      maxOutputTokens: assertTokens(o?.maxOutputTokens, `${field}.maxOutputTokens`),
      taskClasses: [...new Set(o.taskClasses.map((t) => assertTaskClass(t, `${field}.taskClasses`)))],
    };
  });
  if (new Set(deployments.map((d) => d.code)).size !== deployments.length) throw new QandeelError('VALIDATION_FAILED', 'deployment codes are distinct', { field: 'deployments' });
  for (const d of deployments) if (d.maxOutputTokens >= d.contextWindowTokens) throw new QandeelError('VALIDATION_FAILED', 'maxOutputTokens must leave room for input inside the context window', { field: `deployment ${d.code}` });
  const card = p.priceCard as Omit<PriceCard, 'id' | 'version'> | undefined;
  if (!card) throw new QandeelError('VALIDATION_FAILED', 'a price card is required', { field: 'priceCard' });
  assertPriceCardRates(card);
  const egress = assertDataClass(p.egressMaxDataClass, 'egressMaxDataClass');
  // D4 is local-only and D3 external egress is closed (D-C2-13): an external profile never asks for more than D2.
  if (prov.locality === 'EXTERNAL' && (egress === 'D3' || egress === 'D4')) throw new QandeelError('EGRESS_DENIED', 'an external provider profile never exceeds D2 egress', { field: 'egressMaxDataClass' });
  if (!(QUALIFICATION_STATES as readonly string[]).includes(p.qualificationTarget as string) || p.qualificationTarget === 'QUALIFIED') throw new QandeelError('VALIDATION_FAILED', 'qualificationTarget is a pre-QUALIFIED state (QUALIFIED needs the Company\'s own qualification suite)', { field: 'qualificationTarget' });
  if (!Array.isArray(p.routePolicies) || p.routePolicies.length > 16) throw new QandeelError('VALIDATION_FAILED', 'routePolicies is a bounded list', { field: 'routePolicies' });
  const routePolicies = p.routePolicies.map((r) => {
    const o = r as Partial<{ taskClass: string; body: unknown }> | null;
    return { taskClass: assertTaskClass(o?.taskClass, 'routePolicies.taskClass'), body: assertRoutePolicyBody(o?.body) };
  });
  return {
    code,
    provider: { code: providerCode, locality: prov.locality, credentialRef },
    model: { code: modelCode, expectedPublicName: model.expectedPublicName },
    deployments,
    priceCard: {
      currency: card.currency,
      billingMode: card.billingMode,
      billedInputPerMTok: card.billedInputPerMTok,
      billedOutputPerMTok: card.billedOutputPerMTok,
      billedPerCall: card.billedPerCall,
      economicInputPerMTok: card.economicInputPerMTok,
      economicOutputPerMTok: card.economicOutputPerMTok,
      economicPerCall: card.economicPerCall,
      ...(card.billedCachedInputPerMTok !== undefined ? { billedCachedInputPerMTok: card.billedCachedInputPerMTok } : {}),
      ...(card.schedule !== undefined && card.schedule !== null ? { schedule: card.schedule } : {}),
    },
    egressMaxDataClass: egress,
    qualificationTarget: p.qualificationTarget as QualificationState,
    routePolicies,
  };
}

/** The digest a preview carries: what the Founder confirmed is exactly what is registered. */
export function provisioningProfileDigest(profile: ProviderProvisioningProfile): string {
  return sha256Hex(canonicalJson(assertProvisioningProfile(profile)));
}
