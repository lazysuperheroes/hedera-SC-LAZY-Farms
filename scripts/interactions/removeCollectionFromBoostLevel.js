/**
 * Remove collection(s) from a boost level in BoostManager
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, confirmOrExit, runScript, parseCommaList } = require('../../utils/scriptHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getLevel, lookupLevel } = require('../../utils/LazyFarmingHelper');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'removeCollectionFromBoostLevel.js 0.0.BBB <rank> 0.0.GGGG1,0.0.GGGG2,0.0.GGGG3', [
		'0.0.BBB is the BoostManager contract to update',
		'<rank> is the boost level (0 - 5 or C|R|SR|UR|LR|SPE)',
		'0.0.GGGG is the collection to remove from the boost level',
	]);

	const contractId = ContractId.fromString(args[0]);
	const tokenList = parseCommaList(args[2]).map(t => TokenId.fromString(t));

	let rank;
	try {
		rank = getLevel(args[1]);
		if (rank < 0 || rank > 5) {
			throw new Error('Invalid rank');
		}
	}
	catch (err) {
		console.log('ERROR: Invalid rank. Must be 0-5 or C|R|SR|UR|LR|SPE', err.message);
		process.exit(1);
	}

	printHeader({
		scriptName: 'Remove Collection from Boost Level',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Rank': `${rank} (${lookupLevel(rank)})`,
			'Collection(s)': tokenList.map(t => t.toString()).join(', '),
		},
	});

	confirmOrExit('Do you want to update the Gem Collections?');

	const boostManagerIface = loadInterface('BoostManager');

	// Remove each token individually
	for (const token of tokenList) {
		const result = await contractExecuteFunction(
			contractId,
			boostManagerIface,
			client,
			300_000,
			'removeCollectionFromBoostLevel',
			[rank, token.toSolidityAddress()],
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Error removing:', token.toString(), result);
			return;
		}

		console.log(`Gem ${token.toString()} removed from Level ${lookupLevel(rank)}. Transaction ID:`, result[2]?.transactionId?.toString());
	}
};

runScript(main);
