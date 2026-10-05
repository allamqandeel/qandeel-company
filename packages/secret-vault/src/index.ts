/**
 * @qandeel-company/secret-vault — the L1-01 secret boundary (Stage 14 D14-A.4/.5, D14-D.5; D-L1-02).
 *
 * Company state, prompts, artifacts, logs, audit, events and command lines carry only opaque `vault:<name>`
 * references. A governed executor (the Model Runtime's provider adapter, a Tool driver's credential source)
 * resolves a reference privately, inside a callback, for one call. The Windows vault is Current-User DPAPI
 * through the signed Windows PowerShell host — the one reviewed process path in the repository.
 */
export { InMemorySecretVault, VAULT_REF, VaultError, assertSecretValue, vaultName, type SecretVault, type VaultErrorCode } from './vault.js';
export { WindowsUserVault, VAULT_FORMAT, defaultVaultDirectory, type WindowsUserVaultOptions } from './windows-dpapi.js';
