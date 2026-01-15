/**
 * Configure gem boost reduction percentage for a specific level in BoostManager
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, confirmOrExit, logResult, runScript, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { getLevel, lookupLevel } = require('../../utils/LazyFarmingHelper');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'configureGemBoost.js 0.0.BBB <rank> <percentage>', [
		'0.0.BBB is the BoostManager contract to update',
		'<rank> is the boost level (0 - 5 or C|R|SR|UR|LR|SPE)',
		'<percentage> is the percentage to reduce mission time (1-100)',
	]);

	const contractId = ContractId.fromString(args[0]);

	let rank, reductionPercentage;
	try {
		rank = getLevel(args[1]);
		if (rank < 0 || rank > 5) {
			throw new Error('Invalid rank');
		}
		reductionPercentage = parseInt(args[2], 10);
		if (reductionPercentage < 1 || reductionPercentage > 100) {
			throw new Error('Percentage must be 1-100');
		}
	}
	catch (err) {
		console.log('ERROR: Invalid parameters.', err.message);
		process.exit(1);
	}

	printHeader({
		scriptName: 'Configure Gem Boost',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Rank': `${rank} (${lookupLevel(rank)})`,
			'Reduction %': `${reductionPercentage}%`,
		},
	});

	confirmOrExit('Do you want to update the gem boost?');

	const boostManagerIface = loadInterface('BoostManager');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		boostManagerIface,
		client,
		null,
		'setGemBoostReduction',
		[rank, reductionPercentage],
		multisigOptions,
	);

	logResult(result, 'Gem Level Boost update');
};

runScript(main);
