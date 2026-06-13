/**
 * Registry for @lazysuperheroes/hedera-verify.
 *
 * Maps each deployed contract to the .env var(s) holding its Hedera ID, so
 * `npx hedera-verify harness` verifies everything that has an id set for the
 * current ENVIRONMENT.
 *
 * Add entries as more contracts are wired up for Sourcify verification.
 * Run `npx hedera-verify list-artifacts` to see contract names + sourceName.
 * Only add `sourceName` when the source path is NOT contracts/<ContractName>.sol.
 */
module.exports = {
	registry: [
		{ contractName: 'PrngSystemContract', envVars: ['PRNG_CONTRACT_ID'] },
	],
};
