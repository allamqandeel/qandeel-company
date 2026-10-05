/**
 * @qandeel-company/model-providers — L1-01 real provider adapters behind the C2 `ProviderAdapter` contract.
 * The governed Model Runtime is the only caller of `generate` (verifier `model-calls-confined`); an adapter
 * knows its provider's HTTP details and nothing of Company authority, Work, budgets or tools.
 */
export * from './deepseek/declaration.js';
export * from './deepseek/pricing.js';
export * from './deepseek/transport.js';
export * from './deepseek/https-transport.js';
export * from './deepseek/adapter.js';
