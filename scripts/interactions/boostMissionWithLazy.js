/**
 * Boost a mission using $LAZY tokens (consumable boost)
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient, getCommonContractIds } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, formatTokenAmount, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { setFTAllowance } = require('../../utils/hederaHelpers');
const { getTokenDetails, checkFTAllowances, getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');
const { GAS } = require('../../utils/constants');

/**
 * Format time remaining for display
 */
function formatTimeRemaining(seconds) {
	return `${seconds} seconds -> ${Math.floor(seconds / 60)} minutes -> ${Math.floor(seconds / 3600)} hours -> ${Math.floor(seconds / 86400)} days`;
}

const main = async () => {
	const { client, operatorId, env } = createHederaClient({
		requireOperator: true,
		requireEnvVars: ['LAZY_GAS_STATION_CONTRACT_ID'],
	});

	const { lazyGasStationId } = getCommonContractIds();

	const args = parseArgs(2, 'boostMissionWithLazy.js 0.0.BBBB 0.0.MMMM', [
		'BBBB is the boost manager address',
		'MMMM is the mission address',
	]);

	const contractId = ContractId.fromString(args[0]);
	const missionAsEVM = await getContractEVMAddress(env, args[1]);
	const missionId = ContractId.fromEvmAddress(0, 0, missionAsEVM);

	printHeader({
		scriptName: 'Boost Mission with $LAZY (Consumable)',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Mission': `${missionId.toString()} -> ${args[1]}`,
		},
	});

	const boostIface = loadInterface('BoostManager');
	const missionIface = loadInterface('Mission');

	// Helper for mirror node queries
	const queryBoost = async (fcnName, params = []) => {
		const encoded = boostIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return boostIface.decodeFunctionResult(fcnName, result);
	};

	const queryMission = async (fcnName, params = []) => {
		const encoded = missionIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, missionId, encoded, operatorId, false);
		return missionIface.decodeFunctionResult(fcnName, result);
	};

	// Get current end time and boost status from Mission
	const currentEndAndBoost = await queryMission('getUserEndAndBoost', [operatorId.toSolidityAddress()]);
	console.log('\nUser has Boosted:', Boolean(currentEndAndBoost[1]));

	if (currentEndAndBoost[1]) {
		console.log('Already boosted, exiting...');
		process.exit(0);
	}

	const currEndTimestamp = Number(currentEndAndBoost[0]);

	if (currEndTimestamp === 0) {
		console.log('ERROR: User is not on this mission. Exiting...');
		process.exit(0);
	}

	console.log('Current end:', currEndTimestamp, '->', new Date(currEndTimestamp * 1000).toISOString());
	const timeRemaining = currEndTimestamp - Math.floor(Date.now() / 1000);
	console.log('Time remaining:', formatTimeRemaining(timeRemaining));

	// Get the cost in $LAZY to boost
	const cost = await queryBoost('lazyBoostCost', []);

	// Get the Lazy token ID
	const lazyToken = await queryBoost('lazyToken', []);
	const lazyTokenId = TokenId.fromSolidityAddress(lazyToken[0]);
	const lazyTokenDetails = await getTokenDetails(env, lazyTokenId);

	console.log('\nCost to boost:', formatTokenAmount(Number(cost[0]), lazyTokenDetails.decimals, lazyTokenDetails.symbol),
		`(${lazyTokenId.toString()})`);

	// Check the reduction percentage
	const reduction = await queryBoost('lazyBoostReduction', []);
	console.log('Consumable boost reduces time remaining by:', Number(reduction[0]), '%');

	// Check the user has the approval set to LGS for the cost
	const mirrorFTAllowances = await checkFTAllowances(env, operatorId);
	const costValue = Number(cost[0]);

	let hasAllowance = false;
	for (const allowance of mirrorFTAllowances) {
		if (allowance.token_id === lazyTokenId.toString() && allowance.spender === contractId.toString()) {
			if (allowance.amount >= costValue) {
				console.log('FOUND: Sufficient $LAZY allowance to BoostManager',
					formatTokenAmount(allowance.amount, lazyTokenDetails.decimals));
				hasAllowance = true;
			}
		}
	}

	if (!hasAllowance) {
		console.log('ERROR: Insufficient $LAZY allowance to BoostManager');
		confirmOrExit('Do you want to set the allowance?');

		const result = await setFTAllowance(
			client,
			lazyTokenId,
			operatorId,
			lazyGasStationId,
			costValue,
		);

		if (result[0]?.status?.toString() !== 'SUCCESS') {
			console.log('Error setting $LAZY allowance to LGS:', result);
			return;
		}

		console.log('ALLOWANCE SET:', formatTokenAmount(costValue, lazyTokenDetails.decimals, lazyTokenDetails.symbol),
			'allowance to LGS', lazyGasStationId.toString());
	}

	confirmOrExit('\nDo you want to Boost with $LAZY (consumable boost)?');

	const multisigOptions = getMultisigOptions();

	let result = await contractExecuteWithMultisig(
		contractId,
		boostIface,
		client,
		GAS.BOOST_ACTIVATE,
		'boostWithLazy',
		[missionId.toSolidityAddress()],
		multisigOptions,
	);

	if (!logResult(result, 'Boosted!')) {
		return;
	}

	// Get updated end time
	const newEndAndBoost = await queryMission('getUserEndAndBoost', [operatorId.toSolidityAddress()]);
	console.log('\nUser has Boosted:', Boolean(newEndAndBoost[1]));

	const newEndTimestamp = Number(newEndAndBoost[0]);
	console.log('New end:', newEndTimestamp, '->', new Date(newEndTimestamp * 1000).toISOString());
	const newTimeRemaining = newEndTimestamp - Math.floor(Date.now() / 1000);
	console.log('New time remaining:', formatTimeRemaining(newTimeRemaining));
};

runScript(main);
