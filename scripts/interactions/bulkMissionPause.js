const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const { contractExecuteFunction } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');
const readlineSync = require('readline-sync');
const { getContractEVMAddress } = require('../../utils/hederaMirrorHelpers');

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const contractName = 'MissionFactory';

const env = process.env.ENVIRONMENT ?? null;

let client;


const main = async () => {
	// configure the client object
	if (
		operatorKey === undefined ||
		operatorKey == null ||
		operatorId === undefined ||
		operatorId == null
	) {
		console.log(
			'Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	if (env.toUpperCase() == 'TEST') {
		client = Client.forTestnet();
		console.log('testing in *TESTNET*');
	}
	else if (env.toUpperCase() == 'MAIN') {
		client = Client.forMainnet();
		console.log('testing in *MAINNET*');
	}
	else if (env.toUpperCase() == 'PREVIEW') {
		client = Client.forPreviewnet();
		console.log('testing in *PREVIEWNET*');
	}
	else if (env.toUpperCase() == 'LOCAL') {
		const node = { '127.0.0.1:50211': new AccountId(3) };
		client = Client.forNetwork(node).setMirrorNetwork('127.0.0.1:5600');
		console.log('testing in *LOCAL*');
	}
	else {
		console.log(
			'ERROR: Must specify either MAIN or TEST or LOCAL as environment in .env file',
		);
		return;
	}

	client.setOperator(operatorId, operatorKey);

	const args = process.argv.slice(2);
	if (args.length != 3 || getArgFlag('h')) {
		console.log('Usage: bulkMissionPause.js 0.0.FFFF 0.0.MM1,0.0.MM2 [1|0]');
		console.log('       FFFF is the mission factory address');
		console.log('       MM1,MM2 are the mission addresses (comma separated - no spaces)');
		console.log('       1 to pause, 0 to unpause');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const missionList = args[1].split(',');
	let pause;
	try {
		pause = parseInt(args[2]);
		if (pause != 1 && pause != 0) {
			throw new Error('Invalid pause value');
		}
	}
	catch (err) {
		console.log('ERROR: Must specify 1 or 0 to pause or unpause');
		console.log(args[2], err.message);
		return;
	}

	const missionsAsAccountIds = missionList.map((m) => ContractId.fromString(m).toString());
	const missionsAsSolidityAddresses = [];

	for (const mission of missionList) {
		missionsAsSolidityAddresses.push(await getContractEVMAddress(env, mission));
	}

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Missions (Hedera):', missionList);
	console.log('\n-Missions (EVM):', missionsAsAccountIds);
	console.log('\n-Pause:', pause ? 'PAUSE' : 'UNPAUSE');

	const proceed = readlineSync.keyInYNStrict('Do you want to change pause status?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	// import ABI
	const missionJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const missionFactoryIface = new ethers.Interface(missionJSON.abi);

	// deployMission
	const result = await contractExecuteFunction(
		contractId,
		missionFactoryIface,
		client,
		null,
		'updateMissionPause',
		[
			missionsAsSolidityAddresses,
			pause,
		],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.error('ERROR: Transaction failed', result);
		return;
	}

	console.log('Pause updated - Tx Id:', result[2].transactionId.toString());

};


main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
