/**
 * Named Constants
 * Replaces magic numbers with meaningful names across all scripts
 */

/**
 * Gas limits for common operations
 * Based on observed usage patterns in existing scripts
 */
const GAS = {
	// Standard operations
	DEFAULT: 100_000,
	STANDARD: 200_000,

	// Contract queries
	QUERY: 100_000,

	// Simple contract calls
	SIMPLE_CALL: 200_000,

	// Mission operations
	MISSION_ENTER: 2_000_000,
	MISSION_LEAVE: 1_500_000,
	MISSION_CLAIM: 1_500_000,

	// Staking operations (scales with number of tokens)
	STAKE_BASE: 400_000,
	STAKE_PER_TOKEN: 400_000,

	// NFT operations
	NFT_TRANSFER: 300_000,
	NFT_ALLOWANCE: 200_000,

	// Admin operations
	ADMIN_CALL: 300_000,

	// Boost operations
	BOOST_ACTIVATE: 500_000,

	// Deployment
	CONTRACT_DEPLOY: 800_000,
	MISSION_DEPLOY: 5_000_000,
};

/**
 * Helper to calculate gas for staking operations
 * @param {number} tokenCount - Number of tokens being staked
 * @returns {number} Calculated gas limit
 */
function calculateStakeGas(tokenCount) {
	return GAS.STAKE_BASE + (tokenCount * GAS.STAKE_PER_TOKEN);
}

/**
 * Mirror node polling/delay times (milliseconds)
 */
const DELAYS = {
	// Standard mirror node propagation delay
	MIRROR_NODE: 5000,

	// Short polling interval
	SHORT_POLL: 1000,

	// Long polling interval
	LONG_POLL: 10000,
};

/**
 * Token decimals for known tokens
 */
const DECIMALS = {
	LAZY: 1,       // $LAZY has 1 decimal
	HBAR: 8,       // HBAR has 8 decimals (tinybars)
	DEFAULT: 0,    // NFTs have 0 decimals
};

/**
 * Hedera precompile addresses
 */
const PRECOMPILES = {
	// HTS System Contract
	HTS: '0x0000000000000000000000000000000000000167',

	// PRNG System Contract
	PRNG: '0x0000000000000000000000000000000000000169',

	// Exchange Rate System Contract
	EXCHANGE_RATE: '0x0000000000000000000000000000000000000168',
};

/**
 * Common percentage bases
 */
const PERCENTAGE = {
	// Basis points (100% = 10000)
	BASIS_POINTS: 10000,

	// Simple percentage (100% = 100)
	SIMPLE: 100,
};

/**
 * Time constants (in seconds)
 */
const TIME = {
	MINUTE: 60,
	HOUR: 3600,
	DAY: 86400,
	WEEK: 604800,
};

/**
 * Network-specific constants
 */
const NETWORK = {
	LOCAL_NODE_ADDRESS: '127.0.0.1:50211',
	LOCAL_MIRROR_ADDRESS: '127.0.0.1:5600',
	LOCAL_NODE_ACCOUNT: 3,
};

module.exports = {
	GAS,
	calculateStakeGas,
	DELAYS,
	DECIMALS,
	PRECOMPILES,
	PERCENTAGE,
	TIME,
	NETWORK,
};
