const { AccountId, ContractId, TokenId } = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const { readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { homebrewPopulateAccountEvmAddress, getTokenDetails } = require('../../utils/hederaMirrorHelpers');
const { default: axios } = require('axios');

// Get operator from .env file
let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify ACCOUNT_ID in the .env file', err);
}

const contractName = 'MissionFactory';
const boostManagerName = 'BoostManager';
const missionName = 'Mission';

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	// configure the client object
	if (operatorId === undefined || operatorId == null) {
		console.log(
			'Environment required, please specify ACCOUNT_ID & SIGNING_KEY in the .env file',
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.length != 1 || getArgFlag('h')) {
		console.log('Usage: getLazyFarmingEconomy.js 0.0.MF');
		console.log('		0.0.MF is the MissionFactory');
		return;
	}

	const contractId = ContractId.fromString(args[0]);

	console.log('\n-**STAKING**');
	console.log('-Using ENIVRONMENT:', env);
	console.log('-Using Operator:', operatorId.toString());
	console.log('-Using MissionFactory Contract:', contractId.toString());

	// import ABI
	const missionFactoryJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const missionFactoryIface = new ethers.Interface(missionFactoryJSON.abi);

	// import ABI
	const boostManagerJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${boostManagerName}.sol/${boostManagerName}.json`,
		),
	);

	const boostManagerIface = new ethers.Interface(boostManagerJSON.abi);

	// import ABI
	const missionJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${missionName}.sol/${missionName}.json`,
		),
	);

	const missionIface = new ethers.Interface(missionJSON.abi);

	// query mirror nodes to call the following methods:
	// 1) getDeployedMissions

	let encodedCommand = missionFactoryIface.encodeFunctionData(
		'getAvailableSlots',
		[],
	);

	let result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const getAvailableMissions = missionFactoryIface.decodeFunctionResult(
		'getAvailableSlots',
		result,
	);

	// lazyToken
	encodedCommand = missionFactoryIface.encodeFunctionData(
		'lazyToken',
		[],
	);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const lazyToken = missionFactoryIface.decodeFunctionResult(
		'lazyToken',
		result,
	);

	const lazyTokenId = TokenId.fromSolidityAddress(lazyToken[0]);

	// get the details of the lazyToken from the mirror node
	const lazyTokenDetails = await getTokenDetails(env, lazyTokenId);

	let totalSlots = 0;
	const liveMissionCount = getAvailableMissions[0].length;
	const missionRequirements = {};
	for (let i = 0; i < liveMissionCount; i++) {
		totalSlots += Number(getAvailableMissions[0][i]);
		const missionIdAsEVM = getAvailableMissions[1][i];

		const missionId = await homebrewPopulateAccountEvmAddress(env, missionIdAsEVM);

		// get the mission details
		const encodedMissionCall = missionIface.encodeFunctionData('getRequirements', []);

		const missionResult = await readOnlyEVMFromMirrorNode(
			env,
			missionIdAsEVM,
			encodedMissionCall,
			operatorId,
			false,
		);

		const missionDetails = missionIface.decodeFunctionResult('getRequirements', missionResult);

		// convert the [0] element from a list of EVM addresses to a list of AccountIds
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

	// get the BoostManager details from the MissionFactory
	// boostManager
	encodedCommand = missionFactoryIface.encodeFunctionData(
		'boostManager',
		[],
	);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	const boostManager = missionFactoryIface.decodeFunctionResult(
		'boostManager',
		result,
	);

	const boostManagerId = ContractId.fromEvmAddress(0, 0, boostManager[0]);

	// query the BoostManager for the live Boosts with liveBoosts()
	encodedCommand = boostManagerIface.encodeFunctionData(
		'liveBoosts',
		[],
	);

	result = await readOnlyEVMFromMirrorNode(
		env,
		boostManagerId,
		encodedCommand,
		operatorId,
		false,
	);

	const boostData = boostManagerIface.decodeFunctionResult(
		'liveBoosts',
		result,
	);

	const liveBoosts = Number(boostData[0]);

	// query the logs of MissionFactory to figure out number of missions completed and total boosts.
	const { boosts, missionEntry, completedMissions } = await parseMissionFactoryLogs(missionFactoryIface, contractId);

	console.log('Available Slots:', totalSlots);
	console.log('Live Mission Count:', liveMissionCount);
	console.log('Mission Requirements:', missionRequirements);
	console.log('Live Gem Boosts:', liveBoosts);
	console.log('Total Boosts:', boosts);
	console.log('Users Farming:', missionEntry - completedMissions);
	console.log('Completed Missions:', completedMissions);
};

/**
 * Hard coded inside the file to ease portability
 * @param {Ethers.Interface} iface Ethers Interface object
 * @param {ContractId} contractId ContractId object
 * @returns {Promise<{boosts: number, missionEntry: number, completedMissions: number}>}
 */
async function parseMissionFactoryLogs(iface, contractId) {
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
		jsonResponse.logs.forEach(async log => {
			// decode the event data
			if (log.data == '0x') return;
			const event = iface.parseLog({ topics: log.topics, data: log.data });

			// switch on the event name
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

function getBaseURL() {
	if (env.toLowerCase() == 'test' || env.toLowerCase() == 'testnet') {
		return 'https://testnet.mirrornode.hedera.com';
	}
	else if (env.toLowerCase() == 'main' || env.toLowerCase() == 'mainnet') {
		return 'https://mainnet-public.mirrornode.hedera.com';
	}
	else if (env.toLowerCase() == 'preview' || env.toLowerCase() == 'previewnet') {
		return 'https://previewnet.mirrornode.hedera.com';
	}
	else if (env.toLowerCase() == 'local') {
		return 'http://localhost:8000';
	}
	else {
		throw new Error('ERROR: Must specify either MAIN, TEST, LOCAL or PREVIEW as environment');
	}
}

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
