/**
 * Add collection to a boost level with specific locked serials in BoostManager
 * Use this when a single collection has different rarity tiers per serial.
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, confirmOrExit, logResult, runScript, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { getLevel, lookupLevel } = require('../../utils/LazyFarmingHelper');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'addCollectionToBoostLevelWithLockedSerials.js 0.0.BBB <rank> 0.0.GGGG <serials>', [
		'0.0.BBB is the BoostManager contract to update',
		'<rank> is the boost level (0 - 5 or C|R|SR|UR|LR|SPE)',
		'0.0.GGGG is the collection address',
		'<serials> is a comma-separated list of serial numbers to lock at this level',
	]);

	const contractId = ContractId.fromString(args[0]);
	const token = TokenId.fromString(args[2]);
	const serials = args[3].split(',').map(s => parseInt(s, 10));

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

	if (serials.length === 0 || serials.some(isNaN)) {
		console.log('ERROR: Must provide at least one valid serial number');
		process.exit(1);
	}

	printHeader({
		scriptName: 'Add Collection to Boost Level (Serial Locked)',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Rank': `${rank} (${lookupLevel(rank)})`,
			'Collection': token.toString(),
			'Serials': serials.join(', '),
		},
	});

	confirmOrExit('Do you want to add this collection with locked serials?');

	const boostManagerIface = loadInterface('BoostManager');
	const multisigOptions = getMultisigOptions();

	const result = await contractExecuteWithMultisig(
		contractId,
		boostManagerIface,
		client,
		1_300_000,
		'addCollectionToBoostLevelWithLockedSerials',
		[rank, token.toSolidityAddress(), serials],
		multisigOptions,
	);

	logResult(result, 'Add collection with locked serials');
};

runScript(main);
