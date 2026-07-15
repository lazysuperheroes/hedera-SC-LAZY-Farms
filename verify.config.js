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
		// Mission is the clone master (template). Its source lives at contracts/Mission.sol,
		// so the default <ContractName>.sol path applies (no sourceName). Set
		// MISSION_TEMPLATE_CONTRACT_ID in .env after a redeploy for the harness to pick it up.
		{ contractName: 'Mission', envVars: ['MISSION_TEMPLATE_CONTRACT_ID'] },
	],
};
