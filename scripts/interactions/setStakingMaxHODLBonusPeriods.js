/**
 * Set the max HODL bonus periods on LazyNFTStaking contract
 * Refactored to use shared utilities
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult } = require('../../utils/scriptHelpers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'setStakingMaxHODLBonusPeriods.js 0.0.SSS <periods>', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'<periods> is the max periods for HODL bonus (default: 8)',
	]);

	const contractId = ContractId.fromString(args[0]);
	const hodlPeriods = parseInt(args[1]);

	if (hodlPeriods < 0) {
		console.log('Invalid HODL Bonus Period:', hodlPeriods);
		process.exit(1);
	}

	printHeader({
		scriptName: 'Setting HODL Bonus Period Cap',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'NEW HODL Bonus Period Cap': `${hodlPeriods} (default: 8)`,
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	// Get the old maxBonusTimePeriods from mirror
	const encodedCommand = lnsIface.encodeFunctionData('maxBonusTimePeriods', []);

	const ohr = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
	);

	const oldHODLPeriodCap = lnsIface.decodeFunctionResult('maxBonusTimePeriods', ohr);

	console.log('\n-Old HODL Period Cap:', oldHODLPeriodCap[0].toString());

	confirmOrExit('Do you want to update the HODL period Cap (default 8)?');

	const result = await contractExecuteFunction(
		contractId,
		lnsIface,
		client,
		null,
		'setMaxBonusTimePeriods',
		[hodlPeriods],
	);

	logResult(result, 'HODL Period Cap updated');
};

runScript(main);
