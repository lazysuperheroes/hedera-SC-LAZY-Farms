/**
 * Set the start timestamp for a Mission
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'setMissionStart.js 0.0.MMMM <timestamp>', [
		'MMMM is the mission address',
		'<timestamp> is the start time (Unix timestamp in seconds)',
	]);

	const missionAsEVM = await getContractEVMAddress(env, args[0]);
	const contractId = ContractId.fromEvmAddress(0, 0, missionAsEVM);

	let startTimestamp;
	let startTime;
	try {
		startTimestamp = parseInt(args[1]);
		startTime = new Date(startTimestamp * 1000);
	}
	catch (err) {
		console.log('ERROR: Must be a valid timestamp as the second argument');
		console.log(args[1], err.message);
		process.exit(1);
	}

	printHeader({
		scriptName: 'Set Mission Start',
		env,
		operatorId: operatorId.toString(),
		contractId: `${contractId.toString()} (HAPI: ${args[0]})`,
		additionalInfo: {
			'Start Time': `${startTimestamp} -> ${startTime.toISOString()}`,
		},
	});

	const missionIface = loadInterface('Mission');

	confirmOrExit('Do you want to update the mission start time?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		missionIface,
		client,
		GAS.ADMIN_CALL,
		'setStartTimestamp',
		[startTimestamp],
		multisigOptions,
	);

	logResult(result, 'Start time updated');
};

runScript(main);
