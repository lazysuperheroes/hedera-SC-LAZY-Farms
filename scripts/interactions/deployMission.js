/**
 * Deploy a new Mission via MissionFactory
 * Refactored to use shared utilities
 */
const { ContractId, TokenId } = require('@hashgraph/sdk');
const { createHederaClient, getCommonContractIds } = require('../../utils/clientFactory');
const { loadInterface } = require('../../utils/abiLoader');
const { parseArgs, printHeader, runScript, confirmOrExit, logResult, parseCommaList } = require('../../utils/scriptHelpers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { sleep } = require('../../utils/nodeHelpers');
const { GAS } = require('../../utils/constants');

const main = async () => {
	const { client, operatorId, env } = createHederaClient({ requireOperator: true });

	const args = parseArgs(9, 'deployMission.js <factoryId> <duration> <fee> <requirements> <rewards> <burn> <expiry> <numReq> <numRew>', [
		'<factoryId> - MissionFactory contract ID (e.g., 0.0.12345) or "env" to use MISSION_FACTORY_CONTRACT_ID',
		'<duration> - Mission duration in seconds',
		'<fee> - Entry fee in $LAZY (smallest unit)',
		'<requirements> - Requirement token IDs (comma separated, e.g., 0.0.111,0.0.222)',
		'<rewards> - Reward token IDs (comma separated, e.g., 0.0.333,0.0.444)',
		'<burn> - Burn percentage of LAZY fees (0-100)',
		'<expiry> - Timestamp for mission expiry (last entry time)',
		'<numReq> - Number of requirements to enter the mission',
		'<numRew> - Number of rewards per user',
	]);

	// Parse factory ID - allow "env" to use environment variable
	let contractId;
	if (args[0].toLowerCase() === 'env') {
		const { missionFactoryId } = getCommonContractIds();
		if (!missionFactoryId) {
			console.log('ERROR: MISSION_FACTORY_CONTRACT_ID not set in .env file');
			process.exit(1);
		}
		contractId = missionFactoryId;
	}
	else {
		contractId = ContractId.fromString(args[0]);
	}

	const duration = parseInt(args[1]);
	const fee = parseInt(args[2]);
	const requirements = parseCommaList(args[3]).map(t => TokenId.fromString(t));
	const rewards = parseCommaList(args[4]).map(t => TokenId.fromString(t));
	const burn = parseInt(args[5]);
	const expiry = parseInt(args[6]);
	const numReq = parseInt(args[7]);
	const numRew = parseInt(args[8]);

	printHeader({
		scriptName: 'Deploy Mission',
		env,
		operatorId: operatorId.toString(),
		contractId: contractId.toString(),
		additionalInfo: {
			'Duration': `${duration} seconds (${duration / 60} minutes)`,
			'Entry Fee': `${fee} $LAZY`,
			'Requirements': requirements.map(r => r.toString()).join(', '),
			'Rewards': rewards.map(r => r.toString()).join(', '),
			'Burn %': `${burn}%`,
			'Expiry': expiry > 0 ? new Date(expiry * 1000).toISOString() : 'None',
			'Num Requirements': numReq,
			'Num Rewards': numRew,
		},
	});

	const missionFactoryIface = loadInterface('MissionFactory');

	// Convert tokens to Solidity addresses
	const reqTokenAsSolidityList = requirements.map(tokenId => tokenId.toSolidityAddress());
	const rewTokenAsSolidityList = rewards.map(tokenId => tokenId.toSolidityAddress());

	confirmOrExit('Do you want to deploy this mission?');

	const result = await contractExecuteFunction(
		contractId,
		missionFactoryIface,
		client,
		GAS.MISSION_DEPLOY,
		'deployMission',
		[
			duration,
			fee,
			reqTokenAsSolidityList,
			rewTokenAsSolidityList,
			burn,
			expiry,
			numReq,
			numRew,
		],
	);

	if (result[0]?.status?.toString() !== 'SUCCESS') {
		console.log('ERROR: Transaction failed:', result[0]?.status ?? result);
		return;
	}

	const missionContract = ContractId.fromEvmAddress(0, 0, result[1][0]);

	// Wait for the contract to be created and populated to mirrors
	await sleep(5000);
	const missionId = await missionContract.populateAccountNum(client);

	console.log('\nMission deployed successfully!');
	console.log('Mission Contract ID:', missionId.toString());
	logResult(result, 'Mission Deployment');
};

runScript(main);
