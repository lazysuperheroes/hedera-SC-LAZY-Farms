/**
 * Get comprehensive Mission contract information
 * Refactored to use shared utilities
 */
const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getTokenDetails, getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'getMissionInfo.js 0.0.MMMM', ['MMM is the mission address']);

	const missionIdEVMAddress = await getContractEVMAddress(env, args[0]);
	const contractId = ContractId.fromEvmAddress(0, 0, missionIdEVMAddress);

	printHeader({
		scriptName: 'Mission Info',
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

	// Basic mission state
	const missionPaused = await query('isPaused');
	console.log('Mission Paused:', missionPaused[0]);

	const slotsRemaining = await query('getSlotsRemaining');
	console.log('Slots Remaining:', Number(slotsRemaining[0]));

	// Get lazy token and its details
	const lazyTokenObj = await query('lazyToken');
	const lazyToken = TokenId.fromSolidityAddress(lazyTokenObj[0]);
	const lazyTokenDetails = await getTokenDetails(env, lazyToken);

	// Entry fee
	const entryFee = await query('entryFee');
	console.log('Entry Fee:', Number(entryFee[0]) / Math.pow(10, lazyTokenDetails.decimals), `$${lazyTokenDetails.symbol}`);

	// Decrement details (Dutch auction)
	const decrementDetails = await query('getDecrementDetails');
	const decrementInterval = Number(decrementDetails[0]);
	const decrementStartTime = Number(decrementDetails[1]);
	if (decrementStartTime > 0) {
		console.log('**DUTCH AUCTION engaged');
		console.log('Decrement every:', decrementInterval, 'seconds (', decrementInterval / 60, 'minutes)');
		console.log('Decrement Start Time:', new Date(decrementStartTime * 1000).toUTCString());
	}
	else {
		console.log('Fixed Cost Entry');
	}

	// Users on mission
	const usersOnMission = await query('getUsersOnMission');
	console.log('Users on Mission:', usersOnMission[0]);

	// Contract references
	const boostManager = await query('boostManager');
	console.log('Boost Manager:', ContractId.fromEvmAddress(0, 0, boostManager[0]).toString());

	const prngGenerator = await query('prngGenerator');
	console.log('PRNG Generator:', ContractId.fromEvmAddress(0, 0, prngGenerator[0]).toString());

	const missionFactory = await query('missionFactory');
	console.log('Mission Factory:', ContractId.fromEvmAddress(0, 0, missionFactory[0]).toString());

	const lazyGasStation = await query('lazyGasStation');
	console.log('Lazy Gas Station:', ContractId.fromEvmAddress(0, 0, lazyGasStation[0]).toString());

	const lazyDelegateRegistry = await query('lazyDelegateRegistry');
	console.log('Lazy Delegate Registry:', ContractId.fromEvmAddress(0, 0, lazyDelegateRegistry[0]).toString());

	// Rewards
	const rewards = await query('getRewards');
	console.log('Available Rewards:');
	for (let i = 0; i < rewards[0].length; i++) {
		console.log(`\tToken: ${TokenId.fromSolidityAddress(rewards[0][i])}`);
		console.log('\t\tSerials:', rewards[1][i].map(s => Number(s)).join(', '));
	}

	// Requirements
	const requirements = await query('getRequirements');
	console.log('Allowed Entry Collateral:');
	for (let i = 0; i < requirements[0].length; i++) {
		console.log(`\tToken: ${TokenId.fromSolidityAddress(requirements[0][i])}`);
		const serialLock = Boolean(requirements[1][i]);
		if (serialLock) {
			console.log('\t\tOnly Serials:', requirements[2][i].map(s => Number(s)).join(', '));
		}
		else {
			console.log('\t\tAll Serials');
		}
	}

	// Full mission state
	const missionState = await query('missionState');
	console.log('Mission State:',
		'\n\tFactory:', ContractId.fromEvmAddress(0, 0, missionState[0]).toString(),
		'\n\tCreator:', AccountId.fromEvmAddress(0, 0, missionState[1]).toString(),
		'\n\tDuration:', Number(missionState[2]), 'seconds (', Number(missionState[2]) / 60, 'minutes) or (', Number(missionState[2]) / 3600, 'hours)',
		'\n\tEntry Fee:', Number(missionState[3]) / Math.pow(10, lazyTokenDetails.decimals), `$${lazyTokenDetails.symbol}`,
		'\n\tFee Burn Percentage:', Number(missionState[4]), '%',
		'\n\tLast Entry Timestamp:', new Date(Number(missionState[5]) * 1000).toUTCString(),
		'\n\tStart Timestamp:', Number(missionState[6]) ? new Date(Number(missionState[6]) * 1000).toUTCString() : 'UNSET',
		'\n\tMin Entry Fee:', Number(missionState[7]) / Math.pow(10, lazyTokenDetails.decimals), `$${lazyTokenDetails.symbol}`,
		'\n\tDecrement Amount:', Number(missionState[8]),
		'\n\tDecrement Interval:', Number(missionState[9]), 'seconds (', Number(missionState[9]) / 60, 'minutes)',
		'\n\tTotal Serials As Rewards:', Number(missionState[10]),
		'\n\tNb Of Rewards:', Number(missionState[11]),
		'\n\tNb Of Requirements:', Number(missionState[12]),
	);
};

runScript(main);
