/**
 * Add requirement and reward collections to a Mission contract
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, parseCommaList } = require('../../utils/scriptHelpers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(3, 'addRequirementAndRewardCollectionsToMission.js 0.0.MMMM 0.0.Req1,0.0.Req2 0.0.Rew1,0.0.Rew2', [
		'MMMM is the mission address',
		'Req1,Req2 are the requirement collection addresses (comma separated - no spaces)',
		'Rew1,Rew2 are the reward collection addresses (comma separated - no spaces)',
	]);

	const contractId = ContractId.fromString(args[0]);
	const requirementCollectionIds = parseCommaList(args[1]).map(id => TokenId.fromString(id));
	const rewardCollectionIds = parseCommaList(args[2]).map(id => TokenId.fromString(id));

	printHeader({
		scriptName: 'Add Requirement & Reward Collections to Mission',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Requirement Collections': requirementCollectionIds.map(id => id.toString()).join(', '),
			'Reward Collections': rewardCollectionIds.map(id => id.toString()).join(', '),
		},
	});

	const missionIface = loadInterface('Mission');

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = missionIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return missionIface.decodeFunctionResult(fcnName, result);
	};

	// Display current rewards
	const rewards = await query('getRewards');
	console.log('\nCurrent Rewards:');
	for (let i = 0; i < rewards[0].length; i++) {
		console.log(`  Token: ${TokenId.fromSolidityAddress(rewards[0][i])}`);
		console.log(`    Serials: ${rewards[1][i].map(s => Number(s)).join(', ')}`);
	}

	// Display current requirements
	const requirements = await query('getRequirements');
	console.log('\nCurrent Requirements (Entry Collateral):');
	for (let i = 0; i < requirements[0].length; i++) {
		console.log(`  Token: ${TokenId.fromSolidityAddress(requirements[0][i])}`);
		const serialLock = Boolean(requirements[1][i]);
		if (serialLock) {
			console.log(`    Only Serials: ${requirements[2][i].map(s => Number(s)).join(', ')}`);
		}
		else {
			console.log('    All Serials');
		}
	}

	confirmOrExit('\nDo you want to add these requirement/reward collections to the mission?');

	const result = await contractExecuteFunction(
		contractId,
		missionIface,
		client,
		GAS.ADMIN_CALL * 2 + (requirementCollectionIds.length + rewardCollectionIds.length) * 500_000,
		'addRequirementAndRewardCollections',
		[
			requirementCollectionIds.map(id => id.toSolidityAddress()),
			rewardCollectionIds.map(id => id.toSolidityAddress()),
		],
	);

	if (!logResult(result, 'Collections Added')) {
		return;
	}

	// Display updated rewards
	const newRewards = await query('getRewards');
	console.log('\nUpdated Rewards:');
	for (let i = 0; i < newRewards[0].length; i++) {
		console.log(`  Token: ${TokenId.fromSolidityAddress(newRewards[0][i])}`);
		console.log(`    Serials: ${newRewards[1][i].map(s => Number(s)).join(', ')}`);
	}

	// Display updated requirements
	const newRequirements = await query('getRequirements');
	console.log('\nUpdated Requirements (Entry Collateral):');
	for (let i = 0; i < newRequirements[0].length; i++) {
		console.log(`  Token: ${TokenId.fromSolidityAddress(newRequirements[0][i])}`);
		const serialLock = Boolean(newRequirements[1][i]);
		if (serialLock) {
			console.log(`    Only Serials: ${newRequirements[2][i].map(s => Number(s)).join(', ')}`);
		}
		else {
			console.log('    All Serials');
		}
	}
};

runScript(main);
