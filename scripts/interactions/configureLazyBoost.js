/**
 * Configure $LAZY boost settings in BoostManager
 * Refactored to use shared utilities
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient, getLazyDecimals } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, confirmOrExit, logResult, runScript } = require('../../utils/scriptHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });
	const lazyDecimals = getLazyDecimals();

	const args = parseArgs(4, 'configureLazyBoost.js 0.0.BBB <amount> <percentage> <burn>', [
		'0.0.BBB is the BoostManager contract to update',
		'<amount> is the amount of lazy boost',
		'<percentage> is the percentage to reduce mission time (1-100)',
		'<burn> is the % of $LAZY to burn (0-100)',
	]);

	const contractId = ContractId.fromString(args[0]);

	let lazyAmt, reductionPercentage, burnPercentage;
	try {
		lazyAmt = parseInt(args[1], 10);
		reductionPercentage = parseInt(args[2], 10);
		burnPercentage = parseInt(args[3], 10);

		if (reductionPercentage < 1 || reductionPercentage > 100) {
			throw new Error('Reduction percentage must be 1-100');
		}
		if (burnPercentage < 0 || burnPercentage > 100) {
			throw new Error('Burn percentage must be 0-100');
		}
	}
	catch (err) {
		console.log('ERROR: Invalid parameters.', err.message);
		process.exit(1);
	}

	const rawLazy = lazyAmt * Math.pow(10, lazyDecimals);

	printHeader({
		scriptName: 'Configure $LAZY Boost',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Amount': `${lazyAmt} $LAZY (${rawLazy} raw)`,
			'Reduction %': `${reductionPercentage}%`,
			'Burn %': `${burnPercentage}%`,
		},
	});

	confirmOrExit('Do you want to update the $LAZY boost?');

	const boostManagerIface = loadInterface('BoostManager');

	// Set cost
	let result = await contractExecuteFunction(
		contractId,
		boostManagerIface,
		client,
		null,
		'setLazyBoostCost',
		[rawLazy],
	);

	if (!logResult(result, '$LAZY Boost Cost update')) {
		return;
	}

	// Set reduction percentage
	result = await contractExecuteFunction(
		contractId,
		boostManagerIface,
		client,
		null,
		'setLazyBoostReduction',
		[reductionPercentage],
	);

	if (!logResult(result, '$LAZY Boost Reduction % update')) {
		return;
	}

	// Set burn percentage
	result = await contractExecuteFunction(
		contractId,
		boostManagerIface,
		client,
		null,
		'setLazyBurnPercentage',
		[burnPercentage],
	);

	logResult(result, '$LAZY Burn % update');
};

runScript(main);
