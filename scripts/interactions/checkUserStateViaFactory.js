/**
 * Check user state via MissionFactory contract
 * Refactored to use shared utilities
 */
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(2, 'checkUserStateViaFactory.js 0.0.MMM 0.0.UUU', [
		'MMM is the mission factory address',
		'UUU is the user address',
	]);

	const contractId = ContractId.fromString(args[0]);
	const userAddress = AccountId.fromString(args[1]);

	printHeader({
		scriptName: 'Check User State (Factory)',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'User': userAddress.toString(),
		},
	});

	const missionFactoryIface = loadInterface('MissionFactory');

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = missionFactoryIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return missionFactoryIface.decodeFunctionResult(fcnName, result);
	};

	// Check isAdmin
	const adminResult = await query('isAdmin', [userAddress.toSolidityAddress()]);
	console.log('Is Admin?:', adminResult[0]);

	// Check isDeployer
	const deployerResult = await query('isDeployer', [userAddress.toSolidityAddress()]);
	console.log('Is Deployer?:', deployerResult[0]);

	// Get live missions
	const liveMissionsResult = await query('getLiveMissions', [userAddress.toSolidityAddress()]);
	console.log('Live Missions:', liveMissionsResult);

	const missionList = liveMissionsResult[0];
	const isBoostedList = liveMissionsResult[2];

	// For each mission, get details and boost info if applicable
	for (let i = 0; i < missionList.length; i++) {
		const missionAddress = missionList[i];

		const missionDetails = await query('getUsersMissionParticipation', [
			userAddress.toSolidityAddress(),
			missionAddress,
		]);

		console.log('\n\nMission:', missionAddress.toString());
		console.log('Details:', missionDetails);

		if (isBoostedList[i]) {
			const boostType = await query('getUsersBoostStatus', [
				userAddress.toSolidityAddress(),
				missionAddress,
			]);
			console.log('Boost Type:', boostType);
		}
	}
};

runScript(main);
