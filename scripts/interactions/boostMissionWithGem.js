/**
 * Boost a mission using a Gem NFT
 * The gem is returned when the user exits the mission
 * Refactored to use shared utilities
 * Supports --multisig flag for multi-signature execution
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, getMultisigOptions, contractExecuteWithMultisig } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { setNFTAllowanceAll } = require('../../utils/hederaHelpers');
const { getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');
const { lookupLevel } = require('../../utils/LazyFarmingHelper');
const { GAS } = require('../../utils/constants');

/**
 * Format time remaining for display
 */
function formatTimeRemaining(seconds) {
	return `${seconds} seconds -> ${Math.floor(seconds / 60)} minutes -> ${Math.floor(seconds / 3600)} hours -> ${Math.floor(seconds / 86400)} days`;
}

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(4, 'boostMissionWithGem.js 0.0.BBBB 0.0.MMMM 0.0.GGG <serial>', [
		'BBBB is the boost manager address',
		'MMMM is the mission address',
		'GGG is the collection address of the boost Gem',
		'<serial> is the serial number of the NFT',
	]);

	const contractId = ContractId.fromString(args[0]);
	const missionAsEVM = await getContractEVMAddress(env, args[1]);
	const missionId = ContractId.fromEvmAddress(0, 0, missionAsEVM);
	const gemId = TokenId.fromString(args[2]);
	const serial = Number(args[3]);

	printHeader({
		scriptName: 'Boost Mission with Gem NFT',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Mission': `${missionId.toString()} -> ${args[1]}`,
			'Gem': gemId.toString(),
			'Serial': serial,
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
	const currEndTimestamp = Number(currentEndAndBoost[0]);

	if (currEndTimestamp === 0) {
		console.log('ERROR: User is not on this mission. Exiting...');
		process.exit(0);
	}

	if (currEndTimestamp < Math.floor(Date.now() / 1000)) {
		console.log('User has completed this mission. No need to Boost. Exiting...');
		process.exit(0);
	}

	console.log('\nUser has Boosted:', Boolean(currentEndAndBoost[1]));

	if (currentEndAndBoost[1]) {
		console.log('Already boosted, exiting...');
		process.exit(0);
	}

	console.log('Current end:', currEndTimestamp, '->', new Date(currEndTimestamp * 1000).toISOString());
	const timeRemaining = currEndTimestamp - Math.floor(Date.now() / 1000);
	console.log('Time remaining:', formatTimeRemaining(timeRemaining));

	// Check the gem boost level
	const reduction = await queryBoost('getBoostLevel', [gemId.toSolidityAddress(), serial]);
	console.log('\nGem Boost Level:', lookupLevel(Number(reduction[0])));

	// Get boost data for the reduction percentage
	const boostData = await queryBoost('getBoostData', [Number(reduction[0])]);
	console.log('This boost reduces time remaining by:', Number(boostData[3]), '%');

	confirmOrExit('\nDo you want to Boost with Gem NFT (NFT returned on exit)?');

	// Set NFT allowance to BoostManager
	let result = await setNFTAllowanceAll(
		client,
		[gemId],
		operatorId,
		contractId,
	);

	if (result !== 'SUCCESS') {
		console.log('Error setting NFT allowance:', result);
		return;
	}

	const multisigOptions = getMultisigOptions();

	// Execute boost
	result = await contractExecuteWithMultisig(
		contractId,
		boostIface,
		client,
		GAS.BOOST_ACTIVATE + 300_000,
		'boostWithGemCards',
		[missionId.toSolidityAddress(), gemId.toSolidityAddress(), serial],
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
