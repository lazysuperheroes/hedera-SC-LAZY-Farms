/**
 * Claim farming rewards and exit mission
 * Refactored to use shared utilities
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult } = require('../../utils/scriptHelpers');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { setHbarAllowance } = require('../../utils/hederaHelpers');
const { checkHbarAllowances } = require('../../utils/hederaMirrorHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({
		requireOperator: true,
		requireEnvVars: ['LAZY_TOKEN_ID', 'BOOST_MANAGER_CONTRACT_ID'],
	});

	const boostManagerId = ContractId.fromString(process.env.BOOST_MANAGER_CONTRACT_ID);

	const args = parseArgs(1, 'claimFarmingRewards.js 0.0.MMMM', ['MMM is the mission address']);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'Claim Farming Rewards',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
	});

	const missionIface = loadInterface('Mission');

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = missionIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return missionIface.decodeFunctionResult(fcnName, result);
	};

	// Check end time
	const userEndAndBoost = await query('getUserEndAndBoost', [operatorId.toSolidityAddress()]);
	const userEnd = Number(userEndAndBoost[0]);
	const userBoost = Boolean(userEndAndBoost[1]);

	console.log('Mission Completes:', userEnd, '->', new Date(userEnd * 1000).toISOString(), 'Boost:', userBoost);

	if (userEnd > Date.now() / 1000) {
		console.log('Mission not yet completed');
		return;
	}

	console.log('Mission Completed - to withdraw you need an allowance to the Mission for hbar');
	console.log('\nChecking Allowances...');

	// Check HBAR allowances
	const hbarAllowances = await checkHbarAllowances(env, operatorId);
	let missionAllowance = hbarAllowances.some(a => a.spender === contractId.toString());
	let boostAllowance = hbarAllowances.some(a => a.spender === boostManagerId.toString());

	if (!missionAllowance) {
		console.log('ERROR: Insufficient HBAR allowance to Mission');
		confirmOrExit('Do you want to set the allowance?');

		const res = await setHbarAllowance(client, operatorId, contractId, 10);
		if (res[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Error setting HBAR allowance:', res);
			return;
		}
		console.log('ALLOWANCE SET: 10 Tinybar allowance to Mission');
	}

	// Check if boost requires additional allowance
	if (userBoost) {
		const boostInfo = await query('getUsersBoostInfo', [operatorId.toSolidityAddress()]);
		const boostType = Number(boostInfo[0]);

		if (boostType === 2 && !boostAllowance) {
			console.log('Mission has a gem boost, you need an allowance to the boost manager');
			confirmOrExit('Do you want to set the allowance?');

			const res = await setHbarAllowance(client, operatorId, boostManagerId, 1);
			if (res[0]?.status?.toString() !== 'SUCCESS') {
				console.log('Error setting HBAR allowance to Boost Manager:', res);
				return;
			}
			console.log('ALLOWANCE SET: 1 Tinybar allowance to Boost Manager');
		}
	}

	confirmOrExit('Do you want to claim rewards and exit the mission?');

	const result = await contractExecuteFunction(
		contractId,
		missionIface,
		client,
		GAS.MISSION_ENTER,
		'claimRewards',
		[],
	);

	logResult(result, 'Rewards Claimed');
};

runScript(main);
