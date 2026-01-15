/**
 * Update max reward rates for stakeable NFT collections in LazyNFTStaking contract
 * Refactored to use shared utilities
 *
 * Note: This does NOT add collections, it only updates the max reward rate for existing collections.
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, parseCommaList } = require('../../utils/scriptHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'updateStakeableCollection.js 0.0.SSS 0.0.CCC1,0.0.CCC2,0.0.CCC3 R1,R2,R3', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'0.0.CCC1,0.0.CCC2,0.0.CCC3 is the collections to update (comma separated - no spaces)',
		'R1,R2,R3 is new max reward rate per collection (comma separated - no spaces)',
		'Example: updateStakeableCollection.js 0.0.12345 0.0.123,0.0.456,0.0.789 1,2,3',
		'Reward Rate in whole $LAZY that can be earned per period',
		'NOTE: This does NOT add collections, it REPLACES the current max reward rate ONLY',
	]);

	const contractId = ContractId.fromString(args[0]);
	const tokenList = parseCommaList(args[1]).map(t => TokenId.fromString(t));
	const rewardRates = parseCommaList(args[2]).map(r => parseInt(r));

	// Validate reward rates match token list
	if (tokenList.length !== rewardRates.length) {
		console.log('ERROR: Reward rates length must match token list length');
		process.exit(1);
	}

	printHeader({
		scriptName: 'Update Max Reward Rates for Collections',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Collections': tokenList.map(t => t.toString()).join(', '),
			'New Reward Rates': rewardRates.join(', '),
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	confirmOrExit('Do you want to update the max reward rates for these Stakable Collections?');

	const tokenListAsSolidity = tokenList.map(t => t.toSolidityAddress());
	const gas = GAS.ADMIN_CALL + tokenList.length * 100_000;

	const result = await contractExecuteFunction(
		contractId,
		lnsIface,
		client,
		gas,
		'updateMaxBaseRate',
		[tokenListAsSolidity, rewardRates],
	);

	logResult(result, 'Collection max rates updated');
};

runScript(main);
