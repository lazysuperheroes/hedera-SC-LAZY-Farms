/**
 * Leave a mission early (without rewards)
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { setHbarAllowance } = require('../../utils/hederaHelpers');
const { getContractEVMAddress, checkHbarAllowances } = require('../../utils/hederaMirrorHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({
		requireOperator: true,
		requireEnvVars: ['LAZY_TOKEN_ID', 'BOOST_MANAGER_CONTRACT_ID'],
	});

	const boostManagerId = ContractId.fromString(process.env.BOOST_MANAGER_CONTRACT_ID);

	const args = parseArgs(1, 'leaveMission.js 0.0.MMMM', ['MMM is the mission address']);

	const missionAsEVM = await getContractEVMAddress(env, args[0]);
	const contractId = ContractId.fromEvmAddress(0, 0, missionAsEVM);

	printHeader({
		scriptName: 'Leave Mission',
		env,
		operatorId: operatorId.toString(),
		contractId: `${contractId.toString()} HAPI: ${args[0]}`,
	});

	const missionIface = loadInterface('Mission');

	// Helper for mirror node queries
	const query = async (fcnName, params = []) => {
		const encoded = missionIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return missionIface.decodeFunctionResult(fcnName, result);
	};

	// Check mission end time
	const userEndAndBoost = await query('getUserEndAndBoost', [operatorId.toSolidityAddress()]);
	const userEnd = Number(userEndAndBoost[0]);

	console.log('Mission Completes:', userEnd, '->', new Date(userEnd * 1000).toISOString());

	if (userEnd < Date.now() / 1000) {
		console.log('Mission completed. Try claiming rewards instead');
		return;
	}

	console.log('To withdraw you need an allowance to the Mission for HBAR dust');
	console.log('\nChecking Allowances...');

	// Check HBAR allowances
	const mirrorHbarAllowances = await checkHbarAllowances(env, operatorId);
	let missionAllowance = mirrorHbarAllowances.some(a => a.spender === contractId.toString() && a.amount >= 10);
	let boostAllowance = mirrorHbarAllowances.some(a => a.spender === boostManagerId.toString() && a.amount >= 1);

	if (missionAllowance) {
		console.log('FOUND: Sufficient Hbar allowance to Mission');
	}
	else {
		console.log('ERROR: Insufficient HBAR allowance to Mission');
		confirmOrExit('Do you want to set the allowance?');

		const res = await setHbarAllowance(client, operatorId, contractId, 10);
		if (res !== 'SUCCESS') {
			console.log('Error setting HBAR allowance:', res);
			return;
		}
		console.log('ALLOWANCE SET: 10 tinybar allowance to Mission');
	}

	// Check if boost requires additional allowance
	if (!boostAllowance) {
		const boostInfo = await query('getUsersBoostInfo', [operatorId.toSolidityAddress()]);
		const boostType = Number(boostInfo[0]);

		if (boostType === 2) {
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

	confirmOrExit('Do you want to exit the mission (no rewards)?');

	const multisigOptions = getMultisigOptions();
	const result = await contractExecuteWithMultisig(
		contractId,
		missionIface,
		client,
		GAS.MISSION_ENTER,
		'leaveMission',
		[],
		multisigOptions,
	);

	logResult(result, 'Mission Exited');
};

runScript(main);
