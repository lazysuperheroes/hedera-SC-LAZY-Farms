/**
 * Unpause a mission (admin only)
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

	const args = parseArgs(1, 'unpauseMission.js 0.0.MMMM', ['MMM is the mission address']);

	const missionAsEVM = await getContractEVMAddress(env, args[0]);
	const contractId = ContractId.fromEvmAddress(0, 0, missionAsEVM);

	printHeader({
		scriptName: 'Unpause Mission',
		env,
		operatorId: operatorId.toString(),
		contractId: `${contractId.toString()} HAPI: ${args[0]}`,
	});

	const missionIface = loadInterface('Mission');

	confirmOrExit('Do you want to unpause the mission?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		missionIface,
		client,
		GAS.CONTRACT_DEPLOY,
		'updatePauseStatus',
		[false],
		multisigOptions,
	);

	logResult(result, 'Mission Unpaused');
};

runScript(main);
