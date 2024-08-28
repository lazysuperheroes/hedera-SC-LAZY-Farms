const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
require('dotenv').config();
const fs = require('fs');
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { contractExecuteFunction, readOnlyEVMFromMirrorNode } = require('../../utils/solidityHelpers');
const { getArgFlag } = require('../../utils/nodeHelpers');

// Get operator from .env file
let operatorKey;
let operatorId;
try {
	operatorKey = PrivateKey.fromStringED25519(process.env.PRIVATE_KEY);
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch (err) {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const contractName = 'Mission';

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
		console.log('Usage: addRequirementAndRewardCollectionsToMission.js 0.0.MMMM 0.0.Req1,0.0.Req2 0.0.Rew1,0.0.Rew2');
		console.log('		MMM is the mission address');
		console.log('		Req1, Req2 are the requirement collection addresses');
		console.log('		Rew1, Rew2 are the reward collection addresses');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const requirementCollectionIds = args[1].split(',').map(id => TokenId.fromString(id));
	const rewardCollectionIds = args[2].split(',').map(id => TokenId.fromString(id));

	console.log('\n-Using ENIVRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Using Requirement Collections:', requirementCollectionIds.map(id => id.toString()));
	console.log('\n-Using Reward Collections:', rewardCollectionIds.map(id => id.toString()));

	// get existing requirement and reward collections
	let encodedCommand = missionIface.encodeFunctionData(
		'getRewards',
		[],
	);

	let result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	let rewards = missionIface.decodeFunctionResult('getRewards', result);

	console.log('Available Rewards:');
	for (let i = 0; i < rewards[0].length; i++) {
		console.log(`\tToken: ${TokenId.fromSolidityAddress(rewards[0][i])}`);
		console.log('\t\tSerials:', rewards[1][i].map(s => Number(s)).join(', '));

	}

	encodedCommand = missionIface.encodeFunctionData(
		'getRequirements',
		[],
	);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	let requirements = missionIface.decodeFunctionResult('getRequirements', result);

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

	// import ABI
	const missionJSON = JSON.parse(
		fs.readFileSync(
			`./artifacts/contracts/${contractName}.sol/${contractName}.json`,
		),
	);

	const missionIface = new ethers.Interface(missionJSON.abi);

	const proceed = readlineSync.keyInYNStrict('Do you want to add reward/requirement collections to the mission?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}


	result = await contractExecuteFunction(
		contractId,
		missionIface,
		client,
		2_000_000,
		'addRequirementAndRewardCollections',
		[requirementCollectionIds.map(id => id.toSolidityAddress()), rewardCollectionIds.map(id => id.toSolidityAddress())],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error adding requirement & reward collections:', result);
		return;
	}

	console.log('Collections added. Transaction ID:', result[2]?.transactionId?.toString());

	encodedCommand = missionIface.encodeFunctionData(
		'getRewards',
		[],
	);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	rewards = missionIface.decodeFunctionResult('getRewards', result);

	console.log('Available Rewards:');
	for (let i = 0; i < rewards[0].length; i++) {
		console.log(`\tToken: ${TokenId.fromSolidityAddress(rewards[0][i])}`);
		console.log('\t\tSerials:', rewards[1][i].map(s => Number(s)).join(', '));

	}

	encodedCommand = missionIface.encodeFunctionData(
		'getRequirements',
		[],
	);

	result = await readOnlyEVMFromMirrorNode(
		env,
		contractId,
		encodedCommand,
		operatorId,
		false,
	);

	requirements = missionIface.decodeFunctionResult('getRequirements', result);

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
};


main()
	.then(() => {
		// eslint-disable-next-line no-useless-escape
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
