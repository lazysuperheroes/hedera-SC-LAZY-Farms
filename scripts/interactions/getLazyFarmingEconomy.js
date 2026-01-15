/**
 * Get $LAZY Farming Economy overview
 * Queries MissionFactory for missions, boosts, and active farming stats
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { default: axios } = require('axios');
const { createHederaClient } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript } = require('../../utils/scriptHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getTokenDetails, getBaseURL, homebrewPopulateAccountNum } = require('../../utils/hederaMirrorHelpers');

const main = async () => {
	const { operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(1, 'getLazyFarmingEconomy.js 0.0.MF', [
		'0.0.MF is the MissionFactory',
	]);

	const contractId = ContractId.fromString(args[0]);

	printHeader({
		scriptName: 'Lazy Farming Economy',
		env,
		operatorId: operatorId.toString(),
		missionFactory: contractId.toString(),
	});

	const missionFactoryIface = loadInterface('MissionFactory');
	const boostManagerIface = loadInterface('BoostManager');
	const missionIface = loadInterface('Mission');

	// Helper for mirror node queries
	const queryFactory = async (fcnName, params = []) => {
		const encoded = missionFactoryIface.encodeFunctionData(fcnName, params);
		const result = await readOnlyEVMFromMirrorNode(env, contractId, encoded, operatorId, false);
		return missionFactoryIface.decodeFunctionResult(fcnName, result);
	};

	// Get available slots
	const getAvailableMissions = await queryFactory('getAvailableSlots');

	// Get lazyToken
	const lazyToken = await queryFactory('lazyToken');
	const lazyTokenId = TokenId.fromSolidityAddress(lazyToken[0]);

	// Get lazyToken details
	const lazyTokenDetails = await getTokenDetails(env, lazyTokenId);

	let totalSlots = 0;
	const liveMissionCount = getAvailableMissions[0].length;
	const missionRequirements = {};

	for (let i = 0; i < liveMissionCount; i++) {
		totalSlots += Number(getAvailableMissions[0][i]);
		const missionIdAsEVM = getAvailableMissions[1][i];

		const missionId = await homebrewPopulateAccountNum(env, missionIdAsEVM);

		// Get mission requirements
		const encodedMissionCall = missionIface.encodeFunctionData('getRequirements', []);
		const missionResult = await readOnlyEVMFromMirrorNode(
			env,
			missionIdAsEVM,
			encodedMissionCall,
			operatorId,
			false,
		);

		const missionDetails = missionIface.decodeFunctionResult('getRequirements', missionResult);

		// Convert EVM addresses to TokenIds
		const missionRequirementsList = [];
		for (let j = 0; j < missionDetails[0].length; j++) {
			const tokenId = TokenId.fromSolidityAddress(missionDetails[0][j]);
			const serialLock = Boolean(missionDetails[1][j]);
			const serials = missionDetails[2][j].map((serial) => Number(serial));

			missionRequirementsList.push({
				tokenId,
				serialLock,
				serials,
			});
		}

		const missionObj = {
			missionId: missionId.toString(),
			missionAsEVM: missionIdAsEVM,
			missionRequirements: missionRequirementsList,
			missionCost: Number(getAvailableMissions[2][i]) * 10 ** -lazyTokenDetails.decimals,
		};

		missionRequirements[missionId.toString()] = missionObj;
	}

	// Get BoostManager from MissionFactory
	const boostManager = await queryFactory('boostManager');
	const boostManagerId = ContractId.fromEvmAddress(0, 0, boostManager[0]);

	// Query BoostManager for live boosts
	const encodedBoostCall = boostManagerIface.encodeFunctionData('liveBoosts', []);
	const boostResult = await readOnlyEVMFromMirrorNode(
		env,
		boostManagerId,
		encodedBoostCall,
		operatorId,
		false,
	);

	const boostData = boostManagerIface.decodeFunctionResult('liveBoosts', boostResult);
	const liveBoosts = Number(boostData[0]);

	// Parse MissionFactory logs
	const { boosts, missionEntry, completedMissions } = await parseMissionFactoryLogs(env, missionFactoryIface, contractId);

	console.log('Available Slots:', totalSlots);
	console.log('Live Mission Count:', liveMissionCount);
	console.log('Mission Requirements:', missionRequirements);
	console.log('Live Gem Boosts:', liveBoosts);
	console.log('Total Boosts:', boosts);
	console.log('Users Farming:', missionEntry - completedMissions);
	console.log('Completed Missions:', completedMissions);
};

/**
 * Parse MissionFactory logs for stats
 * @param {string} env - Environment
 * @param {ethers.Interface} iface - Ethers Interface object
 * @param {ContractId} contractId - ContractId object
 * @returns {Promise<{boosts: number, missionEntry: number, completedMissions: number}>}
 */
async function parseMissionFactoryLogs(env, iface, contractId) {
	const baseUrl = getBaseURL(env);
	let missionEntry = 0;
	let boosts = 0;
	let completedMissions = 0;

	let url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?order=desc&limit=100`;

	while (url) {
		const response = await axios.get(url).catch((err) => {
			console.error(err);
			return null;
		});
		if (!response) break;

		const jsonResponse = response.data;
		jsonResponse.logs.forEach(log => {
			// Decode the event data
			if (log.data == '0x') return;
			const event = iface.parseLog({ topics: log.topics, data: log.data });

			switch (event.name) {
			case 'MissionJoinedFactory':
				missionEntry++;
				break;
			case 'BoostActivatedFactory':
				boosts++;
				break;
			case 'MissionCompletedFactory':
				completedMissions++;
				break;
			}
		});

		// Update the URL for the next page
		url = jsonResponse.links?.next ? `${baseUrl}${jsonResponse.links.next}` : null;
	}

	return { boosts, missionEntry, completedMissions };
}

runScript(main);
