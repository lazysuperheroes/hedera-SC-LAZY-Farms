/**
 * Set the period for HODL bonus on LazyNFTStaking contract
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { TIME } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'setStakingPeriodForHODLBonus.js 0.0.SSS <period>', [
		'0.0.SSS is the LazyNFTStaking contract to update',
		'<period> is the number of seconds for the HODL bonus period',
	]);

	const contractId = ContractId.fromString(args[0]);
	const secondsForHODL = parseInt(args[1]);

	if (secondsForHODL < 0) {
		console.log('Invalid HODL Bonus Period:', secondsForHODL);
		process.exit(1);
	}

	printHeader({
		scriptName: 'Setting HODL Period (Seconds)',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'NEW HODL Period': `${secondsForHODL} seconds (hours: ${secondsForHODL / TIME.HOUR} <-> days: ${secondsForHODL / TIME.DAY})`,
		},
	});

	const lnsIface = loadInterface('LazyNFTStaking');

	// Get the old periodForBonus from mirror
	const encodedCommand = lnsIface.encodeFunctionData('periodForBonus', []);

	const ohr = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
	);

	const oldHODLPeriod = lnsIface.decodeFunctionResult('periodForBonus', ohr);

	console.log('\n-Old HODL Period:', oldHODLPeriod, `seconds (hours: ${oldHODLPeriod / TIME.HOUR} <-> days: ${oldHODLPeriod / TIME.DAY})`);

	confirmOrExit('Do you want to update the HODL period?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		lnsIface,
		client,
		null,
		'setPeriodForBonus',
		[secondsForHODL],
		multisigOptions,
	);

	logResult(result, 'HODL Period updated');
};

runScript(main);
