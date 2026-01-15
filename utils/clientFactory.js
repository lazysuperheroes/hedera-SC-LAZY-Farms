/**
 * Centralized Hedera Client Factory
 * Eliminates duplicated client initialization code across all scripts
 */
const {
	Client,
	AccountId,
	PrivateKey,
} = require('@hashgraph/sdk');
require('dotenv').config();

/**
 * Creates and configures a Hedera client based on environment settings
 * @param {Object} options - Configuration options
 * @param {boolean} options.requireOperator - If true, exits on missing operator credentials (default: true)
 * @param {boolean} options.requireSigningKey - If true, validates SIGNING_KEY is present (default: false)
 * @param {string[]} options.requireEnvVars - Additional env vars that must be present
 * @returns {{
 *   client: Client,
 *   operatorId: AccountId,
 *   operatorKey: PrivateKey,
 *   signingKey: PrivateKey | null,
 *   env: string
 * }}
 */
function createHederaClient(options = {}) {
	const {
		requireOperator = true,
		requireSigningKey = false,
		requireEnvVars = [],
	} = options;

	// Load environment
	const env = process.env.ENVIRONMENT ?? null;

	// Load operator credentials
	let operatorKey = null;
	let operatorId = null;
	let signingKey = null;

	try {
		if (process.env.PRIVATE_KEY) {
			operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
		}
		if (process.env.ACCOUNT_ID) {
			operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
		}
	}
	catch (err) {
		console.log('ERROR: Failed to parse PRIVATE_KEY or ACCOUNT_ID from .env file');
		console.log(err.message);
	}

	// Load signing key if available (ECDSA for signature verification)
	try {
		if (process.env.SIGNING_KEY) {
			signingKey = PrivateKey.fromStringECDSA(process.env.SIGNING_KEY);
		}
	}
	catch (err) {
		console.log('WARNING: Failed to parse SIGNING_KEY from .env file');
	}

	// Validate required operator credentials
	if (requireOperator && (!operatorKey || !operatorId)) {
		console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
		process.exit(1);
	}

	// Validate signing key if required
	if (requireSigningKey && !signingKey) {
		console.log('ERROR: Must specify SIGNING_KEY (ECDSA) in the .env file');
		process.exit(1);
	}

	// Validate additional required env vars
	for (const varName of requireEnvVars) {
		if (!process.env[varName]) {
			console.log(`ERROR: Must specify ${varName} in the .env file`);
			process.exit(1);
		}
	}

	// Validate environment
	if (!env) {
		console.log('ERROR: Must specify ENVIRONMENT (TEST, MAIN, PREVIEW, or LOCAL) in .env file');
		process.exit(1);
	}

	// Create client based on environment
	let client;
	const envUpper = env.toUpperCase();

	switch (envUpper) {
	case 'TEST':
		client = Client.forTestnet();
		console.log('Using *TESTNET*');
		break;
	case 'MAIN':
		client = Client.forMainnet();
		console.log('Using *MAINNET*');
		break;
	case 'PREVIEW':
		client = Client.forPreviewnet();
		console.log('Using *PREVIEWNET*');
		break;
	case 'LOCAL':
		client = Client.forNetwork({ '127.0.0.1:50211': new AccountId(3) })
			.setMirrorNetwork('127.0.0.1:5600');
		console.log('Using *LOCAL*');
		break;
	default:
		console.log('ERROR: ENVIRONMENT must be TEST, MAIN, PREVIEW, or LOCAL');
		process.exit(1);
	}

	// Set operator if available
	if (operatorKey && operatorId) {
		client.setOperator(operatorId, operatorKey);
	}

	return {
		client,
		operatorId,
		operatorKey,
		signingKey,
		env,
	};
}

/**
 * Gets common token/contract IDs from environment
 * @returns {{
 *   lazyTokenId: TokenId | null,
 *   lazyGasStationId: AccountId | null,
 *   lazyNftStakingId: ContractId | null,
 *   missionFactoryId: ContractId | null
 * }}
 */
function getCommonContractIds() {
	const { TokenId, ContractId } = require('@hashgraph/sdk');

	let lazyTokenId = null;
	let lazyGasStationId = null;
	let lazyNftStakingId = null;
	let missionFactoryId = null;

	try {
		if (process.env.LAZY_TOKEN_ID) {
			lazyTokenId = TokenId.fromString(process.env.LAZY_TOKEN_ID);
		}
	}
	catch (err) {
		// Optional - don't exit
	}

	try {
		if (process.env.LAZY_GAS_STATION_CONTRACT_ID) {
			lazyGasStationId = ContractId.fromString(process.env.LAZY_GAS_STATION_CONTRACT_ID);
		}
	}
	catch (err) {
		// Optional - don't exit
	}

	try {
		if (process.env.LAZY_NFT_STAKING_CONTRACT_ID) {
			lazyNftStakingId = ContractId.fromString(process.env.LAZY_NFT_STAKING_CONTRACT_ID);
		}
	}
	catch (err) {
		// Optional - don't exit
	}

	try {
		if (process.env.MISSION_FACTORY_CONTRACT_ID) {
			missionFactoryId = ContractId.fromString(process.env.MISSION_FACTORY_CONTRACT_ID);
		}
	}
	catch (err) {
		// Optional - don't exit
	}

	return {
		lazyTokenId,
		lazyGasStationId,
		lazyNftStakingId,
		missionFactoryId,
	};
}

/**
 * Gets the LAZY token decimals from environment
 * @returns {number}
 */
function getLazyDecimals() {
	return parseInt(process.env.LAZY_DECIMALS ?? '1', 10);
}

module.exports = {
	createHederaClient,
	getCommonContractIds,
	getLazyDecimals,
};
