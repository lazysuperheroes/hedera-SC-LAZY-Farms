/**
 * Add stakeable NFT collections to LazyNFTStaking contract
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient, getCommonContractIds, getLazyDecimals } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, parseCommaList, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { getTokenDetails } = require('../../utils/hederaMirrorHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({
		requireOperator: true,
		requireEnvVars: ['LAZY_TOKEN_ID'],
	});

	const args = parseArgs(3, 'addStakableCollection.js 0.0.SSS 0.0.CCC1,0.0.CCC2,0.0.CCC3 R1,R2,R3', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'0.0.CCC1,0.0.CCC2,0.0.CCC3 is the collections to add (comma separated - no spaces)',
		'R1,R2,R3 is max reward rate per collection (comma separated - no spaces)',
		'Example: addStakableCollection.js 0.0.12345 0.0.123,0.0.456,0.0.789 1,2,3',
		'Reward Rate in whole $LAZY that can be earned per period',
	]);

	const contractId = ContractId.fromString(args[0]);
	const tokenList = parseCommaList(args[1]).map(t => TokenId.fromString(t));
	const rewardRates = parseCommaList(args[2]).map(r => parseInt(r));

	// Validate token list size
	if (tokenList.length > 12) {
		console.log('ERROR: Too many tokens in the list. Max is 12');
		process.exit(1);
	}

	// Validate reward rates match token list
	if (tokenList.length !== rewardRates.length) {
		console.log('ERROR: Reward rates length must match token list length');
		process.exit(1);
	}

	// Get LAZY token info for display
	const { lazyTokenId } = getCommonContractIds();
	const lazyTokenInfo = await getTokenDetails(env, lazyTokenId);
	const lazyDecimals = getLazyDecimals();

	printHeader({
		scriptName: 'Add Collections for Staking',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Collections': tokenList.map(t => t.toString()).join(', '),
		},
	});

	// Display each token with its info and reward rate
	console.log('\nCollection Details:');
	for (let i = 0; i < tokenList.length; i++) {
		const token = tokenList[i];
		const tokenInfo = await getTokenDetails(env, token.toString());
		console.log(`  ${token.toString()}`);
		console.log(`    Symbol: ${tokenInfo.symbol}, Name: ${tokenInfo.name}`);
		console.log(`    Max Reward Rate: ${rewardRates[i] / Math.pow(10, lazyDecimals)} ${lazyTokenInfo.symbol}`);
	}

	console.log('\nReward Rates (raw):', rewardRates.join(', '));

	const lnsIface = loadInterface('LazyNFTStaking');

	confirmOrExit('\nDo you want to add these Stakable Collections?');

	const multisigOptions = getMultisigOptions();

	const tokenListAsSolidity = tokenList.map(t => t.toSolidityAddress());
	const gas = GAS.ADMIN_CALL + tokenList.length * 1_000_000;

	const result = await contractExecuteWithMultisig(
		contractId,
		lnsIface,
		client,
		gas,
		'setStakeableCollection',
		[tokenListAsSolidity, rewardRates],
		multisigOptions,
	);

	logResult(result, 'Collections now stakeable');
};

runScript(main);
