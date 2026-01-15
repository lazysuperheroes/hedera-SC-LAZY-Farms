/**
 * Check user state via Mission contract
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

	const args = parseArgs(2, 'checkUserStateViaMission.js 0.0.MMM 0.0.UUU', [
		'MMM is the mission address',
		'UUU is the user address',
	]);

	const missionIdEVMAddress = await getContractEVMAddress(env, args[0]);
	const contractId = ContractId.fromEvmAddress(0, 0, missionIdEVMAddress);
	const userAddress = AccountId.fromString(args[1]);

	printHeader({
		scriptName: 'Check User State (Mission)',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'User': userAddress.toString(),
		},
	});

	const missionIface = loadInterface('Mission');

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = missionIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return missionIface.decodeFunctionResult(fcnName, result);
	};

	// Check isAdmin
	const adminResult = await query('isAdmin', [userAddress.toSolidityAddress()]);
	console.log('Is Admin?:', adminResult[0]);

	// Check isParticipant
	const participantResult = await query('isParticipant', [userAddress.toSolidityAddress()]);
	console.log('Is Participant?:', participantResult[0]);

	if (!participantResult[0]) {
		console.log('User is not partipating in this mission');
		return;
	}

	// Get mission participation details
	const participationDetails = await query('getMissionParticipation', [userAddress.toSolidityAddress()]);
	console.log('Mission Participation:', participationDetails);

	const isBoosted = Boolean(participationDetails[4]);

	if (isBoosted) {
		const boostType = await query('getUsersBoostInfo', [userAddress.toSolidityAddress()]);
		console.log('Boost Type:', boostType);
	}
};

runScript(main);
