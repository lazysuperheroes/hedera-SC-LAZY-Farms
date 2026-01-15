/**
 * Check if user has boost for a mission via BoostManager
 * Refactored to use shared utilities
 */
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'checkHasBoost.js 0.0.BBB 0.0.UUU 0.0.MMM', [
		'BBB is the BoostManager address',
		'UUU is the user address',
		'MMM is the mission address',
	]);

	const contractId = ContractId.fromString(args[0]);
	const userAddress = AccountId.fromString(args[1]);
	const missionAddressEVM = await getContractEVMAddress(env, args[2]);
	const missionAddress = ContractId.fromEvmAddress(0, 0, missionAddressEVM);

	printHeader({
		scriptName: 'Check Has Boost',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'User': userAddress.toString(),
			'Mission': missionAddress.toString(),
		},
	});

	const boostManagerIface = loadInterface('BoostManager');

	// Query hasBoost
	const encodedCommand = boostManagerIface.encodeFunctionData('hasBoost', [
		userAddress.toSolidityAddress(),
		missionAddress.toSolidityAddress(),
	]);

	const result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const boostDetails = boostManagerIface.decodeFunctionResult('hasBoost', result);
	console.log('Has Boost:', boostDetails);
};

runScript(main);
