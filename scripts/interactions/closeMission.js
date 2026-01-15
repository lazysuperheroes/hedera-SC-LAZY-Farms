/**
 * Close a mission (admin only)
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'closeMission.js 0.0.MMMM', ['MMM is the mission address']);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'Close Mission',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
	});

	const missionIface = loadInterface('Mission');

	confirmOrExit('Do you want to close the mission?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		missionIface,
		client,
		GAS.MISSION_LEAVE,
		'closeMission',
		[],
		multisigOptions,
	);

	logResult(result, 'Mission Closed');
};

runScript(main);
