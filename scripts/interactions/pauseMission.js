/**
 * Pause a mission (admin only)
 * Refactored to use shared utilities
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult } = require('../../utils/scriptHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'pauseMission.js 0.0.MMMM', ['MMM is the mission address']);

	const missionAsEVM = await getContractEVMAddress(env, args[0]);
	const contractId = ContractId.fromEvmAddress(0, 0, missionAsEVM);

	printHeader({
		scriptName: 'Pause Mission',
		env,
		operatorId: operatorId.toString(),
		contractId: `${contractId.toString()} HAPI: ${args[0]}`,
	});

	const missionIface = loadInterface('Mission');

	confirmOrExit('Do you want to pause the mission?');

	const result = await contractExecuteFunction(
		contractId,
		missionIface,
		client,
		GAS.CONTRACT_DEPLOY,
		'updatePauseStatus',
		[true],
	);

	logResult(result, 'Mission Paused');
};

runScript(main);
